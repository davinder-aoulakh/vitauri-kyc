import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Loader2, Upload, Shield } from 'lucide-react';

export default function BrandingTab({ tenant, form, setForm, onSave, saving }) {
  const [uploading, setUploading] = useState(false);

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm(f => ({ ...f, branding_logo_url: file_url }));
    setUploading(false);
  }

  const color = form.branding_primary_color || '#1A6BFF';

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-5 space-y-5">
        <h3 className="font-semibold text-sm">Institution Branding</h3>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Institution Name</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Primary Colour</Label>
            <div className="flex items-center gap-2">
              <Input type="color" value={color} onChange={e => setForm(f => ({ ...f, branding_primary_color: e.target.value }))} className="h-9 w-16 p-1 cursor-pointer" />
              <Input value={color} onChange={e => setForm(f => ({ ...f, branding_primary_color: e.target.value }))} className="h-9 text-sm flex-1 font-mono" placeholder="#1A6BFF" />
            </div>
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
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Tenant Logo (PNG/SVG)</Label>
            <div className="flex items-center gap-2">
              {form.branding_logo_url && (
                <img src={form.branding_logo_url} alt="Logo" className="h-9 w-9 object-contain rounded border border-border" />
              )}
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium px-3 py-2 border border-border rounded-md hover:bg-muted/50 transition-colors">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {form.branding_logo_url ? 'Replace Logo' : 'Upload Logo'}
                <input type="file" accept="image/png,image/svg+xml" className="hidden" onChange={handleLogoUpload} />
              </label>
            </div>
          </div>
        </div>

        {/* Live Preview */}
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="text-xs font-semibold text-muted-foreground px-4 py-2 border-b border-border bg-muted/30 uppercase tracking-wide">Live Preview</div>
          <div className="p-5 space-y-4">
            {/* App sidebar preview */}
            <div className="flex gap-3 items-stretch h-24 rounded-lg overflow-hidden border border-border">
              <div className="w-32 flex flex-col gap-2 p-3" style={{ backgroundColor: color }}>
                <div className="flex items-center gap-1.5">
                  {form.branding_logo_url
                    ? <img src={form.branding_logo_url} alt="" className="w-5 h-5 object-contain rounded" />
                    : <Shield className="w-4 h-4 text-white" />}
                  <span className="text-white text-xs font-semibold truncate">{form.name || 'Your Bank'}</span>
                </div>
                {['Dashboard', 'Cases', 'Clients'].map(l => (
                  <div key={l} className="text-white/60 text-xs">{l}</div>
                ))}
              </div>
              <div className="flex-1 bg-background p-3 flex flex-col gap-2">
                <div className="h-2 w-32 rounded-full" style={{ backgroundColor: color, opacity: 0.2 }} />
                <div className="h-2 w-24 rounded-full bg-muted" />
                <div className="mt-auto flex gap-2">
                  <div className="px-3 py-1 rounded text-white text-xs" style={{ backgroundColor: color }}>Approve</div>
                  <div className="px-3 py-1 rounded text-xs border border-border">Cancel</div>
                </div>
              </div>
            </div>
            {/* Outreach client view preview */}
            <div className="border border-border rounded-lg p-4 bg-muted/10">
              <div className="flex items-center gap-2 mb-2">
                {form.branding_logo_url
                  ? <img src={form.branding_logo_url} alt="" className="h-6 object-contain" />
                  : <Shield className="w-5 h-5" style={{ color }} />}
                <span className="text-sm font-semibold" style={{ color }}>{form.name || 'Your Bank'}</span>
              </div>
              <div className="text-xs text-muted-foreground">Client document request — {form.default_language === 'nl' ? 'Geachte klant,' : 'Dear Client,'}</div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                <div className="h-full w-1/3 rounded-full" style={{ backgroundColor: color }} />
              </div>
            </div>
          </div>
        </div>

        <Button onClick={onSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Branding
        </Button>
      </div>
    </div>
  );
}