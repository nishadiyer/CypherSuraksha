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
