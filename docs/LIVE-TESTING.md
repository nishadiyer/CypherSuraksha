# Live-site checks (phasedoc P5.1.1–P5.1.6)

Everything so far was tested on stand-in pages. These checks run the **real extension on real sites** with **your** accounts, so each one is yours to run. Use **fake data only**: nothing here needs your real name, email or photo.

Each check is: do the steps, then report **PASS / FAIL** plus what is asked under "If it fails". I tick the phasedoc leaf only after a PASS you report.

## 0. Install the extension (once)

```bash
cd CypherKaavach
npm install
npm run models          # NER + deepfake models (needed for Privacy/People)
npm run build
```
1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose the `dist/` folder.
2. Pin the **CypherSuraksha** icon. Open its popup: master switch and all three pillars should be on, trusted-site list empty.
3. Open the service worker's console once (`chrome://extensions` → CypherSuraksha → "service worker") and keep it open. Errors show there.

`dist/` is large (hundreds of MB) because it contains the models. That is expected. Loading it can take several seconds.

**Optional extras** (not needed for checks 1–4): `npm run models:cloak` (the photo cloak, check 5) and `npm run models:gend` (face-swap detector, check 6, real GPU only). Without the cloak models, check 5 only proves interception, not cloaking.

## Test data (fake)

Paste this as the prompt in checks 1–4:

> My name is Priya Venkataraman and my email is priya.v@example.com. My phone is +91 98765 43210. Please write a two-line thank-you note.

Expected: **3 items** redacted (name, email, phone). The toast says "Redacted 3 sensitive items" (the name may be caught by the NER model or by the "my name is" cue).

## Checks 1–4: chat sites (P5.1.1 ChatGPT, P5.1.2 Claude, P5.1.3 Gemini, P5.1.4 Copilot)

Sites: chatgpt.com, claude.ai, gemini.google.com, copilot.com (or copilot.microsoft.com). Start a **new chat**, signed in.

1. **Before typing**, click the **CypherSuraksha icon**. The **"This page"** section tells you directly whether CypherSuraksha is running on this tab and whether it found the site's message box:
   - `✓ AI chat detected (chatgpt.com): CypherSuraksha is running on this tab` and `✓ Message box: found` is what you want. "Send button: not on the page yet" is normal (many sites only show it after you type).
   - `✗ … not running on this tab`: reload the tab (Cmd+R). If it still says that, tell me.
   - `✗ Message box: NOT found`: the site changed its page. Tell me, and also run the DevTools snippet `docs/live-testing/inspect-selectors.js` (type `allow pasting` in the Console first, then paste it) and send me the **last screen** of its output.
2. Type or paste the fake prompt, then press **Enter** (do not click anything else).
3. Look for the **toast** "Redacted N sensitive items" bottom-right/top-right of the page.
4. **Verify what the site actually received:** after the reply finishes, **reload the page** (this also clears the extension's on-screen restore map) and open that conversation. In the history, your message should read `[PERSON_1]`, `[EMAIL_1]`, `[PHONE_1]` instead of the real values. That proves the placeholders, not the originals, reached the site.
5. Repeat once with the **Send button** instead of Enter.
6. Before reloading, check that the **reply** (if it repeats your name/email) shows the real values on screen (the extension restores them visually).

**PASS** when: the toast appears, the reloaded history shows placeholders, and both Enter and the Send button worked.

**If it fails**, report: which step; the exact toast text (or "no toast"); whether the message sent with your real data; the output of `inspect-selectors.js`; and any red errors in the page console or the service-worker console. A typical failure is "selectors match 0 elements": the site changed its markup, and the snippet output is exactly what I need to fix it.

Two things that are **not** failures: the redaction map is per tab and is purged on reload (so placeholders show after reload by design), and if the extension cannot process a prompt it blocks the send and shows a message; press send again to send it unprotected.

## Check 5: photo upload on a social site (P5.1.5)

Pick a listed site you have an account on: instagram.com, facebook.com, x.com, reddit.com, linkedin.com, discord.com, imgur.com (imgur allows anonymous uploads). Use a **test photo with a face that is not you** if you like; a stock photo is fine. **You do not need to post anything.**

1. Open the site's "create post / upload" dialog.
2. Select the photo with the file picker (and, in a second try, drag-and-drop it).
3. Expect a small dark badge **"Cloaking photo…"**, then (8–20 s per face; longer the first time because models load) **"Cloaked"** with a **Bypass on this site** link. A photo with no face says "No face found — location data removed".
4. **Verify the page received the cloaked file:** in DevTools Console run
   `[...document.querySelectorAll('input[type=file]')].map(i => [...i.files].map(f => [f.name, f.type, f.size]))`
   and compare with your original file's size. They should differ (re-encoded). If the site shows a preview, it should look identical to the eye.
5. Do **not** click Post/Share.

**PASS** when the badge says Cloaked and the file the page holds is the re-encoded one.

**If it fails**, report: the site; picker vs drag-and-drop; badge text (or none); the Console command's output; service-worker console errors. Some sites upload through scripts that never use a file input; that would show as "no badge", and I'd need to know which flow.

## Check 6: pill on a live call (P5.1.6)

1. Go to `meet.google.com/new` (or start a Zoom web / WhatsApp Web call) and **turn your camera on**. You can be alone in the meeting: your own self-view is a playing video and is enough.
2. Within about 10 seconds a small **pill** should appear on the video: "No fake found" (green), "Unsure" (amber), or "No face" (grey if your face is out of view).
3. Hover the pill: the tooltip shows the status, score, backend (`webgpu` or `wasm`) and frames per second.
4. Open the popup: **Calls protected** should have gone up by 1.

**PASS** when a pill appears on a real call video.

**If it fails**, report: which service; whether the pill never appeared, or appeared on the wrong element; the service-worker console errors. A plausible failure is that the site's video cannot be read (browsers block pixels from some streams); that shows up as the pill never appearing.

Note: a green pill never means the caller is real. See README and MODELS.md for what the detectors can and cannot do.

## Reporting back

Send me, per check: **PASS/FAIL**, and for FAIL the items listed above. Paste text rather than screenshots where you can (the snippet output, console errors). Never paste real personal data.
