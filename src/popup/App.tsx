import { useEffect, useState } from 'preact/hooks';
import logo from '../assets/logo.svg?inline';
import type { ShieldKind } from '../types/shield';
import { addKeyword, clearVault, loadVault, showTestNotification, useLedger, usePageStatus, useSettings, type PageState } from './store';

type Tab = 'shield' | 'page' | 'vault' | 'sites';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'shield', label: 'Shield' },
  { id: 'page', label: 'Page' },
  { id: 'vault', label: 'Vault' },
  { id: 'sites', label: 'Sites' },
];
const initialTab = (): Tab => {
  const v = new URLSearchParams(location.search).get('view');
  return v === 'page' || v === 'vault' || v === 'sites' ? v : 'shield';
};

/* ---------- icons (inline, stroke) ---------- */
const Svg = ({ children, size = 20 }: { children: preact.ComponentChildren; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const IShield = () => <Svg><path d="M12 3 4.5 6v5.5c0 4.4 3 7.9 7.5 9.5 4.5-1.6 7.5-5.1 7.5-9.5V6L12 3Z" /><path d="m9 12 2.2 2.2L15.5 10" /></Svg>;
const IPage = () => <Svg><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></Svg>;
const IVault = () => <Svg><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" /></Svg>;
const ISites = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" /></Svg>;
const ISun = () => <Svg size={18}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" /></Svg>;
const IMoon = () => <Svg size={18}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" /></Svg>;
const IText = () => <Svg size={22}><path d="M5 7h14M5 12h9M5 17h12" /><path d="m17 14 2 2 3-3.5" /></Svg>;
const IFace = () => <Svg size={22}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><circle cx="12" cy="11" r="3" /><path d="M7.5 18c.8-2 2.5-3 4.500-3s3.700 1 4.500 3" /></Svg>;
const IVideo = () => <Svg size={22}><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="m16 10.500 5-3v9l-5-3" /></Svg>;

function Toggle({ on, onChange, label, small }: { on: boolean; onChange: (v: boolean) => void; label: string; small?: boolean }) {
  return <button role="switch" aria-checked={on} aria-label={label} class={`cs-toggle${small ? ' sm' : ''}`} onClick={() => onChange(!on)} />;
}

const DEFENSES: Array<{ kind: ShieldKind; name: string; tag: string; tone: 'warm' | 'cool' | 'good'; desc: string; Icon: () => preact.JSX.Element }> = [
  { kind: 'PRIVACY', name: 'PromptGuard', tag: 'PII', tone: 'warm', desc: 'Names, emails, IDs and secrets become placeholders before AI chats see them', Icon: IText },
  { kind: 'PIXELS', name: 'Pixel Cloak', tag: 'FACES', tone: 'cool', desc: 'Invisible adversarial change on faces before you upload a photo', Icon: IFace },
  { kind: 'PEOPLE', name: 'TruthLens', tag: 'WEBRTC', tone: 'good', desc: 'Checks faces in Meet, Zoom and WhatsApp Web calls for AI generation', Icon: IVideo },
];

/* ---------- Shield tab ---------- */
function Hero({ armed, enabled, onToggle }: { armed: number; enabled: boolean; onToggle: (v: boolean) => void }) {
  const R = 84;
  const C = 2 * Math.PI * R;
  const state = !enabled || armed === 0 ? 'off' : armed === 3 ? 'on' : 'part';
  const label = state === 'on' ? 'Armor active' : state === 'part' ? 'Partly armed' : 'Paused';
  const backend = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'WebGPU available' : 'CPU (WASM) mode';
  return (
    <div class="cs-card cs-hero" data-testid="hero">
      <div class="cs-ringwrap">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <defs>
            <linearGradient id="cs-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="var(--teal)" />
              <stop offset="1" stop-color="var(--blue)" />
            </linearGradient>
          </defs>
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--line)" stroke-width="11" />
          <circle cx="100" cy="100" r={R} fill="none" stroke="url(#cs-ring)" stroke-width="11" stroke-linecap="round" stroke-dasharray={`${(C * armed) / 3} ${C}`} transform="rotate(-90 100 100)" />
          <circle cx="100" cy="100" r="68" fill="none" stroke="var(--faint)" stroke-opacity="0.45" stroke-width="1.2" stroke-dasharray="3 5" />
          <path d="M100 6v12M100 182v12" stroke="var(--teal)" stroke-width="2.4" stroke-linecap="round" />
        </svg>
        <div class="cs-ringtext">
          <span class={`cs-state ${state}`}><i class="cs-dot" />{label}</span>
          <span class="cs-big">100% On-Device</span>
          <span class="cs-sub mono">{backend}</span>
        </div>
      </div>
      <div class="cs-herofoot">
        <span class="cs-pill ok"><i class="cs-dot" />Network blocked by policy</span>
        <span class="cs-pill" style="gap:8px">
          {enabled ? 'On' : 'Off'}
          <Toggle label="Enable CypherSuraksha" on={enabled} onChange={onToggle} small />
        </span>
      </div>
    </div>
  );
}

function Defense({ d, on, onChange, children }: { d: (typeof DEFENSES)[number]; on: boolean; onChange: (v: boolean) => void; children?: preact.ComponentChildren }) {
  return (
    <div class="cs-card cs-def" data-testid={`defense-${d.kind.toLowerCase()}`}>
      <div class="cs-def-top">
        <div class={`cs-def-ico ${d.tone}`}><d.Icon /></div>
        <div style="flex:1;min-width:0">
          <div class="cs-def-name">{d.name}<span class={`cs-tag ${d.tone} mono`}>{d.tag}</span></div>
          <div class="cs-def-desc">{d.desc}</div>
        </div>
        <Toggle label={`${d.name} shield`} on={on} onChange={onChange} />
      </div>
      {children}
    </div>
  );
}

function ShieldTab() {
  const [settings, setSettings] = useSettings();
  const ledger = useLedger();
  const active = (k: ShieldKind): boolean => settings.enabled && settings.pillars[k];
  const armed = DEFENSES.filter((d) => active(d.kind)).length;
  const version = chrome.runtime.getManifest().version;
  return (
    <>
      <Hero armed={armed} enabled={settings.enabled} onToggle={(enabled) => setSettings({ ...settings, enabled })} />
      <div class="cs-stats">
        {([['promptsRedacted', 'Secrets', 'prompts redacted', 'warm'], ['photosCloaked', 'Cloaked', 'photos cloaked', 'cool'], ['callsProtected', 'Calls', 'calls checked', 'good']] as const).map(([k, title, sub, tone]) => (
          <div key={k} class={`cs-card cs-stat ${tone}`}>
            <small class="mono">{title}</small>
            <b data-testid={k}>{ledger[k]}</b>
            <span>{sub}</span>
          </div>
        ))}
      </div>
      <div class="cs-section"><span>Active defenses</span><span class="cs-count mono">{armed} / 3 armed</span></div>
      <Defense d={DEFENSES[0]!} on={active('PRIVACY')} onChange={(v) => setSettings({ ...settings, pillars: { ...settings.pillars, PRIVACY: v } })}>
        <div class="cs-strip mono"><span><code>priya@example.com</code> → <code>[EMAIL_1]</code></span><span>e.g.</span></div>
      </Defense>
      <Defense d={DEFENSES[1]!} on={active('PIXELS')} onChange={(v) => setSettings({ ...settings, pillars: { ...settings.pillars, PIXELS: v } })}>
        <div class="cs-strip mono"><span>Max 8/255 change · location data removed</span></div>
      </Defense>
      <Defense d={DEFENSES[2]!} on={active('PEOPLE')} onChange={(v) => setSettings({ ...settings, pillars: { ...settings.pillars, PEOPLE: v } })}>
        <div class="cs-sub-row">
          <div>
            <b>Face-swap detector (experimental)</b>
            <span>Needs the optional 609 MB model and a real GPU. Can show amber ("Unsure"), never red. Off by default: it flagged a real webcam in testing.</span>
          </div>
          <Toggle label="Face-swap detector (experimental)" on={settings.faceSwap} onChange={(faceSwap) => setSettings({ ...settings, faceSwap })} small />
        </div>
      </Defense>
      <div class="cs-foot mono">Everything runs on this device · v{version}</div>
    </>
  );
}

/* ---------- Page tab ---------- */
function Row({ ok, children }: { ok: boolean | 'info'; children: preact.ComponentChildren }) {
  return (
    <li>
      <span class={`ic ${ok === true ? 'cs-ok' : ok === 'info' ? 'cs-info' : 'cs-bad'}`} aria-hidden="true">{ok === true ? '✓' : ok === 'info' ? '•' : '✗'}</span>
      <span>{children}</span>
    </li>
  );
}

function Candidates({ json }: { json: string }) {
  let list: Array<{ el: string; role?: string; testid?: string; aria?: string; editable?: string; inShadow: boolean; w: number; h: number }> = [];
  try {
    list = JSON.parse(json);
  } catch {
    list = [];
  }
  return (
    <li data-testid="candidates">
      <span class="ic" />
      <span class="cs-note mono" style="margin:0">
        Text boxes seen on this page (send a screenshot of this):
        {list.length === 0 && <div>none found</div>}
        {list.map((c, i) => (
          <div key={i}>
            {c.el} {c.editable !== undefined && `[contenteditable=${c.editable}]`} {c.role && `role=${c.role}`} {c.testid && `testid=${c.testid}`} {c.aria && `aria="${c.aria}"`} {c.inShadow && 'IN-SHADOW-DOM'} {c.w}x{c.h}
          </div>
        ))}
      </span>
    </li>
  );
}

function Buttons({ json }: { json: string }) {
  let list: Array<{ testid?: string; aria?: string; type?: string; disabled: boolean }> = [];
  try {
    list = JSON.parse(json);
  } catch {
    list = [];
  }
  return (
    <li data-testid="buttons">
      <span class="ic" />
      <span class="cs-note mono" style="margin:0">
        Buttons near the message box (type a few letters first, then send a screenshot):
        {list.length === 0 && <div>none found</div>}
        {list.map((b, i) => (
          <div key={i}>button {b.testid && `testid=${b.testid}`} {b.aria && `aria="${b.aria}"`} {b.type && `type=${b.type}`} {b.disabled && 'DISABLED'}</div>
        ))}
      </span>
    </li>
  );
}

function WriteDiag({ json }: { json: string }) {
  let d: { tag: string; editable: boolean; attempts: Array<{ strategy: string; read: number; expected: number; ok: boolean; left?: string }> } = { tag: '', editable: false, attempts: [] };
  try {
    d = JSON.parse(json);
  } catch {
    /* ignore */
  }
  return (
    <li data-testid="write-diag">
      <span class="ic" />
      <span class="cs-note mono" style="margin:0">
        The last attempt to edit the message box failed (send a screenshot of this). Box: {d.tag}{d.editable ? ' (editable)' : ''}
        {d.attempts.map((a, i) => (
          <div key={i}>{a.strategy}: box then held {a.read} characters, expected {a.expected} {a.ok ? '(ok)' : '(no)'}{a.left ? ` left: ${a.left}` : ''}</div>
        ))}
      </span>
    </li>
  );
}

function TestButton() {
  const [msg, setMsg] = useState('');
  return (
    <div style="margin-top:10px">
      <button class="cs-btn ghost" onClick={async () => setMsg((await showTestNotification()) ? 'Sent. Look at the bottom-right corner of the page for the message.' : 'This page did not answer. Reload it and try again.')}>
        Show a test notification on this page
      </button>
      {msg && <p class="cs-p" style="margin:6px 0 0">{msg}</p>}
    </div>
  );
}

function ThisPage({ page }: { page: PageState }) {
  if (page.kind === 'loading') return <p class="cs-p">Checking this tab…</p>;
  if (page.kind === 'other') return <p class="cs-p">CypherSuraksha does not apply to this page. It works on the supported chat, upload and video-call sites.</p>;
  if (page.kind === 'inactive')
    return (
      <p class="cs-bad" style="font-size:12px;margin:0" data-testid="page-inactive">
        ✗ {page.host} is a supported site, but CypherSuraksha is <b>not running on this tab</b>. Reload the tab (Cmd/Ctrl+R). If it still says this, the extension is not loading here.
      </p>
    );
  return (
    <>
      <ul class="cs-rows" data-testid="page-active">
        {page.status.parts.map((p) => {
          const d = p.detail;
          if (p.part === 'prompt')
            return [
              <Row ok key="p">AI chat detected ({String(d.site)}): CypherSuraksha is running on this tab</Row>,
              <Row ok={Boolean(d.messageBox)} key="m">Message box: {d.messageBox ? 'found' : 'NOT found. This site may have changed its page, tell the developer'}</Row>,
              d.messageBox || !d.candidates ? null : <Candidates key="c" json={String(d.candidates)} />,
              <Row ok={d.sendButton ? true : 'info'} key="s">Send button: {d.sendButton ? 'found' : 'not on the page yet (many sites only show it after you type)'}</Row>,
              !d.sendButton && d.buttons ? <Buttons key="b" json={String(d.buttons)} /> : null,
              d.lastWrite ? <WriteDiag key="w" json={String(d.lastWrite)} /> : null,
              <Row ok="info" key="r">Placeholders remembered for this tab: {String(d.remembered ?? 0)}</Row>,
              Number(d.placeholdersRestorable) > 0 ? <Row ok={false} key="pr">{String(d.placeholdersRestorable)} placeholder(s) are still showing on screen and should have been replaced. Tell the developer.</Row> : null,
              Number(d.placeholdersInEditable) > 0 ? <Row ok="info" key="pe">{String(d.placeholdersInEditable)} placeholder(s) sit inside an editable area (for example a document or canvas editor). CypherSuraksha leaves editable text alone on purpose: changing it would make the site think you typed the real value and could save it.</Row> : null,
            ];
          if (p.part === 'upload')
            return [
              <Row ok key="u">Photo upload protection is running ({String(d.fileInputs)} file field{d.fileInputs === 1 ? '' : 's'} on this page, {String(d.components)} web component{d.components === 1 ? '' : 's'} checked)</Row>,
              <Row ok="info" key="us">Photo selections CypherSuraksha has seen on this page: {String(d.selectionsSeen)}. If you picked a photo and this is still 0, this site's file picker is invisible to CypherSuraksha.</Row>,
            ];
          if (p.part === 'video') {
            const v = (n: unknown): string => (Number(n) < 0 ? 'n/a' : `${n}%`);
            return [
              <Row ok key="v">Video-call protection is running ({String(d.videos)} video{d.videos === 1 ? '' : 's'} on this page)</Row>,
              <Row ok="info" key="vt">Analysing {String(d.tracked)} video{d.tracked === 1 ? '' : 's'}{d.trackedSizes ? ` (${String(d.trackedSizes)})` : ''}; {String(d.duplicatesSkipped)} duplicate{d.duplicatesSkipped === 1 ? '' : 's'} of the same source skipped. One pill per video.</Row>,
              d.hasReading ? (
                <Row ok="info" key="vr">
                  Latest reading: {String(d.level)}. Smoothed {v(d.smoothed)}; this frame {v(d.frame)} (main model {v(d.main)}
                  {Number(d.swap) >= 0 ? `, face-swap detector ${v(d.swap)}` : ', face-swap detector not running'}); {String(d.backend)}, {String(d.fps)} fps. The pill turns amber from 40% and red from 70% (smoothed over 5 frames).
                </Row>
              ) : (
                <Row ok="info" key="vr">No reading yet (a face has to be in view).</Row>
              ),
            ];
          }
          return null;
        })}
      </ul>
      <TestButton />
    </>
  );
}

function PageTab() {
  const page = usePageStatus();
  return (
    <div class="cs-card cs-pad">
      <h2 class="cs-h">This page</h2>
      <p class="cs-p">Is CypherSuraksha running on the tab you are looking at, and what does it see?</p>
      <ThisPage page={page} />
    </div>
  );
}

/* ---------- Vault tab ---------- */
function VaultTab() {
  const [kw, setKw] = useState('');
  const [kwCount, setKwCount] = useState(0);
  const [kwMsg, setKwMsg] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    void loadVault().then((v) => setKwCount(v.hashes.length));
  }, []);
  return (
    <div class="cs-card cs-pad">
      <h2 class="cs-h">Never share</h2>
      <p class="cs-p">Words that must never reach an AI chat: a project name, an account number. Stored only as salted one-way hashes, so they cannot be read back or listed.</p>
      <form
        class="cs-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = await addKeyword(kw);
          setKw(''); // plaintext leaves memory of the UI immediately
          setKwCount(v.hashes.length);
          setKwMsg('Saved as a one-way hash.');
        }}
      >
        <input class="cs-input" placeholder="Name, project, account no…" value={kw} autocomplete="off" onInput={(e) => setKw((e.target as HTMLInputElement).value)} />
        <button class="cs-btn" disabled={!kw.trim()}>Add</button>
      </form>
      <p class="cs-p" style="margin:8px 0 0">
        {kwCount} protected keyword{kwCount === 1 ? '' : 's'}. Only salted SHA-256 hashes are stored.
        {kwMsg && <span class="cs-ok" style="margin-left:4px">{kwMsg}</span>}
      </p>
      {kwCount > 0 && (
        <button
          class="cs-btn danger"
          style="margin-top:8px"
          onClick={async () => {
            if (!confirmClear) return setConfirmClear(true);
            await clearVault();
            setKwCount(0);
            setConfirmClear(false);
            setKwMsg('All keywords removed.');
          }}
        >
          {confirmClear ? 'Click again to remove all keywords' : 'Remove all keywords'}
        </button>
      )}
    </div>
  );
}

/* ---------- Sites tab ---------- */
function SitesTab() {
  const [settings, setSettings] = useSettings();
  const [domainInput, setDomainInput] = useState('');
  const addDomain = (d: string): void => {
    const host = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (host && !settings.allowlist.includes(host)) setSettings({ ...settings, allowlist: [...settings.allowlist, host] });
    setDomainInput('');
  };
  return (
    <div class="cs-card cs-pad">
      <h2 class="cs-h">Trusted sites</h2>
      <p class="cs-p">On these sites CypherSuraksha stands down completely: nothing is redacted, cloaked or scanned.</p>
      <form class="cs-form" data-testid="sites-form" onSubmit={(e) => { e.preventDefault(); addDomain(domainInput); }}>
        <input class="cs-input" placeholder="example.com" value={domainInput} onInput={(e) => setDomainInput((e.target as HTMLInputElement).value)} />
        <button class="cs-btn" disabled={!domainInput.trim()}>Add</button>
      </form>
      <ul class="cs-list" data-testid="sites-list">
        {settings.allowlist.length === 0 && <li class="cs-info" style="background:none;border:none;padding:2px 0">No trusted sites. Shields run everywhere they apply.</li>}
        {settings.allowlist.map((d) => (
          <li key={d}>
            <span style="overflow:hidden;text-overflow:ellipsis">{d}</span>
            <button class="cs-btn danger" style="padding:3px 9px;font-size:11px" aria-label={`Remove ${d}`} onClick={() => setSettings({ ...settings, allowlist: settings.allowlist.filter((x) => x !== d) })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- shell ---------- */
const NAV_ICONS: Record<Tab, () => preact.JSX.Element> = { shield: IShield, page: IPage, vault: IVault, sites: ISites };

export function App() {
  const [settings, setSettings] = useSettings();
  const [tab, setTab] = useState<Tab>(initialTab);
  const effective: 'light' | 'dark' = settings.theme ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = effective;
  }, [effective]);
  return (
    <div class="cs-root">
      <header class="cs-head">
        <img class="cs-logo" src={logo} alt="" />
        <div>
          <div class="cs-title">CypherSuraksha</div>
          <div class="cs-chip mono"><i class="cs-dot" />Local only · nothing uploaded</div>
        </div>
        <button class="cs-iconbtn" aria-label={effective === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} data-testid="theme-toggle" onClick={() => setSettings({ ...settings, theme: effective === 'dark' ? 'light' : 'dark' })}>
          {effective === 'dark' ? <ISun /> : <IMoon />}
        </button>
      </header>
      <main class="cs-body" data-testid={`tab-${tab}`}>
        {tab === 'shield' && <ShieldTab />}
        {tab === 'page' && <PageTab />}
        {tab === 'vault' && <VaultTab />}
        {tab === 'sites' && <SitesTab />}
      </main>
      <nav class="cs-nav" role="tablist" aria-label="Sections">
        {TABS.map((t) => {
          const Icon = NAV_ICONS[t.id];
          return (
            <button key={t.id} role="tab" data-tab={t.id} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              <Icon />
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
