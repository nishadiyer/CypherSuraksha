# CypherSuraksha — Privacy Policy

_Last updated: 2026-11-22_

CypherSuraksha processes everything on your device. **It collects no data, sends nothing anywhere, and has no servers, accounts, analytics or telemetry.**

## What the extension does with your data
| Data | Handling |
|---|---|
| Text you type into ChatGPT, Claude, Gemini or Copilot | Scanned locally. Sensitive items are replaced with placeholders before the page sends the message. Text is held in memory only. |
| Images you upload to supported social sites | Altered locally in memory, metadata (EXIF/GPS) removed, then given to the site. The original is not saved. |
| Video frames during Google Meet, Zoom Web and WhatsApp Web calls | Sampled and scored locally in memory, then discarded. Frames are never saved. |

## What is stored on your device
- **Settings** (`chrome.storage.local`): master and per-shield on/off switches, and your trusted-site list.
- **"Never share" list** (`chrome.storage.local`): only a random salt and one-way SHA-256 hashes. The words you typed are not stored.
- **Privacy ledger** (`chrome.storage.local`): three counters (prompts redacted, photos cloaked, calls protected). No content.
- **Redaction map** (`chrome.storage.session`): placeholder-to-original pairs for the current tab only, so replies can be shown with the real values. It is deleted when the tab closes or navigates, and by the browser when it closes.

Nothing else is stored. The extension does not use `localStorage`, IndexedDB or caches for your content.

## Network
The extension's pages carry the Content Security Policy `connect-src 'none'`, which makes the browser block every outbound request from them. The extension makes no network calls and never transmits your text, images, video or usage. It only reads its own packaged files (such as model weights).

## Permissions and why
- `offscreen` — runs the local analysis engine in a hidden page.
- `storage` — saves the settings, hashed list and counters above.
- `activeTab`, `scripting` — act on the tab you are using.
- Site access — limited to the listed AI chat, social and video-call sites in the manifest, so it can read the message box, upload field or video on those pages. It is not granted for all sites.

## Limits
Detection is best-effort and can miss items or flag harmless ones. The extension gives no guarantee against any recognition or deepfake system. See the README for details.

## Third parties and children
No data is shared with anyone, because none leaves your device. The extension is suitable for family use and does not knowingly collect any information from anyone, including children.

## Changes and contact
Any change to this policy will be published in this file in the repository, which is its source of truth: https://github.com/nishadiyer/CypherSuraksha. Questions can be raised as issues there.
