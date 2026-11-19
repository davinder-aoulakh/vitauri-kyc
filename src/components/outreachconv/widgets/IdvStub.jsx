import React from 'react';
import { OC } from '@/lib/outreachConvStrings';
/** Test stand-in for the Didit ID check (the real widget arrives with phase 4). The server fills the facts and marks them as test data. */
export default function IdvStub({ busy, onAnswer }) {
  return (
    <div className="oc-widget oc-test">
      <p className="oc-small">{OC.idvTest}</p>
      <button type="button" className="oc-btn" disabled={busy} onClick={() => onAnswer({ stub: true })}>{OC.idvTestButton}</button>
    </div>
  );
}
