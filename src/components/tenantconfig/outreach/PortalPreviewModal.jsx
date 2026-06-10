import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileText, Upload, CheckCircle } from 'lucide-react';
import { FIELD_TYPES } from './FieldTypePicker';

function getFieldTypeLabel(ft) {
  return FIELD_TYPES.find(f => f.value === ft)?.label || ft;
}

function getFieldTypeIcon(ft) {
  return FIELD_TYPES.find(f => f.value === ft)?.icon || '📄';
}

function PreviewField({ tmpl, branding }) {
  const { primary, radius, font } = branding;

  if (tmpl.field_type === 'section_header') {
    return (
      <div className="pt-4 pb-1 border-b border-slate-200">
        <div className="font-semibold text-sm" style={{ color: primary }}>{tmpl.section_title || tmpl.label}</div>
        {tmpl.description && <div className="text-xs text-slate-500 mt-0.5">{tmpl.description}</div>}
      </div>
    );
  }

  const isRequired = tmpl.is_mandatory;
  const ft = tmpl.field_type || (tmpl.item_type === 'document' ? 'file_upload' : 'textarea');

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span className="text-base leading-none mt-0.5">{getFieldTypeIcon(ft)}</span>
          <div>
            <div className="text-sm font-medium text-slate-800">
              {tmpl.label}
              {isRequired && <span style={{ color: primary }} className="ml-1">*</span>}
            </div>
            {tmpl.description && (
              <div className="text-xs text-slate-500 mt-0.5 line-clamp-2" dangerouslySetInnerHTML={{ __html: tmpl.description.replace(/<[^>]*>/g, '') }} />
            )}
          </div>
        </div>
        <span className="text-xs text-slate-400 flex-shrink-0">{getFieldTypeLabel(ft)}</span>
      </div>

      {/* Mock input */}
      {ft === 'file_upload' && (
        <div className="border-2 border-dashed border-slate-200 rounded-lg p-4 flex flex-col items-center text-xs text-slate-400">
          <Upload className="w-5 h-5 mb-1 text-slate-300" />
          <span>Upload file</span>
          {(tmpl.validation_accepted_file_types?.length > 0) && (
            <span className="mt-0.5 text-slate-300">{tmpl.validation_accepted_file_types.join(', ').toUpperCase()}</span>
          )}
        </div>
      )}
      {(ft === 'text') && (
        <div className="h-8 rounded-md border border-slate-200 bg-slate-50 px-3 flex items-center text-xs text-slate-300">Enter your response…</div>
      )}
      {(ft === 'textarea') && (
        <div className="h-16 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-300">Enter your response…</div>
      )}
      {(ft === 'number') && (
        <div className="h-8 rounded-md border border-slate-200 bg-slate-50 px-3 flex items-center text-xs text-slate-300 w-32">0</div>
      )}
      {(ft === 'date') && (
        <div className="h-8 rounded-md border border-slate-200 bg-slate-50 px-3 flex items-center text-xs text-slate-300 w-40">dd / mm / yyyy</div>
      )}
      {(ft === 'dropdown') && (
        <div className="h-8 rounded-md border border-slate-200 bg-slate-50 px-3 flex items-center justify-between text-xs text-slate-300">
          <span>{(tmpl.field_options?.[0]) || 'Select an option…'}</span>
          <span>▾</span>
        </div>
      )}
      {(ft === 'multi_select') && (
        <div className="flex flex-wrap gap-1.5">
          {(tmpl.field_options || ['Option A', 'Option B', 'Option C']).slice(0, 4).map((opt, i) => (
            <span key={i} className="text-xs border border-slate-200 rounded-full px-2.5 py-1 text-slate-500">{opt}</span>
          ))}
        </div>
      )}
      {(ft === 'checkbox') && (
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border border-slate-300 bg-slate-50" />
          <span className="text-xs text-slate-400">{tmpl.label}</span>
        </div>
      )}
      {(ft === 'yes_no') && (
        <div className="flex gap-2">
          <div className="h-8 px-4 rounded-lg border border-slate-200 text-xs text-slate-400 flex items-center">Yes</div>
          <div className="h-8 px-4 rounded-lg border border-slate-200 text-xs text-slate-400 flex items-center">No</div>
        </div>
      )}
      {(ft === 'signature') && (
        <div className="h-16 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-300 italic">Sign here…</div>
      )}
    </div>
  );
}

export default function PortalPreviewModal({ open, onClose, templates, tenant }) {
  const primary = tenant?.branding_primary_color || '#1A6BFF';
  const radius = { square: '0px', rounded: '8px', pill: '9999px' }[tenant?.branding_button_radius] || '8px';
  const font = tenant?.branding_font_family || 'Inter';
  const bg = tenant?.branding_bg_color || '#F4F6FA';
  const logoUrl = tenant?.branding_logo_url;
  const tenantName = tenant?.name || 'Institution';
  const headerStyle = tenant?.branding_header_style || 'dark';
  const headerBg = headerStyle === 'light' ? '#FFFFFF' : primary;
  const headerText = headerStyle === 'light' ? '#1A2332' : '#FFFFFF';
  const branding = { primary, radius, font };

  const sorted = [...templates].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0">
        <div style={{ fontFamily: font, backgroundColor: bg }}>
          {/* Simulated portal header */}
          <div style={{ backgroundColor: headerBg }} className="px-4 py-3 flex items-center gap-2 sticky top-0 z-10">
            {logoUrl
              ? <img src={logoUrl} alt={tenantName} className="h-7 object-contain" />
              : <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: primary }}>{tenantName.charAt(0)}</div>}
            <span className="font-semibold text-sm" style={{ color: headerText }}>{tenantName}</span>
            <span className="ml-auto text-xs opacity-50" style={{ color: headerText }}>Preview</span>
          </div>

          <div className="px-4 py-4 space-y-3">
            <div>
              <div className="text-base font-semibold" style={{ color: '#111827' }}>Dear Client,</div>
              <div className="text-xs text-slate-500 mt-0.5">Please provide the following information by <strong>31 December 2025</strong>.</div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>Your progress</span><span>0%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200">
                <div className="h-full rounded-full w-0" style={{ backgroundColor: primary }} />
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-3">
              {sorted.length === 0 && (
                <div className="text-center text-xs text-slate-400 py-6">No templates in this list yet.</div>
              )}
              {sorted.map(tmpl => (
                <PreviewField key={tmpl.id} tmpl={tmpl} branding={branding} />
              ))}
            </div>

            {/* Submit button */}
            {sorted.length > 0 && (
              <button
                className="w-full py-3 text-sm font-semibold text-white mt-2"
                style={{ backgroundColor: primary, borderRadius: radius }}
              >
                Submit All Responses →
              </button>
            )}

            {/* Footer */}
            {tenant?.portal_footer_text && (
              <div className="text-xs text-slate-400 pt-2 border-t border-slate-200"
                dangerouslySetInnerHTML={{ __html: tenant.portal_footer_text }} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}