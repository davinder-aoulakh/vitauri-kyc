/**
 * ProfileVerificationSection — unified structured-profile verification grid for Step 1.
 * Wraps useProfileSuggestions; renders pipeline controls, metadata bar, the per-field
 * green/amber/red grid, and (for ORG clients) the related-party suggestion sub-grid.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { useProfileSuggestions } from '@/hooks/useProfileSuggestions';
import ProfileFieldRow from '@/components/case/profile/ProfileFieldRow';
import RelatedPartySuggestionRow from '@/components/case/profile/RelatedPartySuggestionRow';
import { Sparkles, Loader2, User, Building2, AlertTriangle, CheckCheck, RefreshCw, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { getNestedValue } from '@/lib/clientNameUtils';

export default function ProfileVerificationSection({
  kycCase, client, currentUser, onFieldVerified, onRequestInfoEmail, onAddNote, onCaseUpdate,
}) {
  const profile = useProfileSuggestions({ kycCase, client, currentUser, onFieldVerified, onCaseUpdate });
  const {
    isOrg, fieldLabels, fieldKeys, clientFields, suggestions, pipelineRunning, acceptingField,
    confirmed, conflicts, highConfPending,
    runPipeline, acceptField, rejectField, handleManualEdit, markInfoRequested, reopenField,
    acceptAllHighConfidence, acceptRelatedParty, rejectRelatedParty, reapplyField,
  } = profile;

  async function handleRequestInfo(fieldKey, mode) {
    const fieldLabel = fieldLabels[fieldKey];
    if (mode === 'flag') {
      await markInfoRequested(fieldKey);
      await onAddNote?.(`[Profile Verification] Info requested for "${fieldLabel}" — flagged for internal review by ${currentUser?.full_name || 'analyst'}.`);
    } else {
      onRequestInfoEmail?.(fieldLabel);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm">Profile Verification</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI-extracted from documents, outreach responses &amp; OSINT · Accept, request info, or keep the existing value for each field
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {suggestions && highConfPending > 0 && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
              onClick={acceptAllHighConfidence}>
              <CheckCheck className="w-3.5 h-3.5" /> Accept All High-Confidence ({highConfPending})
            </Button>
          )}
          <Button size="sm"
            className={cn('gap-1.5 text-xs', suggestions ? 'bg-slate-700 hover:bg-slate-800 text-white' : 'bg-purple-600 hover:bg-purple-700 text-white')}
            onClick={() => runPipeline(false)}
            disabled={pipelineRunning}
          >
            {pipelineRunning
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running Pipeline…</>
              : suggestions
                ? <><RefreshCw className="w-3.5 h-3.5" /> Re-run Pipeline</>
                : <><Sparkles className="w-3.5 h-3.5" /> Run Pre-fill Pipeline</>
            }
          </Button>
        </div>
      </div>

      {suggestions?.run_at && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2 flex-wrap">
          <span className="flex items-center gap-1">
            <Info className="w-3 h-3" />
            Last run: {format(new Date(suggestions.run_at), 'd MMM yyyy HH:mm')}
          </span>
          <span>{suggestions.sources_summary?.documents_processed || 0} docs OCR'd</span>
          <span>{suggestions.sources_summary?.outreach_responses || 0} outreach responses</span>
          <span>{suggestions.sources_summary?.osint_findings || 0} OSINT findings</span>
          {conflicts > 0 && <span className="text-red-600 font-medium flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {conflicts} conflict{conflicts > 1 ? 's' : ''}</span>}
          <span className="text-emerald-600 font-medium">{confirmed}/{fieldKeys.length} confirmed</span>
        </div>
      )}

      {!suggestions && !pipelineRunning && (
        <div className="bg-card border border-border rounded-xl py-12 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-purple-300 mx-auto" />
          <p className="text-sm font-medium text-foreground">No profile suggestions yet</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Run the pre-fill pipeline to automatically extract {isOrg ? 'ORG' : 'NP'} profile fields from documents, outreach responses, and OSINT — each with a source and confidence score.
          </p>
        </div>
      )}

      {pipelineRunning && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl py-10 text-center space-y-3">
          <div className="relative inline-block">
            <div className="w-12 h-12 rounded-full bg-purple-100 animate-ping absolute inset-0 opacity-40" />
            <div className="w-12 h-12 rounded-full bg-purple-100 border border-purple-300 flex items-center justify-center relative">
              <Sparkles className="w-5 h-5 text-purple-600 animate-pulse" />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-purple-800">Pipeline running…</p>
            <p className="text-xs text-purple-600 mt-0.5">OCR'ing documents · reading outreach · running OSINT</p>
          </div>
        </div>
      )}

      {suggestions && !pipelineRunning && (
        <div className="space-y-5">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
              {isOrg ? <Building2 className="w-4 h-4 text-blue-600" /> : <User className="w-4 h-4 text-violet-600" />}
              <span className="font-semibold text-sm">{isOrg ? 'Entity Profile Fields' : 'Personal Profile Fields'}</span>
              <span className="text-xs text-muted-foreground ml-auto">{confirmed}/{fieldKeys.length} confirmed</span>
            </div>
            <div className="p-4 grid grid-cols-1 gap-2.5">
              {fieldKeys.map(key => (
                <ProfileFieldRow
                  key={key}
                  fieldKey={key}
                  label={fieldLabels[key]}
                  suggestion={clientFields[key] || null}
                  currentValue={getNestedValue(client, key) || ''}
                  onAccept={acceptField}
                  onReject={rejectField}
                  onManualEdit={handleManualEdit}
                  onRequestInfo={handleRequestInfo}
                  onReopen={reopenField}
                  onReapply={reapplyField}
                  accepting={acceptingField === key}
                />
              ))}
            </div>
          </div>

          {isOrg && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" />
                <span className="font-semibold text-sm">Related Party Suggestions</span>
                <span className="text-xs text-muted-foreground">(from incorporation docs)</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {(suggestions.related_parties || []).filter(r => r.status === 'confirmed').length}/{(suggestions.related_parties || []).length} confirmed
                </span>
              </div>
              <div className="p-4 space-y-2.5">
                {!suggestions.related_parties?.length ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    No related parties extracted from documents.<br />
                    <span className="text-xs">Directors, UBOs, and shareholders will appear here if found in incorporation docs.</span>
                  </div>
                ) : (
                  suggestions.related_parties.map((rp, i) => (
                    <RelatedPartySuggestionRow
                      key={i}
                      rp={rp}
                      rpIndex={i}
                      onAccept={acceptRelatedParty}
                      onReject={rejectRelatedParty}
                      accepting={false}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          {conflicts > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800">{conflicts} field conflict{conflicts > 1 ? 's' : ''} detected</p>
                <p className="text-xs text-red-600 mt-0.5">
                  These fields have contradictory values across sources. Review each conflict manually and accept the correct value, or enter the correct value directly.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}