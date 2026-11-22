#!/usr/bin/env python3
"""Phasedoc cockpit: one read-only page. ONE codebase for every arc: configure with environment variables.

PD_DB, PD_PLAN_DOC, PD_ARCH_DOC, PD_RESOURCES, PD_EXPLAINERS, PD_PROGRESS_LOG, PD_PROGRESS_PATTERN,
PD_TITLE, PD_SUBTITLE, PD_PORT, PD_HOST (default 127.0.0.1: loopback only)
"""
import html, json, os, re, sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

E = os.environ.get
HERE = Path(__file__).resolve().parent
DB = E("PD_DB", str(HERE / "plan.db"))
PLAN = E("PD_PLAN_DOC", str(HERE / "PLAN.md"))
ARCH = E("PD_ARCH_DOC", str(HERE / "ARCHITECTURE.md"))
RES = E("PD_RESOURCES", str(HERE / "resources.json"))
EXPL = E("PD_EXPLAINERS", str(HERE / "explainers.json"))
LOG = E("PD_PROGRESS_LOG", str(HERE / "PROGRESS.log"))
PATTERN = E("PD_PROGRESS_PATTERN", "")
TITLE = E("PD_TITLE", "Phasedoc")
SUBTITLE = E("PD_SUBTITLE", "")
HOST = E("PD_HOST", "127.0.0.1")
PORT = int(E("PD_PORT", "4200"))
COLORS = {"grey": "#cbd5e1", "amber": "#fbbf24", "green": "#4ade80"}

def read(p, default=""):
    try: return Path(p).read_text()
    except OSError: return default

def conn():
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True); c.row_factory = sqlite3.Row; return c

def rows():
    c = conn(); rs = [dict(r) for r in c.execute("select * from tasks order by id")]; c.close()
    parents = {r["parent"] for r in rs}
    for r in rs: r["leaf"] = r["id"] not in parents
    return rs

def analytics(rs):
    ls = [r for r in rs if r["leaf"]]; phases = {}
    for r in ls:
        d = phases.setdefault(r["id"].split(".")[0], {"done": 0, "partial": 0, "open": 0}); d[r["status"]] += 1
    done = sum(r["status"] == "done" for r in ls); part = sum(r["status"] == "partial" for r in ls)
    return {"total": len(ls), "done": done, "partial": part, "open": len(ls) - done - part,
            "percent": round(100 * done / len(ls), 1) if ls else 0, "phases": phases,
            "titles": {r["id"]: r["title"] for r in rs if "." not in r["id"]}}

def component_states(rs):
    out = {}
    for r in rs:
        if r["leaf"] and r["component"]:
            d = out.setdefault(r["component"], {"done": 0, "partial": 0, "open": 0}); d[r["status"]] += 1
    for k, d in out.items():
        n = sum(d.values()); d["state"] = "grey" if d["done"] + d["partial"] == 0 else ("green" if d["done"] == n else "amber")
    return out

def md(text):
    out, lst, code = [], False, False
    inline = lambda s: re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", re.sub(r"`([^`]+)`", r"<code>\1</code>", html.escape(s)))
    for ln in text.split("\n"):
        if ln.startswith("```"):
            out.append("</pre>" if code else "<pre>"); code = not code; continue
        if code: out.append(html.escape(ln)); continue
        if lst and not ln.startswith("- "): out.append("</ul>"); lst = False
        m = re.match(r"(#{1,3}) (.*)", ln)
        if m: out.append(f"<h{len(m[1])+1}>{inline(m[2])}</h{len(m[1])+1}>")
        elif ln.startswith("> "): out.append(f"<blockquote>{inline(ln[2:])}</blockquote>")
        elif ln.startswith("- "):
            if not lst: out.append("<ul>"); lst = True
            out.append(f"<li>{inline(ln[2:])}</li>")
        elif ln.strip(): out.append(f"<p>{inline(ln)}</p>")
    if lst: out.append("</ul>")
    return "\n".join(out)

def architecture(rs):
    doc = read(ARCH); m = re.search(r"<svg.*?</svg>", doc, re.S); svg = m.group(0) if m else ""
    states = component_states(rs)
    for key in set(re.findall(r'id="comp-([a-z]+)"', svg)):
        st = states.get(key, {"state": "grey"})["state"]
        svg = re.sub(rf'(<[^>]*\bid="comp-{key}"[^>]*?)\bfill="[^"]*"', rf'\1fill="{COLORS[st]}" data-state="{st}"', svg)
    return {"svg": svg, "text": md(doc.replace(m.group(0), "") if m else doc), "states": states}

def progress():
    lines = [l for l in read(LOG).splitlines() if l.strip()]
    if PATTERN: lines = [l for l in lines if re.search(PATTERN, l)]
    return lines[-80:][::-1]

PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__ phasedoc</title><link rel="icon" href="data:,">
<style>
:root{--bg:#f8fafc;--fg:#0f172a;--mut:#64748b;--card:#fff;--line:#e2e8f0;--done:#16a34a;--part:#d97706;--open:#94a3b8}
@media(prefers-color-scheme:dark){:root{--bg:#0b1220;--fg:#e2e8f0;--mut:#94a3b8;--card:#111a2e;--line:#243049}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
header{padding:16px 20px 0}h1{margin:0;font-size:20px}.sub{color:var(--mut);font-size:13px}
nav{display:flex;gap:4px;padding:12px 20px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
nav button{background:none;border:0;padding:8px 14px;font:inherit;color:var(--mut);border-bottom:2px solid transparent;cursor:pointer}
nav button.on{color:var(--fg);border-color:var(--fg);font-weight:600}
main{padding:20px;max-width:1000px}section{display:none}section.on{display:block}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin-bottom:12px}
.leaf{display:flex;gap:8px;padding:2px 0}.dot{width:12px;height:12px;border-radius:50%;margin-top:5px;flex:none;border:2px solid var(--open)}
.dot.done{background:var(--done);border-color:var(--done)}.dot.partial{background:linear-gradient(90deg,var(--part) 50%,transparent 50%);border-color:var(--part)}
.acc,.note{color:var(--mut);font-size:12.5px}.id{font-family:ui-monospace,monospace;color:var(--mut);margin-right:6px}
.bar{height:10px;background:var(--line);border-radius:5px;overflow:hidden;display:flex}.bar i{display:block;height:100%}
.big{font-size:40px;font-weight:700}code,pre{font-family:ui-monospace,monospace;font-size:12.5px;background:var(--line);padding:1px 5px;border-radius:4px}
pre{display:block;padding:10px;overflow:auto}svg{max-width:100%;height:auto;background:#fff;border:1px solid var(--line);border-radius:10px}
.log{font-family:ui-monospace,monospace;font-size:12.5px;white-space:pre-wrap;border-bottom:1px solid var(--line);padding:3px 0}
.legend span{display:inline-block;margin-right:14px;font-size:13px}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;vertical-align:-1px}
</style></head><body>
<header><h1>__TITLE__</h1><div class="sub">__SUBTITLE__</div></header>
<nav id="tabs"></nav><main id="main"></main>
<script>
const $=(s,r=document)=>r.querySelector(s), el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e};
const get=u=>fetch(u).then(r=>{if(!r.ok)throw new Error(u+' '+r.status);return r.json()});
const TABS=['Plan','Architecture','Progress','Analytics','Resources'];
const main=$('#main'),tabs=$('#tabs'),secs={};
TABS.forEach((t,i)=>{const b=el('button',i?'':'on',t);b.onclick=()=>show(t);tabs.append(b);const s=el('section',i?'':'on');secs[t]=s;main.append(s)});
function show(t){[...tabs.children].forEach(b=>b.classList.toggle('on',b.textContent===t));for(const k in secs)secs[k].classList.toggle('on',k===t)}
function bar(d){const n=d.done+d.partial+d.open||1,b=el('div','bar');[['done','var(--done)'],['partial','var(--part)']].forEach(([k,c])=>{const i=el('i');i.style.width=100*d[k]/n+'%';i.style.background=c;b.append(i)});return b}
async function plan(){const [rows,an,ex]=await Promise.all([get('/api/tree'),get('/api/analytics'),get('/api/explainers')]);const s=secs.Plan;s.replaceChildren();
 const ph=rows.filter(r=>!r.id.includes('.'));ph.forEach(p=>{const c=el('div','card');const d=an.phases[p.id]||{done:0,partial:0,open:0};
  c.append(el('h3','',p.id+' — '+p.title+'  ('+d.done+'/'+(d.done+d.partial+d.open)+' done, '+d.partial+' partial, '+d.open+' open)'),bar(d));
  rows.filter(r=>r.id.startsWith(p.id+'.')).forEach(r=>{if(!r.leaf){const h=el('div','', '');h.style.cssText='font-weight:600;margin-top:8px';h.textContent=r.id+' '+r.title;c.append(h);return}
   const l=el('div','leaf'),dot=el('span','dot '+r.status),b=el('div');dot.title=r.status;b.append(Object.assign(el('span','id',r.id)),document.createTextNode(r.title));
   b.append(el('div','acc','acceptance: '+r.acceptance));if(r.note)b.append(el('div','note','note: '+r.note));l.append(dot,b);c.append(l)});
  if(ex[p.id]){const e=el('p','note',ex[p.id]);e.style.marginTop='10px';c.append(e)}s.append(c)})}
async function arch(){const a=await get('/api/arch'),s=secs.Architecture;s.replaceChildren();const lg=el('div','legend');
 [['#cbd5e1','untouched'],['#fbbf24','in progress'],['#4ade80','done and verified']].forEach(([c,t])=>{const sp=el('span');const i=el('i');i.style.background=c;sp.append(i,t);lg.append(sp)});
 const box=el('div');box.innerHTML=a.svg;const tx=el('div');tx.innerHTML=a.text;s.append(lg,box,tx)}
async function prog(){const l=await get('/api/progress'),s=secs.Progress;s.replaceChildren();if(!l.length)s.append(el('p','note','No progress entries yet.'));l.forEach(x=>s.append(el('div','log',x)))}
async function anal(){const a=await get('/api/analytics'),s=secs.Analytics;s.replaceChildren();const c=el('div','card');
 c.append(el('div','big',a.percent+'%'),el('div','note',a.done+' of '+a.total+' leaves done, '+a.partial+' partial, '+a.open+' open. Below 100% while work is open is the point: leaves are ticked only after their test ran.'));s.append(c);
 Object.entries(a.phases).forEach(([k,d])=>{const w=el('div','card');w.append(el('div','',k+' — '+(a.titles[k]||'')),bar(d),el('div','note',d.done+' done · '+d.partial+' partial · '+d.open+' open'));s.append(w)})}
async function res(){const r=await get('/api/resources'),s=secs.Resources;s.replaceChildren();
 Object.entries(r).forEach(([g,items])=>{const c=el('div','card');c.append(el('h3','',g));items.forEach(i=>{const d=el('div');if(i.url){const a=el('a','',i.label);a.href=i.url;a.target='_blank';a.rel='noopener';d.append(a)}else{d.append(document.createTextNode(i.label+': '),el('code','',i.path))}c.append(d)});s.append(c)})}
Promise.all([plan(),arch(),prog(),anal(),res()]).catch(e=>{main.prepend(el('p','note','Failed to load: '+e.message))});
</script></body></html>"""

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else body.encode()
        self.send_response(code); self.send_header("Content-Type", ctype + "; charset=utf-8"); self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store"); self.send_header("X-Content-Type-Options", "nosniff"); self.end_headers()
        if self.command != "HEAD": self.wfile.write(b)
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/": return self.send(200, PAGE.replace("__TITLE__", html.escape(TITLE)).replace("__SUBTITLE__", html.escape(SUBTITLE)), "text/html")
        try:
            rs = rows()
            data = {"/api/tree": lambda: rs, "/api/analytics": lambda: analytics(rs), "/api/arch": lambda: architecture(rs),
                    "/api/progress": progress, "/api/explainers": lambda: json.loads(read(EXPL, "{}")),
                    "/api/resources": lambda: json.loads(read(RES, "{}")), "/api/plandoc": lambda: {"html": md(read(PLAN))}}.get(p)
            if not data: return self.send(404, '{"error":"not found"}')
            return self.send(200, json.dumps(data()))
        except sqlite3.Error as e: return self.send(503, json.dumps({"error": "database unavailable"}))
    def _ro(self): self.send(405, '{"error":"read-only"}')
    do_POST = do_PUT = do_DELETE = do_PATCH = _ro

if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
