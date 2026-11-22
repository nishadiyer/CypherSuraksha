import { useEffect, useState } from 'preact/hooks';
import type { ShieldKind } from '../types/shield';
import { addKeyword, loadVault, useLedger, useSettings } from './store';

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

export function App() {
  const [settings, setSettings] = useSettings();
  const ledger = useLedger();
  const [domainInput, setDomainInput] = useState('');
  const [kw, setKw] = useState('');
  const [kwCount, setKwCount] = useState(0);
  const [kwMsg, setKwMsg] = useState('');

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
