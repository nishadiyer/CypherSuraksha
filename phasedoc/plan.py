#!/usr/bin/env python3
"""AI Shield phasedoc: task database + CLI. Single file, standard library only.

Verbs: init | tick <id> | part <id> | note <id> <text> | add | tree | components | mirror
A leaf is ticked ONLY after its acceptance test has actually been run.
"""
import argparse, json, os, sqlite3, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = Path(os.environ.get("PD_DB", HERE / "plan.db"))
MIRROR = Path(os.environ.get("PD_MIRROR", HERE / "BUILDPLAN.md"))
LOG = Path(os.environ.get("PD_PROGRESS_LOG", HERE / "PROGRESS.log"))
TITLE = os.environ.get("PD_TITLE", "AI Shield")

# (id, parent, title, acceptance, component). Parents have empty acceptance.
# Component keys are lowercase letters only and match SVG ids "comp-<key>" in ARCHITECTURE.md.
T = []
def P(i, title): T.append((i, "", title, "", ""))
def S(i, parent, title): T.append((i, parent, title, "", ""))
def L(i, parent, title, acc, comp): T.append((i, parent, title, acc, comp))

P("P0", "Foundation, security and message routing")
S("P0.1", "P0", "Build and manifest")
L("P0.1.1", "P0.1", "Vite + crxjs Manifest V3 build", "`npm run build` exits 0 and scripts/verify-build.mjs prints GATE OK", "router")
L("P0.1.2", "P0.1", "Minimal permissions and strict CSP", "built dist/manifest.json permissions == offscreen,storage,activeTab,scripting and CSP contains connect-src 'none' (verify-build.mjs)", "security")
L("P0.1.3", "P0.1", "host_permissions mirror the content-script match lists", "python3 check: set(dist host_permissions) == union of content_scripts matches", "security")
S("P0.2", "P0", "Router, offscreen engine, UI isolation")
L("P0.2.1", "P0.2", "Service-worker router validates sender and forwards", "`node tests/e2e/run.mjs 12`: 6 tabs each submit once with redaction", "router")
L("P0.2.2", "P0.2", "Offscreen document is a singleton under concurrent tabs", "e2e gate12: exactly one OFFSCREEN_DOCUMENT after 6 simultaneous tabs", "offscreen")
L("P0.2.3", "P0.2", "One dedicated Web Worker per shield", "e2e `run.mjs onnx`: NER and cloak models run via ORT inside workers", "offscreen")
L("P0.2.4", "P0.2", "Injected UI lives in closed Shadow DOM", "e2e gate3/gate4: host elements have shadowRoot === null", "content")
L("P0.2.5", "P0.2", "CSP blocks every outbound request from the engine", "e2e gate12: fetch/XHR/WebSocket/beacon raise connect-src violations", "security")

P("P1", "Pillar 1 — Privacy: prompt redaction")
S("P1.1", "P1", "Interception")
L("P1.1.1", "P1.1", "Enter and Send-click intercepted on textarea composers", "`npx vitest run tests/interceptor.test.ts` passes (4 interception tests)", "content")
L("P1.1.2", "P1.1", "Contenteditable composers with capture-phase page handlers", "e2e gate6: Enter and click both submit redacted text; pointerdown hidden", "content")
L("P1.1.3", "P1.1", "Fail-safe: never send the original if swap or shield fails", "vitest 'fails safe' test passes; writeComposer verifies the editor took the text", "content")
S("P1.2", "P1", "Detection")
L("P1.2.1", "P1.2", "Deterministic detectors: email, phone, SSN, Aadhaar, cards, API keys", "`npx vitest run tests/privacy.test.ts` passes", "privacy")
L("P1.2.2", "P1.2", "Capitalized full names and intro phrases", "vitest 'fallback detector coverage' passes (John Doe, Aarav Sharma, no false hits)", "privacy")
L("P1.2.3", "P1.2", "Salted SHA-256 'Never share' vault", "vitest vault test + e2e gate5: only hex digests stored, keyword redacted in a real prompt", "privacy")
L("P1.2.4", "P1.2", "NER ONNX pipeline (tokenizer, BIO decode) runs in real ORT", "e2e `run.mjs onnx`: hand-built NER graph redacts PERSON and LOC", "privacy")
L("P1.2.5", "P1.2", "Real INT8 NER model installed and measured", "public/models has a real NER model; fixture of 20 labelled sentences scores >= 0.85 entity recall in e2e", "models")
S("P1.3", "P1", "Swap, restore, forget")
L("P1.3.1", "P1.3", "Reversible deterministic placeholders", "vitest: same value same placeholder across prompts, counters continue", "privacy")
L("P1.3.2", "P1.3", "Placeholders restored on screen in replies", "e2e gate2: assistant reply shows real entities", "content")
L("P1.3.3", "P1.3", "Per-tab map in storage.session, purged on close and navigation", "e2e gate2 + vitest session test: purged on tab close and reload", "router")

P("P2", "Pillar 2 — Pixels: image cloaking")
S("P2.1", "P2", "Upload interception")
L("P2.1.1", "P2.1", "<input type=file> change events intercepted and re-injected", "e2e gate3: page receives exactly one cloaked file", "content")
L("P2.1.2", "P2.1", "Drag-and-drop intercepted", "e2e gate3: drop delivers one cloaked file", "content")
L("P2.1.3", "P2.1", "Badge with one-click 'Bypass on this site'", "e2e gate3: click inside closed shadow root adds host to allowlist; next upload untouched", "content")
S("P2.2", "P2", "Cloaking engine")
L("P2.2.1", "P2.2", "In-memory ImageBitmap/OffscreenCanvas pipeline, bounded perturbation", "e2e gate3: dimensions equal, >50% pixels changed, max change <= 5/255", "pixels")
L("P2.2.2", "P2.2", "Buffers released and nothing persisted", "e2e gate3: no image data in chrome.storage; audit:final dispose/close checks", "pixels")
L("P2.2.3", "P2.2", "Cloak ONNX path in real ORT with delta clamped to budget", "e2e `run.mjs onnx`: monotone delta signature, max == 5", "pixels")
L("P2.2.4", "P2.2", "Real learned adversarial cloak model installed", "public/models/pixel-cloak.fp16.onnx is a real model with a recorded source and licence", "models")
L("P2.2.5", "P2.2", "Measured effect on a real face/object recogniser", "benchmark script reports recogniser confidence drop on a fixture set; result written to notes", "pixels")

P("P3", "Pillar 3 — People: video-call deepfake warning")
S("P3.1", "P3", "Sampling")
L("P3.1.1", "P3.1", "Frames sampled at 1-2 FPS onto an OffscreenCanvas", "e2e gate4: 0.5-2 FPS baseline measured on a captureStream video", "people")
L("P3.1.2", "P3.1", "Adaptive throttle above 150 ms or without WebGPU", "vitest tests/people.test.ts (6 sampler tests) + e2e gate4 heavy-load back-off", "people")
S("P3.2", "P3", "Classifier and warnings")
L("P3.2.1", "P3.2", "ONNX frame classifier with 5-frame rolling smoothing", "vitest smoother tests + e2e gate4 pill reaches RED and recovers", "people")
L("P3.2.2", "P3.2", "Traffic-light pill and circuit-breaker modal", "e2e gate4: modal on sustained RED, dismissible, stays dismissed", "people")
L("P3.2.3", "P3.2", "No frame ever written to storage", "e2e gate4: storage, IndexedDB, localStorage, Cache all empty", "people")
L("P3.2.4", "P3.2", "Real deepfake classifier installed and evaluated", "real model in public/models with recorded source/licence; accuracy on a labelled fixture reported", "models")

P("P4", "Popup, ledger, documentation")
S("P4.1", "P4", "Popup")
L("P4.1.1", "P4.1", "Master and per-pillar toggles, trusted-site allowlist", "e2e gate5: toggles and allowlist change real behaviour", "popup")
L("P4.1.2", "P4.1", "Never-share input hashed on save", "e2e gate5: no plaintext in chrome.storage.local", "popup")
L("P4.1.3", "P4.1", "Local privacy ledger counters", "e2e gate5: popup counters equal chrome.storage.local ledger", "popup")
S("P4.2", "P4", "Docs and audit")
L("P4.2.1", "P4.2", "README.md and MODELS.md present", "test -s README.md && test -s MODELS.md", "security")
L("P4.2.2", "P4.2", "Final audit passes", "`npm run audit:final` prints 'Final audit passed'", "security")

P("P5", "Live-site validation and release")
S("P5.1", "P5", "Real sites")
L("P5.1.1", "P5.1", "ChatGPT live interception", "on chatgpt.com a prompt with a name+email is sent with placeholders and the toast shows", "content")
L("P5.1.2", "P5.1", "Claude live interception", "same check on claude.ai", "content")
L("P5.1.3", "P5.1", "Gemini live interception", "same check on gemini.google.com", "content")
L("P5.1.4", "P5.1", "Copilot live interception", "same check on copilot.microsoft.com", "content")
L("P5.1.5", "P5.1", "Upload cloaking on a live social site", "on a listed site an uploaded photo arrives cloaked and the badge shows", "content")
L("P5.1.6", "P5.1", "Pill on a live Meet/Zoom/WhatsApp call", "pill appears on a real call video", "content")
S("P5.2", "P5", "Release")
L("P5.2.1", "P5.2", "Chrome Web Store package and privacy policy", "`npm run build` zip < store limit and a privacy-policy page exists in the repo", "security")

COMPONENTS = ["content", "router", "offscreen", "privacy", "pixels", "people", "popup", "security", "models"]

def db():
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row; return c

def now(): return time.strftime("%Y-%m-%d %H:%M:%S")

def log(msg):
    with open(LOG, "a") as f: f.write(f"{now()}  {msg}\n")

def leaves(c): return [r for r in c.execute("select * from tasks order by id") if not c.execute("select 1 from tasks where parent=?", (r["id"],)).fetchone()]

def cmd_init(a):
    if DB.exists() and not a.force: sys.exit(f"{DB} exists (use --force to recreate)")
    DB.unlink(missing_ok=True)
    c = db()
    c.execute("create table tasks(id text primary key, parent text, title text, acceptance text, component text, status text default 'open', note text default '', updated text default '')")
    c.executemany("insert into tasks(id,parent,title,acceptance,component) values(?,?,?,?,?)", T)
    c.commit(); log(f"INIT seeded {len(T)} tasks"); cmd_mirror(a); print(f"seeded {len(T)} tasks")

def setstatus(i, st, note=None):
    c = db(); r = c.execute("select * from tasks where id=?", (i,)).fetchone()
    if not r: sys.exit(f"no such task {i}")
    if c.execute("select 1 from tasks where parent=?", (i,)).fetchone(): sys.exit("parent rows are derived; mark leaves")
    c.execute("update tasks set status=?, updated=?, note=coalesce(?,note) where id=?", (st, now(), note, i)); c.commit()
    log(f"{st.upper():7} {i} {r['title']}" + (f" -- {note}" if note else "")); cmd_mirror(None)

def cmd_tick(a):
    if not a.ran: sys.exit("refusing: pass --ran only after the acceptance test has actually been run")
    setstatus(a.id, "done", a.note)
def cmd_part(a): setstatus(a.id, "partial", a.note)
def cmd_note(a):
    c = db(); c.execute("update tasks set note=?, updated=? where id=?", (a.text, now(), a.id)); c.commit(); log(f"NOTE    {a.id} {a.text}"); cmd_mirror(None)
def cmd_add(a):
    c = db(); c.execute("insert into tasks(id,parent,title,acceptance,component) values(?,?,?,?,?)", (a.id, a.parent, a.title, a.acceptance, a.component)); c.commit(); log(f"ADD     {a.id} {a.title}"); cmd_mirror(None)

def rollup(c):
    """Per-phase and total counts over leaves."""
    ls = leaves(c); out = {}
    for r in ls:
        ph = r["id"].split(".")[0]; d = out.setdefault(ph, {"done": 0, "partial": 0, "open": 0})
        d[r["status"]] += 1
    return out

def comp_rollup(c):
    out = {k: {"done": 0, "partial": 0, "open": 0, "state": "grey"} for k in COMPONENTS}
    for r in leaves(c):
        k = r["component"]
        if k in out: out[k][r["status"]] += 1
    for k, d in out.items():
        n = d["done"] + d["partial"] + d["open"]
        d["state"] = "grey" if n == 0 or d["done"] + d["partial"] == 0 else ("green" if d["done"] == n else "amber")
    return out

MARK = {"done": "[x]", "partial": "[~]", "open": "[ ]"}
def render_tree(c, md=False):
    lines = []; rows = c.execute("select * from tasks order by id").fetchall(); roll = rollup(c)
    for r in rows:
        depth = r["id"].count("."); isleaf = not c.execute("select 1 from tasks where parent=?", (r["id"],)).fetchone()
        if isleaf:
            line = f"{'  '*depth}- {MARK[r['status']]} **{r['id']}** {r['title']}" if md else f"{'  '*depth}{MARK[r['status']]} {r['id']} {r['title']}"
            lines.append(line)
            if md:
                lines.append(f"{'  '*depth}  - _acceptance:_ {r['acceptance']}")
                if r["note"]: lines.append(f"{'  '*depth}  - _note:_ {r['note']}")
        else:
            if depth == 0:
                d = roll.get(r["id"], {}); n = sum(d.values()) or 1
                lines.append(("\n## " if md else "\n") + f"{r['id']} {r['title']}  ({d.get('done',0)}/{n} done, {d.get('partial',0)} partial, {d.get('open',0)} open)")
            else: lines.append(f"{'  '*(depth-1)}{'### ' if md else ''}{r['id']} {r['title']}" if md else f"{'  '*depth}{r['id']} {r['title']}")
    return "\n".join(lines)

def cmd_tree(a): print(render_tree(db()))
def cmd_components(a): print(json.dumps(comp_rollup(db()), indent=2))
def cmd_mirror(a):
    c = db(); ls = leaves(c); d = sum(r["status"] == "done" for r in ls); p = sum(r["status"] == "partial" for r in ls)
    head = (f"# {TITLE} — build plan (generated mirror)\n\n"
            "> Generated by `phasedoc/plan.py mirror` on every state change. Do not edit by hand.\n"
            "> **Retrospective seeding:** this arc was seeded after Phases P0-P4 were already built. Tick timestamps for those leaves are the seeding "
            "date, and each acceptance line records only what was genuinely re-run at that time.\n\n"
            f"**Progress:** {d}/{len(ls)} leaves done, {p} partial, {len(ls)-d-p} open ({100*d//len(ls)}%). Open leaves are expected: below 100% is the point.\n")
    MIRROR.write_text(head + render_tree(c, md=True) + "\n")

def main():
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("init"); s.add_argument("--force", action="store_true"); s.set_defaults(f=cmd_init)
    s = sp.add_parser("tick"); s.add_argument("id"); s.add_argument("--ran", action="store_true", help="the acceptance test has been run"); s.add_argument("--note"); s.set_defaults(f=cmd_tick)
    s = sp.add_parser("part"); s.add_argument("id"); s.add_argument("--note"); s.set_defaults(f=cmd_part)
    s = sp.add_parser("note"); s.add_argument("id"); s.add_argument("text"); s.set_defaults(f=cmd_note)
    s = sp.add_parser("add"); [s.add_argument(x) for x in ("id", "parent", "title", "acceptance", "component")]; s.set_defaults(f=cmd_add)
    for n, f in (("tree", cmd_tree), ("components", cmd_components), ("mirror", cmd_mirror)): sp.add_parser(n).set_defaults(f=f)
    a = ap.parse_args(); a.f(a)

if __name__ == "__main__": main()
