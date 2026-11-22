#!/usr/bin/env python3
"""Measures how well the extension's REAL cloak output defeats face recognisers (P2.2.5).

Threat model: an attacker scrapes the cloaked photos into a gallery; later a clean photo of the same
person is matched against it. We report rank-1 identification over N identities (LFW), clean vs cloaked.

  1. python eval_extension.py dump  WORKDIR [--lfw-home DIR] [--n 40]      writes WORKDIR/in/{g,p}NN.png
  2. node tests/e2e/cloakBench.mjs  WORKDIR                                 cloaks WORKDIR/in/g*.png -> WORKDIR/out
  3. python eval_extension.py eval  WORKDIR [--arcface w600k_r50.onnx]      prints rank-1 per recogniser

Recognisers: the two FaceNet graphs shipped in public/models (they are in the cloak ensemble), and
optionally ArcFace R50 (InsightFace w600k_r50, research-only licence: evaluation only, never shipped),
which the cloak never saw. The attacker's crop is a fixed, well-aligned face box (LFW is pre-aligned).
Needs: numpy pillow scikit-learn onnxruntime.
"""
import argparse
import os
import numpy as np
import onnxruntime as ort
from PIL import Image

BOX = (60, 190)  # attacker's aligned face box in the 250x250 funneled LFW image
HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, '..', '..', 'public', 'models')


def sample(lfw_home, n):
    from sklearn.datasets import fetch_lfw_people
    d = fetch_lfw_people(data_home=lfw_home, min_faces_per_person=2, color=True, resize=1.0, slice_=(slice(0, 250), slice(0, 250)))
    imgs = (d.images * 255).astype(np.uint8) if d.images.max() <= 1.5 else d.images.astype(np.uint8)
    rng = np.random.RandomState(7)
    ids = rng.choice([i for i in np.unique(d.target) if (d.target == i).sum() >= 2], n, replace=False)
    gal = [imgs[np.where(d.target == i)[0][0]] for i in ids]
    probe = [imgs[np.where(d.target == i)[0][1]] for i in ids]
    return gal, probe


def crop(img, size):
    return np.asarray(Image.fromarray(img[BOX[0]:BOX[1], BOX[0]:BOX[1]]).resize((size, size), Image.BILINEAR), np.float32) / 255


class Recognisers:
    def __init__(self, arcface):
        so = ort.SessionOptions()
        so.intra_op_num_threads = 8
        mk = lambda p: ort.InferenceSession(p, so, providers=['CPUExecutionProvider'])
        self.facenets = {k: mk(os.path.join(MODELS, f)) for k, f in [('vggface2', 'cloak-facenet-vggface2.onnx'), ('casia-webface', 'cloak-facenet-casia.onnx')]}
        self.arc = mk(arcface) if arcface else None

    def names(self):
        return list(self.facenets) + (['arcface (held out)'] if self.arc else [])

    def emb(self, name, img):
        if name.startswith('arcface'):
            x = ((crop(img, 112) * 255 - 127.5) / 127.5).transpose(2, 0, 1)[None].astype(np.float32)
            e = self.arc.run(None, {self.arc.get_inputs()[0].name: x})[0][0]
        else:
            e = self.facenets[name].run(None, {'x': crop(img, 160).transpose(2, 0, 1)[None], 'target': np.zeros((1, 512), np.float32)})[2][0]
        return e / np.linalg.norm(e)

    def rank1(self, gallery, probes, name):
        g = np.stack([self.emb(name, i) for i in gallery])
        p = np.stack([self.emb(name, i) for i in probes])
        return float((np.argmax(p @ g.T, axis=1) == np.arange(len(gallery))).mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['dump', 'eval'])
    ap.add_argument('workdir')
    ap.add_argument('--lfw-home', default=os.path.join(os.path.expanduser('~'), 'scikit_learn_data'))
    ap.add_argument('--n', type=int, default=40)
    ap.add_argument('--arcface')
    a = ap.parse_args()
    gal, probe = sample(a.lfw_home, a.n)
    if a.mode == 'dump':
        os.makedirs(os.path.join(a.workdir, 'in'), exist_ok=True)
        for i, (g, p) in enumerate(zip(gal, probe)):
            Image.fromarray(g).save(os.path.join(a.workdir, 'in', f'g{i:02d}.png'))
            Image.fromarray(p).save(os.path.join(a.workdir, 'in', f'p{i:02d}.png'))
        print(f'wrote {a.n} gallery + {a.n} probe images to {a.workdir}/in')
        return
    out = [np.asarray(Image.open(os.path.join(a.workdir, 'out', f'g{i:02d}.png')).convert('RGB')) for i in range(a.n)]
    diff = max(int(np.abs(o.astype(int) - g.astype(int)).max()) for o, g in zip(out, gal))
    R = Recognisers(a.arcface)
    print(f'{a.n} identities, cloaked gallery vs clean probe, max pixel change {diff}/255')
    print(f'{"recogniser":22s} {"clean":>7s} {"cloaked":>8s}')
    for n in R.names():
        print(f'{n:22s} {R.rank1(gal, probe, n):7.1%} {R.rank1(out, probe, n):8.1%}')


main()
