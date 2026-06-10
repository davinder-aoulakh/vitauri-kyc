import React, { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Smartphone, Tablet, Monitor, Upload, FileText, X, PenLine, CheckCircle } from 'lucide-react';
import { FIELD_TYPES } from './FieldTypePicker';
import { cn } from '@/lib/utils';

const VIEWPORTS = [
  { key: 'phone',   label: 'Phone',   icon: Smartphone, width: 375 },
  { key: 'tablet',  label: 'Tablet',  icon: Tablet,     width: 768 },
  { key: 'desktop', label: 'Desktop', icon: Monitor,    width: 1024 },
];

function getBranding(tenant) {
  const primary   = tenant?.branding_primary_color  || '#1A6BFF';
  const secondary = tenant?.branding_secondary_color || '#E8F0FF';
  const bg        = tenant?.branding_bg_color        || '#F4F6FA';
  const text      = tenant?.branding_text_color      || '#1A2332';
  const font      = tenant?.branding_font_family     || 'Inter';
  const radiusKey = tenant?.branding_button_radius   || 'rounded';
  const radius    = { square: '0px', rounded: '8px', pill: '9999px' }[radiusKey] || '8px';
  const headerStyle  = tenant?.branding_header_style || 'dark';
  const headerBg     = headerStyle === 'light' ? '#FFFFFF' : primary;
  const headerText   = headerStyle === 'light' ? '#1A2332' : '#FFFFFF';
  const whiteLabel   = tenant?.white_label_enabled || false;
  return { primary, secondary, bg, text, font, radius, headerBg, headerText, whiteLabel };
}

function getFieldTypeIcon(ft) {
  return FIELD_TYPES.find(f => f.value === ft)?.icon || '📄';
}

function PreviewField({ tmpl, branding }) {
  const { primary, secondary, text, radius } = branding;
  const ft = tmpl.field_type || (tmpl.item_type === 'document' ? 'file_upload' : 'textarea');

  if (ft === 'section_header') {
    return (
      <div className="pt-3 pb-1">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1" style={{ backgroundColor: secondary }} />
          <span className="text-xs font-bold uppercase tracking-widest opacity-60" style={{ color: text }}>
            {tmpl.section_title || tmpl.label}
          </span>
          <div className="h-px flex-1" style={{ backgroundColor: secondary }} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: secondary }}>
      <div className="px-4 pt-4 pb-2 flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <FileText className="w-4 h-4 text-slate-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm" style={{ color: text }}>
            {tmpl.label}
            {tmpl.is_mandatory && <span className="text-red-500 ml-1">*</span>}
          </div>
          {tmpl.description && (
            <div
              className="text-xs opacity-50 mt-0.5 line-clamp-2"
              dangerouslySetInnerHTML={{ __html: tmpl.description.replace(/<[^>]*>/g, '') }}
            />
          )}
        </div>
      </div>

      <div className="px-4 pb-4 mt-1">
        {ft === 'file_upload' && (
          <div className="border-2 border-dashed rounded-xl p-5 flex flex-col items-center" style={{ borderColor: secondary }}>
            <Upload className="w-5 h-5 mb-1 opacity-30" />
            <span className="text-sm opacity-40">Click or drag to upload</span>
            {tmpl.validation_accepted_file_types?.length > 0 && (
              <span className="text-xs opacity-30 mt-0.5">{tmpl.validation_accepted_file_types.join(', ').toUpperCase()} — max {tmpl.validation_max_file_size_mb || 25}MB</span>
            )}
            {(!tmpl.validation_accepted_file_types?.length) && (
              <span className="text-xs opacity-30 mt-0.5">PDF, JPG, PNG — max 25MB</span>
            )}
          </div>
        )}

        {ft === 'text' && (
          <div className="h-9 rounded-xl border px-3 flex items-center text-xs text-slate-300 bg-slate-50" style={{ borderColor: secondary }}>
            Enter your response…
          </div>
        )}

        {ft === 'textarea' && (
          <div className="h-16 rounded-xl border px-3 py-2.5 text-xs text-slate-300 bg-slate-50" style={{ borderColor: secondary }}>
            Enter your response…
          </div>
        )}

        {ft === 'number' && (
          <div className="h-9 rounded-xl border px-3 flex items-center text-xs text-slate-300 bg-slate-50 w-32" style={{ borderColor: secondary }}>
            0
          </div>
        )}

        {ft === 'date' && (
          <div className="h-9 rounded-xl border px-3 flex items-center text-xs text-slate-300 bg-slate-50 w-44" style={{ borderColor: secondary }}>
            dd / mm / yyyy
          </div>
        )}

        {ft === 'dropdown' && (
          <div className="h-9 rounded-xl border px-3 flex items-center justify-between text-xs bg-slate-50" style={{ borderColor: secondary }}>
            <span className="text-slate-300">{tmpl.field_options?.[0] || 'Select an option…'}</span>
            <span className="text-slate-300">▾</span>
          </div>
        )}

        {ft === 'multi_select' && (
          <div className="space-y-2 mt-1">
            {(tmpl.field_options?.length > 0 ? tmpl.field_options : ['Option A', 'Option B', 'Option C']).slice(0, 5).map((opt, i) => (
              <label key={i} className="flex items-center gap-2.5 text-xs opacity-60 cursor-default">
                <div className="w-4 h-4 rounded border border-slate-300 bg-slate-50 flex-shrink-0" />
                <span style={{ color: text }}>{opt}</span>
              </label>
            ))}
          </div>
        )}

        {ft === 'checkbox' && (
          <label className="mt-1 flex items-center gap-2.5 text-xs opacity-60 cursor-default">
            <div className="w-4 h-4 rounded border border-slate-300 bg-slate-50 flex-shrink-0" />
            <span style={{ color: text }}>{tmpl.label}</span>
          </label>
        )}

        {ft === 'yes_no' && (
          <div className="flex gap-3 mt-1">
            <div className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-center text-sm opacity-50" style={{ color: text }}>
              ✓ Yes
            </div>
            <div className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-center text-sm opacity-50" style={{ color: text }}>
              ✗ No
            </div>
          </div>
        )}

        {ft === 'signature' && (
          <div className="h-16 rounded-xl border-2 border-dashed flex items-center justify-center text-xs text-slate-300 italic" style={{ borderColor: secondary }}>
            <PenLine className="w-4 h-4 mr-1.5 opacity-30" /> Full name (digital signature)
          </div>
        )}
      </div>
    </div>
  );
}

function PortalMockup({ templates, tenant, title }) {
  const branding = getBranding(tenant);
  const { primary, secondary, bg, text, font, radius, headerBg, headerText, whiteLabel } = branding;
  const logoUrl    = tenant?.branding_logo_url;
  const tenantName = tenant?.name || 'Your Institution';
  const welcomeTitle = tenant?.portal_welcome_title || `Welcome — ${tenantName}`;
  const footerText   = tenant?.portal_footer_text;
  const sorted = [...templates].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const countable = sorted.filter(t => t.field_type !== 'section_header');

  return (
    <div style={{ fontFamily: font, backgroundColor: bg, minHeight: '100%' }}>
      {/* Header */}
      <div style={{ backgroundColor: headerBg }} className="px-4 py-3 flex items-center gap-2 sticky top-0 z-10 shadow-sm">
        {logoUrl
          ? <img src={logoUrl} alt={tenantName} className="h-7 object-contain max-w-[120px]" />
          : <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: primary }}>{tenantName.charAt(0)}</div>}
        <span className="font-semibold text-sm" style={{ color: headerText }}>{tenantName} — Document Request</span>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Welcome */}
        <div>
          <div className="text-base font-semibold" style={{ color: text }}>{welcomeTitle}</div>
          <div className="text-xs mt-0.5 opacity-50" style={{ color: text }}>
            Please provide the following information by <strong>31 December 2025</strong>.
          </div>
        </div>

        {/* Request title */}
        {title && (
          <div className="text-sm font-semibold" style={{ color: primary }}>{title}</div>
        )}

        {/* Progress */}
        <div>
          <div className="flex justify-between text-xs mb-1 opacity-50" style={{ color: text }}>
            <span>Your progress</span>
            <span>0 of {countable.length} completed</span>
          </div>
          <div className="h-2 rounded-full bg-slate-200">
            <div className="h-full rounded-full w-0" style={{ backgroundColor: primary }} />
          </div>
        </div>

        {/* Fields */}
        <div className="space-y-3">
          {sorted.length === 0 && (
            <div className="text-center text-xs opacity-40 py-8" style={{ color: text }}>No fields in this template yet.</div>
          )}
          {sorted.map(tmpl => (
            <PreviewField key={tmpl.id} tmpl={tmpl} branding={branding} />
          ))}
        </div>

        {/* Submit */}
        {sorted.length > 0 && (
          <button
            className="w-full py-3 text-sm font-semibold text-white mt-2 opacity-70 cursor-default"
            style={{ backgroundColor: primary, borderRadius: radius }}
          >
            Submit All Responses →
          </button>
        )}

        {/* Footer */}
        {footerText ? (
          <div className="text-xs opacity-40 pt-3 border-t" style={{ color: text, borderColor: secondary }}
            dangerouslySetInnerHTML={{ __html: footerText }} />
        ) : (
          <div className="text-xs opacity-30 pt-3 border-t text-center" style={{ color: text, borderColor: secondary }}>
            {whiteLabel ? tenantName : `Powered by ${tenantName}`}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PortalPreviewModal({ open, onClose, templates, tenant, title }) {
  const [viewport, setViewport] = useState('phone');
  const vp = VIEWPORTS.find(v => v.key === viewport);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-[900px] w-full p-0 gap-0 overflow-hidden" style={{ maxHeight: '92vh' }}>
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
          <div>
            <div className="text-sm font-semibold">Portal Preview</div>
            <div className="text-xs text-muted-foreground mt-0.5">This is a preview — clients will see your live branding</div>
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {VIEWPORTS.map(v => {
              const Icon = v.icon;
              return (
                <button
                  key={v.key}
                  onClick={() => setViewport(v.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    viewport === v.key
                      ? 'bg-white shadow text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Preview container */}
        <div className="flex-1 overflow-auto bg-slate-100 p-6 flex justify-center" style={{ maxHeight: 'calc(92vh - 64px)' }}>
          <div
            className="bg-white shadow-xl overflow-auto transition-all duration-300 rounded-2xl"
            style={{ width: vp.width, maxWidth: '100%', minHeight: 400 }}
          >
            <PortalMockup
              templates={templates}
              tenant={tenant}
              title={title}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}