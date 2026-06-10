import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Save, Loader2, Upload, Shield, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

const FONT_OPTIONS = ['Inter', 'DM Sans', 'Georgia', 'Roboto', 'Open Sans'];

function ColorField({ label, fieldKey, form, setForm }) {
  const val = form[fieldKey] || '';
  return (
    <div>
      <Label className="text-xs font-medium mb-1.5 block">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          value={val || '#000000'}
          onChange={e => setForm(f => ({ ...f, [fieldKey]: e.target.value }))}
          className="h-9 w-14 p-1 cursor-pointer flex-shrink-0"
        />
        <Input
          value={val}
          onChange={e => setForm(f => ({ ...f, [fieldKey]: e.target.value }))}
          className="h-9 text-sm flex-1 font-mono"
          placeholder="#000000"
        />
      </div>
    </div>
  );
}

function SegmentedControl({ label, options, value, onChange, note }) {
  return (
    <div>
      <Label className="text-xs font-medium mb-1.5 block">{label}</Label>
      <div className="flex rounded-md border border-border overflow-hidden w-fit">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium transition-colors',
              value === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:bg-muted'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
    </div>
  );
}

function SectionHeading({ number, title }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0">
        {number}
      </div>
      <h3 className="font-semibold text-sm text-foreground">{title}</h3>
    </div>
  );
}

export default function BrandingTab({ tenant, form, setForm, onSave, saving }) {
  const [uploading, setUploading] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm(f => ({ ...f, branding_logo_url: file_url }));
    setUploading(false);
  }

  async function handleFaviconUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFavicon(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm(f => ({ ...f, branding_favicon_url: file_url }));
    setUploadingFavicon(false);
  }

  const primaryColor = form.branding_primary_color || '#1A6BFF';
  const secondaryColor = form.branding_secondary_color || '#E8F0FF';
  const bgColor = form.branding_bg_color || '#F4F6FA';
  const textColor = form.branding_text_color || '#1A2332';
  const fontFamily = form.branding_font_family || 'Inter';
  const buttonRadius = form.branding_button_radius || 'rounded';
  const headerStyle = form.branding_header_style || 'dark';
  const subdomain = form.portal_subdomain || '';

  const btnRadiusClass = {
    square: 'rounded-none',
    rounded: 'rounded-md',
    pill: 'rounded-full',
  }[buttonRadius] || 'rounded-md';

  const sidebarBg = headerStyle === 'dark' ? primaryColor : '#FFFFFF';
  const sidebarText = headerStyle === 'dark' ? '#FFFFFF' : textColor;

  return (
    <div className="space-y-6">

      {/* SECTION 1 — Visual Identity */}
      <div className="bg-card border border-border rounded-xl p-5">
        <SectionHeading number="1" title="Visual Identity" />
        <div className="grid grid-cols-2 gap-5">
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Institution Name</Label>
            <Input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Default Language</Label>
            <Select value={form.default_language} onValueChange={v => setForm(f => ({ ...f, default_language: v }))}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English (EN)</SelectItem>
                <SelectItem value="nl">Dutch (NL)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ColorField label="Primary Colour" fieldKey="branding_primary_color" form={form} setForm={setForm} />
          <ColorField label="Secondary Colour" fieldKey="branding_secondary_color" form={form} setForm={setForm} />
          <ColorField label="Portal Background Colour" fieldKey="branding_bg_color" form={form} setForm={setForm} />
          <ColorField label="Body Text Colour" fieldKey="branding_text_color" form={form} setForm={setForm} />

          {/* Logo */}
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Logo (PNG / SVG)</Label>
            <div className="flex items-center gap-2">
              {form.branding_logo_url && (
                <img src={form.branding_logo_url} alt="Logo" className="h-9 w-9 object-contain rounded border border-border bg-muted" />
              )}
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium px-3 py-2 border border-border rounded-md hover:bg-muted/50 transition-colors">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {form.branding_logo_url ? 'Replace Logo' : 'Upload Logo'}
                <input type="file" accept="image/png,image/svg+xml" className="hidden" onChange={handleLogoUpload} />
              </label>
            </div>
          </div>

          {/* Favicon */}
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Favicon (.ico / .png)</Label>
            <div className="flex items-center gap-2">
              {form.branding_favicon_url && (
                <img src={form.branding_favicon_url} alt="Favicon" className="h-8 w-8 object-contain rounded border border-border bg-muted" />
              )}
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium px-3 py-2 border border-border rounded-md hover:bg-muted/50 transition-colors">
                {uploadingFavicon ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {form.branding_favicon_url ? 'Replace Favicon' : 'Upload Favicon'}
                <input type="file" accept=".ico,image/png" className="hidden" onChange={handleFaviconUpload} />
              </label>
              <span className="text-xs text-muted-foreground">32×32 or 64×64 recommended</span>
            </div>
          </div>

          {/* Font Family */}
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Font Family</Label>
            <Select value={fontFamily} onValueChange={v => setForm(f => ({ ...f, branding_font_family: v }))}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <SegmentedControl
            label="Button Style"
            options={[
              { value: 'square', label: 'Square' },
              { value: 'rounded', label: 'Rounded' },
              { value: 'pill', label: 'Pill' },
            ]}
            value={buttonRadius}
            onChange={v => setForm(f => ({ ...f, branding_button_radius: v }))}
          />

          <SegmentedControl
            label="Portal Header Style"
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
            value={headerStyle}
            onChange={v => setForm(f => ({ ...f, branding_header_style: v }))}
          />
        </div>
      </div>

      {/* SECTION 2 — White-Label Settings */}
      <div className="bg-card border border-border rounded-xl p-5">
        <SectionHeading number="2" title="White-Label Settings" />
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">White-Label Mode</div>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-md">
                When enabled, the Vitauri KYC platform name will not appear anywhere in the client-facing portal or emails.
              </p>
            </div>
            <Switch
              checked={!!form.white_label_enabled}
              onCheckedChange={v => setForm(f => ({ ...f, white_label_enabled: v }))}
            />
          </div>

          <div>
            <Label className="text-xs font-medium mb-1.5 block">Custom Portal Subdomain</Label>
            <Input
              value={subdomain}
              onChange={e => setForm(f => ({ ...f, portal_subdomain: e.target.value.toLowerCase().replace(/\s+/g, '-') }))}
              className="h-9 text-sm font-mono"
              placeholder="your-institution"
            />
            <div className="flex items-center gap-1.5 mt-1.5">
              <Globe className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Portal URL:{' '}
                <span className="font-mono text-primary">
                  {subdomain ? `${subdomain}.vitaurikyc.com` : 'your-name.vitaurikyc.com'}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3 — Email Settings */}
      <div className="bg-card border border-border rounded-xl p-5">
        <SectionHeading number="3" title="Email Settings" />
        <div className="grid grid-cols-2 gap-5">
          <div>
            <Label className="text-xs font-medium mb-1.5 block">FROM Name</Label>
            <Input
              value={form.email_from_name || ''}
              onChange={e => setForm(f => ({ ...f, email_from_name: e.target.value }))}
              className="h-9 text-sm"
              placeholder="Compliance Team — Meridian Trust"
            />
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">FROM Email Address</Label>
            <Input
              value={form.email_from_address || ''}
              onChange={e => setForm(f => ({ ...f, email_from_address: e.target.value }))}
              className="h-9 text-sm font-mono"
              placeholder="compliance@meridiantrust.nl"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Requires DNS configuration. Contact Vitauri support for setup.
            </p>
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Reply-To Address <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              value={form.email_reply_to || ''}
              onChange={e => setForm(f => ({ ...f, email_reply_to: e.target.value }))}
              className="h-9 text-sm font-mono"
              placeholder="noreply@meridiantrust.nl"
            />
          </div>
        </div>
      </div>

      {/* SECTION 4 — Portal Content */}
      <div className="bg-card border border-border rounded-xl p-5">
        <SectionHeading number="4" title="Portal Content" />
        <div className="space-y-4">
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Portal Welcome Title</Label>
            <Input
              value={form.portal_welcome_title || ''}
              onChange={e => setForm(f => ({ ...f, portal_welcome_title: e.target.value }))}
              className="h-9 text-sm"
              placeholder={`Welcome to ${form.name || "your institution"}'s Secure Portal`}
            />
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Portal Welcome Body</Label>
            <Textarea
              value={form.portal_welcome_body || ''}
              onChange={e => setForm(f => ({ ...f, portal_welcome_body: e.target.value }))}
              className="text-sm resize-none"
              rows={3}
              placeholder="Introductory message shown on the portal home screen…"
            />
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Portal Footer Text</Label>
            <Textarea
              value={form.portal_footer_text || ''}
              onChange={e => setForm(f => ({ ...f, portal_footer_text: e.target.value }))}
              className="text-sm resize-none"
              rows={2}
              placeholder="© 2025 Meridian Trust NV. All rights reserved."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Shown at the bottom of every portal page. Include contact info and legal disclaimers.
            </p>
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Contact Information</Label>
            <Input
              value={form.portal_contact_info || ''}
              onChange={e => setForm(f => ({ ...f, portal_contact_info: e.target.value }))}
              className="h-9 text-sm"
              placeholder="compliance@meridiantrust.nl · +5999 xxx xxxx"
            />
          </div>
        </div>
      </div>

      {/* LIVE PREVIEW */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="text-xs font-semibold text-muted-foreground px-4 py-2 border-b border-border bg-muted/30 uppercase tracking-wide">
          Live Preview
        </div>
        <div className="p-5 space-y-4" style={{ fontFamily }}>

          {/* App sidebar + main area preview */}
          <div className="flex gap-0 items-stretch h-28 rounded-lg overflow-hidden border border-border text-xs">
            {/* Sidebar */}
            <div className="w-28 flex flex-col gap-1.5 p-2.5 flex-shrink-0" style={{ backgroundColor: sidebarBg }}>
              <div className="flex items-center gap-1.5 mb-1">
                {form.branding_logo_url
                  ? <img src={form.branding_logo_url} alt="" className="w-4 h-4 object-contain rounded" />
                  : <Shield className="w-3.5 h-3.5" style={{ color: sidebarText }} />}
                <span className="font-semibold truncate" style={{ color: sidebarText, fontSize: '10px' }}>
                  {form.name || 'Your Bank'}
                </span>
              </div>
              {['Dashboard', 'Cases', 'Clients'].map(l => (
                <div key={l} style={{ color: sidebarText, opacity: 0.65, fontSize: '10px' }}>{l}</div>
              ))}
            </div>
            {/* Main area */}
            <div className="flex-1 flex flex-col gap-2 p-3" style={{ backgroundColor: bgColor, color: textColor }}>
              <div className="h-1.5 w-28 rounded-full" style={{ backgroundColor: primaryColor, opacity: 0.3 }} />
              <div className="h-1.5 w-20 rounded-full" style={{ backgroundColor: secondaryColor }} />
              <div className="flex-1 rounded p-2 mt-1" style={{ backgroundColor: secondaryColor }}>
                <div className="h-1.5 w-16 rounded-full" style={{ backgroundColor: primaryColor, opacity: 0.4 }} />
              </div>
              <div className="flex gap-1.5 mt-auto">
                <div
                  className={`px-2 py-0.5 text-white font-medium ${btnRadiusClass}`}
                  style={{ backgroundColor: primaryColor, fontSize: '10px' }}
                >
                  Approve
                </div>
                <div
                  className={`px-2 py-0.5 border font-medium ${btnRadiusClass}`}
                  style={{ borderColor: primaryColor, color: primaryColor, fontSize: '10px' }}
                >
                  Cancel
                </div>
              </div>
            </div>
          </div>

          {/* Client portal preview */}
          <div className="border border-border rounded-lg overflow-hidden" style={{ backgroundColor: bgColor, fontFamily }}>
            {/* Portal header */}
            <div className="px-4 py-2 flex items-center gap-2" style={{ backgroundColor: sidebarBg }}>
              {form.branding_logo_url
                ? <img src={form.branding_logo_url} alt="" className="h-5 object-contain" />
                : <Shield className="w-4 h-4" style={{ color: sidebarText }} />}
              <span className="text-xs font-semibold" style={{ color: sidebarText }}>
                {form.name || 'Your Institution'}
              </span>
            </div>
            {/* Portal body */}
            <div className="p-3" style={{ color: textColor }}>
              <div className="text-xs font-semibold mb-0.5">
                {form.portal_welcome_title || `Welcome to ${form.name || 'Your Institution'}'s Secure Portal`}
              </div>
              {form.portal_welcome_body && (
                <div className="text-xs opacity-70 mb-2 line-clamp-2">{form.portal_welcome_body}</div>
              )}
              <div className="h-1 w-full rounded-full bg-muted my-2">
                <div className="h-full w-1/3 rounded-full" style={{ backgroundColor: primaryColor }} />
              </div>
              {form.portal_contact_info && (
                <div className="text-xs opacity-50 mt-1">{form.portal_contact_info}</div>
              )}
            </div>
            {/* Portal footer */}
            <div className="px-3 py-1.5 border-t" style={{ borderColor: secondaryColor, backgroundColor: secondaryColor }}>
              <div className="text-xs opacity-60 truncate" style={{ color: textColor }}>
                {form.portal_footer_text || '© Your Institution. All rights reserved.'}
              </div>
            </div>
          </div>

        </div>
      </div>

      <Button onClick={onSave} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Save Branding
      </Button>
    </div>
  );
}