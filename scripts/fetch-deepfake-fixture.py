#!/usr/bin/env python3
"""Builds the labelled deepfake fixture used by tests/e2e/gatePeople.mjs.

Reads a seeded random sample of images straight out of the remote OpenRL/DeepFakeFace zips with HTTP range
requests (no multi-GB download). Real = wiki.zip (IMDB-WIKI faces); fake = insight (face swap), inpainting
(Stable Diffusion inpainting) and text2img (Stable Diffusion v1.5). Dataset licence: OpenRAIL. Third-party
images are written to tests/fixtures/deepfake/ (git-ignored); only manifest.json (names + sha256) is committed.

Run with: python3 -I scripts/fetch-deepfake-fixture.py   (output dir must be separate from this script)
"""
import hashlib, io, json, random, sys, urllib.request, zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "deepfake"
PLAN = [("wiki", "real", 40), ("insight", "fake", 14), ("inpainting", "fake", 13), ("text2img", "fake", 13)]
SEED = 20261122
# Optional: build a second, disjoint evaluation set, e.g.
#   python3 -I scripts/fetch-deepfake-fixture.py --seed 7 --out tests/fixtures/deepfake-test --counts wiki=100,insight=34,inpainting=33,text2img=33 --exclude tests/fixtures/deepfake/manifest.json
if len(sys.argv) > 1:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--counts", default="")
    ap.add_argument("--exclude", default="")
    a = ap.parse_args()
    SEED, OUT = a.seed, Path(a.out).resolve()
    if a.counts:
        c = dict(kv.split("=") for kv in a.counts.split(","))
        PLAN = [(n, "real" if n == "wiki" else "fake", int(c[n])) for n in c]
    EXCLUDE = {i["source"] for i in json.loads(Path(a.exclude).read_text())["items"]} if a.exclude else set()
else:
    EXCLUDE = set()


class RangeFile(io.RawIOBase):
    def __init__(self, url):
        r = urllib.request.urlopen(urllib.request.Request(url, method="HEAD"))
        self.url, self.size, self.pos = r.geturl(), int(r.headers["Content-Length"]), 0
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos
    def read(self, n=-1):
        if n < 0 or self.pos + n > self.size: n = self.size - self.pos
        if n <= 0: return b""
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + n - 1}"})
        data = urllib.request.urlopen(req).read()
        self.pos += len(data)
        return data
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)


def main():

    meta = json.load(urllib.request.urlopen("https://huggingface.co/api/datasets/OpenRL/DeepFakeFace"))
    FULL_REV = meta["sha"]
    OUT.mkdir(parents=True, exist_ok=True)
    items = []
    for name, label, n in PLAN:
        z = zipfile.ZipFile(RangeFile(f"https://huggingface.co/datasets/OpenRL/DeepFakeFace/resolve/{FULL_REV}/{name}.zip"))
        names = sorted(i.filename for i in z.infolist() if i.filename.lower().endswith((".jpg", ".jpeg", ".png")) and f"{name}.zip:{i.filename}" not in EXCLUDE)
        picks = random.Random(f"{SEED}-{name}").sample(names, n)
        for k, fn in enumerate(sorted(picks)):
            data = z.read(fn)
            dst = f"{label}-{name}-{k:02d}.jpg"
            (OUT / dst).write_bytes(data)
            items.append({"file": dst, "label": label, "generator": name, "source": f"{name}.zip:{fn}", "sha256": hashlib.sha256(data).hexdigest()})
        print(f"{name}: {n} images", file=sys.stderr)
    manifest = {"dataset": "OpenRL/DeepFakeFace", "revision": FULL_REV, "licence": "openrail", "seed": SEED, "items": items}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"wrote {len(items)} images + manifest.json to {OUT}", file=sys.stderr)

main()
