#!/usr/bin/env python3
"""Downloads and verifies everything scripts/cloak/bench_ensemble.py needs into WORK (git-ignored), then builds the LFW set.

Third-party files are data only (weights, images); no third-party Python is downloaded or run.
Licences: the AdaFace/ArcFace-style weights come from CVLFace (WebFace4M/12M) and gaunernst (MS1MV3) training sets and the InsightFace
ArcFace R50 is research-only: all are used for EVALUATION and for the research experiment only, none ships in the extension.

    python scripts/cloak/fetch_eval_assets.py WORK
"""
import hashlib, os, sys, urllib.request

HF = "https://huggingface.co"
ASSETS = [
    ("rec/ir18.safetensors", f"{HF}/minchul/cvlface_adaface_ir18_webface4m/resolve/0dd53f188fa27968b0a1326970ebf4aeb37ce2ca/model.safetensors", "3a416518b11ece107b43385fc3678aad1d4f2405fde9f58f0be7f530230e368b"),
    ("rec/ir101.safetensors", f"{HF}/minchul/cvlface_adaface_ir101_webface12m/resolve/54f602a0737bd1ee4a4e7e9fd089a485f397fefd/model.safetensors", "2ea535a43877bd3de8091903935c783ce335be66a9f8917fae9a7a18ae4bbf56"),
    ("rec/vit_adaface.safetensors", f"{HF}/gaunernst/vit_tiny_patch8_112.adaface_ms1mv3/resolve/8f38db37c3519647f5536fda7eee304a5b8ebba0/model.safetensors", "d60895095f95ab0fab8dda4e7b15278db01ba511583080d12f7ef575d747b7f2"),
    ("rec/vit_arcface.safetensors", f"{HF}/gaunernst/vit_tiny_patch8_112.arcface_ms1mv3/resolve/55262fe66b0c455c04aebd530c852a8c2bf1cb69/model.safetensors", "2308f4b2c895b43f172c419be9d17c34d17cf238fbfdbc020f68177ca21aa014"),
    ("rec/arcface_r50.onnx", f"{HF}/public-data/insightface/resolve/33c1063c49c785b7652d3fd529f86fa4f149392b/models/buffalo_l/w600k_r50.onnx", "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43"),
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def main():
    work = os.path.abspath(sys.argv[1])
    os.makedirs(os.path.join(work, "rec"), exist_ok=True)
    for rel, url, want in ASSETS:
        dst = os.path.join(work, rel)
        if os.path.exists(dst) and sha256(dst) == want:
            print("ok (cached)", rel)
            continue
        print("downloading", rel, flush=True)
        urllib.request.urlretrieve(url, dst)
        got = sha256(dst)
        assert got == want, f"{rel}: checksum mismatch ({got})"
    out = os.path.join(work, "lfw_small.npz")
    if not os.path.exists(out):
        import numpy as np
        from sklearn.datasets import fetch_lfw_people
        d = fetch_lfw_people(data_home=os.path.join(work, "lfw"), min_faces_per_person=2, color=True, resize=1.0, slice_=(slice(0, 250), slice(0, 250)))
        imgs = (d.images * 255).astype(np.uint8) if d.images.max() <= 1.5 else d.images.astype(np.uint8)
        np.savez_compressed(out, images=imgs, target=d.target)
        print("wrote", out, imgs.shape)
    print("assets ready in", work)


main()
