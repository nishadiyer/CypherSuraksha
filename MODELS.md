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

**Measured, original pipeline (whole frame squashed to 224x224, no crop)** on 80 labelled face images (40 real from IMDB-WIKI, 40 fake from `OpenRL/DeepFakeFace`: 14 InsightFace face-swap, 13 Stable Diffusion inpainting, 13 Stable Diffusion text-to-image; seeded sample, OpenRAIL dataset, images not committed, `tests/fixtures/deepfake/manifest.json` records names and hashes). Each image goes through the real extension path (224x224 frame, PEOPLE shield, real onnxruntime-web in Chrome):

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
- **The current pipeline is at chance on a realistic video-call frame.** Pasting each face small into a 16:9 tile (face about 45% of the tile height) drops AUC to 0.52 dev / 0.56 test, because the whole tile is squashed into the model. **Cropping to the detected face first** (the UltraFace detector already in the repo) restores it to 0.74 / 0.77 and lifts face-swap AUC from 0.62 to 0.80 on test (0.42 to 0.68 dev). It costs a little on generated faces (text-to-image AUC 0.995 to 0.934 on test). So the sampler now sends the whole frame and the offscreen worker detects and crops the face (implemented, measured below).
- Even cropped, face-swap recall at a threshold that keeps false alarms under 1% is only about 6-21%. A detector trained on face-swaps would be needed for a real fix. The tile is a flat grey background, a simplification of real calls.

**Current pipeline (implemented):**
1. The content script sends the **whole frame** (aspect kept, longest side up to 640 px), not a 224x224 squash.
2. The offscreen worker runs the UltraFace detector (`face-detector.ultraface.onnx`), takes the largest face (at least 32 px) and crops a square with 30% margin (black where it leaves the frame).
3. **No face found: the frame is not scored.** The pill shows a neutral grey "No face" and the 5-frame window is left untouched, because the model is at chance on frames without a clear face.
4. Backend: if a **real GPU** is present (software renderers such as SwiftShader are rejected) the FP32 model (`people-deepfake.fp32.onnx`, 87 MB) runs on WebGPU, and is kept only if a timed warm inference is under 250 ms; otherwise the INT8 model runs on WASM. The reported backend (`webgpu` / `wasm`) drives the sampler's 2 FPS / 1 FPS cap. If the detector file is missing the old whole-frame path is used.
5. The pill now reads "No fake found" / "Unsure" / "Fake?" (it used to say "Real", which overclaimed).

**Measured, current pipeline** on the same 80-image dev set (`node tests/e2e/run.mjs people`, real Chrome; `E2E_REAL_GPU=1` for the real GPU):

| | Software GPU (INT8, WASM) | Real Apple GPU (FP32, WebGPU) |
|---|---|---|
| AUC, whole frames | 0.836 | 0.825 |
| **AUC, small face in a 16:9 call tile** (was 0.52, chance) | **0.738** | **0.732** |
| Accuracy at 0.5 (whole frames) | 71.1% | 68.4% |
| Real called real | 38/38 | 38/38 |
| Face-swap caught | 1/13 | 1/13 |
| Inpainting caught | 5/13 | 5/13 |
| Text-to-image caught | 10/12 | 8/12 |
| Face found in the frame | 95% plain, 81% tile | same |
| **Median time per frame** | 864 ms | **82 ms** |

Accuracy at a fixed 0.5 threshold went **down** (75% to about 70%) while AUC went up: cropping makes the scores rank better but lowers generated-face scores, so 0.5 is no longer the best cut-off. Face-swap detection is still essentially absent (1/13); cropping improved its *ranking* (AUC 0.62 to 0.80 on the larger test set) but not its recall at a usable threshold. The detector misses the face in about 19% of small-face tile frames (those frames are skipped, not guessed). Real webcam video is still untested.

**Second detector for face-swaps (optional, real GPU only): GenD CLIP ViT-L/14.**

The main model above is weak on face-swaps. I tested every ONNX-ready alternative on the same cropped faces (80 dev + 200 test images): the `prithivMLmods` Exp-02-21 / Exp-02-22 pair, `AI-vs-Deepfake-vs-Real` and the `dima806`-derived `deepfake_vs_real_image_detection` all scored **at or below chance** (AUC 0.29-0.52; three of them rated the real Wikipedia portraits as *more* fake, i.e. they key on image style). The KoreaPeter FF++ EfficientNets are gated (a logged-in Hugging Face account must accept terms), so they were not tried. The one that worked is GenD (`HoopitAI/video-deepfake-detection-GenD_CLIP_L_14_FF`, MIT): OpenAI CLIP ViT-L/14 with only its LayerNorms fine-tuned on **FaceForensics++**, which contains face-swaps.

| Held-out check (offline, 192 test images, thresholds from the 78-image dev split only) | CommunityForensics alone | GenD alone | **Both (either flags it)** |
|---|---|---|---|
| Face-swap AUC (test) | 0.79 | 0.86 | **0.92** (rank-averaged) |
| False alarms on real photos | 1.0% | 2.1% | 3.1% |
| Face-swaps caught | 16% | 58% | **65%** |
| Inpainting caught | 75% | 31% | 81% |
| Text-to-image caught | 81% | 28% | 84% |

They are complementary (GenD sees swaps, CommunityForensics sees generated faces), so the frame score is `max(main, g(GenD))` where `g` maps GenD's probability linearly from 0.41 (its 90th percentile on real dev photos) to 0.95. At a 0.5 cut-off on the test split that flags 2.1% of real photos and catches 58% of swaps, 69% of inpainting and 78% of text-to-image.

**Measured in the extension** (`E2E_REAL_GPU=1 node tests/e2e/run.mjs people`, real Apple GPU, 80-image dev set, both detectors):

| | Main model only (real GPU) | **Both detectors** |
|---|---|---|
| AUC, whole frames | 0.825 | **0.938** |
| AUC, face in a call tile | 0.732 | **0.808** |
| Accuracy at 0.5 | 68.4% | **84.2%** |
| **Face-swaps caught** | **1/13** | **10/13** |
| Inpainting / text-to-image caught | 5/13, 8/12 | 8/13, 9/12 |
| Real called real | 38/38 | 37/38 |

**Costs and limits, plainly:**
- Build with `npm run models:gend` (needs Python 3.9+, about 4 GB of disk, downloads 1.2 GB of pinned, checksummed weights, **produces a 609 MB FP16 file**). `scripts/people/export_gend.py` rebuilds the architecture from the weights with the standard `transformers` CLIP vision model, so the repository's own Python is never executed. The ONNX output matches PyTorch (fp32 logit 0.14537 vs 0.14536; fp16 on WebGPU within about 0.04 in logit).
- **It only runs on a real GPU (WebGPU, FP16).** Software renderers are rejected and a timed self-test (under 600 ms) must pass; otherwise the shield uses the main model alone, exactly as before. There is no WASM fallback (a 1.2 GB FP32 or ~300 MB INT8 CLIP-L would take seconds per frame).
- **Speed:** GenD is the slow part. Per frame on the dev Mac: face detection about 9 ms, main model 44-87 ms, **GenD 255-570 ms** (a standalone page measured 95-175 ms; the same GPU gives very different numbers depending on what else is loading it). Expect about 0.3-0.7 s per frame with both, so the adaptive sampler settles at 0.5-1 FPS.
- **Size:** with this model the extension's model files total about 1.1 GB.
- **Licence:** the code and CLIP backbone are MIT, but the weights were fine-tuned on FaceForensics++, whose own terms are research-oriented. Check them before any commercial release.
- **Live webcam false positive (first real test, Google Meet, real GPU):** the face-swap detector scored the user's own real face at **93%** (calibrated) while the main model said **0%**, which made the pill red and showed the "may be AI-generated" warning. The detector was tuned on 40 still photos; compressed, differently lit webcam video is a different picture, and one reading cannot re-tune it. So it is now **opt-in (off by default; switch in the popup) and capped at 0.65, below the red line (0.7): alone it can make the pill amber ("Unsure"), never red and never the warning modal; red needs the main model to agree.** The main model read the same face correctly. The benchmark numbers above are unchanged by the cap (they use a 0.5 cut-off). A proper fix needs labelled real-webcam data to re-calibrate, which we do not have.
- **Evidence is thin:** the dev/test fixtures are the same dataset, whose face-swaps are InsightFace swaps; the real photos are Wikipedia portraits and the fakes 512 px squares (a style confound); the GenD calibration comes from only 40 real dev photos; webcam video is untested. Treat 58-65% swap recall as promising, not proven.

**What this does and does not mean. Read before trusting the pill:**
- The main model detects *AI-generated* faces much better than *face-swapped* ones: **on its own it did not catch a single face-swap in the original fixture, and face-swap is the most common live-call deepfake.** The optional GenD detector (above) fixes most of that on a real GPU. A green pill means "no sign of AI generation found", not "verified real".
- The fixture is small (80), the real photos are Wikipedia portraits (non-square, some greyscale) and the fakes are 512x512 squares, so part of what it separates may be image style. Webcam video (compression, lighting, motion) is untested; false-positive and false-negative rates on real calls are unknown.
- On a machine without a real GPU the INT8 WASM path takes about 0.85 s per frame (detection + crop + classify), so the adaptive sampler settles at 0.5-1 FPS and the red circuit breaker needs roughly 7 frames (about 15 s) to trip. With a real GPU it is about 80 ms.
- INT8 on WASM only (see the NER note on WebGPU). **The same model in FP32 (87 MB) runs 12x faster on a real GPU**: 53 ms per frame on Apple Metal WebGPU against 627 ms on WASM, output identical (max difference 8e-6). This is now wired in (see below). Another model tried first, `Deep-Fake-Detector-v2` (Apache-2.0, 92% on its own test set), scored at chance here (AUC 0.48-0.51, same result in FP32 and under face crops) and was not adopted.

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

### Ensemble experiment: adding iResNet and ViT recognisers did not help (negative result)

To make the cloak transfer to recognisers it wasn't built on (ArcFace-style), I added recognisers from other families to the PGD ensemble and measured every recogniser, members marked `*`, the rest unseen. Same protocol as above (LFW, 40 identities, +/-8/255, 30 steps, rank-1, `scripts/cloak/bench_ensemble.py`). New recognisers, all rebuilt from weights only (`scripts/cloak/recognisers.py`, no third-party code run): iResNet-18 (AdaFace, WebFace4M), iResNet-101 (AdaFace, WebFace12M), two ViT-tiny/8 (AdaFace and ArcFace losses, MS1MV3).

| Ensemble used for the cloak | VGGFace2 | CASIA | IR-18 | IR-101 | ViT-A | ViT-B | ArcFace R50 |
|---|---|---|---|---|---|---|---|
| none (clean) | 97.5 | 97.5 | 95.0 | 97.5 | 85.0 | 90.0 | 97.5 |
| VGGFace2 + CASIA (shipped) | **30.0*** | **32.5*** | 75.0 | 95.0 | 62.5 | 60.0 | 95.0 |
| + IR-18 | 30.0* | 37.5* | **70.0*** | 95.0 | 62.5 | 57.5 | 92.5 |
| + ViT-A | 30.0* | 35.0* | 75.0 | 95.0 | **62.5*** | 60.0 | 95.0 |
| + IR-18 + ViT-A | 37.5* | 37.5* | 67.5* | 95.0 | 62.5* | 62.5 | 92.5 |
| + IR-18 + IR-101 + ViT-A | 40.0* | 37.5* | 70.0* | **97.5*** | 62.5* | 62.5 | 92.5 |

Attacked **alone** (white-box), IR-18 only fell to 85%, IR-101 stayed at 97.5% and ViT-A at 85%, while a FaceNet falls to about 30%. So extra members bought **no extra transfer** (ArcFace 92.5-95% in every row) and the members themselves are barely disrupted; the FaceNet-only cloak already lowers the weak ViT-tiny recognisers (85/90% to 60%) and IR-18 (95% to 75%) as a side effect. The larger ensembles also cost more time per face (about 4 s vs 2.5 s in PyTorch for the 4-member set).

**Why (bisected on 8 images):** the attack *does* work inside its own optimisation on every model (similarity to the clean embedding driven to about 0 for IR-101), and the effect **survives being applied to the real, quantised, native-resolution photo** (IR-101 0.15, IR-18 0.12). It is lost only in the **attacker's view**: viewed through the attack's own sampler at the attacker's exact crop, IR-101 is back to 0.86. The attacker's fixed box was 0.74x my detector's box and about 0.22 of its height higher (UltraFace boxes are loose and low), and iResNet/ViT recognisers are far more sensitive to crop position and scale than FaceNet (IR-101 similarity at the optimised crop 0.06, 0.38 at 0.8x, 0.36 at 1.3x, 0.78 at 1.6x). Training over a much wider random range of crop scales and shifts (0.4-1.1x, up to 0.35 shift) did **not** fix it, even though the attacker's crop was inside that range. Resampling method (antialiasing, supersampling, optimising at native resolution) made no difference.

**Budget needed (IR-101 alone, wide jitter):** similarity at the attacker's crop 0.86 at +/-8, 0.74 at +/-16, 0.68 at +/-16 with 80 steps, 0.54 at +/-24 with 80 steps. Telling two people apart typically needs similarity around 0.3 or below, so a crop-robust cloak against this family needs **visibly strong noise** and many more steps. Conclusion: at invisible budgets this method does not protect against iResNet/ViT-family recognisers, and adding them to the ensemble does not change that. The shipped FaceNet pair stays as it is; a stronger guarantee needs a different tool (for example blurring faces, which works against every recogniser but is visible). Reproduce with `python scripts/cloak/fetch_eval_assets.py WORK` then `scripts/cloak/bench_ensemble.py` (see its docstring). Caveats: 40 identities, one gallery photo each; LFW only; these recognisers are research-licensed (WebFace/MS1MV3/InsightFace) and used for evaluation only.

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
