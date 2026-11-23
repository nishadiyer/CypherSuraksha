import { b64ToBytes, bytesToB64 } from '../shared/base64';
import { newRequestId, send } from '../shared/messages';
import type { PixelsResult } from '../types/shield';
import { installUploadInterceptor } from './interceptors/uploadInterceptor';
import { showCloakResult, showCloaking } from './ui/CloakBadge';
import { registerPageStatus } from './status';
import { showToast } from './ui/Toast';

registerPageStatus('upload', () => ({ fileInputs: document.querySelectorAll('input[type=file]').length }));

/** Files that went out re-encoded with nothing cloaked (no face found); the badge reports them honestly. */
const noFace = new WeakSet<File>();

installUploadInterceptor(window, {
  async cloak(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const b64 = bytesToB64(buf);
    buf.fill(0);
    const r = await send({
      kind: 'SHIELD_REQUEST',
      request: { requestId: newRequestId(), shield: 'PIXELS', payload: { b64, mime: file.type, name: file.name, strength: 0.5 } },
    });
    if (!r.ok || !('response' in r)) throw new Error('shield unavailable');
    if (r.response.action === 'ALLOW') return file; // shield off / site allowlisted: pass original
    if (r.response.action !== 'MODIFY') return null;
    const d = r.response.data as PixelsResult;
    const bytes = b64ToBytes(d.b64);
    const name = d.mime === file.type ? file.name : file.name.replace(/\.[^.]+$/, '') + (d.mime === 'image/png' ? '.png' : '.jpg');
    const out = new File([bytes], name, { type: d.mime, lastModified: file.lastModified });
    if (d.mode === 'no-face') noFace.add(out);
    return out;
  },
  isNoFace: (f) => noFace.has(f),
  onProcessing: showCloaking,
  onResult: (anchor, cloaked, failed, none) =>
    showCloakResult(anchor, cloaked, failed, none, () => {
      void send({ kind: 'BYPASS_SITE' }).then(() => showToast('Photos on this site will no longer be cloaked. Re-select your photo to upload the original.', 6000));
    }),
});
