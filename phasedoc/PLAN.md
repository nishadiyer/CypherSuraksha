# AI Shield — plan of record

Internal, builders-facing. Tracks what is done, what is actually proven, and what is still open for the AI Shield browser extension. The live task tree is in `BUILDPLAN.md` (generated) and in the cockpit.

> **Retrospective seeding.** Phases P0–P4 were built before this phasedoc existed. They were seeded afterwards; tick dates for them are the seeding date, and every tick records only a test that was re-run at seeding time.

## P0 — Foundation, security and message routing
The extension is a Chrome add-on made of three layers. Small scripts injected into web pages watch what the user does; a background "router" decides whether a request is allowed and passes it on; a hidden helper page does the heavy computation. All three talk only through Chrome's built-in messaging.

The most important rule is that nothing may leave the browser. A Content Security Policy (CSP, a browser rule list that says what a page may load or contact) forbids every network connection from the extension's own pages. This phase proves that rule holds in a real browser and that the layers cooperate correctly when many tabs ask for help at once.

## P1 — Pillar 1, Privacy: prompt redaction
When someone types into an AI chat, the extension intercepts the send, swaps names, emails, phone numbers and secrets for placeholders such as `[PERSON_1]`, and only then lets the message go. In the reply it swaps the placeholders back so the person sees real names, while the AI company only ever saw placeholders.

Detection works in two ways: fixed rules (patterns for emails, phone numbers and the like) and, once installed, a trained model for named-entity recognition (NER, finding people, organisations and places in free text). The real model is the main open item in this phase.

## P2 — Pillar 2, Pixels: image cloaking
When someone uploads a photo to a social site, the extension intercepts the file, makes tiny pixel changes that people cannot see but that can disturb face-recognition software, removes hidden metadata such as location, and hands the cleaned copy to the website. A small badge confirms it and offers a one-click "bypass" for that site.

Today the pixel changes come from simple bounded noise, which is honest plumbing but not a proven shield. The open leaves are to install a real trained cloaking model and to measure whether it actually reduces recognition.

## P3 — Pillar 3, People: video-call deepfake warning
During a web video call the extension looks at the other person's video once or twice a second, asks a model how likely it is to be computer-generated, averages the last five answers to avoid flicker, and shows a green, yellow or red dot. If it stays red it shows a warning telling the user not to send money or share secrets.

The sampling, averaging and warning screens are built and tested with a stand-in model. A real deepfake detector has not been installed, so on real calls the dot shows an explicit "unverified" state.

## P4 — Popup, ledger, documentation
The toolbar popup lets the user turn each shield on or off, list trusted sites, add words that must never be shared (stored only as one-way hashes), and see three simple counters of what the extension has done. This phase also covers the written docs and the final automated audit.

## P5 — Live-site validation and release
Everything so far was tested against stand-in pages that imitate real chat, upload and call sites. This phase is about proving it on the real sites, whose page structure changes over time, and preparing the extension for the Chrome Web Store. These leaves stay open until someone actually runs them on the real sites.
