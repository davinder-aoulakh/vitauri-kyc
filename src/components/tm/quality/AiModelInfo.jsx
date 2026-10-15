import React from 'react';
import { modelLabel } from '@/lib/tmAiModels';

/** Read-only: which model the TM agents use and when that last changed. Shown next to the AI shadow metrics. */
export default function AiModelInfo({ tenant }) {
  let s = tenant?.tm_settings;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { s = {}; } }
  s = s || {};
  return (
    <div className="mt-5 rounded-xl border border-border bg-card px-4 py-3 text-xs">
      <span className="font-semibold">AI model:</span> {modelLabel(s.ai_model)}
      <span className="text-muted-foreground">
        {s.ai_model_changed_at ? ` · last changed ${s.ai_model_changed_at.slice(0, 10)}${s.ai_model_change_note ? `: ${s.ai_model_change_note}` : ''}` : ' · never changed'}
      </span>
    </div>
  );
}