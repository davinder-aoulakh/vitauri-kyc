import React, { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Check, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

export default function CaseNotesSidebar({ noteText, onNoteChange, onNoteSave, noteSaving, noteSaved, caseCreatedDate }) {
  return (
    <div className="border-t border-border p-4 flex-shrink-0 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <div className="text-xs font-semibold text-muted-foreground">Case Notes</div>
        </div>
        {noteSaving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        {noteSaved && !noteSaving && <Check className="w-3.5 h-3.5 text-emerald-600" />}
      </div>

      {/* Case created timestamp */}
      {caseCreatedDate && (
        <div className="text-xs text-muted-foreground/70 bg-muted/30 px-2 py-1.5 rounded-md">
          Case opened {format(new Date(caseCreatedDate), 'd MMM yyyy HH:mm')}
        </div>
      )}

      {/* Textarea */}
      <Textarea
        value={noteText}
        onChange={e => {
          onNoteChange(e.target.value);
        }}
        placeholder="Add notes about case progress, decisions, or follow-ups…"
        className="text-xs min-h-20 resize-none"
        onBlur={onNoteSave}
      />
    </div>
  );
}