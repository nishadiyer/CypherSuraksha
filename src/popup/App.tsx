import { useEffect, useState } from 'preact/hooks';
import type { ShieldKind } from '../types/shield';
import { addKeyword, clearVault, loadVault, showTestNotification, useLedger, usePageStatus, useSettings, type PageState } from './store';

const PILLARS: Array<{ kind: ShieldKind; title: string; blurb: string }> = [
  { kind: 'PRIVACY', title: 'Privacy', blurb: 'Hide names, emails & secrets from AI chats' },
  { kind: 'PIXELS', title: 'Pixels', blurb: 'Cloak photos before you upload them' },
  { kind: 'PEOPLE', title: 'People', blurb: 'Flag deepfakes on video calls' },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      class={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-emerald-600' : 'bg-slate-300'}`}
    >
      <span class={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

const Section = ({ title, children }: { title: string; children: preact.ComponentChildren }) => (
  <section class="border-t border-slate-200 px-4 py-3">
    <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
    {children}
  </section>
);

function Row({ ok, children }: { ok: boolean | 'info'; children: preact.ComponentChildren }) {
  return (
    <li class="flex gap-1.5">
      <span class={ok === true ? 'text-emerald-700' : ok === 'info' ? 'text-slate-400' : 'text-red-700'} aria-hidden="true">{ok === true ? '✓' : ok === 'info' ? '•' : '✗'}</span>
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
    <li class="ml-4 text-[10px] text-slate-500" data-testid="candidates">
      Text boxes seen on this page (send a screenshot of this):
      {list.length === 0 && <div>none found</div>}
      {list.map((c, i) => (
        <div key={i} class="font-mono">
          {c.el} {c.editable !== undefined && `[contenteditable=${c.editable}]`} {c.role && `role=${c.role}`} {c.testid && `testid=${c.testid}`} {c.aria && `aria="${c.aria}"`} {c.inShadow && 'IN-SHADOW-DOM'} {c.w}x{c.h}
        </div>
      ))}
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
    <li class="ml-4 text-[10px] text-slate-500" data-testid="buttons">
      Buttons near the message box (type a few letters first, then send a screenshot):
      {list.length === 0 && <div>none found</div>}
      {list.map((b, i) => (
        <div key={i} class="font-mono">
          button {b.testid && `testid=${b.testid}`} {b.aria && `aria="${b.aria}"`} {b.type && `type=${b.type}`} {b.disabled && 'DISABLED'}
        </div>
      ))}
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
    <li class="ml-4 text-[10px] text-slate-500" data-testid="write-diag">
      The last attempt to edit the message box failed (send a screenshot of this). Box: {d.tag}{d.editable ? ' (editable)' : ''}
      {d.attempts.map((a, i) => (
        <div key={i} class="font-mono">
          {a.strategy}: box then held {a.read} characters, expected {a.expected} {a.ok ? '(ok)' : '(no)'}{a.left ? ` left: ${a.left}` : ''}
        </div>
      ))}
    </li>
  );
}

function ThisPage({ page }: { page: PageState }) {
  if (page.kind === 'loading') return <p class="text-xs text-slate-400">Checking this tab…</p>;
  if (page.kind === 'other') return <p class="text-xs text-slate-500">AI Shield does not apply to this page. It works on the supported chat, upload and video-call sites.</p>;
  if (page.kind === 'inactive')
    return (
      <p class="text-xs text-red-700" data-testid="page-inactive">
        ✗ {page.host} is a supported site, but AI Shield is <b>not running on this tab</b>. Reload the tab (Cmd/Ctrl+R). If it still says this, the extension is not loading here.
      </p>
    );
  return (
    <>
    <ul class="space-y-1 text-xs" data-testid="page-active">
      {page.status.parts.map((p) => {
        const d = p.detail;
        if (p.part === 'prompt')
          return [
            <Row ok key="p">AI chat detected ({String(d.site)}): AI Shield is running on this tab</Row>,
            <Row ok={Boolean(d.messageBox)} key="m">Message box: {d.messageBox ? 'found' : 'NOT found. This site may have changed its page, tell the developer'}</Row>,
            d.messageBox || !d.candidates ? null : <Candidates key="c" json={String(d.candidates)} />,
            <Row ok={d.sendButton ? true : 'info'} key="s">Send button: {d.sendButton ? 'found' : 'not on the page yet (many sites only show it after you type)'}</Row>,
            !d.sendButton && d.buttons ? <Buttons key="b" json={String(d.buttons)} /> : null,
            d.lastWrite ? <WriteDiag key="w" json={String(d.lastWrite)} /> : null,
            <Row ok="info" key="r">Placeholders remembered for this tab: {String(d.remembered ?? 0)}</Row>,
            Number(d.placeholdersRestorable) > 0 ? <Row ok={false} key="pr">{String(d.placeholdersRestorable)} placeholder(s) are still showing on screen and should have been replaced. Tell the developer.</Row> : null,
            Number(d.placeholdersInEditable) > 0 ? <Row ok="info" key="pe">{String(d.placeholdersInEditable)} placeholder(s) sit inside an editable area (for example a document or canvas editor). AI Shield leaves editable text alone on purpose: changing it would make the site think you typed the real value and could save it.</Row> : null,
          ];
        if (p.part === 'upload') return <Row ok key="u">Photo upload protection is running ({String(d.fileInputs)} file field{d.fileInputs === 1 ? '' : 's'} on this page)</Row>;
        if (p.part === 'video') return <Row ok key="v">Video-call protection is running ({String(d.videos)} video{d.videos === 1 ? '' : 's'} on this page)</Row>;
        return null;
      })}
    </ul>
    <TestButton />
    </>
  );
}

function TestButton() {
  const [msg, setMsg] = useState('');
  return (
    <div class="mt-2">
      <button
        class="rounded-md border border-slate-300 px-2 py-1 text-xs"
        onClick={async () => setMsg((await showTestNotification()) ? 'Sent. Look at the bottom-right corner of the page for the message.' : 'This page did not answer. Reload it and try again.')}
      >
        Show a test notification on this page
      </button>
      {msg && <p class="mt-1 text-[10px] text-slate-500">{msg}</p>}
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useSettings();
  const ledger = useLedger();
  const page = usePageStatus();
  const [domainInput, setDomainInput] = useState('');
  const [kw, setKw] = useState('');
  const [kwCount, setKwCount] = useState(0);
  const [kwMsg, setKwMsg] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void loadVault().then((v) => setKwCount(v.hashes.length));
  }, []);

  const addDomain = (d: string): void => {
    const host = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (host && !settings.allowlist.includes(host)) setSettings({ ...settings, allowlist: [...settings.allowlist, host] });
    setDomainInput('');
  };

  return (
    <main class="font-sans text-sm">
      <header class="flex items-center justify-between px-4 py-3">
        <div>
          <h1 class="text-base font-bold">🛡️ AI Shield</h1>
          <p class="text-xs text-slate-500">Everything runs on this device. Nothing is uploaded.</p>
        </div>
        <Toggle label="Enable AI Shield" on={settings.enabled} onChange={(enabled) => setSettings({ ...settings, enabled })} />
      </header>

      <Section title="This page">
        <ThisPage page={page} />
      </Section>

      <Section title="Shields">
        <ul class="space-y-2">
          {PILLARS.map((p) => (
            <li key={p.kind} class="flex items-center justify-between gap-3">
              <div>
                <div class="font-medium">{p.title}</div>
                <div class="text-xs text-slate-500">{p.blurb}</div>
              </div>
              <Toggle
                label={`${p.title} shield`}
                on={settings.enabled && settings.pillars[p.kind]}
                onChange={(v) => setSettings({ ...settings, pillars: { ...settings.pillars, [p.kind]: v } })}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Local privacy ledger">
        <div class="grid grid-cols-3 gap-2 text-center">
          {([['promptsRedacted', 'Prompts redacted'], ['photosCloaked', 'Photos cloaked'], ['callsProtected', 'Calls protected']] as const).map(([k, l]) => (
            <div key={k} class="rounded-lg bg-white p-2 shadow-sm ring-1 ring-slate-200">
              <div class="text-xl font-bold tabular-nums" data-testid={k}>{ledger[k]}</div>
              <div class="text-[10px] text-slate-500">{l}</div>
            </div>
          ))}
        </div>
        <p class="mt-1 text-[10px] text-slate-400">Counts only. No text, images or sites are recorded.</p>
      </Section>

      <Section title="Never share">
        <form
          class="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = await addKeyword(kw);
            setKw(''); // plaintext leaves memory of the UI immediately
            setKwCount(v.hashes.length);
            setKwMsg('Saved as a one-way hash.');
          }}
        >
          <input
            class="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1"
            placeholder="Name, project, account no…"
            value={kw}
            autocomplete="off"
            onInput={(e) => setKw((e.target as HTMLInputElement).value)}
          />
          <button class="rounded-md bg-slate-900 px-3 py-1 text-white disabled:opacity-40" disabled={!kw.trim()}>Add</button>
        </form>
        <p class="mt-1 text-xs text-slate-500">
          {kwCount} protected keyword{kwCount === 1 ? '' : 's'}. Only salted SHA-256 hashes are stored.
          {kwMsg && <span class="ml-1 text-emerald-700">{kwMsg}</span>}
        </p>
        {kwCount > 0 && (
          <button
            class="mt-1 rounded-md border border-red-300 px-2 py-1 text-xs text-red-700"
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
      </Section>

      <Section title="Trusted sites">
        <form class="flex gap-2" onSubmit={(e) => { e.preventDefault(); addDomain(domainInput); }}>
          <input class="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1" placeholder="example.com" value={domainInput} onInput={(e) => setDomainInput((e.target as HTMLInputElement).value)} />
          <button class="rounded-md bg-slate-900 px-3 py-1 text-white disabled:opacity-40" disabled={!domainInput.trim()}>Add</button>
        </form>
        <ul class="mt-2 space-y-1">
          {settings.allowlist.length === 0 && <li class="text-xs text-slate-400">No trusted sites. Shields run everywhere they apply.</li>}
          {settings.allowlist.map((d) => (
            <li key={d} class="flex items-center justify-between rounded bg-white px-2 py-1 ring-1 ring-slate-200">
              <span class="truncate">{d}</span>
              <button class="text-xs text-red-700" aria-label={`Remove ${d}`} onClick={() => setSettings({ ...settings, allowlist: settings.allowlist.filter((x) => x !== d) })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  );
}
