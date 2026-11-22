#!/usr/bin/env python3
"""Builds public/models/people-gend.fp16.onnx: a CLIP ViT-L/14 face-swap detector (GenD, fine-tuned on FaceForensics++).

Source weights: https://huggingface.co/HoopitAI/video-deepfake-detection-GenD_CLIP_L_14_FF (MIT; trained on FF++,
whose own terms are research-oriented, see MODELS.md), pinned to revision 8d227ed2ef40f8014dbac19aed9dbf7892ee1a7a.
We do NOT run the repository's Python (trust_remote_code). The architecture is rebuilt with the standard
transformers CLIPVisionModel (ViT-L/14, 224 px) plus the 2-class head from the safetensors, which is all the model is:
    logit_fake = (L2norm(pooled_cls) @ W.T + b)[1] - (...)[0]      P(fake) = sigmoid(logit_fake)
Exports FP32 ONNX, checks it against PyTorch, converts to FP16 (keep FP32 inputs/outputs) -> ~609 MB.

Usage: python export_gend.py OUT_DIR [--weights /path/model.safetensors]
"""
import argparse, hashlib, json, os, sys, tempfile, urllib.request

REV = "8d227ed2ef40f8014dbac19aed9dbf7892ee1a7a"
URL = f"https://huggingface.co/HoopitAI/video-deepfake-detection-GenD_CLIP_L_14_FF/resolve/{REV}/model.safetensors"
SHA256 = "ff433972982954d15a16654b61fa2752ce221f3ea213c69504398264d38c49ee"
# Calibration for the extension (derived from the 80-image dev split only, see MODELS.md):
# GenD's probability maps linearly from LO (to 0) to HI (to 1); the frame score is max(CommunityForensics, that).
CONFIG = {"size": 224, "mean": [0.48145466, 0.4578275, 0.40821073], "std": [0.26862954, 0.26130258, 0.27577711], "calibration": {"lo": 0.41, "hi": 0.95}}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--weights")
    a = ap.parse_args()
    import numpy as np, onnx, onnxruntime as ort, torch, torch.nn as nn, torch.nn.functional as F
    from onnxconverter_common import float16
    from safetensors.torch import load_file
    from transformers import CLIPVisionConfig, CLIPVisionModel

    w = a.weights
    if not w:
        w = os.path.join(tempfile.gettempdir(), "gend-model.safetensors")
        if not (os.path.exists(w) and sha256(w) == SHA256):
            print("downloading 1.2 GB of weights ...", file=sys.stderr)
            urllib.request.urlretrieve(URL, w)
    assert sha256(w) == SHA256, "weights checksum mismatch"
    sd = load_file(w)
    cfg = CLIPVisionConfig(hidden_size=1024, intermediate_size=4096, num_hidden_layers=24, num_attention_heads=16, image_size=224, patch_size=14,
                           hidden_act="quick_gelu", layer_norm_eps=1e-5, projection_dim=768, attn_implementation="eager")
    vit = CLIPVisionModel(cfg).eval()
    vit.load_state_dict({k[len("feature_extractor."):]: v for k, v in sd.items() if k.startswith("feature_extractor.vision_model.")})
    W, B = sd["model.linear.weight"].clone(), sd["model.linear.bias"].clone()

    class GenD(nn.Module):
        def __init__(self):
            super().__init__()
            self.m = vit
            self.register_buffer("W", W)
            self.register_buffer("B", B)

        def forward(self, pixel_values):
            f = F.normalize(self.m(pixel_values=pixel_values).pooler_output, p=2, dim=1)
            l = f @ self.W.T + self.B
            return l[:, 1:2] - l[:, 0:1]

    net = GenD().eval()
    x = torch.randn(1, 3, 224, 224)
    with torch.no_grad():
        ref = net(x).item()
    os.makedirs(a.out_dir, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        fp32 = os.path.join(tmp, "gend_fp32.onnx")
        torch.onnx.export(net, (x,), input_names=["pixel_values"], output_names=["logit"], opset_version=18, dynamo=True).save(fp32)
        got = ort.InferenceSession(fp32, providers=["CPUExecutionProvider"]).run(None, {"pixel_values": x.numpy()})[0].item()
        assert abs(got - ref) < 1e-3, f"ONNX fp32 does not match PyTorch: {got} vs {ref}"
        m16 = float16.convert_float_to_float16(onnx.load(fp32, load_external_data=True), keep_io_types=True, disable_shape_infer=True)
        out = os.path.join(a.out_dir, "people-gend.fp16.onnx")
        onnx.save(m16, out)
    with open(os.path.join(a.out_dir, "people-gend.config.json"), "w") as f:
        json.dump(CONFIG, f, indent=2)
        f.write("\n")
    print(f"wrote {out} ({os.path.getsize(out) / 1e6:.0f} MB); fp32 logit {got:.5f} vs torch {ref:.5f}")


main()
