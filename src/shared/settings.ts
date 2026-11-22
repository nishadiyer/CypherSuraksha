import type { ShieldKind } from '../types/shield';

export interface Settings {
  enabled: boolean;
  pillars: Record<ShieldKind, boolean>;
  allowlist: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  pillars: { PRIVACY: true, PIXELS: true, PEOPLE: true },
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
