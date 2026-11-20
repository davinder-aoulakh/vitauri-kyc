import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { OC } from '@/lib/outreachConvStrings';

const PULL_MS = 4000;
/** Spec 5.2: QR code on a wide screen, the button on a phone-sized screen. */
export const isWideScreen = () => {
  try { return Math.min(window.innerWidth, window.screen?.width || window.innerWidth) > 760; } catch { return false; }
};

/**
 * The Didit ID check. The server (outreachPortal idv_start / idv_status) starts or reuses the session and applies the result;
 * this widget shows the QR code or the button, waits (4-second pull, plus a check when the tab is visible again or the
 * browser is back online) and offers "Not now".
 */
export default function Idv({ step, busy, onAnswer, onIdv }) {
  const idv = step.idv || {};
  const [wide] = useState(isWideScreen);
  const [qr, setQr] = useState('');
  const [starting, setStarting] = useState(false);
  const started = useRef(false);
  const timer = useRef(null);

  // Wide screen: start (or reuse) the session as soon as the step is shown, to draw the QR code.
  useEffect(() => {
    if (!wide || started.current || !idv.configured) return;
    if (idv.state === 'none' || ((idv.state === 'declined' || idv.state === 'expired') && idv.can_start)) {
      started.current = true;
      onIdv('idv_start');
    }
  }, [wide, idv.state, idv.can_start, idv.configured, onIdv]);

  useEffect(() => {
    let alive = true;
    if (wide && idv.session_url) QRCode.toDataURL(idv.session_url, { margin: 1, width: 220 }).then((u) => { if (alive) setQr(u); }).catch(() => setQr(''));
    else setQr('');
    return () => { alive = false; };
  }, [wide, idv.session_url]);

  // Waiting for the result: a ref-based timer, stopped when the step changes or the page unmounts.
  // One pull at a time: the next one is scheduled only after the previous answer is back (a pull can take seconds,
  // and two overlapping pulls once moved the conversation back to the ID confirmation).
  useEffect(() => {
    if (idv.state !== 'open') return undefined;
    let alive = true;
    let inFlight = false;
    const tick = async () => {
      if (!alive || inFlight) return;
      inFlight = true;
      clearTimeout(timer.current);
      try { await onIdv('idv_status', { quiet: true }); } finally {
        inFlight = false;
        if (alive) timer.current = setTimeout(tick, PULL_MS);
      }
    };
    timer.current = setTimeout(tick, PULL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', tick);
    return () => { alive = false; clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', tick); };
  }, [idv.state, onIdv]);

  async function continueOnPhone() {
    setStarting(true);
    try {
      const url = idv.session_url || (await onIdv('idv_start'))?.step?.idv?.session_url;
      if (url) window.location.assign(url);
    } finally { setStarting(false); }
  }

  const notNow = <button type="button" className="oc-link" disabled={busy || starting} onClick={() => onAnswer({ declined: true })}>{OC.notNow}</button>;

  if (!idv.configured) return <div className="oc-widget"><p className="oc-small">{idv.message || OC.idvNotConfigured}</p></div>;
  if (idv.state === 'in_review' || idv.state === 'approved') return <div className="oc-widget"><p className="oc-small">{OC.idvProcessing}</p></div>;
  if ((idv.state === 'declined' || idv.state === 'expired') && !idv.can_start) return <div className="oc-widget"><p className="oc-small">{idv.message}</p></div>;

  return (
    <div className="oc-widget oc-idv">
      {idv.message && <p className="oc-small" role="status">{idv.message}</p>}
      {wide ? (
        <div className="oc-idv-wide">
          <div className="oc-qr" aria-label={OC.qrLabel}>{qr ? <img src={qr} alt={OC.qrLabel} width={200} height={200} /> : <div className="oc-spin" aria-hidden="true" />}</div>
          <div>
            <ol className="oc-steps">
              <li>{OC.idvStep1}</li>
              <li>{OC.idvStep2}</li>
              <li>{OC.idvStep3}</li>
            </ol>
            {idv.state === 'open' && <p className="oc-small oc-wait"><span className="oc-typing" aria-hidden="true"><span /><span /><span /></span> {OC.waitingPhone}</p>}
            {idv.session_url && <p className="oc-small">{OC.orThisDevice} <a className="oc-link" href={idv.session_url}>{OC.openHere}</a></p>}
            {notNow}
          </div>
        </div>
      ) : (
        <div className="oc-row">
          <button type="button" className="oc-btn" disabled={busy || starting} onClick={continueOnPhone}>{starting ? OC.saving : OC.continueDidit}</button>
          {notNow}
        </div>
      )}
      {idv.attempts_left != null && idv.attempts_left < 3 && <p className="oc-small">{OC.attemptsLeft(idv.attempts_left)}</p>}
    </div>
  );
}
