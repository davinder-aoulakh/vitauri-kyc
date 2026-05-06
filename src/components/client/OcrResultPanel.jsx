import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, AlertTriangle, ChevronDown, ChevronUp, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Human-readable labels for extracted fields
const FIELD_LABELS = {
  full_name:            'Full Name',
  date_of_birth:        'Date of Birth',
  nationality:          'Nationality',
  id_number:            'ID / Passport Number',
  id_type:              'ID Type',
  id_expiry_date:       'ID Expiry Date',
  country_of_residence: 'Country of Residence',
  registration_number:  'Registration Number',
  registered_country:   'Registered Country',
  registered_address:   'Registered Address',
  legal_form:           'Legal Form',
  sector:               'Sector',
  lei_code:             'LEI Code',
};

export default function OcrResultPanel({ ocrResult, onApply, onDismiss }) {
  const [selected, setSelected] = useState(() => {
    const init = {};
    Object.keys(ocrResult.extracted || {}).forEach(k => { init[k] = true; });
    return init;
  });
  const [expanded, setExpanded] = useState(true);

  const fields = Object.entries(ocrResult.extracted || {});
  if (fields.length === 0) return null;

  const confidence = ocrResult.confidence;
  const confidenceColor = confidence >= 80 ? 'text-emerald-600' : confidence >= 50 ? 'text-amber-600' : 'text-red-600';

  function toggleField(key) {
    setSelected(s => ({ ...s, [key]: !s[key] }));
  }

  function handleApply() {
    const toApply = {};
    Object.entries(selected).forEach(([k, on]) => {
      if (on && ocrResult.extracted[k] != null) toApply[k] = ocrResult.extracted[k];
    });
    onApply(toApply);
  }

  const anySelected = Object.values(selected).some(Boolean);

  return (
    <div className="border border-primary/30 bg-primary/5 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-primary/10 border-b border-primary/20">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-primary">OCR Extraction Complete</span>
          {confidence != null && (
            <span className={cn('text-xs font-medium ml-1', confidenceColor)}>
              {confidence}% confidence
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1 rounded hover:bg-primary/10 text-muted-foreground"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onDismiss} className="p-1 rounded hover:bg-primary/10 text-muted-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Select the fields you want to pre-fill into the client profile. Review each value before applying.
          </p>

          {/* Warnings */}
          {ocrResult.warnings?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
              {ocrResult.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Field checklist */}
          <div className="space-y-1.5">
            {fields.map(([key, value]) => (
              <label
                key={key}
                className={cn(
                  'flex items-start gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors',
                  selected[key]
                    ? 'bg-white border-primary/30'
                    : 'bg-muted/20 border-transparent opacity-60'
                )}
              >
                <input
                  type="checkbox"
                  checked={!!selected[key]}
                  onChange={() => toggleField(key)}
                  className="mt-0.5 rounded"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-muted-foreground">{FIELD_LABELS[key] || key}</div>
                  <div className="text-sm font-medium text-foreground truncate">{String(value)}</div>
                </div>
                {selected[key] && <CheckCircle className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />}
              </label>
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleApply}
              disabled={!anySelected}
              className="gap-1.5 flex-1"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Apply {Object.values(selected).filter(Boolean).length} Field{Object.values(selected).filter(Boolean).length !== 1 ? 's' : ''} to Profile
            </Button>
            <Button size="sm" variant="outline" onClick={onDismiss}>Discard</Button>
          </div>
        </div>
      )}
    </div>
  );
}