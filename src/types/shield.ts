export type ShieldKind = 'PRIVACY' | 'PIXELS' | 'PEOPLE';
export type ShieldAction = 'ALLOW' | 'MODIFY' | 'WARN' | 'BLOCK';

export interface ShieldRequest {
  requestId: string;
  shield: ShieldKind;
  tabId: number;
  domain: string;
  payload: unknown;
}

export interface ShieldResponse {
  requestId: string;
  action: ShieldAction;
  data?: unknown;
  confidence: number;
  latencyMs: number;
}

/** Every offscreen shield implements this contract. */
export interface Shield {
  readonly kind: ShieldKind;
  handle(request: ShieldRequest): Promise<ShieldResponse>;
  /** Release sessions, tensors and buffers. */
  dispose(): Promise<void>;
}

/* ---------- Privacy ---------- */
export type EntityType = 'PERSON' | 'ORG' | 'LOC' | 'ID' | 'SECRET' | 'EMAIL' | 'PHONE' | 'CUSTOM';

/** placeholder -> real value, e.g. "[PERSON_1]" -> "Ada Lovelace" */
export type EntityMap = Record<string, string>;

export interface PrivacyPayload {
  text: string;
  existingMap: EntityMap;
  vault: VaultSnapshot;
}
export interface PrivacyResult {
  redactedText: string;
  map: EntityMap;
  count: number;
}

export interface VaultSnapshot {
  salt: string; // base64
  hashes: string[]; // hex SHA-256(salt || normalizedKeyword)
}

/* ---------- Pixels ---------- */
export interface PixelsPayload {
  /** base64 of the original encoded image (never persisted) */
  b64: string;
  mime: string;
  name: string;
  strength: number;
}
export interface PixelsResult {
  b64: string;
  mime: string;
  /** how the photo was protected: pgd-wasm, no-face, onnx-*, deterministic-noise */
  mode?: string;
  /** faces cloaked (PGD mode) */
  faces?: number;
}

/* ---------- People ---------- */
export interface PeoplePayload {
  /** RGBA pixels, base64 */
  b64: string;
  width: number;
  height: number;
  sessionId: string;
}
export interface PeopleResult {
  frameScore: number;
  smoothed: number;
  level: 'GREEN' | 'YELLOW' | 'RED';
  sustainedRed: boolean;
  backend: string;
}
