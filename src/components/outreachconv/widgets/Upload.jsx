import React, { useRef, useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';

const MAX_MB = 25;
const TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const LONG_SIDE = 2400;
const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** Photos are made smaller in the browser (long side 2400 px, JPEG) so they fit the upload; PDFs are sent as they are. */
async function shrinkPhoto(file) {
  if (!/^image\/(jpeg|png)$/.test(file.type)) return file;
  if (file.size < 4 * 1024 * 1024) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const scale = Math.min(1, LONG_SIDE / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file;
  } catch { return file; } finally { URL.revokeObjectURL(url); }
}
const toBase64 = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = fail; r.readAsDataURL(file); });

/**
 * Upload step: the file goes to outreachUpload (private storage, checks); the checks appear one by one (pending, then
 * met or not met); then the answer names the stored evidence. "I will provide this later" only when the block allows it.
 */
export default function Upload({ step, busy, onAnswer, onUpload }) {
  const input = useRef(null);
  const [phase, setPhase] = useState('pick'); // pick | sending | checks
  const [err, setErr] = useState('');
  const [shown, setShown] = useState([]);
  const [fileName, setFileName] = useState('');

  async function pick(file) {
    setErr('');
    if (!file) return;
    if (file.type && !TYPES.includes(file.type)) { setErr(OC.fileType); return; }
    setFileName(file.name);
    setPhase('sending');
    try {
      const f = await shrinkPhoto(file);
      if (f.size > MAX_MB * 1024 * 1024) { setErr(OC.fileTooLarge(MAX_MB)); setPhase('pick'); return; }
      const res = await onUpload(step.id, { name: f.name, mime: f.type, data: await toBase64(f) });
      if (!res?.evidence_id) { setErr(res?.error || OC.notSaved); setPhase('pick'); return; }
      setPhase('checks');
      const all = res.checks || [];
      const wait = reducedMotion() ? 0 : 350;
      for (let i = 0; i < all.length; i++) {
        setShown(all.slice(0, i + 1));
        if (wait) await new Promise((r) => setTimeout(r, wait));
      }
      await onAnswer({ evidence_id: res.evidence_id });
    } catch (e) {
      setErr(e?.message || OC.notSaved);
      setPhase('pick');
    }
  }

  return (
    <div className="oc-widget">
      {phase === 'pick' && (
        <>
          <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="oc-file" aria-label={step.text} disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f); }} />
          {step.checks?.length > 0 && <ul className="oc-checks">{step.checks.map((c) => <li key={c}>{c}</li>)}</ul>}
          <p className="oc-small">{OC.uploadHint(MAX_MB)}</p>
          {step.allow_defer && <button type="button" className="oc-chip" disabled={busy} onClick={() => onAnswer({ deferred: true })}>{OC.later}</button>}
        </>
      )}
      {phase === 'sending' && <p className="oc-small oc-wait" role="status"><span className="oc-typing" aria-hidden="true"><span /><span /><span /></span> {OC.checkingFile(fileName)}</p>}
      {phase === 'checks' && (
        <ul className="oc-idv-checks" aria-live="polite" aria-label={OC.docChecks}>
          {shown.map((c) => (
            <li key={c.name} className={c.ok === true ? 'ok' : c.ok === false ? 'no' : ''}>
              <span aria-hidden="true">{c.ok === true ? '✓' : c.ok === false ? '✗' : '…'}</span>
              {c.name}{c.ok === false && c.message ? ` — ${c.message}` : ''}{c.ok === null ? ` (${OC.pendingReview})` : ''}
            </li>
          ))}
        </ul>
      )}
      {err && <p className="oc-err" style={{ padding: 0 }} role="alert">{err}</p>}
    </div>
  );
}
