import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { FileText, Upload, CheckCircle, Clock, Send, Loader2, MessageCircle, AlertTriangle, X, ChevronRight, ArrowLeft, LayoutDashboard, Shield } from 'lucide-react';
import { portalSecureUpload } from '@/lib/securityUtils';
import { format, isPast, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

const T = {
  en: {
    welcome: 'Dear', deadline: 'Please respond by', expired: 'This link has expired.',
    completed: 'Thank you — your submission is complete.', progress: 'Your progress',
    submit: 'Submit All Responses', submitting: 'Submitting…', uploaded: 'Uploaded',
    pending: 'Pending', ask: 'Ask a question…',
    chat_intro: 'Hi! I\'m here to help you understand what\'s being asked.',
    upload_btn: 'Upload file', text_placeholder: 'Enter your response here…',
    overdue: 'This request is overdue', submitted_item: 'Submitted',
    lang: 'NL',
    description_doc: 'Please upload a clear, legible copy of this document (PDF, JPG or PNG, max 25MB).',
    description_dp: 'Please provide the requested information in the text field below.',
    all_requests: 'All Requests', compliance_status: 'Compliance Status',
    status_complete: 'All documents received', status_partial: 'Partial response — action required',
    status_pending: 'Action required', status_review: 'Under review',
    open_request: 'Open', back_to_dashboard: 'Back to overview',
    requests_count: 'request', requests_count_pl: 'requests',
    dashboard_title: 'Your Document Requests',
    dashboard_sub: 'Here is an overview of all information requests from your institution.',
    compliance_title: 'Compliance Overview',
    no_requests: 'No active requests found for this link.',
  },
  nl: {
    welcome: 'Beste', deadline: 'Graag reageren voor', expired: 'Deze link is verlopen.',
    completed: 'Dank u — uw inzending is volledig.', progress: 'Uw voortgang',
    submit: 'Alle antwoorden verzenden', submitting: 'Verzenden…', uploaded: 'Geüpload',
    pending: 'In behandeling', ask: 'Stel een vraag…',
    chat_intro: 'Hallo! Ik help u graag te begrijpen wat er gevraagd wordt.',
    upload_btn: 'Bestand uploaden', text_placeholder: 'Voer hier uw antwoord in…',
    overdue: 'Dit verzoek is verlopen', submitted_item: 'Ingediend',
    lang: 'EN',
    description_doc: 'Upload een duidelijk, leesbaar exemplaar van dit document (PDF, JPG of PNG, max 25MB).',
    description_dp: 'Voer de gevraagde informatie in het tekstveld hieronder in.',
    all_requests: 'Alle verzoeken', compliance_status: 'Compliance status',
    status_complete: 'Alle documenten ontvangen', status_partial: 'Gedeeltelijk — actie vereist',
    status_pending: 'Actie vereist', status_review: 'In behandeling',
    open_request: 'Openen', back_to_dashboard: 'Terug naar overzicht',
    requests_count: 'verzoek', requests_count_pl: 'verzoeken',
    dashboard_title: 'Uw documentverzoeken',
    dashboard_sub: 'Hier is een overzicht van alle informatieverzoeken van uw instelling.',
    compliance_title: 'Compliance overzicht',
    no_requests: 'Geen actieve verzoeken gevonden voor deze link.',
  },
};

function statusConfig(outreach) {
  if (outreach.status === 'Complete') return { label: 'Complete', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500' };
  if (outreach.status === 'Partial_Response') return { label: 'Partial', color: 'text-amber-700 bg-amber-50 border-amber-200', dot: 'bg-amber-500' };
  if (outreach.status === 'Viewed' || outreach.status === 'Sent') return { label: 'Action Required', color: 'text-red-700 bg-red-50 border-red-200', dot: 'bg-red-500' };
  return { label: 'Draft', color: 'text-slate-600 bg-slate-50 border-slate-200', dot: 'bg-slate-400' };
}

export default function ClientPortal() {
  const { token } = useParams();
  const [lang, setLang] = useState(navigator.language?.startsWith('nl') ? 'nl' : 'en');

  // All outreach requests for this client (shared token → same client_id)
  const [allOutreaches, setAllOutreaches] = useState([]);
  const [tenant, setTenant] = useState(null);
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  // Which view: 'dashboard' | 'request' | 'compliance'
  const [view, setView] = useState('dashboard');
  const [activeOutreach, setActiveOutreach] = useState(null);

  // Per-item state keyed by outreach id → item_id
  const [itemStateMap, setItemStateMap] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submittedIds, setSubmittedIds] = useState(new Set());

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  const t = T[lang];

  useEffect(() => { if (token) loadByToken(); else setLoading(false); }, [token]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);
  useEffect(() => {
    setChatMessages([{ role: 'ai', text: T[lang].chat_intro }]);
  }, [lang]);

  async function loadByToken() {
    // Find outreach by token
    const results = await base44.entities.OutreachRequest.filter({ access_token: token });
    const primary = results?.[0];
    if (!primary) { setExpired(true); setLoading(false); return; }
    if (primary.token_expires_at && isPast(new Date(primary.token_expires_at))) {
      setExpired(true); setLoading(false); return;
    }

    // Load all outreaches for this client
    const [allReqs, tenantData, clientData] = await Promise.all([
      base44.entities.OutreachRequest.filter({ client_id: primary.client_id, tenant_id: primary.tenant_id }),
      base44.entities.Tenant.filter({ id: primary.tenant_id }),
      base44.entities.Client.filter({ id: primary.client_id }),
    ]);

    const visibleReqs = (allReqs || []).filter(r => r.status !== 'Draft');
    setAllOutreaches(visibleReqs);
    setTenant(tenantData?.[0] || null);
    setClient(clientData?.[0] || null);

    // Init item states for all outreaches
    const map = {};
    visibleReqs.forEach(req => {
      map[req.id] = {};
      (req.items || []).forEach(item => {
        map[req.id][item.item_id] = {
          text: item.response_text || '',
          fileUrl: item.file_url || '',
          uploading: false,
          done: item.status === 'Received' || item.status === 'Verified',
        };
      });
    });
    setItemStateMap(map);

    // Log view
    await Promise.all([
      base44.entities.AuditEvent.create({
        tenant_id: primary.tenant_id, case_id: primary.case_id,
        client_id: primary.client_id, actor_type: 'System', actor_name: 'Client Portal',
        event_type: 'portal_viewed', notes: 'Client portal accessed via token',
      }),
      base44.entities.OutreachRequest.update(primary.id, {
        status: primary.status === 'Sent' ? 'Viewed' : primary.status,
      }),
    ]);

    // If only one request, go straight to it
    if (visibleReqs.length === 1) {
      setActiveOutreach(visibleReqs[0]);
      setView('request');
    } else {
      // Default to the primary token's request
      setActiveOutreach(primary);
      setView('dashboard');
    }

    setLoading(false);
  }

  async function uploadFile(outreachId, itemId, file) {
    if (!file) return;
    setItemStateMap(s => ({ ...s, [outreachId]: { ...s[outreachId], [itemId]: { ...s[outreachId]?.[itemId], uploading: true } } }));
    try {
      const file_url = await portalSecureUpload(file);
      setItemStateMap(s => ({ ...s, [outreachId]: { ...s[outreachId], [itemId]: { ...s[outreachId]?.[itemId], uploading: false, fileUrl: file_url } } }));
    } catch (err) {
      setItemStateMap(s => ({ ...s, [outreachId]: { ...s[outreachId], [itemId]: { ...s[outreachId]?.[itemId], uploading: false } } }));
      alert(err.message || 'Upload failed. Please try again.');
    }
  }

  function setItemText(outreachId, itemId, text) {
    setItemStateMap(s => ({ ...s, [outreachId]: { ...s[outreachId], [itemId]: { ...s[outreachId]?.[itemId], text } } }));
  }

  function getItemStates(outreachId) { return itemStateMap[outreachId] || {}; }

  function completedCount(outreach) {
    const states = getItemStates(outreach.id);
    return (outreach?.items || []).filter(item => {
      const s = states[item.item_id];
      return s?.done || (item.item_type === 'document' ? !!s?.fileUrl : !!s?.text?.trim());
    }).length;
  }

  async function handleSubmit(outreach) {
    setSubmitting(true);
    const states = getItemStates(outreach.id);
    const updatedItems = (outreach.items || []).map(item => {
      const s = states[item.item_id] || {};
      const isDone = s.done || (item.item_type === 'document' ? !!s.fileUrl : !!s.text?.trim());
      return { ...item, response_text: s.text || item.response_text || '', file_url: s.fileUrl || item.file_url || '', status: isDone ? 'Received' : 'Requested' };
    });
    const allDone = updatedItems.every(i => i.status === 'Received' || i.status === 'Verified');
    const newStatus = allDone ? 'Complete' : 'Partial_Response';

    await base44.entities.OutreachRequest.update(outreach.id, { items: updatedItems, status: newStatus });
    await base44.entities.AuditEvent.create({
      tenant_id: outreach.tenant_id, case_id: outreach.case_id, client_id: outreach.client_id,
      actor_type: 'System', actor_name: 'Client Portal', event_type: 'portal_submitted',
      notes: `Client submitted: ${newStatus}. ${updatedItems.filter(i => i.status === 'Received').length}/${updatedItems.length} items.`,
    });

    // Update local state
    setAllOutreaches(prev => prev.map(r => r.id === outreach.id ? { ...r, status: newStatus, items: updatedItems } : r));
    setSubmittedIds(s => new Set([...s, outreach.id]));
    setSubmitting(false);
  }

  async function askAI(question) {
    if (!question.trim()) return;
    setChatMessages(m => [...m, { role: 'user', text: question }]);
    setChatInput('');
    setChatLoading(true);
    const items = activeOutreach?.items?.map(i => i.label).join(', ') || 'documents and information';
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a helpful assistant for a financial institution's client portal. A client is completing an information request.
The client has been asked to provide: ${items}
Their question: "${question}"
Answer in plain, friendly language (in ${lang === 'nl' ? 'Dutch' : 'English'}). Be helpful. Do NOT reveal KYC system internals. Keep it to 2-4 sentences.`,
    });
    setChatMessages(m => [...m, { role: 'ai', text: typeof result === 'string' ? result : result?.output || 'Sorry, I couldn\'t process that.' }]);
    setChatLoading(false);
  }

  const brandColor = tenant?.branding_primary_color || '#1A6BFF';
  const tenantName = tenant?.name || 'Your Financial Institution';
  const logoUrl = tenant?.branding_logo_url;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
    </div>
  );

  if (expired || !token) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="text-center max-w-sm">
        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-slate-800 mb-2">{t.expired}</h2>
        <p className="text-sm text-slate-500">If you think this is an error, please contact your relationship manager.</p>
      </div>
    </div>
  );

  // Overall compliance status
  const totalItems = allOutreaches.reduce((acc, r) => acc + (r.items?.length || 0), 0);
  const doneItems  = allOutreaches.reduce((acc, r) => acc + completedCount(r), 0);
  const allComplete = allOutreaches.every(r => r.status === 'Complete' || submittedIds.has(r.id));
  const anyOverdue  = allOutreaches.some(r => r.deadline && isPast(parseISO(r.deadline)) && r.status !== 'Complete');

  const Header = () => (
    <div className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={tenantName} className="h-8 w-auto object-contain" />
          ) : (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: brandColor }}>
              {tenantName.charAt(0)}
            </div>
          )}
          <span className="font-semibold text-slate-800 text-sm">{tenantName}</span>
        </div>
        <div className="flex items-center gap-2">
          {allOutreaches.length > 1 && view !== 'dashboard' && (
            <button onClick={() => setView('dashboard')} className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 border border-slate-200 rounded-md px-2 py-1 transition-colors">
              <ArrowLeft className="w-3 h-3" /> {t.back_to_dashboard}
            </button>
          )}
          <button
            onClick={() => setLang(l => l === 'en' ? 'nl' : 'en')}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 border border-slate-200 rounded-md px-2 py-1 transition-colors"
          >{t.lang}</button>
        </div>
      </div>
      {/* Tab nav when multiple requests */}
      {allOutreaches.length > 1 && (
        <div className="max-w-lg mx-auto px-4 pb-2 flex items-center gap-1">
          <button
            onClick={() => setView('dashboard')}
            className={cn('flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors',
              view === 'dashboard' ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:text-slate-800')}
          >
            <LayoutDashboard className="w-3.5 h-3.5" /> {t.all_requests}
          </button>
          <button
            onClick={() => setView('compliance')}
            className={cn('flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors',
              view === 'compliance' ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:text-slate-800')}
          >
            <Shield className="w-3.5 h-3.5" /> {t.compliance_status}
          </button>
        </div>
      )}
    </div>
  );

  // ── Dashboard View ──
  if (view === 'dashboard' && allOutreaches.length > 1) {
    return (
      <div className="min-h-screen bg-slate-50 pb-24">
        <Header />
        <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">
          <div>
            <h1 className="text-lg font-bold text-slate-800">{t.dashboard_title}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{t.dashboard_sub}</p>
          </div>

          {/* Overall progress card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">{t.progress}</span>
              <span className="text-sm font-bold" style={{ color: brandColor }}>
                {totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0}%
              </span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0}%`, backgroundColor: brandColor }} />
            </div>
            <div className="text-xs text-slate-500 mt-1.5">{doneItems} of {totalItems} items completed across {allOutreaches.length} {allOutreaches.length === 1 ? t.requests_count : t.requests_count_pl}</div>
          </div>

          {/* Request cards */}
          <div className="space-y-3">
            {allOutreaches.map(req => {
              const cfg = statusConfig(req);
              const done = completedCount(req);
              const total = req.items?.length || 0;
              const isOver = req.deadline && isPast(parseISO(req.deadline)) && req.status !== 'Complete';
              return (
                <button
                  key={req.id}
                  onClick={() => { setActiveOutreach(req); setView('request'); }}
                  className="w-full text-left bg-white rounded-2xl border border-slate-200 p-4 shadow-sm hover:border-slate-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border', cfg.color)}>{cfg.label}</span>
                        {isOver && <span className="text-xs text-red-600 font-medium">Overdue</span>}
                      </div>
                      {req.message && <p className="text-sm text-slate-700 font-medium truncate">{req.message.substring(0, 80)}{req.message.length > 80 ? '…' : ''}</p>}
                      <div className="text-xs text-slate-500 mt-1">
                        {done}/{total} items · {req.deadline ? `Due ${format(parseISO(req.deadline), 'd MMM yyyy')}` : 'No deadline'}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0 mt-1" />
                  </div>
                  {total > 0 && (
                    <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.round((done / total) * 100)}%`, backgroundColor: brandColor }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Compliance View ──
  if (view === 'compliance') {
    const pendingReqs  = allOutreaches.filter(r => ['Sent','Viewed'].includes(r.status));
    const partialReqs  = allOutreaches.filter(r => r.status === 'Partial_Response');
    const completeReqs = allOutreaches.filter(r => r.status === 'Complete' || submittedIds.has(r.id));
    return (
      <div className="min-h-screen bg-slate-50 pb-24">
        <Header />
        <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">
          <h1 className="text-lg font-bold text-slate-800">{t.compliance_title}</h1>

          <div className={cn('rounded-2xl border p-4 flex items-center gap-3', allComplete ? 'bg-emerald-50 border-emerald-200' : anyOverdue ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200')}>
            {allComplete
              ? <CheckCircle className="w-8 h-8 text-emerald-500 flex-shrink-0" />
              : anyOverdue
                ? <AlertTriangle className="w-8 h-8 text-red-500 flex-shrink-0" />
                : <Clock className="w-8 h-8 text-amber-500 flex-shrink-0" />}
            <div>
              <div className={cn('font-semibold text-sm', allComplete ? 'text-emerald-800' : anyOverdue ? 'text-red-800' : 'text-amber-800')}>
                {allComplete ? t.status_complete : anyOverdue ? t.status_pending : t.status_partial}
              </div>
              <div className={cn('text-xs mt-0.5', allComplete ? 'text-emerald-600' : anyOverdue ? 'text-red-600' : 'text-amber-600')}>
                {doneItems}/{totalItems} items · {completeReqs.length}/{allOutreaches.length} requests complete
              </div>
            </div>
          </div>

          {[
            { label: 'Action Required', items: pendingReqs, color: 'text-red-700 bg-red-50 border-red-200' },
            { label: 'Partial Response', items: partialReqs, color: 'text-amber-700 bg-amber-50 border-amber-200' },
            { label: 'Complete', items: completeReqs, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
          ].filter(g => g.items.length > 0).map(group => (
            <div key={group.label}>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{group.label}</div>
              <div className="space-y-2">
                {group.items.map(req => (
                  <button key={req.id} onClick={() => { setActiveOutreach(req); setView('request'); }}
                    className="w-full text-left bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between hover:border-slate-300 transition-colors">
                    <div>
                      <div className="text-sm font-medium text-slate-700 truncate max-w-xs">{req.message?.substring(0, 60) || 'Information Request'}</div>
                      <div className="text-xs text-slate-500">{completedCount(req)}/{req.items?.length || 0} items</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Single Request View ──
  const outreach = activeOutreach;
  if (!outreach) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center text-slate-500 text-sm">{t.no_requests}</div>
    </div>
  );

  const isSubmitted = submittedIds.has(outreach.id) || outreach.status === 'Complete';
  const states = getItemStates(outreach.id);
  const progress = (outreach.items?.length || 0) > 0 ? Math.round((completedCount(outreach) / outreach.items.length) * 100) : 0;
  const isOverdue = outreach.deadline && isPast(parseISO(outreach.deadline));

  if (isSubmitted) return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <Header />
      <div className="max-w-lg mx-auto px-4 pt-16 flex flex-col items-center text-center">
        <CheckCircle className="w-14 h-14 text-emerald-500 mb-4" />
        <h2 className="text-lg font-semibold text-slate-800 mb-2">{t.completed}</h2>
        <p className="text-sm text-slate-500">You may close this window.</p>
        {allOutreaches.length > 1 && (
          <Button variant="outline" className="mt-6" onClick={() => setView('dashboard')}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> {t.back_to_dashboard}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <Header />
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">
        {/* Welcome + deadline */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="text-lg font-semibold text-slate-800 mb-1">{t.welcome} {client?.full_name || ''},</div>
          {outreach.message && <p className="text-sm text-slate-600 mb-3">{outreach.message}</p>}
          <div className={cn('flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium', isOverdue ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800')}>
            {isOverdue ? <AlertTriangle className="w-4 h-4 flex-shrink-0" /> : <Clock className="w-4 h-4 flex-shrink-0" />}
            {isOverdue ? t.overdue : `${t.deadline} ${outreach.deadline ? format(parseISO(outreach.deadline), 'd MMMM yyyy') : '—'}`}
          </div>
        </div>

        {/* Progress */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">{t.progress}</span>
            <span className="text-sm font-bold" style={{ color: brandColor }}>{progress}%</span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, backgroundColor: brandColor }} />
          </div>
          <div className="text-xs text-slate-500 mt-1.5">{completedCount(outreach)} of {outreach.items?.length || 0} items completed</div>
        </div>

        {/* Items */}
        <div className="space-y-3">
          {(outreach.items || []).map(item => {
            const s = states[item.item_id] || {};
            const isDoc = item.item_type === 'document';
            const isDone = s.done || (isDoc ? !!s.fileUrl : !!s.text?.trim());
            return (
              <div key={item.item_id} className={cn('bg-white rounded-2xl border shadow-sm overflow-hidden transition-all', isDone ? 'border-emerald-200' : 'border-slate-200')}>
                <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={cn('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', isDone ? 'bg-emerald-100' : 'bg-slate-100')}>
                      {isDone ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <FileText className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 text-sm">{item.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{isDoc ? t.description_doc : t.description_dp}</div>
                    </div>
                  </div>
                  {isDone && <span className="text-xs font-medium text-emerald-600 flex-shrink-0">{t.submitted_item}</span>}
                </div>
                {!s.done && (
                  <div className="px-4 pb-4">
                    {isDoc ? (
                      <div className="mt-2">
                        {s.fileUrl ? (
                          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2.5">
                            <CheckCircle className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate">{t.uploaded}</span>
                            <button className="ml-auto text-slate-400 hover:text-slate-600" onClick={() => setItemStateMap(m => ({ ...m, [outreach.id]: { ...m[outreach.id], [item.item_id]: { ...m[outreach.id]?.[item.item_id], fileUrl: '' } } }))}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <label className={cn('flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-5 cursor-pointer transition-colors', s.uploading ? 'border-slate-300 bg-slate-50' : 'border-slate-200 hover:border-slate-400 hover:bg-slate-50')}>
                            {s.uploading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400 mb-1" /> : <Upload className="w-5 h-5 text-slate-400 mb-1" />}
                            <span className="text-sm font-medium text-slate-600">{s.uploading ? 'Uploading…' : t.upload_btn}</span>
                            <span className="text-xs text-slate-400 mt-0.5">PDF, JPG, PNG — max 25MB</span>
                            <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" disabled={s.uploading} onChange={e => uploadFile(outreach.id, item.item_id, e.target.files?.[0])} />
                          </label>
                        )}
                      </div>
                    ) : (
                      <Textarea value={s.text || ''} onChange={e => setItemText(outreach.id, item.item_id, e.target.value)} placeholder={t.text_placeholder} className="mt-2 text-sm min-h-16 bg-slate-50 border-slate-200 rounded-xl" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Button className="w-full h-12 text-base font-semibold rounded-2xl gap-2 shadow-sm" style={{ backgroundColor: brandColor }} onClick={() => handleSubmit(outreach)} disabled={submitting || completedCount(outreach) === 0}>
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          {submitting ? t.submitting : t.submit}
        </Button>
      </div>

      {/* AI Chat bubble */}
      <div className="fixed bottom-5 right-5 z-20">
        {chatOpen && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-80 mb-3 overflow-hidden flex flex-col" style={{ maxHeight: '60vh' }}>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0" style={{ backgroundColor: brandColor + '15' }}>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: brandColor }}>AI</div>
                <span className="text-sm font-semibold text-slate-800">Assistant</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {chatMessages.map((msg, i) => (
                <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed', msg.role === 'user' ? 'text-white rounded-br-sm' : 'bg-slate-100 text-slate-700 rounded-bl-sm')} style={msg.role === 'user' ? { backgroundColor: brandColor } : {}}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatLoading && <div className="flex justify-start"><div className="bg-slate-100 rounded-2xl rounded-bl-sm px-3 py-2"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div></div>}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 border-t border-slate-100 flex-shrink-0">
              <div className="flex gap-2">
                <Input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder={t.ask} className="text-sm rounded-xl border-slate-200" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(chatInput); } }} />
                <Button size="icon" className="rounded-xl flex-shrink-0 text-white" style={{ backgroundColor: brandColor }} onClick={() => askAI(chatInput)} disabled={!chatInput.trim() || chatLoading}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
        <button onClick={() => setChatOpen(o => !o)} className="w-14 h-14 rounded-full text-white shadow-lg flex items-center justify-center transition-transform hover:scale-105 active:scale-95" style={{ backgroundColor: brandColor }}>
          {chatOpen ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
        </button>
      </div>
    </div>
  );
}