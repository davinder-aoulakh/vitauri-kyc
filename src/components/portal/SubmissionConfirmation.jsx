import React from 'react';
import { CheckCircle, Mail, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

export default function SubmissionConfirmation({
  outreach,
  client,
  tenantName,
  brandColor,
  onBackToDashboard,
  lang = 'en',
}) {
  const t = {
    en: {
      success_full: 'Your documents have been successfully received by',
      success_msg: 'Our compliance team will review your submission.',
      submitted_label: 'Submitted on',
      items_label: 'items',
      reference: 'Reference',
      partial_title: 'Thank you — we\'ve received your submission',
      partial_msg: 'of the requested items.',
      please_complete: 'Please complete the remaining items before',
      email_sent: 'A confirmation email has been sent to',
      back_dashboard: 'Back to Overview',
      copy: 'Copy',
      copied: 'Copied!',
    },
    nl: {
      success_full: 'Uw documenten zijn succesvol ontvangen door',
      success_msg: 'Ons compliance team zal uw inzending beoordelen.',
      submitted_label: 'Ingediend op',
      items_label: 'items',
      reference: 'Referentie',
      partial_title: 'Dank u — we hebben uw inzending ontvangen',
      partial_msg: 'van de gevraagde items.',
      please_complete: 'Voltooi de resterende items alstublieft voor',
      email_sent: 'Een bevestigings-e-mail is verzonden naar',
      back_dashboard: 'Terug naar overzicht',
      copy: 'Kopiëren',
      copied: 'Gekopieerd!',
    },
  };

  const strings = t[lang] || t.en;

  const submitted = (outreach.items || []).filter(
    i => i.status === 'Received' || i.status === 'Verified'
  );
  const total = outreach.items?.length || 0;
  const isComplete = submitted.length === total;
  const refShort = outreach.id?.substring(0, 8).toUpperCase() || '';
  const submittedDate = format(new Date(), 'd MMMM yyyy');

  const handleCopyRef = () => {
    navigator.clipboard.writeText(outreach.id);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-blue-50 pb-24">
      {/* Success Banner */}
      <div className="w-full bg-emerald-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-start gap-3">
          <CheckCircle className="w-6 h-6 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-base">
              {isComplete
                ? `${strings.success_full} ${tenantName}.`
                : `${strings.partial_title}`}
            </div>
            <div className="text-emerald-100 text-sm mt-1">
              {isComplete
                ? strings.success_msg
                : `${submitted.length} ${strings.items_label} ${strings.of || 'of'} ${total}. ${strings.please_complete} ${format(parseISO(outreach.deadline), 'd MMMM yyyy')}.`}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 pt-8 space-y-5">
        {/* Submission Summary Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: brandColor }}
            >
              ✓
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">
                Submitted {submitted.length} {strings.items_label}
              </div>
              <div className="text-xs text-slate-500">{strings.submitted_label} {submittedDate}</div>
            </div>
          </div>

          {/* Submitted Items List */}
          <div className="space-y-2 mb-4">
            {submitted.map(item => (
              <div key={item.item_id} className="flex items-center gap-2 text-sm text-slate-700 bg-emerald-50 rounded-lg px-3 py-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          {/* Reference Number */}
          <div className="border-t border-slate-100 pt-4">
            <div className="text-xs text-slate-500 mb-1.5">{strings.reference}</div>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono font-semibold text-slate-800 bg-slate-100 rounded-lg px-3 py-2.5 flex-1">
                {refShort}
              </code>
              <button
                onClick={handleCopyRef}
                className="p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-slate-600"
                title={strings.copy}
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Remaining Items (if partial) */}
        {!isComplete && (
          <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5">
            <div className="text-sm font-semibold text-amber-900 mb-3">
              Remaining {total - submitted.length} {strings.items_label}
            </div>
            <div className="space-y-2">
              {(outreach.items || [])
                .filter(i => i.status !== 'Received' && i.status !== 'Verified')
                .map(item => (
                  <div key={item.item_id} className="flex items-center gap-2 text-xs text-amber-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                    {item.label}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Email Confirmation */}
        <div className="bg-blue-50 rounded-2xl border border-blue-200 p-5 flex items-start gap-3">
          <Mail className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <div className="font-semibold mb-0.5">{strings.email_sent}</div>
            <div className="text-blue-700">{client?.primary_contact_email}</div>
          </div>
        </div>

        {/* Action Button */}
        {onBackToDashboard && (
          <Button
            className="w-full h-11 text-base font-semibold rounded-2xl"
            style={{ backgroundColor: brandColor }}
            onClick={onBackToDashboard}
          >
            {strings.back_dashboard}
          </Button>
        )}
      </div>
    </div>
  );
}