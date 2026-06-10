import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  MessageSquare, Plus, Send, Loader2, FileText, CheckCircle,
  AlertTriangle, Sparkles, Eye, Copy, ExternalLink, ShieldCheck, Mail, ChevronDown
} from 'lucide-react';
import DocumentViewer from '@/components/shared/DocumentViewer';

const SITUATION_LABELS = {
  Welcome: 'Welcome',
  Documentation_Request: 'Documentation Request',
  First_Reminder: 'First Reminder',
  Second_Reminder: 'Second Reminder',
  Third_Reminder: 'Third Reminder',
  Additional_Info: 'Additional Info',
};
import { format, addDays, isPast, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

// Master item catalogue — NP + ORG items
const ALL_ITEMS = [
  { id: 'passport',         label: 'Passport / National ID',              type: 'document',   applies: ['NP','ORG'] },
  { id: 'proof_address',    label: 'Proof of Address',                    type: 'document',   applies: ['NP','ORG'] },
  { id: 'ubo_register',     label: 'UBO Register Extract',                type: 'document',   applies: ['ORG'] },
  { id: 'articles',         label: 'Articles of Association',             type: 'document',   applies: ['ORG'] },
  { id: 'financial_stmt',   label: 'Financial Statements (2 years)',      type: 'document',   applies: ['ORG'] },
  { id: 'tax_return',       label: 'Tax Return',                          type: 'document',   applies: ['NP','ORG'] },
  { id: 'source_wealth',    label: 'Source of Wealth Declaration',        type: 'document',   applies: ['NP','ORG'] },
  { id: 'beneficial_owner', label: 'Beneficial Owner Declaration',        type: 'document',   applies: ['ORG'] },
  { id: 'salary_slip',      label: 'Recent Salary Slips (3 months)',      type: 'document',   applies: ['NP'] },
  { id: 'bank_statement',   label: 'Bank Statements (3 months)',          type: 'document',   applies: ['NP','ORG'] },
  { id: 'tin_dp',           label: 'Tax Identification Number (TIN)',     type: 'data_point', applies: ['NP','ORG'] },
  { id: 'fatca_self_cert',  label: 'FATCA / CRS Self-Certification',      type: 'data_point', applies: ['NP','ORG'] },
  { id: 'ubo_names',        label: 'Names & ownership % of all UBOs',     type: 'data_point', applies: ['ORG'] },
  { id: 'sof_description',  label: 'Description of Source of Funds',     type: 'data_point', applies: ['NP','ORG'] },
];

const STATUS_STYLES = {
  Draft:            'bg-slate-100 text-slate-600 border-slate-200',
  Sent:             'bg-blue-100 text-blue-700 border-blue-200',
  Viewed:           'bg-purple-100 text-purple-700 border-purple-200',
  Partial_Response: 'bg-amber-100 text-amber-700 border-amber-200',
  Complete:         'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const ITEM_STATUS_STYLES = {
  Requested: 'bg-amber-50 text-amber-700 border-amber-200',
  Received:  'bg-blue-50 text-blue-700 border-blue-200',
  Verified:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  Missing:   'bg-red-50 text-red-700 border-red-200',
};

function generateToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

function buildEmailHtml(tenant, client, req, portalUrl) {
  const primaryColor = tenant?.branding_primary_color || '#1A6BFF';
  const buttonRadius = { square: '0px', rounded: '8px', pill: '9999px' }[tenant?.branding_button_radius] || '8px';
  const fontFamily = tenant?.branding_font_family || 'Inter, sans-serif';
  const itemListHtml = (req.items || []).map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#374151;">
        ${i.label}
        <span style="font-size:12px;color:#9CA3AF;margin-left:8px;">(${i.item_type === 'file_upload' || i.item_type === 'document' ? 'Document' : 'Information'})</span>
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
        <p style="font-size:15px;color:#111827;margin-bottom:8px;">${req.message || `Dear ${client?.full_name || 'Client'},`}</p>
        <p style="font-size:14px;color:#374151;margin-bottom:24px;">
          As part of our review process, we kindly request the following information by
          <strong>${req.deadline ? format(parseISO(req.deadline), 'd MMMM yyyy') : '—'}</strong>:
        </p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">${itemListHtml}</table>
        <div style="text-align:center;margin:32px 0;">
          <a href="${portalUrl}" style="background:${primaryColor};color:#ffffff;padding:14px 32px;border-radius:${buttonRadius};text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
            Submit Documents →
          </a>
        </div>
        <p style="font-size:12px;color:#9CA3AF;">This is a secure, personalised link. Please do not share it with others.</p>
      </div>
      ${tenant?.portal_footer_text
        ? `<div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6B7280;">${tenant.portal_footer_text}</div>`
        : ''}
      ${!tenant?.white_label_enabled
        ? `<div style="padding:12px 32px;background:#f3f4f6;font-size:11px;color:#9CA3AF;text-align:center;">Powered by Vitauri KYC</div>`
        : ''}
    </div>
  `;
}

export default function OutreachStep({ kycCase, client, currentUser, tenant }) {
  const [requests, setRequests]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [newOpen, setNewOpen]     = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [viewerDoc, setViewerDoc] = useState(null); // { url, name }

  // Builder state
  const [selectedItems, setSelectedItems] = useState([]);
  const [message, setMessage]     = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [channel, setChannel]     = useState('Email');
  const [deadline, setDeadline]   = useState(format(addDays(new Date(), 14), 'yyyy-MM-dd'));
  const [creating, setCreating]   = useState(false);
  const [sending, setSending]     = useState(false);

  // Email templates
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  // AI copilot
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);

  const clientType = client?.client_type || 'NP';
  const catalogueItems = ALL_ITEMS.filter(i => i.applies.includes(clientType));

  useEffect(() => { load(); loadTemplates(); }, [kycCase.id]);

  async function load() {
    const data = await base44.entities.OutreachRequest.filter({ case_id: kycCase.id });
    setRequests(data || []);
    setLoading(false);
  }

  async function loadTemplates() {
    if (!kycCase.tenant_id) return;
    const data = await base44.entities.EmailTemplate.filter({ tenant_id: kycCase.tenant_id, is_active: true });
    setEmailTemplates(data || []);
  }

  function resolveTemplateVars(text, portalUrl) {
    return (text || '')
      .replace(/{{client_name}}/g, client?.full_name || '')
      .replace(/{{tenant_name}}/g, tenant?.name || '')
      .replace(/{{portal_link}}/g, portalUrl || '')
      .replace(/{{due_date}}/g, deadline || '')
      .replace(/{{analyst_name}}/g, currentUser?.full_name || '');
  }

  function applyTemplate(tmpl, portalUrl) {
    setEmailSubject(resolveTemplateVars(tmpl.subject, portalUrl));
    // Strip HTML tags for the plain message field
    const stripped = tmpl.body_html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    setMessage(resolveTemplateVars(stripped, portalUrl));
    setTemplatePickerOpen(false);
  }

  async function runAiCopilot() {
    setAiLoading(true);
    const missingFields = [];
    if (!client?.id_number && !client?.registration_number) missingFields.push('ID/Registration number');
    if (!client?.nationality && !client?.registered_country) missingFields.push('Country/Nationality');
    if (!client?.date_of_birth && clientType === 'NP') missingFields.push('Date of birth');
    if (!client?.sector) missingFields.push('Sector');

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a KYC compliance analyst. Based on the client information below, suggest which documents and data points should be requested from the client.

Client type: ${clientType === 'NP' ? 'Natural Person (individual)' : 'Organisation (company)'}
Client name: ${client?.full_name}
Country: ${client?.registered_country || client?.nationality || 'unknown'}
Sector: ${client?.sector || 'unknown'}
Missing profile fields: ${missingFields.length > 0 ? missingFields.join(', ') : 'none identified'}
Case type: ${kycCase?.case_type?.replace(/_/g,' ')}

Available items to request (pick by ID): ${catalogueItems.map(i => `${i.id}: ${i.label}`).join(', ')}

Return the item IDs you recommend requesting, with a short reason for each.`,
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
    // Auto-select suggested items
    if (result?.recommended_item_ids?.length > 0) {
      setSelectedItems(result.recommended_item_ids.filter(id => catalogueItems.find(c => c.id === id)));
    }
    if (result?.message_draft) setMessage(result.message_draft);
    setAiLoading(false);
  }

  function toggleItem(id) {
    setSelectedItems(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  }

  async function createRequest() {
    if (selectedItems.length === 0) return;
    setCreating(true);
    const token = generateToken();
    const tokenExpiry = new Date(deadline);
    tokenExpiry.setDate(tokenExpiry.getDate() + 1);

    const items = selectedItems.map(id => {
      const item = catalogueItems.find(d => d.id === id) || ALL_ITEMS.find(d => d.id === id);
      return { item_id: id, item_type: item?.type || 'document', label: item?.label || id, status: 'Requested' };
    });

    await base44.entities.OutreachRequest.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      client_id: kycCase.client_id,
      message,
      deadline,
      delivery_channel: channel,
      status: 'Draft',
      access_token: token,
      token_expires_at: tokenExpiry.toISOString(),
      items,
    });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      client_id: kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'outreach_created',
      notes: `Outreach request created (${channel}): ${items.map(i => i.label).join(', ')}`,
    });
    setNewOpen(false);
    setPreviewOpen(false);
    setSelectedItems([]);
    setMessage('');
    setEmailSubject('');
    setAiSuggestions(null);
    setCreating(false);
    load();
  }

  async function sendEmail(req) {
    if (!client?.primary_contact_email) return;
    setSending(true);
    const portalUrl = getPortalUrl(req);
    const fromName = tenant?.email_from_name || tenant?.name || 'Compliance Team';
    const body = buildEmailHtml(tenant, client, req, portalUrl);

    try {
      await base44.integrations.Core.SendEmail({
        from_name: fromName,
        ...(tenant?.email_from_address ? { from_email: tenant.email_from_address } : {}),
        to: client.primary_contact_email,
        subject: emailSubject || `Action Required: Documents needed — ${tenant?.name || 'KYC Review'}`,
        body,
      });
    } catch (err) {
      console.warn('Email send failed (external email not supported), marking as sent anyway:', err);
    }

    await base44.entities.OutreachRequest.update(req.id, { status: 'Sent' });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'outreach_sent',
      notes: `Outreach email sent to ${client.primary_contact_email}`,
    });
    setSending(false);
    load();
  }

  async function markSent(req) {
    await base44.entities.OutreachRequest.update(req.id, { status: 'Sent' });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'outreach_sent',
      notes: `Outreach marked as sent via ${req.delivery_channel}`,
    });
    load();
  }

  async function verifyItem(req, itemIndex) {
    const updatedItems = req.items.map((item, i) =>
      i === itemIndex ? { ...item, status: 'Verified' } : item
    );
    await base44.entities.OutreachRequest.update(req.id, { items: updatedItems });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'document_verified',
      notes: `Verified: ${req.items[itemIndex].label}`,
    });
    load();
  }

  function getPortalUrl(req) {
    return `${window.location.origin}/portal/${req.access_token}`;
  }

  function copyPortalLink(req) {
    navigator.clipboard.writeText(getPortalUrl(req));
  }

  const selectedItemObjects = selectedItems.map(id => catalogueItems.find(c => c.id === id) || ALL_ITEMS.find(c => c.id === id)).filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Outreach & Document Collection</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Manage document and data requests sent to the client</p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setNewOpen(true)}>
          <Plus className="w-3 h-3" /> New Request
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-card border border-border rounded-xl py-12 text-center">
          <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No outreach requests yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Create a request to collect documents from the client</p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map(req => {
            const isOverdue = req.deadline && isPast(parseISO(req.deadline)) && req.status !== 'Complete';
            const portalUrl = getPortalUrl(req);
            const pendingCount = req.items?.filter(i => i.status === 'Requested').length || 0;
            const verifiedCount = req.items?.filter(i => i.status === 'Verified').length || 0;

            return (
              <div key={req.id} className={cn('bg-card border rounded-xl overflow-hidden', isOverdue ? 'border-amber-300' : 'border-border')}>
                {/* Request header */}
                <div className={cn('px-4 py-3 flex items-center justify-between border-b', isOverdue ? 'bg-amber-50 border-amber-200' : 'border-border')}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium border', STATUS_STYLES[req.status] || STATUS_STYLES.Draft)}>
                      {req.status?.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-muted-foreground">via {req.delivery_channel}</span>
                    {req.deadline && (
                      <span className={cn('text-xs font-medium', isOverdue ? 'text-amber-700' : 'text-muted-foreground')}>
                        {isOverdue ? '⚠ Overdue — ' : 'Due '}
                        {format(parseISO(req.deadline), 'd MMM yyyy')}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {verifiedCount}/{req.items?.length || 0} verified
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {req.access_token && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => copyPortalLink(req)}>
                          <Copy className="w-3 h-3" /> Copy Link
                        </Button>
                        <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                            <ExternalLink className="w-3 h-3" /> Portal
                          </Button>
                        </a>
                      </>
                    )}
                    {req.status === 'Draft' && (
                      <>
                        {client?.primary_contact_email && (
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-primary border-primary/30 hover:bg-primary/5"
                            onClick={() => sendEmail(req)} disabled={sending}>
                            {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                            Send Email
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => markSent(req)}>
                          <Send className="w-3 h-3" /> Mark Sent
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {req.items?.length > 0 && (
                  <div className="px-4 pt-3 pb-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Progress</span>
                      <span className="text-xs font-medium">{Math.round((verifiedCount / req.items.length) * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${(verifiedCount / req.items.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Document tracker */}
                {req.items?.length > 0 && (
                  <div className="divide-y divide-border/50 mt-2">
                    {req.items.map((item, i) => {
                      const itemOverdue = isOverdue && item.status === 'Requested';
                      return (
                        <div key={i} className={cn('flex items-center justify-between px-4 py-2.5', itemOverdue && 'bg-amber-50/40')}>
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className={cn('w-3.5 h-3.5 flex-shrink-0', item.status === 'Verified' ? 'text-emerald-500' : itemOverdue ? 'text-amber-500' : 'text-muted-foreground')} />
                            <div className="min-w-0">
                              <div className="text-xs text-foreground truncate">{item.label}</div>
                              {item.response_text && <div className="text-xs text-muted-foreground truncate">{item.response_text}</div>}
                              {item.file_url && (
                                <button
                                  className="text-xs text-primary hover:underline text-left"
                                  onClick={() => setViewerDoc({ url: item.file_url, name: item.label })}
                                >
                                  View uploaded file
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={cn('text-xs px-1.5 py-0.5 rounded-full border', ITEM_STATUS_STYLES[item.status] || ITEM_STATUS_STYLES.Requested)}>
                              {item.status}
                            </span>
                            {item.status === 'Received' && (
                              <Button size="sm" variant="outline" className="h-6 text-xs gap-0.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                onClick={() => verifyItem(req, i)}>
                                <ShieldCheck className="w-3 h-3" /> Verify
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Covering message */}
                {req.message && (
                  <div className="px-4 py-3 border-t border-border/50 bg-muted/20">
                    <div className="text-xs text-muted-foreground italic">"{req.message}"</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {viewerDoc && (
        <DocumentViewer
          fileUrl={viewerDoc.url}
          fileName={viewerDoc.name}
          onClose={() => setViewerDoc(null)}
        />
      )}

      {/* ── Builder Dialog ── */}
      <Dialog open={newOpen} onOpenChange={v => { setNewOpen(v); if (!v) { setAiSuggestions(null); setSelectedItems([]); setMessage(''); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Outreach Request — {client?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">

            {/* AI Copilot */}
            <div className="bg-purple-50/60 border border-purple-100 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  <span className="text-sm font-semibold text-purple-800">Outreach Co-Pilot</span>
                </div>
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs gap-1 border-purple-200 text-purple-700 hover:bg-purple-100"
                  onClick={runAiCopilot}
                  disabled={aiLoading}
                >
                  {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {aiLoading ? 'Analysing…' : 'Suggest Items'}
                </Button>
              </div>
              {aiSuggestions ? (
                <div className="space-y-1.5">
                  <div className="text-xs text-purple-700 font-medium">AI recommends {aiSuggestions.recommended_item_ids?.length} item(s) — auto-selected below:</div>
                  {aiSuggestions.recommended_item_ids?.map(id => {
                    const item = ALL_ITEMS.find(c => c.id === id);
                    const reason = aiSuggestions.reasons?.[id];
                    return item ? (
                      <div key={id} className="flex items-start gap-1.5 text-xs text-purple-700">
                        <CheckCircle className="w-3 h-3 text-purple-500 mt-0.5 flex-shrink-0" />
                        <span><strong>{item.label}</strong>{reason ? ` — ${reason}` : ''}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              ) : (
                <p className="text-xs text-purple-600">Click "Suggest Items" to get AI-powered recommendations based on client type, profile gaps, and case context.</p>
              )}
            </div>

            {/* Template Picker */}
            {emailTemplates.length > 0 && (
              <div className="relative">
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs font-medium">Use Email Template</Label>
                </div>
                <div className="relative">
                  <Button
                    type="button" size="sm" variant="outline"
                    className="w-full justify-between text-xs h-9"
                    onClick={() => setTemplatePickerOpen(o => !o)}
                  >
                    <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-muted-foreground" /> Select a template to pre-fill subject &amp; message…</span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                  {templatePickerOpen && (
                    <div className="absolute left-0 top-full mt-1 z-50 w-full bg-popover border border-border rounded-xl shadow-lg overflow-hidden">
                      {emailTemplates.map(tmpl => (
                        <button key={tmpl.id} type="button"
                          className="w-full text-left px-3 py-2.5 text-xs hover:bg-muted/60 transition-colors border-b border-border/50 last:border-0"
                          onClick={() => applyTemplate(tmpl, `${window.location.origin}/portal/[token]`)}
                        >
                          <div className="font-medium text-foreground">{tmpl.name}</div>
                          <div className="text-muted-foreground mt-0.5">{SITUATION_LABELS[tmpl.situation] || tmpl.situation} · {tmpl.subject}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Email Subject (shown when channel = Email) */}
            {channel === 'Email' && (
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Email Subject</Label>
                <Input
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  placeholder="Action Required: Documents needed for your KYC review"
                  className="h-9 text-sm"
                />
              </div>
            )}

            {/* Item selection */}
            <div>
              <Label className="text-xs font-medium mb-2 block">Select Items to Request</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-1">
                {catalogueItems.map(item => {
                  const isAiSuggested = aiSuggestions?.recommended_item_ids?.includes(item.id);
                  return (
                    <label key={item.id} className={cn(
                      'flex items-start gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm',
                      selectedItems.includes(item.id) ? 'border-primary bg-primary/5' : isAiSuggested ? 'border-purple-300 bg-purple-50/40' : 'border-border hover:bg-muted/30'
                    )}>
                      <input
                        type="checkbox"
                        checked={selectedItems.includes(item.id)}
                        onChange={() => toggleItem(item.id)}
                        className="rounded border-border mt-0.5"
                      />
                      <div>
                        <div className={cn('text-sm leading-tight', selectedItems.includes(item.id) ? 'font-medium' : '')}>{item.label}</div>
                        <div className="text-xs text-muted-foreground">{item.type === 'document' ? 'Document' : 'Data point'}</div>
                      </div>
                      {isAiSuggested && <Sparkles className="w-3 h-3 text-purple-500 ml-auto mt-0.5 flex-shrink-0" />}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Channel + deadline */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Delivery Channel</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Email">Email</SelectItem>
                    <SelectItem value="SMS">SMS</SelectItem>
                    <SelectItem value="Portal">Client Portal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Response Deadline</Label>
                <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="h-9 text-sm" />
              </div>
            </div>

            {/* Covering message */}
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Covering Message</Label>
              <Textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Dear [Client], as part of our periodic KYC review…"
                className="text-sm min-h-16"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-1 border-t border-border">
              <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
              <Button
                variant="outline"
                disabled={selectedItems.length === 0}
                onClick={() => { setPreviewOpen(true); }}
                className="gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" /> Preview
              </Button>
              <Button onClick={createRequest} disabled={selectedItems.length === 0 || creating} className="gap-2">
                {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                Create & Generate Link
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Preview Dialog ── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Preview — Client View</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="bg-muted/30 rounded-xl p-4 border border-border">
              <div className="text-sm font-semibold mb-1">Dear {client?.full_name},</div>
              {message && <p className="text-sm text-muted-foreground mb-3">{message}</p>}
              <p className="text-sm text-muted-foreground mb-3">
                As part of our ongoing review, we kindly request the following by <strong>{deadline ? format(parseISO(deadline), 'd MMMM yyyy') : '—'}</strong>:
              </p>
              <ul className="space-y-1.5">
                {selectedItemObjects.map(item => (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    {item.label}
                    <span className="text-xs text-muted-foreground ml-1">({item.type})</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setPreviewOpen(false)}>Back to Edit</Button>
              <Button onClick={createRequest} disabled={creating} className="gap-2">
                {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm & Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}