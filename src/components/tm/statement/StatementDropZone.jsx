import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

const ACCEPT = '.csv,.xlsx,.sta,.txt,.940,.xml,.pdf';
const ALLOWED = ['csv', 'xlsx', 'sta', 'txt', '940', 'xml', 'pdf'];

export default function StatementDropZone({ onFile, disabled }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');

  function pick(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED.includes(ext)) { setError('Unsupported file. Use CSV, XLSX, MT940 (.sta/.txt/.940), CAMT.053 (.xml) or PDF.'); return; }
    setError('');
    onFile(file);
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a bank statement"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) pick(e.dataTransfer.files?.[0]); }}
        className={cn(
          'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
          over ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30',
          disabled && 'opacity-50 pointer-events-none'
        )}
      >
        <Upload className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
        <div className="text-sm font-medium">Drop a statement here or click to browse</div>
        <div className="text-xs text-muted-foreground mt-1">CSV · XLSX · MT940 · CAMT.053 · PDF</div>
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
    </div>
  );
}