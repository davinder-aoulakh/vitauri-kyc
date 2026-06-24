import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Loader2, Mail, CheckCircle } from 'lucide-react';

export default function NewTenantDialog({ open, onClose, onCreated }) {
  const [step, setStep] = useState('form'); // 'form' | 'success'
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    slug: '',
    status: 'Active',
    default_language: 'en',
    branding_primary_color: '#1A6BFF',
    admin_email: '',
  });

  function updateForm(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      // Auto-generate slug from name if slug not manually edited
      if (field === 'name') {
        next.slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      }
      return next;
    });
  }

  async function handleSubmit() {
    setError('');
    if (!form.name.trim()) { setError('Institution name is required.'); return; }
    if (!form.slug.trim()) { setError('Slug is required.'); return; }
    if (!form.admin_email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.admin_email)) {
      setError('A valid admin email is required.'); return;
    }

    setSaving(true);
    try {
      // 1. Create the Tenant record
      await base44.entities.Tenant.create({
        name: form.name.trim(),
        slug: form.slug.trim(),
        status: form.status,
        default_language: form.default_language,
        branding_primary_color: form.branding_primary_color,
        pending_admin_email: form.admin_email.trim().toLowerCase(),
      });

      // 2. Invite the admin user (platform-level invite, role=admin)
      await base44.users.inviteUser(form.admin_email.trim(), 'admin');

      setStep('success');
    } catch (e) {
      setError(e.message || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (step === 'success') onCreated?.();
    setStep('form');
    setForm({ name: '', slug: '', status: 'Active', default_language: 'en', branding_primary_color: '#1A6BFF', admin_email: '' });
    setError('');
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Onboard New Tenant
          </DialogTitle>
        </DialogHeader>

        {step === 'success' ? (
          <div className="py-6 text-center space-y-3">
            <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto" />
            <div className="font-semibold text-base">{form.name} created</div>
            <p className="text-sm text-muted-foreground">
              An invitation has been sent to <strong>{form.admin_email}</strong>.<br />
              When they accept and sign in, they will be automatically linked to this tenant as <strong>Tenant Admin</strong>.
            </p>
            <Button className="w-full mt-2" onClick={handleClose}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Institution Details */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Institution Details</div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Institution Name *</Label>
                <Input value={form.name} onChange={e => updateForm('name', e.target.value)}
                  placeholder="e.g. Meridian Trust NV" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">URL Slug *</Label>
                <Input value={form.slug} onChange={e => updateForm('slug', e.target.value)}
                  placeholder="e.g. meridian-trust" className="h-9 text-sm font-mono" />
                <p className="text-xs text-muted-foreground mt-1">Lowercase, hyphens only. Auto-generated from name.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Status</Label>
                  <Select value={form.status} onValueChange={v => updateForm('status', v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Demo">Demo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Default Language</Label>
                  <Select value={form.default_language} onValueChange={v => updateForm('default_language', v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="nl">Dutch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Brand Colour</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.branding_primary_color}
                    onChange={e => updateForm('branding_primary_color', e.target.value)}
                    className="h-9 w-12 rounded border border-input cursor-pointer p-0.5" />
                  <Input value={form.branding_primary_color}
                    onChange={e => updateForm('branding_primary_color', e.target.value)}
                    className="h-9 text-sm font-mono flex-1" />
                </div>
              </div>
            </div>

            {/* Admin Invite */}
            <div className="space-y-3 pt-1">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant Admin Invite</div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Admin Email Address *</Label>
                <Input type="email" value={form.admin_email}
                  onChange={e => updateForm('admin_email', e.target.value)}
                  placeholder="admin@meridiantrust.nl" className="h-9 text-sm" />
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                <strong>How it works:</strong> The admin will receive an invite email. When they accept and sign in for the first time, they are automatically linked to this tenant and granted the <strong>Tenant Admin</strong> application role.
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{error}</div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                Create & Send Invite
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}