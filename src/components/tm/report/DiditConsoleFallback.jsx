import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Upload } from 'lucide-react';

const STEPS = [
  'Open the case for this client in the Didit console.',
  'Generate the goAML report from the template.',
  'Download the XML file.',
  'Upload it here.',
];

export default function DiditConsoleFallback({ busy, onUpload }) {
  const ref = useRef(null);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onUpload(await file.text(), file.name);
  };
  return (
    <div className="mt-5 bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-amber-900">Generate in Didit console</h3>
        <p className="text-xs text-amber-800">Automatic goAML generation is not available for this plan. Generate the file in Didit and upload it here. The rest of the submission flow is unchanged.</p>
      </div>
      <ol className="list-decimal pl-5 text-xs text-amber-900 space-y-1">{STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
      <input ref={ref} type="file" accept=".xml,application/xml,text/xml" className="hidden" onChange={pick} />
      <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => ref.current?.click()}>
        {busy === 'upload_generated' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload goAML XML
      </Button>
    </div>
  );
}