import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { FileText, Upload, CheckCircle, Clock, Send, Loader2, MessageCircle, AlertTriangle, X } from 'lucide-react';
import { portalSecureUpload } from '@/lib/securityUtils';
import { format, isPast, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

// Simple translations
const T = {
  en: {
    welcome: 'Dear',
    deadline: 'Please respond by',
    expired: 'This request has expired.',
    completed: 'Thank you — your submission is complete.',
    progress: 'Your progress',
    submit: 'Submit All Responses',
    submitting: 'Submitting…',
    uploaded: 'Uploaded',
    pending: 'Pending',
    ask: 'Ask a question…',
    chat_intro: 'Hi! I\'m here to help you understand what\'s being asked. Feel free to ask any questions.',
    upload_btn: 'Upload file',
    text_placeholder: 'Enter your response here…',
    overdue: 'This request is overdue',
    submitted_item: 'Submitted',
    already_submitted: 'Already submitted',
    lang: 'NL',
    description_doc: 'Please upload a clear, legible copy of this document (PDF, JPG or PNG, max 25MB).',
    description_dp: 'Please provide the requested information in the text field below.',
  },
  nl: {
    welcome: 'Beste',
    deadline: 'Graag reageren voor',
    expired: 'Dit verzoek is verlopen.',
    completed: 'Dank u — uw inzending is volledig.',
    progress: 'Uw voortgang',
    submit: 'Alle antwoorden verzenden',
    submitting: 'Verzenden…',
    uploaded: 'Geüpload',
    pending: 'In behandeling',
    ask: 'Stel een vraag…',
    chat_intro: 'Hallo! Ik help u graag te begrijpen wat er gevraagd wordt.',
    upload_btn: 'Bestand uploaden',
    text_placeholder: 'Voer hier uw antwoord in…',
    overdue: 'Dit verzoek is verlopen',
    submitted_item: 'Ingediend',
    already_submitted: 'Al ingediend',
    lang: 'EN',
    description_doc: 'Upload een duidelijk, leesbaar exemplaar van dit document (PDF, JPG of PNG, max 25MB).',
    description_dp: 'Voer de gevraagde informatie in het tekstveld hieronder in.',
  },
};

export default function ClientPortal() {
  const { token } = useParams();

  const [lang, setLang] = useState(navigator.language?.startsWith('nl') ? 'nl' : 'en');
  const [outreach, setOutreach] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [alreadyComplete, setAlreadyComplete] = useState(false);

  // Per-item state: { [item_id]: { text: '', file: null, fileUrl: '', uploading: false, done: false } }
  const [itemState, setItemState] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([{ role: 'ai', text: T[lang].chat_intro }]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  const t = T[lang];

  useEffect(() => {
    if (token) loadByToken();
    else setLoading(false);
  }, [token]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    // Update chat intro when language changes
    setChatMessages(prev => {
      const copy = [...prev];
      if (copy[0]?.role === 'ai') copy[0] = { role: 'ai', text: T[lang].chat_intro };
      return copy;
    });
  }, [lang]);

  async function loadByToken() {
    const results = await base44.entities.OutreachRequest.filter({ access_token: token });
    const req = results?.[0];
    if (!req) { setLoading(false); setExpired(true); return; }

    // Check expiry
    if (req.token_expires_at && isPast(new Date(req.token_expires_at))) {
      setExpired(true); setLoading(false); return;
    }
    if (req.status === 'Complete') { setAlreadyComplete(true); setLoading(false); setOutreach(req); return; }

    setOutreach(req);

    // Init item state from existing items
    const init = {};
    (req.items || []).forEach(item => {
      init[item.item_id] = {
        text: item.response_text || '',
        fileUrl: item.file_url || '',
        uploading: false,
        done: item.status === 'Received' || item.status === 'Verified',
      };
    });
    setItemState(init);

    // Load tenant branding
    const [tenantData, clientData] = await Promise.all([
      base44.entities.Tenant.filter({ id: req.tenant_id }),
      base44.entities.Client.filter({ id: req.client_id }),
    ]);
    setTenant(tenantData?.[0] || null);
    setClient(clientData?.[0] || null);

    // Log view
    await base44.entities.AuditEvent.create({
      tenant_id: req.tenant_id,
      case_id: req.case_id,
      client_id: req.client_id,
      actor_type: 'System',
      actor_name: 'Client Portal',
      event_type: 'portal_viewed',
      notes: `Client portal accessed via token`,
    });
    await base44.entities.OutreachRequest.update(req.id, { status: req.status === 'Sent' ? 'Viewed' : req.status });

    setLoading(false);
  }

  async function uploadFile(itemId, file) {
    if (!file) return;
    setItemState(s => ({ ...s, [itemId]: { ...s[itemId], uploading: true } }));
    try {
      const file_url = await portalSecureUpload(file);
      setItemState(s => ({ ...s, [itemId]: { ...s[itemId], uploading: false, fileUrl: file_url, done: false } }));
    } catch (err) {
      setItemState(s => ({ ...s, [itemId]: { ...s[itemId], uploading: false } }));
      alert(err.message || 'Upload failed. Please try again.');
    }
  }

  function setItemText(itemId, text) {
    setItemState(s => ({ ...s, [itemId]: { ...s[itemId], text } }));
  }

  function completedCount() {
    return (outreach?.items || []).filter(item => {
      const s = itemState[item.item_id];
      return s?.done || (item.type === 'document' ? !!s?.fileUrl : !!s?.text?.trim());
    }).length;
  }

  function totalCount() { return outreach?.items?.length || 0; }

  async function handleSubmit() {
    setSubmitting(true);
    // Build updated items
    const updatedItems = (outreach.items || []).map(item => {
      const s = itemState[item.item_id] || {};
      const isDone = s.done || (item.item_type === 'document' ? !!s.fileUrl : !!s.text?.trim());
      return {
        ...item,
        response_text: s.text || item.response_text || '',
        file_url: s.fileUrl || item.file_url || '',
        status: isDone ? 'Received' : 'Requested',
      };
    });

    const allDone = updatedItems.every(i => i.status === 'Received' || i.status === 'Verified');
    const newStatus = allDone ? 'Complete' : 'Partial_Response';

    await base44.entities.OutreachRequest.update(outreach.id, {
      items: updatedItems,
      status: newStatus,
    });
    await base44.entities.AuditEvent.create({
      tenant_id: outreach.tenant_id,
      case_id: outreach.case_id,
      client_id: outreach.client_id,
      actor_type: 'System',
      actor_name: 'Client Portal',
      event_type: 'portal_submitted',
      notes: `Client submitted responses: ${newStatus}. ${updatedItems.filter(i=>i.status==='Received').length}/${updatedItems.length} items provided.`,
    });
    setSubmitting(false);
    setSubmitted(true);
  }

  async function askAI(question) {
    if (!question.trim()) return;
    setChatMessages(m => [...m, { role: 'user', text: question }]);
    setChatInput('');
    setChatLoading(true);
    const items = outreach?.items?.map(i => i.label).join(', ') || 'documents and information';
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a helpful assistant for a financial institution's client portal. A client is completing an information request and has a question.

The client has been asked to provide: ${items}
Their question: "${question}"

Answer in plain, friendly language (in ${lang === 'nl' ? 'Dutch' : 'English'}). Be helpful and reassuring. Do NOT reveal any information about the KYC system, other clients, internal processes, or the institution's risk assessment. Focus only on helping the client understand what documents/information is needed and why it's standard practice. Keep your answer concise (2-4 sentences max).`,
    });
    setChatMessages(m => [...m, { role: 'ai', text: typeof result === 'string' ? result : result?.output || 'I\'m sorry, I couldn\'t process that. Please try again.' }]);
    setChatLoading(false);
  }

  const brandColor = tenant?.branding_primary_color || '#1A6BFF';
  const logoUrl = tenant?.branding_logo_url;
  const tenantName = tenant?.name || 'Your Financial Institution';

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

  if (submitted || alreadyComplete) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="text-center max-w-sm">
        <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-slate-800 mb-2">{t.completed}</h2>
        <p className="text-sm text-slate-500">You may close this window.</p>
      </div>
    </div>
  );

  const progress = totalCount() > 0 ? Math.round((completedCount() / totalCount()) * 100) : 0;
  const isOverdue = outreach?.deadline && isPast(parseISO(outreach.deadline));

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Brand Header */}
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
          <button
            onClick={() => setLang(l => l === 'en' ? 'nl' : 'en')}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 border border-slate-200 rounded-md px-2 py-1 transition-colors"
          >
            {t.lang}
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">
        {/* Welcome + deadline */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="text-lg font-semibold text-slate-800 mb-1">
            {t.welcome} {client?.full_name || ''},
          </div>
          {outreach?.message && (
            <p className="text-sm text-slate-600 mb-3">{outreach.message}</p>
          )}
          <div className={cn(
            'flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium',
            isOverdue ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'
          )}>
            {isOverdue ? <AlertTriangle className="w-4 h-4 flex-shrink-0" /> : <Clock className="w-4 h-4 flex-shrink-0" />}
            {isOverdue ? t.overdue : `${t.deadline} ${outreach?.deadline ? format(parseISO(outreach.deadline), 'd MMMM yyyy') : '—'}`}
          </div>
        </div>

        {/* Progress */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">{t.progress}</span>
            <span className="text-sm font-bold" style={{ color: brandColor }}>{progress}%</span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, backgroundColor: brandColor }}
            />
          </div>
          <div className="text-xs text-slate-500 mt-1.5">{completedCount()} of {totalCount()} items completed</div>
        </div>

        {/* Items */}
        <div className="space-y-3">
          {(outreach?.items || []).map(item => {
            const s = itemState[item.item_id] || {};
            const isDoc = item.item_type === 'document';
            const isDone = s.done || (isDoc ? !!s.fileUrl : !!s.text?.trim());

            return (
              <div key={item.item_id} className={cn(
                'bg-white rounded-2xl border shadow-sm overflow-hidden transition-all',
                isDone ? 'border-emerald-200' : 'border-slate-200'
              )}>
                <div className={cn('px-4 pt-4 pb-2 flex items-start justify-between gap-3')}>
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={cn('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                      isDone ? 'bg-emerald-100' : 'bg-slate-100'
                    )}>
                      {isDone
                        ? <CheckCircle className="w-4 h-4 text-emerald-600" />
                        : <FileText className="w-4 h-4 text-slate-400" />
                      }
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 text-sm">{item.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {isDoc ? t.description_doc : t.description_dp}
                      </div>
                    </div>
                  </div>
                  {isDone && (
                    <span className="text-xs font-medium text-emerald-600 flex-shrink-0">{t.submitted_item}</span>
                  )}
                </div>

                {!s.done && (
                  <div className="px-4 pb-4">
                    {isDoc ? (
                      <div className="mt-2">
                        {s.fileUrl ? (
                          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2.5">
                            <CheckCircle className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate">{t.uploaded}</span>
                            <button className="ml-auto text-slate-400 hover:text-slate-600" onClick={() => setItemState(s2 => ({ ...s2, [item.item_id]: { ...s2[item.item_id], fileUrl: '' } }))}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <label className={cn(
                            'flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-5 cursor-pointer transition-colors',
                            s.uploading ? 'border-slate-300 bg-slate-50' : 'border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                          )}>
                            {s.uploading ? (
                              <Loader2 className="w-5 h-5 animate-spin text-slate-400 mb-1" />
                            ) : (
                              <Upload className="w-5 h-5 text-slate-400 mb-1" />
                            )}
                            <span className="text-sm font-medium text-slate-600">
                              {s.uploading ? 'Uploading…' : t.upload_btn}
                            </span>
                            <span className="text-xs text-slate-400 mt-0.5">PDF, JPG, PNG — max 25MB</span>
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              className="hidden"
                              disabled={s.uploading}
                              onChange={e => uploadFile(item.item_id, e.target.files?.[0])}
                            />
                          </label>
                        )}
                      </div>
                    ) : (
                      <Textarea
                        value={s.text || ''}
                        onChange={e => setItemText(item.item_id, e.target.value)}
                        placeholder={t.text_placeholder}
                        className="mt-2 text-sm min-h-16 bg-slate-50 border-slate-200 rounded-xl"
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Submit button */}
        <Button
          className="w-full h-12 text-base font-semibold rounded-2xl gap-2 shadow-sm"
          style={{ backgroundColor: brandColor }}
          onClick={handleSubmit}
          disabled={submitting || completedCount() === 0}
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          {submitting ? t.submitting : t.submit}
        </Button>
      </div>

      {/* AI Chat bubble */}
      <div className="fixed bottom-5 right-5 z-20">
        {chatOpen && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-80 mb-3 overflow-hidden flex flex-col" style={{ maxHeight: '60vh' }}>
            {/* Chat header */}
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0" style={{ backgroundColor: brandColor + '15' }}>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: brandColor }}>
                  AI
                </div>
                <span className="text-sm font-semibold text-slate-800">Assistant</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {chatMessages.map((msg, i) => (
                <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'text-white rounded-br-sm'
                      : 'bg-slate-100 text-slate-700 rounded-bl-sm'
                  )} style={msg.role === 'user' ? { backgroundColor: brandColor } : {}}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-3 py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-slate-100 flex-shrink-0">
              <div className="flex gap-2">
                <Input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder={t.ask}
                  className="text-sm rounded-xl border-slate-200"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(chatInput); } }}
                />
                <Button
                  size="icon"
                  className="rounded-xl flex-shrink-0 text-white"
                  style={{ backgroundColor: brandColor }}
                  onClick={() => askAI(chatInput)}
                  disabled={!chatInput.trim() || chatLoading}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Chat toggle button */}
        <button
          onClick={() => setChatOpen(o => !o)}
          className="w-14 h-14 rounded-full text-white shadow-lg flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
          style={{ backgroundColor: brandColor }}
        >
          {chatOpen ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
        </button>
      </div>
    </div>
  );
}