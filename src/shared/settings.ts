import type { ShieldKind } from '../types/shield';

export interface Settings {
  enabled: boolean;
  pillars: Record<ShieldKind, boolean>;
  /** Experimental face-swap detector (needs the optional 609 MB model and a real GPU). Off by default: it flagged a real webcam as AI-generated in live testing. */
  faceSwap: boolean;
  allowlist: string[];
  /** popup theme; unset = follow the system */
  theme?: 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  pillars: { PRIVACY: true, PIXELS: true, PEOPLE: true },
  faceSwap: false,
  allowlist: [],
};

export async function loadSettings(): Promise<Settings> {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings?: Partial<Settings> };
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    pillars: { ...DEFAULT_SETTINGS.pillars, ...settings?.pillars },
    allowlist: settings?.allowlist ?? [],
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: s });
}

export function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

export function isAllowlisted(domain: string, allowlist: string[]): boolean {
  return allowlist.some((d) => domain === d || domain.endsWith('.' + d));
}
