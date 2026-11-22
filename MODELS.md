# Models

AI Shield runs **without any model files**: every shield has a deterministic fallback so the extension works out of the box. Dropping in quantized `.onnx` weights upgrades each shield. There is no code change and no network access involved.

## How loading works

- Put files in `public/models/`, then `npm run build`. Vite copies them to `dist/models/`.
- At runtime the offscreen document reads them with `fetch(chrome.runtime.getURL('models/<file>'))`.
  The extension CSP is `connect-src 'none'`, which blocks **every** network request but still allows an extension page to read its *own* packaged files. This is verified in `tests/e2e/gate12.mjs`: external fetch/XHR/WebSocket/beacon all raise `securitypolicyviolation`.
- `onnxruntime-web` tries the **WebGPU** execution provider first and falls back to **WASM SIMD**. If a model fails to load, the shield silently uses its fallback.
- Input tensors, output tensors and the pixel/token buffers are `.dispose()`d / zero-filled right after every inference.

## Files per shield

| Shield | Required | Optional |
|---|---|---|
| Privacy (NER) | `privacy-ner.int8.onnx`, `privacy-ner.vocab.txt`, `privacy-ner.config.json` | |
| Pixels (cloak) | `pixel-cloak.fp16.onnx` | `pixel-cloak.config.json` |
| People (deepfake) | `people-deepfake.int8.onnx` | `people-deepfake.config.json` |

### Privacy NER
A BERT-family **token-classification** model (e.g. a cased `bert-base-NER` export) with a WordPiece vocab.

- Inputs: `input_ids`, `attention_mask` (int64 `[1, seq]`); `token_type_ids` is fed only if the graph declares it.
- Output: logits `[1, seq, num_labels]`.
- `privacy-ner.config.json`:
  ```json
  { "id2label": { "0": "O", "1": "B-PER", "2": "I-PER", "3": "B-ORG", "4": "I-ORG", "5": "B-LOC", "6": "I-LOC", "7": "B-MISC", "8": "I-MISC" },
    "doLowerCase": false, "maxLength": 512, "minConfidence": 0.6 }
  ```
  `PER/PERSON`, `ORG`, `LOC/GPE`, `ID`, `SECRET` are redacted; `MISC` is ignored. Labels must be BIO.
- NER spans are merged with the regex detectors (emails, phones, SSN, Luhn-valid cards, API keys…) and your hashed "Never share" list. Overlaps resolve by priority: custom list > secrets > IDs > email > phone > model > name heuristics.

### Pixel cloak
- Input: float32 `[1, 3, H, W]`, RGB, range 0..1. Dynamic or fixed H/W both work (dynamic is capped at `maxSide`, default 1024).
- Output: same shape. `config.output` is `"image"` (default: the perturbed image) or `"delta"` (the perturbation).
- Whatever the model returns, the shield computes `delta`, bilinearly upsamples it to full resolution and **clamps it to ±2…8 /255** (an L∞ budget), so output stays visually identical regardless of model behaviour.
- Output is re-encoded via `OffscreenCanvas` as PNG/JPEG(0.95)/WebP. This also strips EXIF/GPS. GIF/AVIF/HEIC are not processed. They are reported as "not uploaded" rather than passed through.

### People (deepfake classifier)
- Input: float32 `[1, 3, size, size]`, normalised with `mean`/`std`.
- `people-deepfake.config.json`:
  ```json
  { "size": 224, "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225], "output": "sigmoid" }
  ```
  `output`: `"sigmoid"` (one logit), `"prob"` (already 0..1) or `"softmax2"` (`[real, fake]` logits).
- Score is the probability the frame is synthetic. A 5-frame rolling mean drives the pill: `<0.40` green, `0.40–0.70` yellow, `≥0.70` red (only once 5 frames are in). The circuit-breaker modal needs 3 consecutive red evaluations.

## Installed model: Privacy NER

`npm run models` (`node scripts/fetch-models.mjs`) downloads and checksum-verifies the real NER model into `public/models/`, then `npm run build` ships it. The `.onnx` is git-ignored (104 MB, over GitHub's 100 MB file limit); the vocab and config are committed.

| | |
|---|---|
| Model | `Xenova/bert-base-NER`, `onnx/model_quantized.onnx` (INT8 export of `dslim/bert-base-NER`, BERT-base cased, CoNLL-2003 labels) |
| Source | https://huggingface.co/Xenova/bert-base-NER at revision `8e892123e8b7c2c0c2bd1dcb598b7d244c4e53aa` |
| Licence | MIT (both `Xenova/bert-base-NER` and `dslim/bert-base-NER`) |
| SHA-256 | model `caaee70a5518ec7f9e46e5308fcc9263a8c227703a9ce46cf61c69a552349648`, vocab `eeaa9875b23b04b4c54ef759d03db9d1ba1554838f8fb26c5d96fa551df93d02` |

**Measured** (`node tests/e2e/run.mjs ner`, real Chrome, onnxruntime-web, 20 prompt-style sentences written before the model was run, 53 PERSON/ORG/LOC entities; an entity counts when its text no longer appears in the redacted output):

| | Recall | PERSON | LOC | ORG |
|---|---|---|---|---|
| Fallback only (regex + name cues) | 47% (25/53) | 19/21 | 2/18 | 4/14 |
| Real model | 100% (53/53) | 21/21 | 18/18 | 14/14 |

Median 72 ms per prompt on WASM. Known limits: small fixture, so treat the recall as indicative, not a benchmark. The model over-flags some acronyms (it redacted `UDP` as an ORG in an entity-free prompt, 1 of 4 negatives), and it was trained on English news text.

**INT8 models run on WASM only.** `getModel(file, ['wasm'])` pins it. In our first test (headless Chrome, which uses a *software* GPU) the WebGPU provider found almost no entities (47%, same as the fallback) and was about 4x slower (301 ms vs 72 ms). Re-checked later on a **real Apple Metal GPU**: WebGPU was still slower than WASM for this INT8 BERT (130 ms vs 88 ms for a 24-token prompt) and its logits differed (max difference 0.73), so the pin stays, but the earlier "unusable output" was partly a software-GPU artefact. FP32 graphs behave very differently (see the People section).

## Installed model: People deepfake classifier

`npm run models` also installs this. `npm run fixtures` builds the evaluation set; `node tests/e2e/run.mjs people` measures it.

| | |
|---|---|
| Model | `buildborderless/CommunityForensics-DeepfakeDet-ViT`, `onnx/model_int8.onnx` (ViT-Small, 384 px, single logit, sigmoid = P(fake); trained on 2.7M images from 4,803 generators; paper: arXiv 2411.04125) |
| Source | https://huggingface.co/buildborderless/CommunityForensics-DeepfakeDet-ViT at revision `ac6ee457bea904a373065754107451793b56db00` (the corrected `onnx/` files; the older `onnx_legacy/` and the `onnx-community/` copy have a wrong config and are not used) |
| Licence | MIT |
| SHA-256 | `968f113f1107d58bfc73444b6e87020e2d541780ad43b7a1ac3e3b18b86c2bbd` (22 MB) |
| Config | `size` 384, CLIP mean/std, `output: "sigmoid"` |

**Measured** on 80 labelled face images (40 real from IMDB-WIKI, 40 fake from `OpenRL/DeepFakeFace`: 14 InsightFace face-swap, 13 Stable Diffusion inpainting, 13 Stable Diffusion text-to-image; seeded sample, OpenRAIL dataset, images not committed, `tests/fixtures/deepfake/manifest.json` records names and hashes). Each image goes through the real extension path (224x224 frame, PEOPLE shield, real onnxruntime-web in Chrome):

| | Result |
|---|---|
| Accuracy at 0.5 | 75.0% (60/80); AUC 0.783 |
| Real photos called real | 40/40 |
| Stable Diffusion text-to-image caught | 13/13 |
| Stable Diffusion inpainting caught | 7/13 |
| **Face-swap (InsightFace) caught** | **0/14** |
| Median latency | 640 ms/frame on WASM |

An independent Python/PIL + ONNX Runtime run on the FP32 model gives the same numbers (75% at 224 px, AUC 0.78), so the in-browser pipeline and INT8 quantization are not the cause of any of the above.

**Follow-up checks** (the 80-image dev set above plus a disjoint 200-image test set from the same dataset: 100 real, 34 face-swap, 33 inpainting, 33 text-to-image):
- **Re-tuning the threshold does not help face-swaps.** Their median score is 0.000, the same as real photos (AUC 0.42 dev / 0.62 test). Lowering the threshold to 0.01 catches only 21% of swaps on test while 10% of real photos are flagged.
- **The current pipeline is at chance on a realistic video-call frame.** Pasting each face small into a 16:9 tile (face about 45% of the tile height) drops AUC to 0.52 dev / 0.56 test, because the whole tile is squashed into the model. **Cropping to the detected face first** (the UltraFace detector already in the repo) restores it to 0.74 / 0.77 and lifts face-swap AUC from 0.62 to 0.80 on test (0.42 to 0.68 dev). It costs a little on generated faces (text-to-image AUC 0.995 to 0.934 on test). So the sampler must send the whole frame and the offscreen document must crop; today it squashes the frame first. Not implemented yet.
- Even cropped, face-swap recall at a threshold that keeps false alarms under 1% is only about 6-21%. A detector trained on face-swaps would be needed for a real fix. The tile is a flat grey background, a simplification of real calls.

**What this does and does not mean. Read before trusting the pill:**
- It detects *AI-generated* faces much better than *face-swapped* ones. **It did not catch a single face-swap in the fixture, and face-swap is the most common live-call deepfake.** A green pill means "no generator artefacts seen", not "verified real".
- The fixture is small (80), the real photos are Wikipedia portraits (non-square, some greyscale) and the fakes are 512x512 squares, so part of what it separates may be image style. Webcam video (compression, lighting, motion) is untested; false-positive and false-negative rates on real calls are unknown.
- 640 ms per frame (WASM INT8) is far above the 150 ms budget, so the adaptive sampler settles at 0.5 FPS and the red circuit breaker needs roughly 7 frames (about 15 s) to trip.
- INT8 on WASM only (see the NER note on WebGPU). **The same model in FP32 (87 MB) runs 12x faster on a real GPU**: 53 ms per frame on Apple Metal WebGPU against 627 ms on WASM, output identical (max difference 8e-6). That is not wired in yet; it would bring the model under the 150 ms budget. Another model tried first, `Deep-Fake-Detector-v2` (Apache-2.0, 92% on its own test set), scored at chance here (AUC 0.48-0.51, same result in FP32 and under face crops) and was not adopted.

## Installed: Pixel cloak (per-image adversarial face cloak)

No pre-trained "cloak" model exists publicly (Fawkes, LowKey, Glaze and PhotoGuard all optimise each photo against a recogniser instead of shipping a one-pass model). So the Pixel shield does the same, on device, **with no training**:

1. **Face detector**: UltraFace RFB-320 (MIT, 1.2 MB, `face-detector.ultraface.onnx`) finds up to 3 faces (at least 40 px).
2. **Gradient graphs**: for each embedder, `scripts/cloak/export_gradient_onnx.py` exports `d cosine(embed(x), target) / dx` as a pure ONNX graph (traced with `torch.fx`, the four backward ops ONNX cannot express are rewritten exactly; checked against PyTorch, gradient cosine 0.99999 / 1.0). Embedders: `facenet-pytorch` InceptionResnetV1 `vggface2` and `casia-webface` (106 MB each, FP32).
3. **PGD in the offscreen worker**: 30 steps of momentum PGD (L-infinity budget 8/255, step 2.5 eps / steps) against both embedders at once. Each step uses a **random crop scale (0.8-1.3x) and shift** and pulls the gradient back with the exact adjoint of the resize, so the cloak survives an attacker cropping differently (without this the effect collapsed: VGGFace2 went from 0% to 65% identification under a different crop). The perturbation is added only around each face, and the **total** change to any pixel (overlapping faces included) is clamped to the budget.
4. A 20 s per-photo budget stops optimisation early and keeps what it has (`pgd-wasm-truncated`). Photos are processed one at a time. A photo with no face is only re-encoded (metadata stripped), reported as "No face found", and not counted as cloaked.

Build the models with `npm run models:cloak` (creates `.venv-cloak`, needs Python 3.9+; about 213 MB into `public/models/`, git-ignored). If any are missing the shield falls back to the old paths (a feed-forward `pixel-cloak.fp16.onnx` if present, else bounded noise).

| Component | Source | Licence |
|---|---|---|
| Face detector | https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB `version-RFB-320.onnx`, commit `0f9ca4a`, sha256 `34cd7e60...` | MIT |
| FaceNet embedders | `facenet-pytorch` 2.6.0 pretrained `vggface2`, `casia-webface` (exported by us to gradient graphs) | Code MIT. **The weights were trained on VGGFace2 and CASIA-WebFace, whose own terms are research-oriented. Check them before any commercial redistribution.** |

**Measured on the extension's real output** (`scripts/cloak/eval_extension.py` + `tests/e2e/cloakBench.mjs`): 40 LFW identities, one photo per person in an attacker's gallery (cloaked) and a clean photo of the same person as the probe, rank-1 identification; the attacker's crop is a fixed, well-aligned face box:

| Recogniser | Clean | Cloaked | After JPEG q90 | After JPEG q75 |
|---|---|---|---|---|
| FaceNet VGGFace2 (in the ensemble) | 97.5% | **30.0%** | 32.5% | 32.5% |
| FaceNet CASIA-WebFace (in the ensemble) | 97.5% | **27.5%** | 32.5% | 32.5% |
| **ArcFace R50 (held out, never seen by the cloak)** | 97.5% | **95.0%** | 95.0% | 95.0% |

Max change 8/255 per channel (about 3%). 40 photos had 64 faces; 6 of 40 hit the 20 s budget. For comparison, **plain random noise at +/-8/255 changed nothing** (97.5% on all three), which is what the old fallback does.

**What this does and does not mean:**
- It disrupts FaceNet-family recognisers and survives JPEG compression. **It does not stop ArcFace-family recognisers at this invisible budget** (95%, i.e. almost no effect). Earlier prototype runs with a larger budget bought only a little transfer: +/-12 gave ArcFace 85%, and +/-16 / +/-32 gave 87.5% / 52.5% (visible).
- ArcFace R50 (InsightFace `w600k_r50`) is research-licensed and used for **evaluation only; it is not shipped**.
- Small test: 40 identities, one gallery photo each, so each number has a wide margin (several points). LFW is pre-aligned. We did not test resizing, blurring or other cleaning defences, or recognisers retrained on cloaked images; published work shows cloaks of this kind can be defeated that way.
- Cost: about 213 MB of models, 8-15 s per single-face photo on WASM (first photo about 17 s including model load), longer for groups, which hit the 20 s budget.
- Claim to make: "disrupts FaceNet-class face recognition", not "defeats facial recognition".

## Getting weights with Microsoft Olive / Foundry

Olive exports and quantizes; the commands below are the general pattern. Check Olive's docs for current flags and recipes.

```bash
pip install olive-ai onnxruntime
# Example: quantize a Hugging Face token-classification model to INT8
olive auto-opt --model_name_or_path dslim/bert-base-NER --task token-classification \
  --device cpu --precision int8 --output_path out/ner
cp out/ner/model.onnx public/models/privacy-ner.int8.onnx
# vocab.txt comes from the HF repo, and id2label from its config.json
```

Use FP16 for GPU/WebGPU models (`--precision fp16`) and INT8 for WASM. The file names in the table above are the contract. Pick your own architecture, but match the input/output shapes.

> **No detector ships with this repo.** I did not bundle weights, and none were evaluated. Check any deepfake or cloaking model you drop in against your own data before relying on it. Detectors are bypassable and give false positives and negatives. The pill is advisory.

## What the fallbacks do (and don't)

| Shield | Fallback | Limitation |
|---|---|---|
| Privacy | Regex/checksum detectors + name/org/address heuristics + hashed vault | Misses names/places that have no cue ("Ada walked to Paris") — that is what the NER model is for |
| Pixels | Bounded ±ε sign noise, re-encoded in memory | **Not a learned adversarial cloak.** It changes pixels and strips metadata but gives no guarantee against any recognition model |
| People | Reports **YELLOW "Unverified — detector not installed"**, never GREEN or RED | Without a model there is nothing to analyse; a reassuring green would be a lie |

## Verifying the offline ("Airplane Mode") guarantee

1. **Static:** `npm run build` runs `scripts/verify-build.mjs`, which fails unless the manifest CSP contains `connect-src 'none'` and no network-capable permission (`webRequest`, `proxy`, `cookies`, `history`, broad `host_permissions`, `externally_connectable`…) is present.
2. **Runtime proof:** `npm run test:e2e` loads the built extension in real Chrome and asserts that fetch, XHR, WebSocket and `sendBeacon` from the engine are all blocked by CSP.
3. **By hand:** enable Airplane Mode (or unplug the network), reload the extension at `chrome://extensions`, open a supported site. Redaction, cloaking and the video pill behave exactly as online. In DevTools → Network on the extension's *offscreen document* (`chrome://extensions` → "Inspect views") you will see no requests, and the Console shows no CSP errors, because the code never tries.
