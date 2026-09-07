import React, { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Smartphone, Tablet, Monitor, X, Upload, ChevronDown } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { cn } from '@/lib/utils';

function resolveFieldType(item) {
  if (item.field_type) return item.field_type;
  return item.item_type === 'document' ? 'file_upload' : 'textarea';
}

function PreviewField({ item, primaryColor, buttonRadius }) {
  const ft = resolveFieldType(item);

  if (ft === 'id_verification') {
    return (
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '8px' }}>
          <label style={{ fontSize: '14px', fontWeight: 500, color: '#111827' }}>
            {item.label}
          </label>
          {(item.validation_required || item.is_mandatory)
            ? <span style={{ color: '#EF4444', fontSize: '13px' }}>*</span>
            : <span style={{ fontSize: '12px', color: '#9CA3AF' }}>(optional)</span>}
        </div>
        <div style={{
          border: '1px solid #BFDBFE', borderRadius: '12px',
          padding: '18px', background: '#EFF6FF', textAlign: 'center',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '10px' }}>🪪</div>
          <div style={{ fontWeight: 600, fontSize: '14px', color: '#1D4ED8', marginBottom: '8px' }}>
            Identity Verification
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: '4px', marginBottom: '14px' }}>
            {['Upload ID', 'Take Selfie', 'Face Match'].map((step, idx) => (
              <React.Fragment key={step}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: '26px', height: '26px', borderRadius: '50%',
                    background: primaryColor, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', fontWeight: 700, margin: '0 auto 3px',
                  }}>{idx + 1}</div>
                  <div style={{ fontSize: '10px', color: '#6B7280', whiteSpace: 'nowrap' }}>{step}</div>
                </div>
                {idx < 2 && (
                  <div style={{ width: '18px', height: '1px', background: '#93C5FD', marginBottom: '14px' }} />
                )}
              </React.Fragment>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '10px' }}>
            {(item.idv_accepted_doc_types || ['Passport', 'Driving_Licence', 'National_ID']).map(dt => (
              <span key={dt} style={{
                fontSize: '11px', background: 'white', border: '1px solid #BFDBFE',
                color: '#3B82F6', padding: '2px 8px', borderRadius: '20px',
              }}>
                {dt.replace('_', ' ')}
              </span>
            ))}
          </div>
          <div style={{ fontSize: '11px', color: '#6B7280' }}>
            Min. match score: <strong>{item.idv_min_match_score || 75}%</strong>
            {item.idv_liveness_required && ' · Blink liveness required'}
          </div>
          <div style={{
            border: '2px dashed #BFDBFE', borderRadius: '8px', padding: '12px',
            background: 'white', marginTop: '12px', fontSize: '12px', color: '#9CA3AF',
          }}>
            📤 Client uploads document here
          </div>
        </div>
      </div>
    );
  }

  if (ft === 'section_header') {
    return (
      <div className="pt-4 pb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">{item.section_title || item.label}</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>
        {item.description && (
          <p className="text-xs text-gray-500 mt-1" dangerouslySetInnerHTML={{ __html: item.description }} />
        )}
      </div>
    );
  }

  const inputBase = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-400 cursor-not-allowed select-none";

  return (
    <div className="mb-4">
      <div className="flex items-baseline gap-1 mb-1.5">
        <label className="text-sm font-medium text-gray-700">{item.label}</label>
        {(item.validation_required || item.is_mandatory)
          ? <span className="text-red-500 text-xs">*</span>
          : <span className="text-xs text-gray-400">(optional)</span>}
      </div>
      {item.description && (
        <p className="text-xs text-gray-500 mb-2" dangerouslySetInnerHTML={{ __html: item.description }} />
      )}

      {ft === 'file_upload' && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-5 text-center bg-gray-50">
          <Upload className="w-5 h-5 text-gray-300 mx-auto mb-1.5" />
          <div className="text-xs text-gray-400">Click to upload or drag and drop</div>
          <div className="text-xs text-gray-300 mt-0.5">
            {(item.validation_accepted_file_types?.length ? item.validation_accepted_file_types.join(', ').toUpperCase() : 'PDF, JPG, PNG')}
            {' · max '}{item.validation_max_file_size_mb || 25}MB
          </div>
        </div>
      )}

      {ft === 'text' && (
        <input type="text" disabled readOnly placeholder={`Enter ${item.label.toLowerCase()}…`} className={inputBase} />
      )}

      {ft === 'textarea' && (
        <textarea disabled readOnly rows={3} placeholder="Enter your response here…" className={cn(inputBase, "resize-none")} />
      )}

      {ft === 'number' && (
        <input type="number" disabled readOnly placeholder="0" className={inputBase} />
      )}

      {ft === 'date' && (
        <input type="date" disabled readOnly className={inputBase} />
      )}

      {ft === 'dropdown' && (
        <div className={cn(inputBase, "flex items-center justify-between")}>
          <span className="text-gray-300">Select an option…</span>
          <ChevronDown className="w-4 h-4 text-gray-300" />
        </div>
      )}

      {ft === 'multi_select' && (
        <div className="space-y-2">
          {(item.field_options?.length ? item.field_options : ['Option 1', 'Option 2', 'Option 3']).slice(0, 4).map((opt, i) => (
            <label key={i} className="flex items-center gap-2.5 opacity-60 cursor-not-allowed">
              <input type="checkbox" disabled className="rounded" />
              <span className="text-sm text-gray-600">{opt}</span>
            </label>
          ))}
          {(item.field_options?.length > 4) && (
            <div className="text-xs text-gray-400">+{item.field_options.length - 4} more options…</div>
          )}
        </div>
      )}

      {ft === 'checkbox' && (
        <label className="flex items-center gap-2.5 opacity-60 cursor-not-allowed">
          <input type="checkbox" disabled className="rounded" />
          <span className="text-sm text-gray-600">{item.label}</span>
        </label>
      )}

      {ft === 'yes_no' && (
        <div className="flex gap-3">
          {['Yes', 'No'].map(opt => (
            <button key={opt} disabled type="button"
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-300 cursor-not-allowed">
              {opt}
            </button>
          ))}
        </div>
      )}

      {ft === 'signature' && (
        <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center bg-gray-50">
          <div className="text-sm text-gray-300 italic" style={{ fontFamily: 'cursive' }}>Type your full name here…</div>
          <div className="border-t border-gray-200 mt-2 pt-1">
            <span className="text-xs text-gray-300">Signature</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FormTemplatePreview({ template, tenant, open, onClose }) {
  const [viewport, setViewport] = useState('mobile');

  if (!template) return null;

  const primary    = tenant?.branding_primary_color || '#1A6BFF';
  const bgColor    = tenant?.branding_bg_color      || '#F4F6FA';
  const fontFamily = tenant?.branding_font_family   || 'Inter, sans-serif';
  const headerDark = (tenant?.branding_header_style || 'dark') === 'dark';
  const buttonR    = { square: '0px', rounded: '8px', pill: '9999px' }[tenant?.branding_button_radius || 'rounded'] || '8px';
  const logoUrl    = tenant?.branding_logo_url;
  const tenantName = tenant?.name || 'Your Institution';
  const whiteLabel = tenant?.white_label_enabled;

  const deadline = format(addDays(new Date(), template.default_deadline_days || 14), 'd MMMM yyyy');
  const viewportWidth = { mobile: 375, tablet: 768, desktop: '100%' }[viewport];
  const items = (template.items || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const countableItems = items.filter(i => resolveFieldType(i) !== 'section_header');

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent hideClose className="max-w-5xl h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">

        {/* Dialog header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">{template.name}</span>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Portal Preview</span>
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {[
              { id: 'mobile',  icon: Smartphone, label: 'Mobile (375px)' },
              { id: 'tablet',  icon: Tablet,     label: 'Tablet (768px)' },
              { id: 'desktop', icon: Monitor,    label: 'Desktop'        },
            ].map(({ id, icon: Icon, label }) => (
              <button key={id} title={label} onClick={() => setViewport(id)}
                className={cn('p-1.5 rounded-md transition-all',
                  viewport === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}>
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Preview note */}
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex-shrink-0">
          <p className="text-xs text-amber-700">
            Preview uses your live branding settings. Fields are read-only — this is exactly what your client will see.
          </p>
        </div>

        {/* Scrollable canvas */}
        <div className="flex-1 overflow-auto bg-gray-100 flex justify-center py-6 px-4">
          <div style={{
            width: typeof viewportWidth === 'number' ? `${viewportWidth}px` : viewportWidth,
            maxWidth: '100%',
            fontFamily,
            fontSize: '14px',
            lineHeight: '1.5',
            background: bgColor,
            minHeight: '100%',
            borderRadius: viewport === 'desktop' ? '0' : '12px',
            overflow: 'hidden',
            boxShadow: viewport === 'desktop' ? 'none' : '0 4px 32px rgba(0,0,0,0.12)',
          }}>

            {/* Portal header */}
            <div style={{
              background: headerDark ? '#0F1F3D' : '#FFFFFF',
              borderBottom: headerDark ? 'none' : '1px solid #E5E7EB',
              padding: '14px 20px',
              display: 'flex', alignItems: 'center', gap: '12px',
            }}>
              {logoUrl ? (
                <img src={logoUrl} alt={tenantName} style={{ height: '28px', objectFit: 'contain' }} />
              ) : (
                <span style={{ fontWeight: 700, fontSize: '16px', color: headerDark ? '#FFFFFF' : primary }}>
                  {tenantName}
                </span>
              )}
              <span style={{ fontSize: '12px', color: headerDark ? 'rgba(255,255,255,0.5)' : '#6B7280', marginLeft: '4px' }}>
                Secure Document Portal
              </span>
              <div style={{ marginLeft: 'auto' }}>
                <span style={{
                  fontSize: '11px', padding: '3px 10px', borderRadius: '20px', fontWeight: 500,
                  background: headerDark ? 'rgba(255,255,255,0.1)' : '#F3F4F6',
                  color: headerDark ? 'rgba(255,255,255,0.7)' : '#374151',
                }}>
                  Due: {deadline}
                </span>
              </div>
            </div>

            {/* Portal body */}
            <div style={{ padding: viewport === 'mobile' ? '16px' : '24px' }}>

              {/* Welcome card */}
              <div style={{ background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E5E7EB', padding: '18px 20px', marginBottom: '16px' }}>
                <div style={{ fontWeight: 600, fontSize: '15px', color: '#111827', marginBottom: '4px' }}>
                  {tenant?.portal_welcome_title || 'Hello, Sample Client'}
                </div>
                <div style={{ fontSize: '13px', color: '#6B7280', lineHeight: 1.6 }}>
                  {tenant?.portal_welcome_body ||
                    `${tenantName} has requested some information from you as part of our standard review process. Please complete all items below before ${deadline}.`}
                </div>
                <div style={{ marginTop: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px', color: '#9CA3AF' }}>
                    <span>Your progress</span>
                    <span>0 of {countableItems.length} completed</span>
                  </div>
                  <div style={{ height: '4px', background: '#E5E7EB', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: '0%', height: '100%', background: primary, borderRadius: '2px' }} />
                  </div>
                </div>
              </div>

              {/* Request card */}
              <div style={{ background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E5E7EB', overflow: 'hidden', marginBottom: '16px' }}>
                <div style={{ padding: '12px 18px', borderBottom: '1px solid #F3F4F6', background: '#FAFAFA', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#111827' }}>{template.name}</div>
                    <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '1px' }}>
                      {countableItems.length} item(s) requested · Due {deadline}
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '20px', border: '1px solid #FCD34D', background: '#FFFBEB', color: '#92400E' }}>
                    Action Required
                  </span>
                </div>

                <div style={{ padding: '18px 20px' }}>
                  {items.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: '#9CA3AF', fontSize: '13px' }}>
                      No fields added to this template yet.
                    </div>
                  ) : (
                    items.map((item, idx) => (
                      <PreviewField key={idx} item={item} primaryColor={primary} buttonRadius={buttonR} />
                    ))
                  )}

                  {items.length > 0 && (
                    <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #F3F4F6' }}>
                      <button type="button" disabled style={{
                        width: '100%', padding: '12px', background: primary, color: '#FFFFFF',
                        border: 'none', borderRadius: buttonR, fontSize: '14px', fontWeight: 600,
                        cursor: 'not-allowed', opacity: 0.9,
                      }}>
                        Submit All Responses
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Portal footer */}
              {(tenant?.portal_footer_text || tenant?.portal_contact_info) ? (
                <div style={{ fontSize: '11px', color: '#9CA3AF', padding: '12px 4px', lineHeight: 1.6 }}>
                  {tenant?.portal_footer_text && <div dangerouslySetInnerHTML={{ __html: tenant.portal_footer_text }} />}
                  {tenant?.portal_contact_info && <div style={{ marginTop: '4px' }}>{tenant.portal_contact_info}</div>}
                </div>
              ) : (
                <div style={{ fontSize: '11px', color: '#9CA3AF', padding: '12px 4px' }}>
                  This is a secure link for your use only. Please do not share it.
                  {!whiteLabel && <div style={{ marginTop: '4px', opacity: 0.6 }}>Powered by Vitauri KYC</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}