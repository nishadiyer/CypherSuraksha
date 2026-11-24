# Live demo: show AI Shield catching an AI-generated or swapped face

A local page plays a still picture as if it were a participant on a video call, so you can watch the pill react in front of an audience. **It is a demo, not a test of real calls**: real calls are live video, and live webcam video behaves differently from still pictures (see "What to say honestly").

## One-time setup

```bash
npm run fixtures        # downloads the sample pictures (public research datasets; not committed)
npm run demo:prepare    # copies the three demo pictures into demo/media/
npm run build:demo      # builds a separate DEMO extension into dist-demo/ (adds http://localhost; the shipping build never has it)
```
Then in Chrome: `chrome://extensions` → turn off or remove the normal **AI Shield** → **Load unpacked** → choose **`dist-demo/`** (its name ends with "(DEMO build)"). Keep only one AI Shield enabled.

The demo page is already served by PM2 as `ai-shield-demo`: **http://localhost:4186/** (`pm2 ls` to check; `pm2 restart ai-shield-demo` if needed).

## Running it

| Click | What AI Shield should do | Why |
|---|---|---|
| **Real person** | Green pill **"No fake found"** | Both detectors read it as 0% |
| **AI-generated face** | Pill turns **red "Fake?"** after about 10 to 20 s, then the warning **"This video may be AI-generated"** | The main model reads fully AI-generated faces at about 99.7% |
| **Face-swapped face** | Normally **green**. With the **experimental face-swap switch on** (popup, needs a real GPU and the optional model) it turns **amber "Unsure"** | The main model cannot see swaps; the experimental detector can, but is capped below red on purpose |
| **Use my own image or video** | Whatever the models make of it | Try your own clips |

Tips:
- **Hover the pill** to show the numbers: smoothed score, main model, face-swap detector, backend and frames per second.
- Open the AI Shield popup: **This page** shows "Latest reading", and the **Face-swap detector (experimental)** switch is under Shields.
- Switch modes on a **fresh tab** if you want a clean reading: the pill smooths over the last 5 frames, so it takes a few seconds to change.
- The first reading after loading takes longer while models load.

## A live camera feed instead of a still picture (optional)
For a more convincing demo, route a real deepfake video into Chrome as a camera: install OBS, add the video as a source, **Start Virtual Camera**, then pick "OBS Virtual Camera" as the camera in Google Meet (`meet.google.com/new`) with the **normal** extension loaded. Expect the same limits as the table above.

## What to say honestly
- The pictures are **stills played as video**, from public research datasets (IMDB-WIKI real faces; AI-generated and face-swapped faces from DeepFakeFace). They were chosen by scoring every sample through the real pipeline, so they show the detectors **at their best**.
- Measured on ~80 held-out pictures the main model catches most fully AI-generated faces but **only 1 of 13 face-swaps**. The experimental face-swap detector catches 10 of 13 on pictures, but it flagged a **real webcam** as AI-generated in live testing (93% while the main model said 0%), so it is opt-in and can only make the pill amber.
- A green pill never proves the caller is real. These detectors are tuned on photos, not live video. See `MODELS.md`.
- Everything runs on the device; nothing is uploaded.

## Checking it works
`node tests/e2e/demo.mjs` drives the demo page in a real Chrome with the demo build and checks: real stays green; AI-generated goes red and shows the warning; a swap is not red with the detector off. With `E2E_REAL_GPU=1` it also checks the swap goes amber, never red, with the detector on.

## Licence note
The sample pictures come from third-party research datasets (OpenRAIL / IMDB-WIKI) and show real people. They stay in git-ignored `demo/media/`; use them only for local demonstration.
