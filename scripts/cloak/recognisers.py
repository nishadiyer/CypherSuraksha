"""Face recognisers for the cloak ensemble and its evaluation, written from scratch.

Only weight files (safetensors) from third-party repos are loaded; no third-party Python is imported or run.
The iResNet layout (IR-18/50/100, "ir" blocks, 112 px) mirrors the CVLFace checkpoints' key names
(model.net.input_layer / body / output_layer); the ViT-tiny is timm's vit_tiny with patch size 8 at 112 px.
All take RGB in 0..1 at 112 x 112 and normalise with (x - 0.5) / 0.5 internally.
"""
import torch
import torch.nn as nn
from safetensors.torch import load_file

IR_UNITS = {18: (2, 2, 2, 2), 34: (3, 4, 6, 3), 50: (3, 4, 14, 3), 100: (3, 13, 30, 3)}


class BasicBlockIR(nn.Module):
    def __init__(self, cin, depth, stride):
        super().__init__()
        self.shortcut_layer = nn.MaxPool2d(1, stride) if cin == depth else nn.Sequential(nn.Conv2d(cin, depth, 1, stride, bias=False), nn.BatchNorm2d(depth))
        self.res_layer = nn.Sequential(
            nn.BatchNorm2d(cin), nn.Conv2d(cin, depth, 3, 1, 1, bias=False), nn.BatchNorm2d(depth), nn.PReLU(depth),
            nn.Conv2d(depth, depth, 3, stride, 1, bias=False), nn.BatchNorm2d(depth))

    def forward(self, x):
        return self.res_layer(x) + self.shortcut_layer(x)


class IResNet(nn.Module):
    def __init__(self, num_layers: int):
        super().__init__()
        self.input_layer = nn.Sequential(nn.Conv2d(3, 64, 3, 1, 1, bias=False), nn.BatchNorm2d(64), nn.PReLU(64))
        body, cin = [], 64
        for depth, units in zip((64, 128, 256, 512), IR_UNITS[num_layers]):
            body.append(BasicBlockIR(cin, depth, 2))
            body += [BasicBlockIR(depth, depth, 1) for _ in range(units - 1)]
            cin = depth
        self.body = nn.Sequential(*body)
        self.output_layer = nn.Sequential(nn.BatchNorm2d(512), nn.Dropout(0.4), nn.Flatten(), nn.Linear(512 * 7 * 7, 512), nn.BatchNorm1d(512, affine=False))

    def forward(self, x):  # x in 0..1
        return self.output_layer(self.body(self.input_layer((x - 0.5) / 0.5)))


def load_iresnet(path: str, num_layers: int) -> nn.Module:
    sd = {k[len('model.net.'):]: v for k, v in load_file(path).items() if k.startswith('model.net.')}
    net = IResNet(num_layers)
    missing, unexpected = net.load_state_dict(sd, strict=False)
    assert not [m for m in missing if 'num_batches_tracked' not in m] and not unexpected, (missing[:3], unexpected[:3])
    return net.eval()


class ViTRec(nn.Module):
    def __init__(self):
        super().__init__()
        import timm
        self.m = timm.create_model('vit_tiny_patch16_224', pretrained=False, img_size=112, patch_size=8, num_classes=512)

    def forward(self, x):
        return self.m((x - 0.5) / 0.5)


def load_vit_tiny(path: str) -> nn.Module:
    net = ViTRec()
    net.m.load_state_dict(load_file(path))
    return net.eval()
