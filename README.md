# AI Shield

A Chrome Manifest V3 extension that protects everyday users, students and families from AI-driven threats. **Everything runs on your device. Nothing is uploaded.**

| Pillar | What it does |
|---|---|
| **Privacy** | Intercepts prompts on ChatGPT, Claude, Gemini and Copilot, swaps names, emails, IDs and secrets for placeholders (`[PERSON_1]`) before they leave the page, and restores the real values on screen in the replies. |
| **Pixels** | Intercepts image uploads (`<input type=file>` and drag-and-drop) on social sites, applies a bounded perturbation in memory, strips metadata, and hands the page the cloaked file. A badge offers "Bypass on this site". |
| **People** | Samples video during Google Meet, Zoom Web and WhatsApp Web calls at 0.5–2 FPS, scores each frame, smooths over 5 frames, and shows a green/yellow/red pill. Sustained red opens a warning modal. |

## Security invariants

1. **Zero network.** `content_security_policy.extension_pages` is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'none';`. The engine can still read its own packaged files (models), but every outbound request raises a CSP violation.
2. **RAM-only processing.** Prompts, images and frames are never written to `localStorage`, `IndexedDB`, `chrome.storage.local` or caches. Tensors are `.dispose()`d and typed buffers zero-filled right after inference.
3. **Ephemeral redaction maps.** Placeholder→value maps live in `chrome.storage.session`, keyed by `tabId`, and are purged on `tabs.onRemoved` and on navigation or reload.
4. **Zero-knowledge vault.** "Never share" keywords are salted and hashed with Web Crypto SHA-256 before saving. Only the salt and digests are stored.
5. **UI isolation.** All injected UI (pill, toast, badge, modal) lives in *closed* Shadow DOM roots styled through `adoptedStyleSheets`.

## Architecture

```
Content scripts (isolated world)  ──chrome.runtime.sendMessage──►  Service worker (router)
  prompt / upload / video interceptors                               allowlist + toggles, session maps,
  closed Shadow DOM UI                                               offscreen singleton, ledger
                                                                          │
                                                                          ▼
                                                              Offscreen document
                                                                one dedicated Web Worker per shield
                                                                (Privacy · Pixels · People)
                                                                onnxruntime-web: WebGPU → WASM SIMD
```

All shields implement the contract in `src/types/shield.ts`: a `ShieldRequest { requestId, shield, tabId, domain, payload }` in, a `ShieldResponse { requestId, action: ALLOW|MODIFY|WARN|BLOCK, data?, confidence, latencyMs }` out.

```
src/background   router, offscreen singleton manager, per-tab session store, ledger
src/content      interceptors (prompt, upload, video) and ui/ (closed Shadow DOM + Tailwind)
src/offscreen    registry, workers, shields (privacy, pixel, people), ORT loader
src/popup        Preact popup: toggles, trusted sites, never-share list, local ledger
src/shared       messages, settings, vault, base64 helpers
src/types        shield contract
```

## Build and install

```bash
npm install
npm run build          # tsc --noEmit, vite build, manifest/CSP gate
npm run audit:final    # static audit (console leaks, dispose wiring, network & storage invariants)
npm test               # unit tests
npm run package        # build + zip to release/ai-shield-<version>.zip for the Chrome Web Store
```

Open `chrome://extensions`, enable Developer mode, **Load unpacked**, choose `dist/`.

`npm run test:e2e` additionally drives a real Chrome against fake pages (needs Google Chrome; set `CHROME_PATH` if it is not in the macOS default location). It is a developer check and is not part of `npm run build`.

## Privacy

See [PRIVACY.md](PRIVACY.md).

## Models

The extension works with no model files, using deterministic fallbacks. `npm run models` installs the real Privacy NER model. Drop quantized `.onnx` weights into `public/models/` to upgrade each shield. See [MODELS.md](MODELS.md) for file names, tensor shapes, configs, Olive/Foundry notes and the offline ("Airplane Mode") check.

## Supported sites

Prompt redaction: chatgpt.com, chat.openai.com, claude.ai, gemini.google.com, copilot.microsoft.com.
Upload cloaking: Instagram, Facebook, X/Twitter, TikTok, LinkedIn, Reddit, Snapchat, Pinterest, Discord, WhatsApp Web, Telegram Web, Imgur, Flickr, Threads, Bluesky.
Video: Google Meet, Zoom (`*.zoom.us`), WhatsApp Web.

`host_permissions` list exactly these sites; add more in `manifest.json` (both `host_permissions` and the matching `content_scripts` entry).

## Limits to know about

- Site selectors for the prompt interceptors target the current DOM of each chat app. They are only tested against stand-in pages, and sites change their markup, so they may need updating.
- Without a cloaking model, the Pixels fallback is bounded noise, **not** a learned adversarial cloak and gives no guarantee against any recognition system.
- Without a deepfake model, the People shield shows an explicit yellow "Unverified" state rather than green. With the installed model (`npm run models`) it catches most AI-generated faces but **missed every face-swap in our 80-image test** (MODELS.md), and it is slow (about 0.6 s/frame), so a green pill does not mean the caller is real. Detectors are advisory and can be wrong either way.
- Prompt redaction without an NER model catches structured data and name cues ("my name is …"), not arbitrary names. Run `npm run models` to install the real NER model (see MODELS.md); it is not committed because of its size.
- JavaScript strings cannot be zeroed; "zero-fill" applies to the typed arrays and tensors that hold images, frames and tokens.
