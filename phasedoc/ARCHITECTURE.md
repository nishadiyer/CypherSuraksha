# AI Shield — architecture

Three tiers, connected only by Chrome messaging. Box colour on the diagram is live task state: **grey** untouched, **amber** in progress, **green** done and verified.

<svg id="arch" viewBox="0 0 940 520" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" font-size="14">
  <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#475569"/></marker></defs>
  <text x="20" y="26" font-weight="600">1. Content scripts (web page)</text>
  <text x="340" y="26" font-weight="600">2. Service worker</text>
  <text x="640" y="26" font-weight="600">3. Offscreen document + workers</text>
  <rect id="comp-content" x="20" y="40" width="270" height="150" rx="10" fill="#cbd5e1" stroke="#334155"/>
  <text x="34" y="66" font-weight="600">Content scripts</text>
  <text x="34" y="90">prompt / upload / video interceptors</text>
  <text x="34" y="112">closed Shadow DOM: pill, toast, badge</text>
  <rect id="comp-router" x="340" y="40" width="250" height="150" rx="10" fill="#cbd5e1" stroke="#334155"/>
  <text x="354" y="66" font-weight="600">Router</text>
  <text x="354" y="90">allowlist + toggles</text>
  <text x="354" y="112">offscreen singleton</text>
  <text x="354" y="134">per-tab session maps, ledger</text>
  <rect id="comp-offscreen" x="640" y="40" width="280" height="150" rx="10" fill="#cbd5e1" stroke="#334155"/>
  <text x="654" y="66" font-weight="600">Offscreen engine</text>
  <text x="654" y="90">one Web Worker per shield</text>
  <text x="654" y="112">ONNX Runtime: WebGPU, then WASM</text>
  <line x1="290" y1="110" x2="338" y2="110" stroke="#475569" stroke-width="2" marker-end="url(#ar)"/>
  <line x1="590" y1="110" x2="638" y2="110" stroke="#475569" stroke-width="2" marker-end="url(#ar)"/>
  <rect id="comp-privacy" x="340" y="230" width="170" height="90" rx="10" fill="#cbd5e1" stroke="#334155"/>
  <text x="354" y="258" font-weight="600">Privacy shield</text><text x="354" y="280">NER + rules + vault</text>
  <rect id="comp-pixels" x="530" y="230" width="170" height="90" rx="10" fill="#cbd5e1" stroke="#334155"/>
  <text x="544" y="258" font-weight="600">Pixel shield</text><text x="544" y="280">cloak + re-encode</text>
  <rect id="comp-people" x="720" y="230" width="200" height="90" rx="10" fill="#cbd5e1" stroke="#334155"/>
  <text x="734" y="258" font-weight="600">People shield</text><text x="734" y="280">classifier + 5-frame mean</text>
  <line x1="780" y1="190" x2="780" y2="228" stroke="#475569" stroke-width="2" marker-end="url(#ar)"/>
  <rect id="comp-models" x="340" y="360" width="580" height="70" rx="10" fill="#cbd5e1" stroke="#334155"/>
  <text x="354" y="388" font-weight="600">Model files (public/models)</text><text x="354" y="410">NER · pixel cloak · deepfake classifier — real weights are still to be installed</text>
  <rect id="comp-popup" x="20" y="230" width="270" height="90" rx="10" fill="#cbd5e1" stroke="#334155"/>
  <text x="34" y="258" font-weight="600">Popup</text><text x="34" y="280">toggles · allowlist · vault · ledger</text>
  <rect id="comp-security" x="20" y="360" width="300" height="70" rx="10" fill="#cbd5e1" stroke="#334155"/>
  <text x="34" y="388" font-weight="600">Security invariants</text><text x="34" y="410">connect-src 'none' · RAM-only · docs</text>
  <text x="20" y="470" fill="#475569">Nothing leaves the browser: the engine's CSP forbids every network request.</text>
</svg>

## Components
- **content** — interceptors that hook Enter, Send, file input, drop and `<video>`; they never see model internals.
- **router** — the only place that reads settings and writes the per-tab session map and the counters.
- **offscreen** — hosts the three workers and the ONNX Runtime sessions; disposes tensors after every inference.
- **privacy / pixels / people** — the three shields, each behind the same request/response contract (`src/types/shield.ts`).
- **models** — the packaged model files; absent files select each shield's deterministic fallback.
- **popup** — user controls and the local ledger.
- **security** — the CSP, permissions, storage rules and documentation that keep the zero-network promise checkable.
