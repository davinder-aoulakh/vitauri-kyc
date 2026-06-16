import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Search, X, Plus, ChevronRight, Send, Loader2, Sparkles,
  FileText, CheckCircle, Copy, ExternalLink, Mail, User, Building2, Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, addDays } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';


function generateToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

const STEPS = ['Select Recipients', 'Build Request', 'Review & Send'];

export default function StandaloneOutreach() {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState(0);

  // Step 1
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [recipients, setRecipients] = useState([]); // selected client objects
  const [quickCreate, setQuickCreate] = useState(false);
  const [quickForm, setQuickForm] = useState({ full_name: '', primary_contact_email: '', client_type: 'NP' });
  const [creatingClient, setCreatingClient] = useState(false);

  // Step 2
  const [formTemplates, setFormTemplates] = useState([]);
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [libraryItems, setLibraryItems] = useState([]);
  const [selectedFormTemplate, setSelectedFormTemplate] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [message, setMessage] = useState('');
  const [deadline, setDeadline] = useState(format(addDays(new Date(), 14), 'yyyy-MM-dd'));
  const [channel, setChannel] = useState('Email');
  const [selectedItems, setSelectedItems] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);

  // Step 3
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState(null); // { sent, failed: [{name, reason}] }
  const [createdRequests, setCreatedRequests] = useState([]);

  useEffect(() => {
    if (tenant?.id) {
      Promise.all([
        base44.entities.OutreachFormTemplate.filter({ tenant_id: tenant.id, is_active: true }),
        base44.entities.EmailTemplate.filter({ tenant_id: tenant.id, is_active: true }),
        base44.entities.OutreachTemplate.filter({ tenant_id: tenant.id, is_active: true }, 'sort_order'),
      ]).then(([forms, emails, library]) => {
        setFormTemplates(forms || []);
        setEmailTemplates(emails || []);
        setLibraryItems(library || []);
      });
    }
  }, [tenant]);

  // Search clients
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      const all = await base44.entities.Client.filter({ tenant_id: tenant?.id });
      const q = searchQuery.toLowerCase();
      setSearchResults((all || []).filter(c =>
        c.full_name?.toLowerCase().includes(q) ||
        c.primary_contact_email?.toLowerCase().includes(q)
      ).slice(0, 8));
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, tenant]);

  function addRecipient(client) {
    if (!recipients.find(r => r.id === client.id)) {
      setRecipients(prev => [...prev, client]);
    }
    setSearchQuery('');
    setSearchResults([]);
  }

  function removeRecipient(id) {
    setRecipients(prev => prev.filter(r => r.id !== id));
  }

  async function createQuickClient() {
    if (!quickForm.full_name.trim()) return;
    setCreatingClient(true);
    const created = await base44.entities.Client.create({
      tenant_id: tenant.id,
      full_name: quickForm.full_name,
      primary_contact_email: quickForm.primary_contact_email,
      client_type: quickForm.client_type,
      status: 'Prospect',
    });
    addRecipient(created);
    setQuickCreate(false);
    setQuickForm({ full_name: '', primary_contact_email: '', client_type: 'NP' });
    setCreatingClient(false);
    toast({ description: `Contact "${created.full_name}" created and added.` });
  }

  function applyFormTemplate(templateId) {
    const tmpl = formTemplates.find(t => t.id === templateId);
    if (!tmpl) return;
    setSelectedFormTemplate(templateId);
    if (tmpl.default_deadline_days) {
      setDeadline(format(addDays(new Date(), tmpl.default_deadline_days), 'yyyy-MM-dd'));
    }
    if (tmpl.default_channel) setChannel(tmpl.default_channel);
    // Pre-fill subject from associated email template
    if (tmpl.email_template_id) {
      const emailTmpl = emailTemplates.find(e => e.id === tmpl.email_template_id);
      if (emailTmpl) setEmailSubject(emailTmpl.subject || '');
    }
  }

  const catalogueItems = libraryItems.filter(item =>
    !item.client_types?.length ||
    recipients.length === 0 ||
    recipients.some(r => item.client_types.includes(r.client_type || 'NP'))
  );

  function toggleItem(id) {
    setSelectedItems(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  }

  async function runAiSuggest() {
    setAiLoading(true);
    setAiSuggestions(null);
    const types = [...new Set(recipients.map(r => r.client_type || 'NP'))];
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a KYC compliance analyst. Based on the recipient types below, suggest which documents and data points should be requested.

Recipient types: ${types.join(', ')}
Number of recipients: ${recipients.length}
Channel: ${channel}

Available items to request (pick by ID): ${catalogueItems.map(i => `${i.id}: ${i.label}`).join(', ')}

Return the item IDs you recommend requesting, with a short reason for each, and a brief covering message draft.`,
      response_json_schema: {
        type: 'object',
        properties: {
          recommended_item_ids: { type: 'array', items: { type: 'string' } },
          reasons: { type: 'object' },
          message_draft: { type: 'string' },
        },
      },
    });
    setAiSuggestions(result);
    if (result?.recommended_item_ids?.length > 0) {
      setSelectedItems(result.recommended_item_ids.filter(id => catalogueItems.find(c => c.id === id)));
    }
    if (result?.message_draft) setMessage(result.message_draft);
    setAiLoading(false);
  }

  function buildEmailHtml(client, req, portalUrl) {
    const primaryColor = tenant?.branding_primary_color || '#1A6BFF';
    const buttonRadius = { square: '0px', rounded: '8px', pill: '9999px' }[tenant?.branding_button_radius] || '8px';
    const fontFamily = tenant?.branding_font_family || 'Inter, sans-serif';
    const itemListHtml = (req.items || []).map(i => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#374151;">
          ${i.label}
        </td>
      </tr>`).join('');

    return `
      <div style="font-family:${fontFamily};max-width:620px;margin:0 auto;background:#ffffff;">
        <div style="background:${primaryColor};padding:24px 32px;">
          ${tenant?.branding_logo_url
            ? `<img src="${tenant.branding_logo_url}" style="height:36px;object-fit:contain;" alt="${tenant?.name || ''}" />`
            : `<span style="color:white;font-size:20px;font-weight:700;">${tenant?.name || ''}</span>`}
        </div>
        <div style="padding:32px;">
          <p style="font-size:15px;color:#111827;margin-bottom:8px;">${message || `Dear ${client?.full_name || 'Client'},`}</p>
          <p style="font-size:14px;color:#374151;margin-bottom:24px;">
            We kindly request the following information by <strong>${deadline ? format(new Date(deadline), 'd MMMM yyyy') : '—'}</strong>:
          </p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">${itemListHtml}</table>
          <div style="text-align:center;margin:32px 0;">
            <a href="${portalUrl}" style="background:${primaryColor};color:#ffffff;padding:14px 32px;border-radius:${buttonRadius};text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
              Submit Documents →
            </a>
          </div>
          <p style="font-size:12px;color:#9CA3AF;">This is a secure, personalised link. Please do not share it with others.</p>
        </div>
        ${!tenant?.white_label_enabled
          ? `<div style="padding:12px 32px;background:#f3f4f6;font-size:11px;color:#9CA3AF;text-align:center;">Powered by Vitauri KYC</div>`
          : ''}
      </div>
    `;
  }

  async function sendAll() {
    setSending(true);
    const items = selectedItems.map(id => {
      const item = libraryItems.find(d => d.id === id);
      return { item_id: id, item_type: item?.field_type || item?.item_type || 'document', label: item?.label || id, status: 'Requested' };
    });

    const results = { sent: 0, failed: [] };
    const created = [];

    for (const client of recipients) {
      try {
        const token = generateToken();
        const tokenExpiry = new Date(deadline);
        tokenExpiry.setDate(tokenExpiry.getDate() + 1);

        const req = await base44.entities.OutreachRequest.create({
          tenant_id: tenant.id,
          case_id: null,
          client_id: client.id,
          message,
          deadline,
          delivery_channel: channel,
          status: 'Draft',
          access_token: token,
          token_expires_at: tokenExpiry.toISOString(),
          items,
        });

        created.push({ req, client });

        if (channel === 'Email' && client.primary_contact_email) {
          const portalUrl = `${window.location.origin}/portal/${token}`;
          const body = buildEmailHtml(client, req, portalUrl);
          const fromName = tenant?.email_from_name || tenant?.name || 'Compliance Team';
          try {
            await base44.integrations.Core.SendEmail({
              from_name: fromName,
              ...(tenant?.email_from_address ? { from_email: tenant.email_from_address } : {}),
              to: client.primary_contact_email,
              subject: emailSubject || `Action Required: Documents needed — ${tenant?.name || 'KYC Review'}`,
              body,
            });
            await base44.entities.OutreachRequest.update(req.id, { status: 'Sent' });
          } catch (emailErr) {
            console.warn('Email send failed:', emailErr);
            await base44.entities.OutreachRequest.update(req.id, { status: 'Sent' });
          }
        }

        results.sent++;
      } catch (err) {
        results.failed.push({ name: client.full_name, reason: err.message || 'Unknown error' });
      }
    }

    setCreatedRequests(created);
    setSendResults(results);
    setSending(false);
  }

  function copyAllLinks() {
    const links = createdRequests.map(({ req, client }) =>
      `${client.full_name}: ${window.location.origin}/portal/${req.access_token}`
    ).join('\n');
    navigator.clipboard.writeText(links);
    toast({ description: 'All portal links copied to clipboard.' });
  }

  const canProceedStep1 = recipients.length > 0;
  const canProceedStep2 = selectedItems.length > 0;

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-bold text-foreground">New Standalone Outreach</h1>
          <p className="text-sm text-muted-foreground mt-1">Send document requests directly to clients — no KYC case required.</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <React.Fragment key={i}>
              <div className="flex items-center gap-2">
                <div className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                  i < step ? 'bg-primary text-white' : i === step ? 'bg-primary text-white ring-4 ring-primary/20' : 'bg-muted text-muted-foreground'
                )}>
                  {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <span className={cn('text-sm', i === step ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{s}</span>
              </div>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border" />}
            </React.Fragment>
          ))}
        </div>

        {/* ── STEP 1: SELECT RECIPIENTS ── */}
        {step === 0 && (
          <div className="space-y-5">
            {/* Selected recipients chips */}
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {recipients.map(r => (
                  <div key={r.id} className="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 rounded-full px-3 py-1 text-xs font-medium">
                    {r.client_type === 'ORG' ? <Building2 className="w-3 h-3" /> : <User className="w-3 h-3" />}
                    {r.full_name}
                    <button onClick={() => removeRecipient(r.id)} className="hover:text-destructive transition-colors ml-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search clients by name or email…"
                className="pl-9 h-10"
              />
              {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
            </div>

            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
                {searchResults.map(client => {
                  const already = !!recipients.find(r => r.id === client.id);
                  return (
                    <button
                      key={client.id}
                      onClick={() => !already && addRecipient(client)}
                      disabled={already}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                        already ? 'bg-muted/40 opacity-60 cursor-default' : 'hover:bg-muted/30'
                      )}
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        {client.client_type === 'ORG' ? <Building2 className="w-3.5 h-3.5 text-primary" /> : <User className="w-3.5 h-3.5 text-primary" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{client.full_name}</div>
                        <div className="text-xs text-muted-foreground">{client.primary_contact_email || 'No email'} · {client.client_type}</div>
                      </div>
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded-full border',
                        client.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : client.status === 'Prospect' ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-muted text-muted-foreground border-border'
                      )}>{client.status}</span>
                      {already && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}

            {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
              <div className="text-center py-6 text-sm text-muted-foreground">
                No clients found for "{searchQuery}"
              </div>
            )}

            {/* Quick create */}
            <div>
              <button
                onClick={() => setQuickCreate(o => !o)}
                className="flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <Plus className="w-3.5 h-3.5" /> Quick-create a new contact
              </button>
              {quickCreate && (
                <div className="mt-3 border border-border rounded-xl p-4 space-y-3 bg-muted/20">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Contact</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block">Full Name *</Label>
                      <Input value={quickForm.full_name} onChange={e => setQuickForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jane Smith" className="h-9 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Email</Label>
                      <Input value={quickForm.primary_contact_email} onChange={e => setQuickForm(f => ({ ...f, primary_contact_email: e.target.value }))} placeholder="jane@example.com" className="h-9 text-sm" type="email" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Client Type</Label>
                    <Select value={quickForm.client_type} onValueChange={v => setQuickForm(f => ({ ...f, client_type: v }))}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NP">Natural Person (NP)</SelectItem>
                        <SelectItem value="ORG">Organisation (ORG)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setQuickCreate(false)}>Cancel</Button>
                    <Button size="sm" onClick={createQuickClient} disabled={!quickForm.full_name.trim() || creatingClient} className="gap-1.5">
                      {creatingClient ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Create & Add
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-border">
              <Button onClick={() => setStep(1)} disabled={!canProceedStep1} className="gap-2">
                Next: Configure Request <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 2: BUILD REQUEST ── */}
        {step === 1 && (
          <div className="space-y-5">
            {/* Use a form template */}
            {formTemplates.length > 0 && (
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Use a Template (optional)</Label>
                <Select value={selectedFormTemplate} onValueChange={applyFormTemplate}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select template to pre-fill…" /></SelectTrigger>
                  <SelectContent>
                    {formTemplates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Email subject */}
            {channel === 'Email' && (
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Email Subject</Label>
                <Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Action Required: Documents needed for your KYC review" className="h-9 text-sm" />
              </div>
            )}

            {/* Covering message */}
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Covering Message</Label>
              <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Dear Client, as part of our review process…" className="text-sm min-h-20" />
            </div>

            {/* Deadline + channel */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Response Deadline</Label>
                <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Channel</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Email">Email</SelectItem>
                    <SelectItem value="Portal">Client Portal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* AI Suggest */}
            <div className="bg-purple-50/60 border border-purple-100 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  <span className="text-sm font-semibold text-purple-800">Outreach Co-Pilot</span>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-purple-200 text-purple-700 hover:bg-purple-100" onClick={runAiSuggest} disabled={aiLoading}>
                  {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {aiLoading ? 'Analysing…' : 'AI Suggest Items'}
                </Button>
              </div>
              {aiSuggestions && (
                <div className="mt-2 space-y-1">
                  {aiSuggestions.recommended_item_ids?.map(id => {
                    const item = libraryItems.find(c => c.id === id);
                    return item ? (
                      <div key={id} className="flex items-start gap-1.5 text-xs text-purple-700">
                        <CheckCircle className="w-3 h-3 text-purple-500 mt-0.5 flex-shrink-0" />
                        <span><strong>{item.label}</strong>{aiSuggestions.reasons?.[id] ? ` — ${aiSuggestions.reasons[id]}` : ''}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              )}
            </div>

            {/* Items checklist */}
            <div>
              <Label className="text-xs font-medium mb-2 block">Items to Request *</Label>
              {libraryItems.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">
                  {tenant?.id ? (
                    <>No items in your library yet. <a href="/tenant-config" className="text-primary underline">Add items in Tenant Config → Outreach Templates</a></>
                  ) : 'Loading…'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-1">
                  {catalogueItems.map(item => {
                    const isAiSuggested = aiSuggestions?.recommended_item_ids?.includes(item.id);
                    const fieldTypeLabel = item.field_type === 'file_upload' || item.item_type === 'document' ? 'Document' : 'Data point';
                    return (
                      <label key={item.id} className={cn(
                        'flex items-start gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors',
                        selectedItems.includes(item.id) ? 'border-primary bg-primary/5' : isAiSuggested ? 'border-purple-300 bg-purple-50/40' : 'border-border hover:bg-muted/30'
                      )}>
                        <input type="checkbox" checked={selectedItems.includes(item.id)} onChange={() => toggleItem(item.id)} className="rounded border-border mt-0.5" />
                        <div>
                          <div className={cn('text-sm leading-tight', selectedItems.includes(item.id) ? 'font-medium' : '')}>{item.label}</div>
                          <div className="text-xs text-muted-foreground">{fieldTypeLabel}</div>
                        </div>
                        {isAiSuggested && <Sparkles className="w-3 h-3 text-purple-500 ml-auto mt-0.5 flex-shrink-0" />}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-between pt-4 border-t border-border">
              <Button variant="outline" onClick={() => setStep(0)}>← Back</Button>
              <Button onClick={() => setStep(2)} disabled={!canProceedStep2} className="gap-2">
                Next: Review & Send <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: REVIEW & SEND ── */}
        {step === 2 && (
          <div className="space-y-5">
            {!sendResults ? (
              <>
                {/* Summary card */}
                <div className="bg-muted/30 border border-border rounded-xl p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Send className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="text-lg font-bold">{recipients.length} recipient{recipients.length !== 1 ? 's' : ''}</div>
                      <div className="text-sm text-muted-foreground">{selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''} requested via {channel}</div>
                    </div>
                  </div>

                  <div className="divide-y divide-border/60">
                    {recipients.map(r => (
                      <div key={r.id} className="py-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {r.client_type === 'ORG' ? <Building2 className="w-3.5 h-3.5 text-muted-foreground" /> : <User className="w-3.5 h-3.5 text-muted-foreground" />}
                          <span className="text-sm font-medium">{r.full_name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{r.primary_contact_email || 'No email'}</span>
                      </div>
                    ))}
                  </div>

                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1.5">Items requested:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedItems.map(id => {
                        const item = libraryItems.find(i => i.id === id);
                        return <span key={id} className="text-xs bg-muted border border-border px-2 py-0.5 rounded-full">{item?.label || id}</span>;
                      })}
                    </div>
                  </div>

                  {deadline && (
                    <div className="text-xs text-muted-foreground">
                      Deadline: <strong className="text-foreground">{format(new Date(deadline), 'd MMMM yyyy')}</strong>
                    </div>
                  )}
                </div>

                <div className="flex justify-between pt-4 border-t border-border">
                  <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
                  <Button onClick={sendAll} disabled={sending} className="gap-2">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {sending ? 'Sending…' : `Send to ${recipients.length} Client${recipients.length !== 1 ? 's' : ''}`}
                  </Button>
                </div>
              </>
            ) : (
              /* Results */
              <div className="space-y-5">
                <div className={cn(
                  'rounded-xl p-5 border',
                  sendResults.failed.length === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
                )}>
                  <div className="flex items-center gap-3 mb-3">
                    {sendResults.failed.length === 0
                      ? <CheckCircle className="w-6 h-6 text-emerald-600" />
                      : <Mail className="w-6 h-6 text-amber-600" />}
                    <div className="text-base font-bold">
                      Sent to {sendResults.sent}/{recipients.length} clients
                    </div>
                  </div>
                  {sendResults.failed.length > 0 && (
                    <div className="text-sm text-amber-700">
                      {sendResults.failed.map(f => <div key={f.name}>{f.name}: {f.reason}</div>)}
                    </div>
                  )}
                </div>

                {/* Portal links */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Portal Links</div>
                  {createdRequests.map(({ req, client }) => (
                    <div key={req.id} className="flex items-center gap-3 border border-border rounded-lg px-3 py-2.5">
                      <span className="text-sm font-medium flex-1 truncate">{client.full_name}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/portal/${req.access_token}`); toast({ description: 'Link copied.' }); }}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" /> Copy
                        </button>
                        <a href={`${window.location.origin}/portal/${req.access_token}`} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> Open
                        </a>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3 pt-4 border-t border-border">
                  <Button variant="outline" className="gap-1.5" onClick={copyAllLinks}>
                    <Copy className="w-4 h-4" /> Copy All Links
                  </Button>
                  <Button onClick={() => navigate('/outreach-dashboard')} className="gap-1.5">
                    <Mail className="w-4 h-4" /> Go to Outreach Dashboard
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}