import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Sparkles, Loader2, Plus, Check, X } from 'lucide-react';

// Presentational AI suggestions panel for the Org Chart Viewer.
// State (generating/aiSuggestions/error) and the generateChart action live in the parent page.
export default function OrgChartAiPanel({ generating, aiSuggestions, error, onRegenerate, onDismiss }) {
  return (
    <div className="border-b border-purple-100 bg-purple-50/40 px-6 py-4 flex-shrink-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600" />
          <span className="text-sm font-semibold text-purple-800">AI Org Chart Agent</span>
        </div>
        <button onClick={onDismiss} className="text-purple-400 hover:text-purple-700">
          <X className="w-4 h-4" />
        </button>
      </div>

      {generating && (
        <div className="flex items-center gap-3 py-4">
          <Loader2 className="w-5 h-5 animate-spin text-purple-600" />
          <span className="text-xs text-purple-700">Analysing ownership structure…</span>
        </div>
      )}

      {error && !generating && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>
      )}

      {aiSuggestions && !generating && (
        <div className="space-y-3">
          {aiSuggestions.unregistered_parties?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-amber-800">
                    AI detected {aiSuggestions.unregistered_parties.length} unregistered related {aiSuggestions.unregistered_parties.length === 1 ? 'party' : 'parties'}
                  </div>
                  <div className="mt-2 space-y-1">
                    {aiSuggestions.unregistered_parties.map((p, i) => (
                      <div key={i} className="flex items-center justify-between bg-amber-100/60 rounded-lg px-3 py-2">
                        <div>
                          <span className="text-xs font-medium text-amber-900">{p.name}</span>
                          {p.reason && <span className="text-xs text-amber-700 ml-2">— {p.reason}</span>}
                        </div>
                        <Button size="sm" variant="outline" className="text-xs h-6 border-amber-300 text-amber-700 hover:bg-amber-100">
                          <Plus className="w-3 h-3 mr-1" /> Add
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {aiSuggestions.nodes?.map((node, i) => (
              <div key={i} className="bg-white rounded-lg border border-purple-100 p-3 text-xs">
                <div className="font-medium text-foreground">{node.name}</div>
                <div className="text-muted-foreground">{node.role} {node.ownership_percentage ? `· ${node.ownership_percentage}%` : ''}</div>
                {node.flag && <div className="text-amber-600 mt-1">⚠ {node.flag}</div>}
              </div>
            ))}
          </div>

          {aiSuggestions.recommendation && (
            <div className="bg-purple-100 rounded-lg p-3 text-xs text-purple-800">
              <strong>Recommendation</strong><br />{aiSuggestions.recommendation}
            </div>
          )}

          <div className="flex gap-2">
            <Button size="sm" className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1">
              <Check className="w-3 h-3" /> Accept
            </Button>
            <Button size="sm" variant="outline" className="text-xs gap-1" onClick={onRegenerate}>
              <Sparkles className="w-3 h-3" /> Regenerate
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}