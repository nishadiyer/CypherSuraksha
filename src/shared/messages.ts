import type { EntityMap, ShieldRequest, ShieldResponse } from '../types/shield';

export type ExtMessage =
  /** content -> background */
  | { kind: 'SHIELD_REQUEST'; request: Omit<ShieldRequest, 'tabId' | 'domain'> }
  | { kind: 'GET_ENTITY_MAP' }
  | { kind: 'CALL_STARTED' }
  | { kind: 'BYPASS_SITE' }
  /** background -> offscreen */
  | { kind: 'OFFSCREEN_INFER'; target: 'offscreen'; request: ShieldRequest }
  | { kind: 'OFFSCREEN_DISPOSE'; target: 'offscreen' };

export type ExtReply =
  | { ok: true; response: ShieldResponse }
  | { ok: true; map: EntityMap }
  | { ok: true }
  | { ok: false; error: string };

/** popup -> content script: "what do you see on this page?" (answer carries no page content) */
export interface PageStatusPart {
  part: string;
  detail: Record<string, boolean | number | string>;
}
export interface PageStatus {
  parts: PageStatusPart[];
}

export interface SiteState {
  enabled: boolean;
  allowlisted: boolean;
  pillars: { PRIVACY: boolean; PIXELS: boolean; PEOPLE: boolean };
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function send<T extends ExtReply = ExtReply>(msg: ExtMessage): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}
