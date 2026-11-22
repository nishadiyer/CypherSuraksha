#!/usr/bin/env python3
"""Exports d(cosine(embed(x), target))/dx of a pretrained FaceNet embedder as a pure ONNX graph.

No training happens here. The embedder's weights are the published MIT-licensed `facenet-pytorch`
checkpoints (VGGFace2, CASIA-WebFace). The backward pass is traced with torch.fx (make_fx), the three
backward ops ONNX cannot express are rewritten exactly (input-gradient only), and the result is exported
and checked against PyTorch. The extension's PGD cloak runs this graph in onnxruntime-web.

Graph:  inputs  x [1,3,160,160] in 0..1,  target [1,512] (unit vector)
        outputs grad [1,3,160,160] (d<emb,target>/dx),  sim [] ,  emb [1,512] (L2-normalised)

Usage:  python export_gradient_onnx.py vggface2|casia-webface OUT.onnx
"""
import operator
import os
import sys

import numpy as np
import onnxruntime as ort
import torch
import torch.nn as nn
import torch.nn.functional as F
from facenet_pytorch import InceptionResnetV1
from facenet_pytorch.models.inception_resnet_v1 import BasicConv2d
from torch.fx.experimental.proxy_tensor import make_fx
from torch.nn.utils.fusion import fuse_conv_bn_eval

aten = torch.ops.aten


def build(which: str) -> nn.Module:
    net = InceptionResnetV1(pretrained=which).eval()
    for p in net.parameters():
        p.requires_grad_(False)
    for mod in net.modules():  # fold BatchNorm into the preceding conv (eval): fewer nodes, no BN ops
        if isinstance(mod, BasicConv2d):
            mod.conv = fuse_conv_bn_eval(mod.conv, mod.bn)
            mod.bn = nn.Identity()
    return net


class Step(nn.Module):
    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, x, target):
        x = x.detach().requires_grad_(True)
        with torch.enable_grad():
            e = F.normalize(self.net(x * 2 - 1), dim=1)  # facenet standardisation ~ (x - 127.5) / 128
            sim = (e * target).sum()
            (g,) = torch.autograd.grad(sim, x)
        return g, sim.detach(), e.detach()


def rewrite_backward_ops(gm: torch.fx.GraphModule) -> None:
    g = gm.graph
    shape = {n: tuple(n.meta['val'].shape) for n in g.nodes if hasattr(n.meta.get('val'), 'shape')}
    for n in list(g.nodes):
        if n.op != 'call_function':
            continue
        if n.target == aten.convolution_backward.default:  # input gradient == transposed convolution
            grad_out, inp, w, _bs, stride, pad, dil, transposed, _op, groups, mask = n.args
            assert not transposed and mask[0] and not mask[1] and not mask[2], mask
            H, W = shape[inp][2:]
            kh, kw = shape[w][2:]
            oh, ow = shape[grad_out][2:]
            outpad = [H - ((oh - 1) * stride[0] - 2 * pad[0] + dil[0] * (kh - 1) + 1), W - ((ow - 1) * stride[1] - 2 * pad[1] + dil[1] * (kw - 1) + 1)]
            with g.inserting_before(n):
                r = g.call_function(aten.convolution.default, (grad_out, w, None, stride, pad, dil, True, outpad, groups))
            shape[r] = shape[inp]
            for u in list(n.users):
                assert u.target == operator.getitem
                if u.args[1] == 0:
                    u.replace_all_uses_with(r)
                    g.erase_node(u)
        elif n.target == aten.max_pool2d_with_indices_backward.default:  # scatter-add through the argmax indices
            grad, inp, _k, _s, _p, _d, _c, idx = n.args
            N, C, H, W = shape[inp]
            oh, ow = shape[grad][2:]
            with g.inserting_before(n):
                zeros = g.call_function(aten.zeros.default, ([N, C, H * W],), {'dtype': torch.float32})
                fi = g.call_function(aten.reshape.default, (idx, [N, C, oh * ow]))
                fg = g.call_function(aten.reshape.default, (grad, [N, C, oh * ow]))
                sc = g.call_function(aten.scatter_add.default, (zeros, 2, fi, fg))
                r = g.call_function(aten.reshape.default, (sc, [N, C, H, W]))
            shape[r] = (N, C, H, W)
            n.replace_all_uses_with(r)
            g.erase_node(n)
        elif n.target == aten.threshold_backward.default:  # ReLU backward
            grad, inp, thr = n.args
            with g.inserting_before(n):
                mask = g.call_function(aten.gt.Scalar, (inp, thr))
                zero = g.call_function(aten.zeros_like.default, (grad,))
                r = g.call_function(aten.where.self, (mask, grad, zero))
            shape[r] = shape[grad]
            n.replace_all_uses_with(r)
            g.erase_node(n)
        elif n.target == aten.native_batch_norm_backward.default:  # eval-mode BatchNorm1d input gradient
            grad, _inp, w, _rm, rv, _sm, _si, train, eps, mask = n.args
            assert not train and mask[0] and not mask[1] and not mask[2]
            with g.inserting_before(n):
                sc = g.call_function(aten.mul.Tensor, (w, g.call_function(aten.rsqrt.default, (g.call_function(aten.add.Tensor, (rv, eps)),))))
                r = g.call_function(aten.mul.Tensor, (grad, sc))
            shape[r] = shape[grad]
            for u in list(n.users):
                assert u.target == operator.getitem
                if u.args[1] == 0:
                    u.replace_all_uses_with(r)
                    g.erase_node(u)
    g.eliminate_dead_code()
    gm.recompile()


def main(which: str, out: str) -> None:
    torch.manual_seed(0)
    m = Step(build(which)).eval()
    x = torch.rand(1, 3, 160, 160)
    t = F.normalize(torch.randn(1, 512), dim=1)
    g_ref, s_ref, e_ref = m(x, t)
    gm = make_fx(m, tracing_mode='real')(x, t)
    rewrite_backward_ops(gm)
    left = {str(n.target) for n in gm.graph.nodes if n.op == 'call_function' and 'backward' in str(n.target)}
    assert not left, f'unexported backward ops remain: {left}'

    class Wrap(nn.Module):
        def __init__(self, gm):
            super().__init__()
            self.gm = gm

        def forward(self, x, t):
            return self.gm(x, t)

    torch.onnx.export(Wrap(gm), (x, t), input_names=['x', 'target'], output_names=['grad', 'sim', 'emb'], opset_version=18, dynamo=True).save(out)
    sess = ort.InferenceSession(out, providers=['CPUExecutionProvider'])
    og, _os, oe = sess.run(None, {'x': x.numpy(), 'target': t.numpy()})
    err_g, err_e = float(np.abs(og - g_ref.numpy()).max()), float(np.abs(oe - e_ref.numpy()).max())
    a, b = og.ravel().astype(np.float64), g_ref.numpy().ravel().astype(np.float64)
    cos = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))
    print(f'{which}: wrote {out} ({os.path.getsize(out) / 1e6:.1f} MB); grad cosine vs PyTorch {cos:.6f}, max|grad diff| {err_g:.2e}, max|emb diff| {err_e:.2e}')
    # Tiny float differences can flip a few ReLUs sitting on their threshold, so compare direction, not bits.
    assert cos > 0.999 and err_e < 1e-4, 'ONNX graph does not match PyTorch'


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
