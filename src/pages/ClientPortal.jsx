import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { FileText, Upload, CheckCircle, Clock, Send, Loader2, MessageCircle, AlertTriangle, X, ChevronRight, ArrowLeft, LayoutDashboard, Shield, PenLine } from 'lucide-react';
import { portalSecureUpload } from '@/lib/securityUtils';
import SubmissionConfirmation from '@/components/portal/SubmissionConfirmation';
import IdVerificationField from '@/components/portal/IdVerificationField';
import SignaturePad from '@/components/portal/SignaturePad';
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
    dashboard_title: 'Document Requests',
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
    dashboard_title: 'Documentverzoeken',
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

function getBranding(tenant) {
  const primary = tenant?.branding_primary_color || '#1A6BFF';
  const secondary = tenant?.branding_secondary_color || '#E8F0FF';
  const bg = tenant?.branding_bg_color || '#F4F6FA';
  const text = tenant?.branding_text_color || '#1A2332';
  const font = tenant?.branding_font_family || 'Inter';
  const headerStyle = tenant?.branding_header_style || 'dark';
  const radiusMap = { square: '0px', rounded: '8px', pill: '9999px' };
  const radius = radiusMap[tenant?.branding_button_radius] || '8px';
  const whiteLabel = !!tenant?.white_label_enabled;
  const headerBg = headerStyle === 'light' ? '#FFFFFF' : primary;
  const headerText = headerStyle === 'light' ? text : '#FFFFFF';
  const headerBorder = headerStyle === 'light' ? '#E2E8F0' : 'transparent';
  return { primary, secondary, bg, text, font, radius, whiteLabel, headerBg, headerText, headerBorder };
}

function PortalFooter({ tenant, branding }) {
  const hasFooter = !!tenant?.portal_footer_text;
  return (
    <div className="px-6 py-5 mt-6 border-t text-xs" style={{ borderColor: branding.secondary, color: branding.text, opacity: 0.75 }}>
      {hasFooter ? (
        <div dangerouslySetInnerHTML={{ __html: tenant.portal_footer_text }} className="leading-relaxed" />
      ) : (
        <p>This is a secure, one-time link. Do not share it with others.</p>
      )}
      {tenant?.portal_contact_info && <p className="mt-1.5 opacity-70">{tenant.portal_contact_info}</p>}
    </div>
  );
}

export default function ClientPortal() {
  const { token } = useParams();
  const [lang, setLang] = useState(navigator.language?.startsWith('nl') ? 'nl' : 'en');

  const [allOutreaches, setAllOutreaches] = useState([]);
  const [tenant, setTenant] = useState(null);
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  const [view, setView] = useState('dashboard');
  const [activeOutreach, setActiveOutreach] = useState(null);

  const [itemStateMap, setItemStateMap] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submittedIds, setSubmittedIds] = useState(new Set());
  const [confirmedOutreach, setConfirmedOutreach] = useState(null);

  const [diditCallbackDone, setDiditCallbackDone] = useState(false);
  const [diditCallbackStatus, setDiditCallbackStatus] = useState('');
  const [diditCallbackParams, setDiditCallbackParams] = useState(null);
  const [diditCallbackResult, setDiditCallbackResult] = useState(null);
  const diditPollRef = useRef(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  const t = T[lang];

  useEffect(() => { if (token) loadByToken(); else setLoading(false); }, [token]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);
  useEffect(() => { setChatMessages([{ role: 'ai', text: T[lang].chat_intro }]); }, [lang]);

  // Didit step 1: capture URL params immediately on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('didit_done') !== '1') return;
    const captured = {
      sessionId:  params.get('verificationSessionId'),
      outreachId: params.get('outreach_id'),
      itemId:     params.get('item_id'),
    };
    window.history.replaceState({}, '', window.location.pathname);
    if (!captured.sessionId || !captured.outreachId || !captured.itemId) return;
    const isMob = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 900;
    if (isMob) { setDiditCallbackDone(true); setDiditCallbackStatus('checking'); }
    setDiditCallbackParams({ ...captured, isMobile: isMob });
  }, []);

  // Didit step 2: process when both params and tenant are ready
  useEffect(() => {
    if (!diditCallbackParams || !tenant?.id) return;
    const { sessionId, outreachId, itemId, isMobile } = diditCallbackParams;
    setDiditCallbackParams(null);

    if (!isMobile) {
      base44.functions.invoke('getDiditSessionResult', {
        session_id: sessionId, outreach_id: outreachId, item_id: itemId, tenant_id: tenant.id,
      }).then(res => {
        const data = res?.data || res;
        if (data?.ok || data?.idv_status) loadByToken();
      }).catch(() => {});
      return;
    }

    // Mobile: poll until Didit returns a terminal result, with a timeout fallback.
    const TERMINAL = ['Pass', 'Fail', 'Inconclusive', 'Expired'];
    const MAX_ATTEMPTS = 45; // ~3 minutes at 4s intervals
    let attempts = 0;

    const poll = async () => {
      attempts++;
      try {
        const res = await base44.functions.invoke('getDiditSessionResult', {
          session_id: sessionId, outreach_id: outreachId, item_id: itemId, tenant_id: tenant.id,
        });
        const data = res?.data || res;
        if (data?.idv_status && TERMINAL.includes(data.idv_status)) {
          clearInterval(diditPollRef.current);
          setDiditCallbackResult(data);
          setDiditCallbackStatus(data.idv_status === 'Pass' ? 'pass' : 'fail');
          return;
        }
      } catch { /* transient — keep polling */ }
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(diditPollRef.current);
        setDiditCallbackStatus('done');
      }
    };

    poll();
    diditPollRef.current = setInterval(poll, 4000);
    return () => clearInterval(diditPollRef.current);
  }, [diditCallbackParams, tenant]);

  // Apply favicon + page title when tenant loads
  useEffect(() => {
    if (!tenant) return;
    const branding = getBranding(tenant);
    if (branding.whiteLabel) document.title = `${tenant.name} — Secure Portal`;
    if (tenant.branding_favicon_url) {
      document.querySelectorAll('link[rel="icon"]').forEach(el => el.remove());
      const link = document.createElement('link');
      link.rel = 'icon'; link.href = tenant.branding_favicon_url;
      document.head.appendChild(link);
    }
  }, [tenant]);

  async function loadByToken() {
    const results = await base44.entities.OutreachRequest.filter({ access_token: token });
    const primary = results?.[0];
    if (!primary) { setExpired(true); setLoading(false); return; }
    if (primary.token_expires_at && isPast(new Date(primary.token_expires_at))) {
      setExpired(true); setLoading(false); return;
    }

    const [allReqs, tenantData, clientData] = await Promise.all([
      base44.entities.OutreachRequest.filter({ client_id: primary.client_id, tenant_id: primary.tenant_id }),
      base44.entities.Tenant.filter({ id: primary.tenant_id }),
      base44.entities.Client.filter({ id: primary.client_id }),
    ]);

    let visibleReqs = (allReqs || []).filter(r => r.status !== 'Draft');

    // Safety fallback: merge field_type/field_options from templates for items missing field_type
    try {
      const templates = await base44.entities.OutreachTemplate.filter({ tenant_id: primary.tenant_id });
      if (templates?.length > 0) {
        const tmplMap = {};
        templates.forEach(t => { tmplMap[t.id] = t; });
        visibleReqs = visibleReqs.map(req => {
          const needsPatch = (req.items || []).some(item => !item.field_type);
          if (!needsPatch) return req;
          return {
            ...req,
            items: (req.items || []).map(item => {
              if (item.field_type) return item;
              const tmpl = tmplMap[item.item_id];
              if (!tmpl) return item;
              return {
                ...item,
                field_type:                    tmpl.field_type || item.field_type,
                field_options:                 tmpl.field_options || item.field_options || [],
                validation_required:           item.validation_required ?? tmpl.validation_required,
                validation_accepted_file_types: tmpl.validation_accepted_file_types || [],
                validation_max_file_size_mb:   tmpl.validation_max_file_size_mb,
                validation_min_length:         tmpl.validation_min_length,
                validation_max_length:         tmpl.validation_max_length,
                condition_depends_on_item_id:  tmpl.condition_depends_on_item_id,
                condition_equals_value:        tmpl.condition_equals_value,
                section_title:                 tmpl.section_title,
              };
            }),
          };
        });
      }
    } catch { /* non-fatal */ }

    setAllOutreaches(visibleReqs);
    setTenant(tenantData?.[0] || null);
    setClient(clientData?.[0] || null);

    const map = {};
    visibleReqs.forEach(req => {
      map[req.id] = {};
      (req.items || []).forEach(item => {
        map[req.id][item.item_id] = {
          text: item.response_text || '',
          fileUrl: item.file_url || '',
          uploading: false,
          done: item.status === 'Received' || item.status === 'Verified',
          selected: [],
          idvResult: (item.idv_status && item.idv_status !== 'Pending') ? {
            idv_status: item.idv_status,
            idv_similarity_score: item.idv_similarity_score,
            idv_confidence: item.idv_confidence,
            idv_failure_reason: item.idv_failure_reason,
            idv_liveness_passed: item.idv_liveness_passed,
            idv_liveness_score: item.idv_liveness_score,
          } : null,
        };
      });
    });
    setItemStateMap(map);

    await Promise.all([
      base44.entities.AuditEvent.create({
        tenant_id: primary.tenant_id, case_id: primary.case_id || null,
        client_id: primary.client_id, actor_type: 'System', actor_name: 'Client Portal',
        event_type: 'portal_viewed', notes: 'Client portal accessed via token',
      }),
      base44.entities.OutreachRequest.update(primary.id, {
        status: primary.status === 'Sent' ? 'Viewed' : primary.status,
      }),
    ]);

    if (visibleReqs.length === 1) { setActiveOutreach(visibleReqs[0]); setView('request'); }
    else { setActiveOutreach(primary); setView('dashboard'); }
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

  function setItemSelected(outreachId, itemId, selected) {
    setItemStateMap(s => ({ ...s, [outreachId]: { ...s[outreachId], [itemId]: { ...s[outreachId]?.[itemId], selected } } }));
  }

  function getItemStates(outreachId) { return itemStateMap[outreachId] || {}; }

  function isItemCompleted(item, s) {
    if (!s) return false;
    if (s.done) return true;
    const ft = item.field_type || (item.item_type === 'document' ? 'file_upload' : 'textarea');
    if (ft === 'file_upload') return !!s.fileUrl;
    if (ft === 'section_header') return true;
    if (ft === 'multi_select') return (s.selected || []).length > 0;
    if (ft === 'checkbox') return s.text === 'true';
    if (ft === 'yes_no') return s.text === 'yes' || s.text === 'no';
    if (ft === 'signature') return !!s.fileUrl;
    return !!s.text?.trim();
  }

  function completedCount(outreach) {
    const states = getItemStates(outreach.id);
    return (outreach?.items || []).filter(item => {
      if (item.field_type === 'section_header') return false;
      return isItemCompleted(item, states[item.item_id]);
    }).length;
  }

  function totalCountable(outreach) {
    return (outreach?.items || []).filter(i => i.field_type !== 'section_header').length;
  }

  function isFieldVisible(item, states) {
    if (!item.condition_depends_on_item_id) return true;
    const depState = states[item.condition_depends_on_item_id] || {};
    return (depState.text || '') === item.condition_equals_value;
  }

  const [validationErrors, setValidationErrors] = useState({});

  async function handleSubmit(outreach) {
    const states = getItemStates(outreach.id);
    const errors = {};
    (outreach.items || []).forEach(item => {
      if (item.field_type === 'section_header') return;
      if (!item.validation_required && !item.is_mandatory) return;
      if (!isFieldVisible(item, states)) return;
      if (!isItemCompleted(item, states[item.item_id])) errors[item.item_id] = 'This field is required.';
    });
    if (Object.keys(errors).length > 0) { setValidationErrors(errors); return; }
    setValidationErrors({});
    setSubmitting(true);

    const freshOutreachList = await base44.entities.OutreachRequest.filter({ id: outreach.id });
    const freshOutreach = freshOutreachList?.[0] || outreach;

    const mergedItems = (freshOutreach.items || []).map(item => {
      const s = states[item.item_id] || {};
      const ft = inferFieldType(item);

      if (ft === 'id_verification') {
        if (item.idv_status && item.idv_status !== 'Pending') return item;
        let idvFields = {};
        try { idvFields = JSON.parse(s.text || '{}'); } catch {}
        if (!idvFields.idv_status) return item;
        return {
          ...item,
          response_text:              s.text || '',
          file_url:                   s.fileUrl || item.file_url || '',
          status: (idvFields.idv_status === 'Pass' || idvFields.idv_status === 'Inconclusive') ? 'Received' : 'Requested',
          didit_session_id:           idvFields.didit_session_id           || item.didit_session_id,
          didit_session_status:       idvFields.didit_session_status       || item.didit_session_status,
          idv_status:                 idvFields.idv_status,
          idv_similarity_score:       idvFields.idv_similarity_score       ?? item.idv_similarity_score,
          idv_liveness_passed:        idvFields.idv_liveness_passed        ?? item.idv_liveness_passed,
          idv_liveness_score:         idvFields.idv_liveness_score         ?? item.idv_liveness_score,
          idv_document_type:          idvFields.idv_document_type          || item.idv_document_type,
          idv_document_number:        idvFields.idv_document_number        || item.idv_document_number,
          idv_document_expiry:        idvFields.idv_document_expiry        || item.idv_document_expiry,
          idv_extracted_first_name:   idvFields.idv_extracted_first_name   || item.idv_extracted_first_name,
          idv_extracted_last_name:    idvFields.idv_extracted_last_name    || item.idv_extracted_last_name,
          idv_extracted_dob:          idvFields.idv_extracted_dob          || item.idv_extracted_dob,
          idv_extracted_nationality:  idvFields.idv_extracted_nationality  || item.idv_extracted_nationality,
          idv_issuing_country:        idvFields.idv_issuing_country        || item.idv_issuing_country,
          idv_failure_reason:         idvFields.idv_failure_reason         || item.idv_failure_reason,
          idv_aml_hits:               idvFields.idv_aml_hits               ?? item.idv_aml_hits,
          idv_aml_status:             idvFields.idv_aml_status             || item.idv_aml_status,
          idv_checked_at:             idvFields.idv_checked_at             || item.idv_checked_at,
          idv_provider:               idvFields.idv_provider               || item.idv_provider,
        };
      }

      let responseText = s.text || item.response_text || '';
      if (ft === 'multi_select' || ft === 'checkbox') responseText = (s.selected || []).join(', ');
      const isDone = isItemCompleted(item, s) || ft === 'section_header';
      return {
        ...item,
        response_text: responseText,
        file_url: s.fileUrl || item.file_url || '',
        status: isDone ? 'Received' : (item.status || 'Requested'),
      };
    });

    const countable = mergedItems.filter(i => inferFieldType(i) !== 'section_header');
    const allDone = countable.every(i => i.status === 'Received' || i.status === 'Verified');
    const newStatus = allDone ? 'Complete' : 'Partial_Response';
    const submittedCount = countable.filter(i => i.status === 'Received').length;

    await base44.entities.OutreachRequest.update(outreach.id, { items: mergedItems, status: newStatus });
    const updatedItems = mergedItems;

    for (const item of updatedItems) {
      const ft = item.field_type || (item.item_type === 'document' ? 'file_upload' : 'textarea');
      if (ft !== 'file_upload' || !item.file_url || item.file_url.startsWith('data:')) continue;
      if (item.field_type === 'id_verification') continue;
      const lbl = (item.label || '').toLowerCase();
      const docType =
        lbl.includes('passport')   ? 'Passport' :
        lbl.includes('id card') || lbl.includes('identity') || lbl.includes('id ') ? 'ID_Card' :
        lbl.includes('salary') || lbl.includes('payslip') ? 'Salary_Slip' :
        lbl.includes('tax')        ? 'Tax_Return' :
        lbl.includes('financial') || lbl.includes('statement') ? 'Financial_Statement' : 'Other';
      base44.entities.Document.create({
        tenant_id: outreach.tenant_id, client_id: outreach.client_id,
        case_id: outreach.case_id || null, doc_type: docType,
        file_name: item.label || 'Portal_Upload', file_url: item.file_url,
        version: 1, is_ai_generated: false, review_status: 'Pending_Review',
      }).catch(() => {});
    }

    await base44.entities.AuditEvent.create({
      tenant_id: outreach.tenant_id, case_id: outreach.case_id || null,
      client_id: outreach.client_id, actor_type: 'System', actor_name: 'Client Portal',
      event_type: 'portal_submitted',
      notes: `Client submitted: ${newStatus}. ${submittedCount}/${countable.length} items.${!outreach.case_id ? ' (Standalone outreach)' : ''}`,
    });

    if (client?.primary_contact_email) {
      const submittedItems = updatedItems.filter(i => i.status === 'Received' || i.status === 'Verified').map(i => `• ${i.label}`).join('\n');
      const emailBody = allDone
        ? `Dear ${client.full_name},\n\nYour submission has been successfully received by ${tenant?.name}.\n\nSubmitted items:\n${submittedItems}\n\nReference: ${outreach.id.substring(0, 8).toUpperCase()}\n\nOur compliance team will review your submission shortly.\n\nBest regards,\n${tenant?.name}`
        : `Dear ${client.full_name},\n\nThank you for your submission. We have received ${submittedCount} of ${countable.length} requested items.\n\nReceived:\n${submittedItems}\n\nPlease complete the remaining items by ${outreach.deadline ? format(parseISO(outreach.deadline), 'd MMMM yyyy') : 'the deadline'}.\n\nReference: ${outreach.id.substring(0, 8).toUpperCase()}\n\nBest regards,\n${tenant?.name}`;
      await base44.integrations.Core.SendEmail({
        to: client.primary_contact_email,
        subject: allDone ? 'Document Submission Confirmed' : 'Partial Submission Received',
        body: emailBody,
        from_name: tenant?.email_from_name || tenant?.name || 'Compliance Team',
      });
    }

    try {
      const clientUpdates = {};
      for (const item of updatedItems) {
        if (!item.response_text || !['Received', 'Verified'].includes(item.status)) continue;
        const lbl = (item.label || '').toLowerCase();
        const val = item.response_text.trim();
        if (!val) continue;
        if ((lbl.includes('email') || lbl.includes('e-mail')) && !client?.primary_contact_email) clientUpdates.primary_contact_email = val;
        if ((lbl.includes('phone') || lbl.includes('mobile') || lbl.includes('tel')) && !client?.primary_contact_phone) clientUpdates.primary_contact_phone = val;
        if ((lbl.includes('country of residence') || lbl.includes('residence country') || lbl.includes('country_of_residence')) && !client?.country_of_residence) clientUpdates.country_of_residence = val;
      }
      if (Object.keys(clientUpdates).length > 0 && outreach.client_id) {
        await base44.entities.Client.update(outreach.client_id, clientUpdates);
        setClient(prev => prev ? { ...prev, ...clientUpdates } : prev);
      }
    } catch {}

    setAllOutreaches(prev => prev.map(r => r.id === outreach.id ? { ...r, status: newStatus, items: updatedItems } : r));
    setSubmittedIds(s => new Set([...s, outreach.id]));
    setConfirmedOutreach({ ...outreach, items: updatedItems, status: newStatus });
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

  function inferFieldType(item) {
    if (item.field_type) return item.field_type;
    if (item.item_type === 'document') return 'file_upload';
    const lbl = (item.label || '').toLowerCase();
    if (lbl.includes('date') || lbl.includes('birth') || lbl.includes('expiry') || lbl.includes('incorporated') || lbl.includes('issued')) return 'date';
    if (lbl.includes('email')) return 'text';
    if (lbl.includes('id&v') || lbl.includes('identity verif') || lbl.includes('idv') || lbl.includes('passport') || lbl.includes('id verification')) return 'id_verification';
    if (lbl.includes('upload') || lbl.includes('document') || lbl.includes('certificate') || lbl.includes('statement') || lbl.includes('accounts') || lbl.includes('register') || lbl.includes('licence') || lbl.includes('permit')) return 'file_upload';
    return 'textarea';
  }

  // ── Didit mobile callback screen ──
  if (diditCallbackDone) {
    const passed = diditCallbackStatus === 'pass';
    const checking = diditCallbackStatus === 'checking';
    const failed = diditCallbackStatus === 'fail';
    const isInconclusive = diditCallbackResult?.idv_status === 'Inconclusive';
    return (
      <div style={{ minHeight: '100vh', background: '#F4F6FA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '40px 32px', textAlign: 'center', maxWidth: '360px', width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          {checking ? (
            <><div style={{ fontSize: '48px', marginBottom: '16px' }}>🔄</div><div style={{ fontWeight: 700, fontSize: '18px', color: '#1A2332', marginBottom: '8px' }}>Confirming verification…</div><div style={{ fontSize: '14px', color: '#64748B', lineHeight: 1.5 }}>Just a moment while we confirm your result.</div></>
          ) : passed ? (
            <><div style={{ fontSize: '56px', marginBottom: '16px' }}>✅</div><div style={{ fontWeight: 700, fontSize: '20px', color: '#059669', marginBottom: '10px' }}>Identity Verified!</div><div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.6, marginBottom: '24px' }}>Your identity has been successfully verified.</div><div style={{ background: '#F0FDF4', border: '1px solid #10B981', borderRadius: '12px', padding: '16px', display: 'flex', alignItems: 'flex-start', gap: '12px', textAlign: 'left' }}><span style={{ fontSize: '24px', flexShrink: 0 }}>💻</span><div><div style={{ fontWeight: 600, fontSize: '14px', color: '#065F46', marginBottom: '4px' }}>Continue on your laptop</div><div style={{ fontSize: '13px', color: '#047857', lineHeight: 1.5 }}>Return to your laptop or desktop — it has already updated with your verification result. You can close this tab.</div></div></div></>
          ) : failed ? (
            <>
              <div style={{ fontSize: '56px', marginBottom: '16px' }}>{isInconclusive ? '🪪' : '❌'}</div>
              <div style={{ fontWeight: 700, fontSize: '18px', color: isInconclusive ? '#92400E' : '#DC2626', marginBottom: '10px' }}>
                {isInconclusive ? 'Verification Under Review' : 'Verification Unsuccessful'}
              </div>
              <div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.6, marginBottom: '24px' }}>
                {diditCallbackResult?.idv_failure_reason || (diditCallbackResult?.idv_similarity_score != null ? `${diditCallbackResult.idv_similarity_score}% face match.` : 'The verification could not be confirmed.')}
              </div>
              <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: '12px', padding: '16px', display: 'flex', alignItems: 'flex-start', gap: '12px', textAlign: 'left' }}>
                <span style={{ fontSize: '24px', flexShrink: 0 }}>💻</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#92400E', marginBottom: '4px' }}>Return to your laptop</div>
                  <div style={{ fontSize: '13px', color: '#78350F', lineHeight: 1.5 }}>Please return to your laptop or desktop to see your result and continue your application. You can close this tab.</div>
                </div>
              </div>
            </>
          ) : (
            <><div style={{ fontSize: '56px', marginBottom: '16px' }}>🪪</div><div style={{ fontWeight: 700, fontSize: '18px', color: '#92400E', marginBottom: '10px' }}>Verification Complete</div><div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.6, marginBottom: '24px' }}>Thank you for completing the verification step.</div><div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: '12px', padding: '16px', display: 'flex', alignItems: 'flex-start', gap: '12px', textAlign: 'left' }}><span style={{ fontSize: '24px', flexShrink: 0 }}>💻</span><div><div style={{ fontWeight: 600, fontSize: '14px', color: '#92400E', marginBottom: '4px' }}>Return to your laptop</div><div style={{ fontSize: '13px', color: '#78350F', lineHeight: 1.5 }}>Please return to your laptop or desktop to see your result and continue your application. You can close this tab.</div></div></div></>
          )}
          <div style={{ marginTop: '24px', fontSize: '11px', color: '#9CA3AF' }}>Powered by Didit · Secure identity verification</div>
        </div>
      </div>
    );
  }

  const branding = getBranding(tenant);
  const tenantName = tenant?.name || 'Your Financial Institution';
  const logoUrl = tenant?.branding_logo_url;
  const contactInfo = tenant?.portal_contact_info || tenantName;
  const errorMsg = branding.whiteLabel ? `Please contact ${contactInfo} for assistance.` : 'If you think this is an error, please contact your relationship manager.';
  const portalTitle = branding.whiteLabel ? (tenant?.portal_welcome_title || `${tenantName} — Document Request`) : `${tenantName} — Document Request`;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: branding.bg }}>
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: branding.primary }} />
    </div>
  );

  if (expired || !token) return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: branding.bg, fontFamily: branding.font }}>
      <div className="text-center max-w-sm">
        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2" style={{ color: branding.text }}>{t.expired}</h2>
        <p className="text-sm opacity-60" style={{ color: branding.text }}>{errorMsg}</p>
      </div>
    </div>
  );

  const totalItems = allOutreaches.reduce((acc, r) => acc + (r.items?.length || 0), 0);
  const doneItems  = allOutreaches.reduce((acc, r) => acc + completedCount(r), 0);
  const allComplete = allOutreaches.every(r => r.status === 'Complete' || submittedIds.has(r.id));
  const anyOverdue  = allOutreaches.some(r => r.deadline && isPast(parseISO(r.deadline)) && r.status !== 'Complete');

  // ── Shared Header ──
  const Header = () => (
    <div className="sticky top-0 z-20 shadow-sm" style={{ backgroundColor: branding.headerBg, borderBottom: `1px solid ${branding.headerBorder}` }}>
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={tenantName} className="h-8 w-auto object-contain" />
          ) : (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: branding.primary }}>
              {tenantName.charAt(0)}
            </div>
          )}
          <span className="font-semibold text-sm" style={{ color: branding.headerText }}>{portalTitle}</span>
        </div>
        <div className="flex items-center gap-2">
          {allOutreaches.length > 1 && view !== 'dashboard' && (
            <button onClick={() => setView('dashboard')}
              className="text-xs font-medium flex items-center gap-1 rounded-md px-2 py-1 transition-colors"
              style={{ color: branding.headerText, border: `1px solid ${branding.headerText}30`, opacity: 0.8 }}>
              <ArrowLeft className="w-3 h-3" /> {t.back_to_dashboard}
            </button>
          )}
          <button onClick={() => setLang(l => l === 'en' ? 'nl' : 'en')}
            className="text-xs font-medium rounded-md px-2 py-1 transition-colors"
            style={{ color: branding.headerText, border: `1px solid ${branding.headerText}30`, opacity: 0.8 }}>
            {t.lang}
          </button>
        </div>
      </div>
      {allOutreaches.length > 1 && (
        <div className="max-w-5xl mx-auto px-6 pb-2 flex items-center gap-1">
          <button onClick={() => setView('dashboard')}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: view === 'dashboard' ? `${branding.headerText}20` : 'transparent', color: branding.headerText }}>
            <LayoutDashboard className="w-3.5 h-3.5" /> {t.all_requests}
          </button>
          <button onClick={() => setView('compliance')}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: view === 'compliance' ? `${branding.headerText}20` : 'transparent', color: branding.headerText }}>
            <Shield className="w-3.5 h-3.5" /> {t.compliance_status}
          </button>
        </div>
      )}
    </div>
  );

  // ── Dashboard View ──
  if (view === 'dashboard' && allOutreaches.length > 1) {
    const welcomeTitle = tenant?.portal_welcome_title || t.dashboard_title;
    const welcomeBody = tenant?.portal_welcome_body || t.dashboard_sub;
    return (
      <div className="min-h-screen pb-8" style={{ backgroundColor: branding.bg, fontFamily: branding.font, color: branding.text }}>
        <Header />
        <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">
          <div>
            <h1 className="text-lg font-bold">{welcomeTitle}</h1>
            <p className="text-sm opacity-60 mt-0.5" style={{ whiteSpace: 'pre-line' }}>{welcomeBody}</p>
          </div>
          <div className="bg-white rounded-2xl border p-4 shadow-sm" style={{ borderColor: branding.secondary }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium opacity-70">{t.progress}</span>
              <span className="text-sm font-bold" style={{ color: branding.primary }}>{totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0}%</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: branding.secondary }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0}%`, backgroundColor: branding.primary }} />
            </div>
            <div className="text-xs opacity-50 mt-1.5">{doneItems} of {totalItems} items completed across {allOutreaches.length} {allOutreaches.length === 1 ? t.requests_count : t.requests_count_pl}</div>
          </div>
          <div className="space-y-3">
            {allOutreaches.map(req => {
              const cfg = statusConfig(req);
              const done = completedCount(req);
              const total = req.items?.length || 0;
              const isOver = req.deadline && isPast(parseISO(req.deadline)) && req.status !== 'Complete';
              return (
                <button key={req.id} onClick={() => { setActiveOutreach(req); setView('request'); }}
                  className="w-full text-left bg-white rounded-2xl border p-4 shadow-sm hover:shadow-md transition-all"
                  style={{ borderColor: branding.secondary }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border', cfg.color)}>{cfg.label}</span>
                        {isOver && <span className="text-xs text-red-600 font-medium">Overdue</span>}
                      </div>
                      {req.message && <p className="text-sm font-medium truncate opacity-80">{req.message.substring(0, 80)}{req.message.length > 80 ? '…' : ''}</p>}
                      <div className="text-xs opacity-50 mt-1">{done}/{total} items · {req.deadline ? `Due ${format(parseISO(req.deadline), 'd MMM yyyy')}` : 'No deadline'}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 opacity-40 flex-shrink-0 mt-1" />
                  </div>
                  {total > 0 && (
                    <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: branding.secondary }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.round((done / total) * 100)}%`, backgroundColor: branding.primary }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <PortalFooter tenant={tenant} branding={branding} />
      </div>
    );
  }

  // ── Compliance View ──
  if (view === 'compliance') {
    const pendingReqs  = allOutreaches.filter(r => ['Sent','Viewed'].includes(r.status));
    const partialReqs  = allOutreaches.filter(r => r.status === 'Partial_Response');
    const completeReqs = allOutreaches.filter(r => r.status === 'Complete' || submittedIds.has(r.id));
    return (
      <div className="min-h-screen pb-8" style={{ backgroundColor: branding.bg, fontFamily: branding.font, color: branding.text }}>
        <Header />
        <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">
          <h1 className="text-lg font-bold">{t.compliance_title}</h1>
          <div className={cn('rounded-2xl border p-4 flex items-center gap-3', allComplete ? 'bg-emerald-50 border-emerald-200' : anyOverdue ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200')}>
            {allComplete ? <CheckCircle className="w-8 h-8 text-emerald-500 flex-shrink-0" /> : anyOverdue ? <AlertTriangle className="w-8 h-8 text-red-500 flex-shrink-0" /> : <Clock className="w-8 h-8 text-amber-500 flex-shrink-0" />}
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
              <div className="text-xs font-semibold opacity-50 uppercase tracking-wide mb-2">{group.label}</div>
              <div className="space-y-2">
                {group.items.map(req => (
                  <button key={req.id} onClick={() => { setActiveOutreach(req); setView('request'); }}
                    className="w-full text-left bg-white rounded-xl border px-4 py-3 flex items-center justify-between hover:shadow-sm transition-all"
                    style={{ borderColor: branding.secondary }}>
                    <div>
                      <div className="text-sm font-medium truncate max-w-xs">{req.message?.substring(0, 60) || 'Information Request'}</div>
                      <div className="text-xs opacity-50">{completedCount(req)}/{req.items?.length || 0} items</div>
                    </div>
                    <ChevronRight className="w-4 h-4 opacity-40" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <PortalFooter tenant={tenant} branding={branding} />
      </div>
    );
  }

  // ── Single Request View ──
  const outreach = activeOutreach;
  if (!outreach) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: branding.bg }}>
      <div className="text-center text-sm opacity-50" style={{ color: branding.text }}>{t.no_requests}</div>
    </div>
  );

  const isSubmitted = submittedIds.has(outreach.id) || outreach.status === 'Complete';
  const states = getItemStates(outreach.id);
  const _total = totalCountable(outreach);
  const progress = _total > 0 ? Math.round((completedCount(outreach) / _total) * 100) : 0;
  const isOverdue = outreach.deadline && isPast(parseISO(outreach.deadline));

  // Welcome text — use portal_welcome_body (tenant config), NOT outreach.message
  const welcomeHeading = `${t.welcome} ${client?.full_name || ''},`;
  const welcomeSub = tenant?.portal_welcome_body || null;

  if (confirmedOutreach) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: branding.bg, fontFamily: branding.font }}>
        <Header />
        <SubmissionConfirmation
          outreach={confirmedOutreach} client={client} tenantName={tenantName}
          brandColor={branding.primary} lang={lang}
          onBackToDashboard={allOutreaches.length > 1 ? () => { setConfirmedOutreach(null); setView('dashboard'); } : null}
        />
        <PortalFooter tenant={tenant} branding={branding} />
      </div>
    );
  }

  if (isSubmitted) return (
    <div className="min-h-screen pb-8" style={{ backgroundColor: branding.bg, fontFamily: branding.font, color: branding.text }}>
      <Header />
      <div className="max-w-lg mx-auto px-4 pt-16 flex flex-col items-center text-center">
        <CheckCircle className="w-14 h-14 text-emerald-500 mb-4" />
        <h2 className="text-lg font-semibold mb-2">{t.completed}</h2>
        <p className="text-sm opacity-50">You may close this window.</p>
        {allOutreaches.length > 1 && (
          <Button variant="outline" className="mt-6" style={{ borderRadius: branding.radius }} onClick={() => setView('dashboard')}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> {t.back_to_dashboard}
          </Button>
        )}
      </div>
      <PortalFooter tenant={tenant} branding={branding} />
    </div>
  );

  // ── Two-column request layout ──
  return (
    <div style={{ backgroundColor: branding.bg, fontFamily: branding.font, color: branding.text, minHeight: '100vh' }}>
      <style>{`
        @keyframes portalRise { from { opacity:0; transform:translateY(18px) } to { opacity:1; transform:none } }
        @keyframes portalCard { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:none } }
        @keyframes portalFill { from { transform:scaleX(0) } to { transform:scaleX(1) } }
        @keyframes portalDrift { from { transform:translate3d(0,0,0) } to { transform:translate3d(-35px,28px,0) } }
        .portal-layout { display:grid; grid-template-columns:315px 1fr; min-height:calc(100vh - 56px); position:relative; isolation:isolate; overflow:hidden; }
        .portal-layout:before { content:""; position:absolute; inset:0; background:radial-gradient(circle at 84% 8%,rgba(226,245,235,.9),transparent 29%),linear-gradient(135deg,#edf5f3 0%,#f5f8f6 48%,#e6f0ed 100%); z-index:-2; pointer-events:none; }
        .portal-layout:after { content:""; position:absolute; width:520px; height:520px; right:-185px; top:420px; border-radius:50%; background:rgba(180,224,207,.28); filter:blur(2px); z-index:-1; animation:portalDrift 12s ease-in-out infinite alternate; pointer-events:none; }
        .portal-sidebar { padding:42px 24px 38px; background:rgba(21,67,62,.96); color:#f5fbf8; display:flex; flex-direction:column; gap:24px; box-shadow:14px 0 38px rgba(28,66,60,.12); animation:portalRise .7s cubic-bezier(.2,.8,.2,1) both; }
        .portal-brandmark { width:43px; height:43px; border-radius:14px; background:#d8f2df; color:#164f46; display:grid; place-items:center; box-shadow:0 8px 18px rgba(0,0,0,.13); flex-shrink:0; overflow:hidden; }
        .portal-welcome-text h1 { font-size:30px; line-height:1.08; letter-spacing:-.8px; margin:0 0 14px; font-weight:700; color:#f5fbf8; }
        .portal-welcome-text p { font-size:15px; line-height:1.65; color:#c7ddd5; margin:0; white-space:pre-line; }
        .portal-glass { border:1px solid rgba(213,243,226,.2); background:rgba(255,255,255,.085); border-radius:17px; padding:17px; backdrop-filter:blur(12px); box-shadow:inset 0 1px rgba(255,255,255,.08); }
        .portal-deadline-card { display:flex; gap:12px; align-items:flex-start; color:#f0f8f3; font-size:14px; font-weight:600; line-height:1.45; }
        .portal-progress-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; color:#c8ded6; font-size:13px; font-weight:600; }
        .portal-progress-head strong { color:#d8f2df; font-size:17px; }
        .portal-track { height:9px; border-radius:99px; background:rgba(255,255,255,.15); overflow:hidden; }
        .portal-fill { height:100%; border-radius:99px; background:linear-gradient(90deg,#9be0b2,#d8f2df); box-shadow:0 0 14px rgba(155,224,178,.5); animation:portalFill .9s .45s ease-out both; transform-origin:left; }
        .portal-count { font-size:12px; color:#a9c7bb; margin-top:10px; }
        .portal-main { padding:48px 54px 64px; display:flex; flex-direction:column; gap:28px; animation:portalRise .8s .12s cubic-bezier(.2,.8,.2,1) both; overflow-y:auto; }
        .portal-mainhead { display:flex; justify-content:space-between; align-items:flex-end; padding:0 2px 8px; border-bottom:1px solid rgba(21,67,62,.13); }
        .portal-mainhead h2 { font-size:27px; line-height:1.15; margin:0; color:#193e3a; letter-spacing:-.5px; }
        .portal-mainhead span { font-size:12px; color:#6d8780; letter-spacing:.08em; text-transform:uppercase; }
        .portal-item-grid { display:grid; grid-template-columns:1fr 1fr; gap:17px; }
        .portal-item-card { box-sizing:border-box; background:rgba(255,255,255,.72); border:1px solid rgba(38,105,88,.16); border-radius:21px; padding:22px; display:flex; flex-direction:column; gap:10px; box-shadow:0 13px 30px rgba(30,75,66,.07),inset 0 1px rgba(255,255,255,.85); backdrop-filter:blur(15px); animation:portalCard .65s cubic-bezier(.2,.8,.2,1) both; }
        .portal-item-card:nth-child(2){animation-delay:.12s}
        .portal-item-card:nth-child(3){animation-delay:.24s}
        .portal-item-card:nth-child(4){animation-delay:.36s}
        .portal-item-card:nth-child(5){animation-delay:.48s}
        .portal-item-card:nth-child(6){animation-delay:.6s}
        .portal-item-done-card { border-color:rgba(16,185,129,.3) !important; background:rgba(240,253,244,.8) !important; }
        .portal-item-error-card { border-color:rgba(239,68,68,.4) !important; }
        .portal-item-top { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
        .portal-item-title { margin:0; color:#214840; font-size:15px; line-height:1.35; font-weight:650; }
        .portal-check-icon { width:27px; height:27px; border-radius:50%; display:grid; place-items:center; background:#d8f2df; color:#287150; flex-shrink:0; }
        .portal-submit-bar { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:24px 25px; background:rgba(218,241,226,.74); border:1px solid rgba(44,117,91,.2); border-radius:22px; box-shadow:0 15px 35px rgba(36,91,70,.08); backdrop-filter:blur(14px); }
        .portal-submit-bar p { margin:0; color:#315f53; font-size:14px; line-height:1.5; }
        .portal-submit-btn { border:0; border-radius:13px; background:#27775c; color:#fff; padding:14px 22px; font:600 14px Inter,system-ui; cursor:pointer; box-shadow:0 8px 18px rgba(39,119,92,.22); transition:background .2s,box-shadow .2s,transform .2s; white-space:nowrap; display:flex; align-items:center; gap:8px; }
        .portal-submit-btn:hover { background:#1d624b; box-shadow:0 10px 22px rgba(39,119,92,.3); }
        .portal-submit-btn:active { transform:translateY(1px); box-shadow:0 4px 10px rgba(39,119,92,.2); }
        .portal-submit-btn:focus-visible { outline:3px solid #a8dfb9; outline-offset:3px; }
        .portal-submit-btn:disabled { opacity:.5; cursor:not-allowed; }
        @media(max-width:700px) {
          .portal-layout { display:block; }
          .portal-sidebar { padding:28px 20px; }
          .portal-main { padding:28px 20px 40px; }
          .portal-item-grid { grid-template-columns:1fr; }
          .portal-mainhead { flex-direction:column; align-items:flex-start; gap:10px; }
        }
      `}</style>

      <Header />

      <div className="portal-layout">
        {/* ── Left Sidebar ── */}
        <aside className="portal-sidebar">
          {/* Brand mark */}
          <div className="portal-brandmark">
            {logoUrl
              ? <img src={logoUrl} alt={tenantName} style={{ height: '32px', width: 'auto', objectFit: 'contain' }} />
              : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 25, height: 25 }}>
                  <path d="M12 20c4.5-2.4 7-6.2 7-10.7V5.8L12 3 5 5.8v3.5C5 13.8 7.5 17.6 12 20Z" />
                  <path d="m8.5 11.8 2.2 2.2 4.8-5" />
                </svg>
              )}
          </div>

          {/* Welcome text — only portal_welcome_body, no email message */}
          <div className="portal-welcome-text" style={{ paddingTop: '6px' }}>
            <h1>{welcomeHeading}</h1>
            {welcomeSub && <p>{welcomeSub}</p>}
          </div>

          {/* Deadline */}
          <div className="portal-glass portal-deadline-card">
            {isOverdue
              ? <AlertTriangle style={{ width: 19, height: 19, flexShrink: 0, marginTop: 1, color: '#f87171' }} />
              : <Clock style={{ width: 19, height: 19, flexShrink: 0, marginTop: 1, color: '#f4c878' }} />}
            <span>{isOverdue ? t.overdue : `${t.deadline} ${outreach.deadline ? format(parseISO(outreach.deadline), 'd MMMM yyyy') : '—'}`}</span>
          </div>

          {/* Progress */}
          <div className="portal-glass" style={{ marginTop: 'auto' }}>
            <div className="portal-progress-head">
              <span>{t.progress}</span>
              <strong>{progress}%</strong>
            </div>
            <div className="portal-track">
              <div className="portal-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="portal-count">{completedCount(outreach)} of {_total} items completed</div>
          </div>
        </aside>

        {/* ── Right Main ── */}
        <main className="portal-main">
          <div className="portal-mainhead">
            <h2>{t.dashboard_title}</h2>
            {outreach.deadline && <span>{format(parseISO(outreach.deadline), 'd MMM yyyy')}</span>}
          </div>

          {/* Item grid */}
          <div className="portal-item-grid">
            {[...(outreach.items || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((item, idx) => {
              const s = states[item.item_id] || {};
              const ft = inferFieldType(item);

              if (!isFieldVisible(item, states)) return null;

              // Section header — full-width divider
              if (ft === 'section_header') {
                return (
                  <div key={item.item_id} style={{ gridColumn: '1 / -1', paddingTop: 8, paddingBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, height: 1, background: 'rgba(21,67,62,.13)' }} />
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#6d8780' }}>
                        {item.section_title || item.label}
                      </span>
                      <div style={{ flex: 1, height: 1, background: 'rgba(21,67,62,.13)' }} />
                    </div>
                  </div>
                );
              }

              const isDone = isItemCompleted(item, s);
              const hasError = !!validationErrors[item.item_id];

              return (
                <article
                  key={item.item_id}
                  className={cn(
                    'portal-item-card',
                    isDone && 'portal-item-done-card',
                    hasError && !isDone && 'portal-item-error-card'
                  )}
                  style={{ animationDelay: `${idx * 0.08}s` }}
                >
                  {/* Card header */}
                  <div className="portal-item-top">
                    <h3 className="portal-item-title">
                      {item.label}
                      {item.validation_required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
                    </h3>
                    {isDone && (
                      <div className="portal-check-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ width: 15, height: 15 }}>
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {item.description && (
                    <p style={{ margin: 0, fontSize: 12, color: '#78918a', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: item.description }} />
                  )}

                  {/* IDV result confirmation — stays visible even after completion */}
                  {ft === 'id_verification' && s.done && s.idvResult && (
                    s.idvResult.idv_status === 'Pass' ? (
                      <div style={{ marginTop: 4, padding: '10px 12px', borderRadius: 10, background: '#F0FDF4', border: '1px solid #10B981', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                        ✅ Identity verification passed — {s.idvResult.idv_similarity_score}% face match
                      </div>
                    ) : s.idvResult.idv_status === 'Inconclusive' ? (
                      <>
                        <style>{`
                          @keyframes idv-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
                          @keyframes idv-icon-in { from { opacity: 0; transform: scale(.7) rotate(-12deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
                          .idv-box { box-sizing: border-box; display: inline-flex; align-items: center; gap: 10px; margin-top: 4px; padding: 11px 14px; border: 1px solid #3B82F6; border-radius: 10px; background: #EFF6FF; box-shadow: 0 3px 10px rgba(59,130,246,.1); font-size: 13px; line-height: 1.45; font-weight: 500; letter-spacing: .005em; color: #17335f; animation: idv-in .32s cubic-bezier(.2,.8,.2,1) both; }
                          .idv-box:hover { background: #E5F0FF; border-color: #2563EB; box-shadow: 0 5px 14px rgba(59,130,246,.16); }
                          .idv-box:active { background: #DBEAFE; box-shadow: 0 2px 6px rgba(59,130,246,.12); }
                          .idv-box:focus-visible { outline: 3px solid rgba(59,130,246,.28); outline-offset: 2px; }
                          .idv-box .idv-icon, .idv-box .idv-check { transition: background-color .18s ease, color .18s ease, box-shadow .18s ease, transform .18s ease; }
                          .idv-box .idv-icon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 22px; width: 22px; height: 22px; border-radius: 50%; background: #DBEAFE; color: #2563EB; font-size: 14px; line-height: 1; transform: translateZ(0); animation: idv-icon-in .45s ease-out .12s both; }
                          .idv-box .idv-check { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 19px; width: 19px; height: 19px; border-radius: 50%; background: #16A34A; color: #fff; font-size: 12px; font-weight: 700; line-height: 1; box-shadow: 0 1px 3px rgba(22,163,74,.25); }
                          .idv-box:hover .idv-icon { transform: rotate(-8deg); }
                          .idv-box:hover .idv-check { box-shadow: 0 2px 6px rgba(22,163,74,.35); }
                        `}</style>
                        <div className="idv-box" tabIndex={0}>
                          <span className="idv-check" aria-hidden="true">✓</span>
                          <span className="idv-icon" aria-hidden="true">⌕</span>
                          <span>Identity verification is being reviewed — {s.idvResult.idv_similarity_score}% face match. We'll confirm your result shortly.</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ marginTop: 4, padding: '10px 12px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #EF4444', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                        ❌ Identity verification failed{s.idvResult.idv_failure_reason ? ` — ${s.idvResult.idv_failure_reason}` : ` — ${s.idvResult.idv_similarity_score}% face match`}
                      </div>
                    )
                  )}

                  {/* Input area — only if not already done */}
                  {!s.done && (
                    <div style={{ marginTop: 4 }}>
                      {/* id_verification */}
                      {ft === 'id_verification' && (() => {
                        return (
                          <IdVerificationField
                            item={item} primaryColor={branding.primary} buttonRadius={branding.radius}
                            portalUrl={`${window.location.origin}/portal/${outreach.access_token}`}
                            outreachId={outreach.id} clientId={client?.id || ''} tenantId={tenant?.id || ''}
                            clientEmail={client?.primary_contact_email || ''}
                            firstName={client?.full_name?.split(' ')[0] || ''}
                            lastName={client?.full_name?.split(' ').slice(1).join(' ') || ''}
                            language={lang}
                            onComplete={idvResult => {
                              setItemStateMap(prev => ({
                                ...prev,
                                [outreach.id]: {
                                  ...prev[outreach.id],
                                  [item.item_id]: {
                                    ...prev[outreach.id]?.[item.item_id],
                                    done: idvResult.idv_status === 'Pass' || idvResult.idv_status === 'Inconclusive',
                                    idvResult, text: JSON.stringify(idvResult), fileUrl: idvResult.idv_selfie_url || '',
                                  },
                                },
                              }));
                            }}
                          />
                        );
                      })()}

                      {/* file_upload */}
                      {ft === 'file_upload' && (
                        s.fileUrl ? (
                          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">
                            <CheckCircle className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate text-xs">{t.uploaded}</span>
                            <button className="ml-auto text-slate-400 hover:text-slate-600 cursor-pointer" onClick={() => setItemStateMap(m => ({ ...m, [outreach.id]: { ...m[outreach.id], [item.item_id]: { ...m[outreach.id]?.[item.item_id], fileUrl: '' } } }))}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <label className={cn('flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-4 cursor-pointer', s.uploading ? 'bg-slate-50' : 'hover:bg-slate-50')} style={{ borderColor: 'rgba(38,105,88,.25)' }}>
                            {s.uploading ? <Loader2 className="w-4 h-4 animate-spin mb-1" style={{ color: branding.primary }} /> : <Upload className="w-4 h-4 mb-1 opacity-40" />}
                            <span className="text-xs font-medium opacity-60">{s.uploading ? 'Uploading…' : t.upload_btn}</span>
                            <span className="text-xs opacity-40 mt-0.5">
                              {item.validation_accepted_file_types?.length > 0 ? item.validation_accepted_file_types.join(', ').toUpperCase() : 'PDF, JPG, PNG'} — max {item.validation_max_file_size_mb || 25}MB
                            </span>
                            <input type="file"
                              accept={item.validation_accepted_file_types?.length > 0 ? item.validation_accepted_file_types.map(e => `.${e}`).join(',') : '.pdf,.jpg,.jpeg,.png'}
                              className="hidden" disabled={s.uploading}
                              onChange={e => uploadFile(outreach.id, item.item_id, e.target.files?.[0])} />
                          </label>
                        )
                      )}

                      {/* text */}
                      {ft === 'text' && (
                        <Input value={s.text || ''} onChange={e => setItemText(outreach.id, item.item_id, e.target.value)}
                          placeholder={t.text_placeholder} className="text-sm rounded-xl" style={{ borderColor: 'rgba(38,105,88,.25)' }} />
                      )}

                      {/* textarea */}
                      {ft === 'textarea' && (
                        <Textarea value={s.text || ''} onChange={e => setItemText(outreach.id, item.item_id, e.target.value)}
                          placeholder={t.text_placeholder} className="text-sm min-h-[60px] rounded-xl" style={{ borderColor: 'rgba(38,105,88,.25)' }} />
                      )}

                      {/* number */}
                      {ft === 'number' && (
                        <Input type="number" value={s.text || ''} onChange={e => setItemText(outreach.id, item.item_id, e.target.value)}
                          min={item.validation_min_value} max={item.validation_max_value} placeholder="Enter a number…"
                          className="text-sm rounded-xl" style={{ borderColor: 'rgba(38,105,88,.25)' }} />
                      )}

                      {/* date */}
                      {ft === 'date' && (
                        <Input type="date" value={s.text || ''} onChange={e => setItemText(outreach.id, item.item_id, e.target.value)}
                          className="text-sm rounded-xl" style={{ borderColor: 'rgba(38,105,88,.25)' }} />
                      )}

                      {/* dropdown */}
                      {ft === 'dropdown' && (
                        <select value={s.text || ''} onChange={e => setItemText(outreach.id, item.item_id, e.target.value)}
                          className="mt-1 w-full text-sm rounded-xl border px-3 py-2 bg-white cursor-pointer"
                          style={{ borderColor: 'rgba(38,105,88,.25)', color: branding.text }}>
                          <option value="">Select an option…</option>
                          {(item.field_options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      )}

                      {/* multi_select */}
                      {ft === 'multi_select' && (
                        <div className="space-y-2">
                          {(item.field_options || []).map(opt => {
                            const checked = (s.selected || []).includes(opt);
                            return (
                              <label key={opt} className="flex items-center gap-2.5 cursor-pointer text-sm">
                                <input type="checkbox" checked={checked} className="rounded"
                                  onChange={() => { const cur = s.selected || []; setItemSelected(outreach.id, item.item_id, checked ? cur.filter(v => v !== opt) : [...cur, opt]); }} />
                                <span style={{ color: '#214840' }}>{opt}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}

                      {/* checkbox */}
                      {ft === 'checkbox' && (
                        <label className="flex items-center gap-2.5 cursor-pointer text-sm">
                          <input type="checkbox" checked={s.text === 'true'} className="rounded"
                            onChange={e => setItemText(outreach.id, item.item_id, e.target.checked ? 'true' : '')} />
                          <span style={{ color: '#214840' }}>{item.label}</span>
                        </label>
                      )}

                      {/* yes_no */}
                      {ft === 'yes_no' && (
                        <div className="flex gap-3 mt-1">
                          {['yes', 'no'].map(val => (
                            <button key={val} type="button" onClick={() => setItemText(outreach.id, item.item_id, val)}
                              className={cn('flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-all cursor-pointer',
                                s.text === val ? 'text-white border-transparent' : 'bg-white border-slate-200 opacity-70 hover:opacity-100')}
                              style={s.text === val ? { backgroundColor: '#27775c', borderColor: '#27775c' } : {}}>
                              {val === 'yes' ? '✓ Yes' : '✗ No'}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* signature */}
                      {ft === 'signature' && (
                        <div>
                          {s.fileUrl ? (
                            <div className="border rounded-xl p-3 bg-emerald-50/50" style={{ borderColor: 'rgba(16,185,129,.3)' }}>
                              <img src={s.fileUrl} alt="Signature" className="w-full h-auto rounded-lg bg-white border" style={{ borderColor: 'rgba(38,105,88,.15)', maxHeight: 100, objectFit: 'contain' }} />
                              <div className="flex items-center justify-between mt-2">
                                <span className="text-xs text-slate-500">{s.text}</span>
                                <button className="text-slate-400 hover:text-slate-600 cursor-pointer" onClick={() => setItemStateMap(m => ({ ...m, [outreach.id]: { ...m[outreach.id], [item.item_id]: { ...m[outreach.id]?.[item.item_id], fileUrl: '', text: '', signerName: '' } } }))}>
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="border-2 border-dashed rounded-xl p-3" style={{ borderColor: 'rgba(38,105,88,.25)' }}>
                              <p className="text-xs opacity-50 mb-2">Type your full name:</p>
                              <Input value={s.signerName || ''} onChange={e => setItemStateMap(m => ({ ...m, [outreach.id]: { ...m[outreach.id], [item.item_id]: { ...m[outreach.id]?.[item.item_id], signerName: e.target.value } } }))}
                                placeholder="Full name…" className="text-sm rounded-xl mb-3"
                                style={{ borderColor: 'rgba(38,105,88,.25)' }} />
                              <p className="text-xs opacity-50 mb-2">Draw your signature below:</p>
                              <SignaturePad
                                name={s.signerName || ''}
                                onConfirm={async (dataUrl, timestampLabel) => {
                                  const res = await fetch(dataUrl);
                                  const blob = await res.blob();
                                  const file = new File([blob], `signature-${item.item_id}.png`, { type: 'image/png' });
                                  const file_url = await portalSecureUpload(file);
                                  setItemStateMap(m => ({ ...m, [outreach.id]: { ...m[outreach.id], [item.item_id]: { ...m[outreach.id]?.[item.item_id], fileUrl: file_url, text: `${s.signerName || ''} — Signed on ${timestampLabel}` } } }));
                                }}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Validation error */}
                      {hasError && (
                        <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {validationErrors[item.item_id]}
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* Submit bar */}
          <div className="portal-submit-bar">
            <p>
              {completedCount(outreach) === _total && _total > 0
                ? 'All items completed — ready to submit.'
                : `${completedCount(outreach)} of ${_total} items completed.`}
            </p>
            <button
              className="portal-submit-btn"
              onClick={() => handleSubmit(outreach)}
              disabled={submitting || completedCount(outreach) === 0}
            >
              {submitting ? <Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} /> : <Send style={{ width: 18, height: 18 }} />}
              {submitting ? t.submitting : t.submit}
            </button>
          </div>

          <PortalFooter tenant={tenant} branding={branding} />
        </main>
      </div>

      {/* AI Chat bubble */}
      <div className="fixed bottom-5 right-5 z-30">
        {chatOpen && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-80 mb-3 overflow-hidden flex flex-col" style={{ maxHeight: '60vh' }}>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0" style={{ backgroundColor: branding.primary + '15' }}>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: branding.primary }}>AI</div>
                <span className="text-sm font-semibold" style={{ color: branding.text }}>Assistant</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="opacity-40 hover:opacity-70 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {chatMessages.map((msg, i) => (
                <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[85%] px-3 py-2 text-sm leading-relaxed rounded-2xl', msg.role === 'user' ? 'text-white' : 'bg-slate-100 text-slate-700')}
                    style={msg.role === 'user' ? { backgroundColor: branding.primary } : {}}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatLoading && <div className="flex justify-start"><div className="bg-slate-100 rounded-2xl px-3 py-2"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div></div>}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 border-t border-slate-100 flex-shrink-0">
              <div className="flex gap-2">
                <Input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder={t.ask}
                  className="text-sm rounded-xl border-slate-200"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(chatInput); } }} />
                <Button size="icon" className="flex-shrink-0 text-white cursor-pointer"
                  style={{ backgroundColor: branding.primary, borderRadius: branding.radius }}
                  onClick={() => askAI(chatInput)} disabled={!chatInput.trim() || chatLoading}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
        <button
          onClick={() => setChatOpen(o => !o)}
          className="w-14 h-14 text-white shadow-lg flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer"
          style={{ backgroundColor: branding.primary, borderRadius: '9999px' }}
          aria-label="Open AI assistant">
          {chatOpen ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
        </button>
      </div>
    </div>
  );
}