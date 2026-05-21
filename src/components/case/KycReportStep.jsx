/**
 * KYC Investigation Report — Professional branded PDF export
 * Sections: Cover · Client Profile · Related Parties · Screening Hits ·
 *           SoF/SoW · Risk Indicators · Consolidated Risk · Control Measures ·
 *           Sign-Off · Audit Trail Appendix
 */
import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { FileText, Download, Loader2, Share2, CheckCircle, XCircle, Eye, RefreshCw, Shield } from 'lucide-react';
import DocumentViewer from '@/components/shared/DocumentViewer';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import jsPDF from 'jspdf';
import { isStepComplete, getStepStatus } from '@/lib/caseUtils';

// ── PDF design tokens ──────────────────────────────────────────────────────
const C = {
  navy:        [15,  31,  61],
  navyLight:   [26,  107, 255],
  white:       [255, 255, 255],
  bodyText:    [40,  45,  55],
  mutedText:   [110, 118, 135],
  border:      [220, 224, 232],
  pageGrey:    [247, 249, 252],
  riskLow:     { bg: [209, 250, 229], text: [6,   95,  70]  },
  riskMedium:  { bg: [254, 243, 199], text: [120, 53,  15]  },
  riskHigh:    { bg: [254, 226, 226], text: [153, 27,  27]  },
  riskUnacceptable: { bg: [127, 0, 0], text: [255, 255, 255] },
  hitNew:      [254, 226, 226],
  hitResolved: [209, 250, 229],
  sectionBg:   [240, 244, 255],
  sectionText: [26,  58,  120],
  tableHeader: [234, 237, 247],
};

function riskColor(risk) {
  return C[`risk${risk}`] || { bg: [240,240,240], text: [50,50,50] };
}

// ── PDF primitives ─────────────────────────────────────────────────────────
const PAGE_H = 297, PAGE_W = 210, MARGIN = 14, INNER_W = PAGE_W - MARGIN * 2;

function addFooter(doc, dateStr, pageNum, pageCount) {
  doc.setPage(pageNum);
  doc.setFillColor(...C.navy);
  doc.rect(0, PAGE_H - 10, PAGE_W, 10, 'F');
  doc.setFontSize(6.5);
  doc.setTextColor(...C.white);
  doc.text(`Vitauri KYC  ·  ${dateStr}  ·  CONFIDENTIAL — FOR COMPLIANCE USE ONLY`, MARGIN, PAGE_H - 4);
  doc.text(`Page ${pageNum} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 4, { align: 'right' });
}

function checkBreak(doc, y, needed = 15) {
  if (y + needed > PAGE_H - 16) { doc.addPage(); return 22; }
  return y;
}

function sectionHeader(doc, num, title, y) {
  y = checkBreak(doc, y, 16);
  doc.setFillColor(...C.sectionBg);
  doc.roundedRect(MARGIN, y - 5, INNER_W, 10, 2, 2, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.sectionText);
  doc.text(`${num}.  ${title}`, MARGIN + 3, y + 1.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.bodyText);
  return y + 13;
}

function kvRow(doc, label, value, y, indent = MARGIN) {
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.mutedText);
  doc.text(label.toUpperCase(), indent, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.bodyText);
  const lines = doc.splitTextToSize(String(value ?? '—'), INNER_W - 44);
  doc.text(lines, indent + 44, y);
  return y + 5.5 * lines.length;
}

function para(doc, text, y, maxW = INNER_W) {
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.bodyText);
  const lines = doc.splitTextToSize(String(text ?? ''), maxW);
  doc.text(lines, MARGIN, y);
  return y + 5.5 * lines.length + 1;
}

function tableHeader(doc, cols, y) {
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  doc.setFillColor(...C.tableHeader);
  doc.rect(MARGIN, y - 4, totalW, 8, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.sectionText);
  let x = MARGIN + 2;
  cols.forEach(c => { doc.text(c.label, x, y); x += c.w; });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.bodyText);
  return y + 6;
}

function tableRow(doc, cols, values, y, shade = false) {
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  if (shade) { doc.setFillColor(...C.pageGrey); doc.rect(MARGIN, y - 4, totalW, 7, 'F'); }
  doc.setFontSize(7.5);
  let x = MARGIN + 2;
  let maxLines = 1;
  cols.forEach((c, i) => {
    const lines = doc.splitTextToSize(String(values[i] ?? '—'), c.w - 3);
    maxLines = Math.max(maxLines, lines.length);
    doc.text(lines, x, y);
    x += c.w;
  });
  return y + 5.5 * maxLines + 1.5;
}

function divider(doc, y) {
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  return y + 5;
}

// ── Main generate function ─────────────────────────────────────────────────
async function buildPDF({ kycCase, client, currentUser, screeningHits, assessments,
  controlMeasures, auditEvents, relatedPartyLinks, relatedParties, tenant, nextVersion }) {

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const dateStr = format(new Date(), 'd MMMM yyyy');
  const risk = kycCase.risk_classification;
  const rc = riskColor(risk);

  // ══ COVER PAGE ════════════════════════════════════════════════════════════
  // Navy header band
  doc.setFillColor(...C.navy);
  doc.rect(0, 0, PAGE_W, 60, 'F');

  // Accent stripe
  doc.setFillColor(...C.navyLight);
  doc.rect(0, 56, PAGE_W, 3, 'F');

  // Title
  doc.setTextColor(...C.white);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('KYC INVESTIGATION REPORT', MARGIN, 24);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('CONFIDENTIAL — FOR COMPLIANCE USE ONLY', MARGIN, 32);

  // Tenant name (branding)
  if (tenant?.name) {
    doc.setFontSize(8);
    doc.setTextColor(180, 200, 255);
    doc.text(tenant.name.toUpperCase(), PAGE_W - MARGIN, 24, { align: 'right' });
  }

  // Report meta box
  doc.setFillColor(...C.pageGrey);
  doc.roundedRect(MARGIN, 70, INNER_W, 52, 3, 3, 'F');
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, 70, INNER_W, 52, 3, 3, 'S');

  doc.setTextColor(...C.bodyText);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(client?.full_name || '—', MARGIN + 5, 82);

  // Risk badge
  doc.setFillColor(...rc.bg);
  doc.roundedRect(MARGIN + 5, 86, 48, 8, 2, 2, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...rc.text);
  doc.text(`${risk || 'UNCLASSIFIED'} RISK`, MARGIN + 7, 91.5);
  doc.setTextColor(...C.bodyText);

  // Meta fields
  let my = 100;
  const metaLeft = MARGIN + 5, metaRight = PAGE_W / 2 + 5;
  const metaPairs = [
    ['Case Type',       kycCase.case_type?.replace(/_/g, ' ')],
    ['Case Status',     kycCase.status?.replace(/_/g, ' ')],
    ['Report Version',  `v${nextVersion}`],
  ];
  const metaRight2 = [
    ['Report Date',     dateStr],
    ['Prepared By',     currentUser?.full_name],
    ['Analyst',         currentUser?.full_name],
  ];
  metaPairs.forEach(([l, v], i) => {
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.mutedText);
    doc.text(l.toUpperCase(), metaLeft, my + i * 6);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.bodyText);
    doc.text(String(v ?? '—'), metaLeft + 30, my + i * 6);
  });
  metaRight2.forEach(([l, v], i) => {
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.mutedText);
    doc.text(l.toUpperCase(), metaRight, my + i * 6);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.bodyText);
    doc.text(String(v ?? '—'), metaRight + 28, my + i * 6);
  });

  // Table of contents
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.sectionText);
  doc.text('TABLE OF CONTENTS', MARGIN, 138);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.bodyText);
  const toc = [
    '1.  Client Profile',
    '2.  Related Parties',
    '3.  Screening & Adverse Media',
    '4.  Source of Funds / Wealth',
    '5.  Risk Indicators & Assessment',
    '6.  Consolidated Risk Classification',
    '7.  Control Measures',
    '8.  Sign-Off Record',
    '9.  Audit Trail Appendix',
  ];
  doc.setFontSize(8);
  toc.forEach((t, i) => {
    doc.text(t, MARGIN + 4, 146 + i * 7);
    doc.setDrawColor(...C.border); doc.setLineWidth(0.15);
    doc.line(MARGIN + 4, 148 + i * 7, PAGE_W - MARGIN - 4, 148 + i * 7);
  });

  // ══ CONTENT PAGES ═════════════════════════════════════════════════════════
  doc.addPage();
  let y = 22;

  // ── 1. Client Profile ──
  y = sectionHeader(doc, 1, 'Client Profile', y);

  if (client?.client_type === 'NP') {
    const npFields = [
      ['Full Name',            client.full_name],
      ['Client Type',          'Natural Person (NP)'],
      ['Date of Birth',        client.date_of_birth],
      ['Nationality',          client.nationality],
      ['Country of Residence', client.country_of_residence],
      ['ID Type',              client.id_type],
      ['ID Number',            client.id_number],
      ['ID Expiry',            client.id_expiry_date],
      ['Tax Residency',        client.tax_residency],
      ['TIN',                  client.tin],
    ];
    const half = Math.ceil(npFields.length / 2);
    npFields.forEach(([l, v], i) => {
      const col = i < half ? 0 : 1;
      const xOff = col === 0 ? 0 : INNER_W / 2 + 2;
      const row = i % half;
      const ry = y + row * 7;
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.mutedText);
      doc.text(l.toUpperCase(), MARGIN + xOff, ry);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.bodyText);
      doc.text(String(v ?? '—'), MARGIN + xOff + 38, ry);
    });
    y += half * 7 + 6;
  } else {
    const orgFields = [
      ['Legal Name',           client?.full_name],
      ['Client Type',          'Organisation (ORG)'],
      ['Registration Number',  client?.registration_number],
      ['LEI Code',             client?.lei_code],
      ['Jurisdiction',         client?.registered_country],
      ['Registered Address',   client?.registered_address],
      ['Sector',               client?.sector],
      ['Legal Form',           client?.legal_form],
      ['FATCA / CRS Status',   client?.entity_classification],
      ['Fatca Reporting',      client?.fatca_reporting_status],
    ];
    const half = Math.ceil(orgFields.length / 2);
    orgFields.forEach(([l, v], i) => {
      const col = i < half ? 0 : 1;
      const xOff = col === 0 ? 0 : INNER_W / 2 + 2;
      const row = i % half;
      const ry = y + row * 7;
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.mutedText);
      doc.text(l.toUpperCase(), MARGIN + xOff, ry);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.bodyText);
      doc.text(String(v ?? '—'), MARGIN + xOff + 38, ry);
    });
    y += half * 7 + 6;
  }

  // Contact info
  if (client?.primary_contact_name || client?.primary_contact_email) {
    y = checkBreak(doc, y);
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.sectionText);
    doc.text('Primary Contact', MARGIN, y); y += 5;
    y = kvRow(doc, 'Name',  client?.primary_contact_name,  y);
    y = kvRow(doc, 'Email', client?.primary_contact_email, y);
    y = kvRow(doc, 'Phone', client?.primary_contact_phone, y);
  }
  y = divider(doc, y + 4);

  // ── 2. Related Parties ──
  y = checkBreak(doc, y, 20);
  y = sectionHeader(doc, 2, 'Related Parties', y);

  if (!relatedPartyLinks || relatedPartyLinks.length === 0) {
    y = para(doc, 'No related parties recorded for this client.', y);
  } else {
    const rpCols = [
      { label: 'Name',        w: 50 },
      { label: 'Type',        w: 18 },
      { label: 'Role',        w: 34 },
      { label: 'Ownership %', w: 24 },
      { label: 'Verification',w: 30 },
      { label: 'Risk',        w: 26 },
    ];
    y = tableHeader(doc, rpCols, y);
    relatedPartyLinks.forEach((link, i) => {
      y = checkBreak(doc, y, 9);
      const rp = relatedParties.find(p => p.id === link.related_party_id) || {};
      y = tableRow(doc, rpCols, [
        rp.full_name || '—',
        rp.party_type || '—',
        link.role || rp.role_in_relationship || '—',
        link.ownership_percentage != null ? `${link.ownership_percentage}%` : '—',
        rp.verification_status?.replace(/_/g, ' ') || '—',
        rp.risk_classification || '—',
      ], y, i % 2 === 1);
    });
    y += 4;
  }
  y = divider(doc, y + 2);

  // ── 3. Screening & Adverse Media ──
  y = checkBreak(doc, y, 20);
  y = sectionHeader(doc, 3, 'Screening & Adverse Media', y);

  if (!screeningHits || screeningHits.length === 0) {
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.bodyText);
    doc.setFillColor(...C.riskLow.bg);
    doc.roundedRect(MARGIN, y - 2, INNER_W, 10, 2, 2, 'F');
    doc.setTextColor(...C.riskLow.text);
    doc.setFont('helvetica', 'bold');
    doc.text('✓  No screening hits recorded for this case.', MARGIN + 4, y + 4);
    doc.setTextColor(...C.bodyText); doc.setFont('helvetica', 'normal');
    y += 16;
  } else {
    const hitCols = [
      { label: 'List / Source',  w: 36 },
      { label: 'Hit Name',       w: 52 },
      { label: 'Confidence',     w: 22 },
      { label: 'AI Assessment',  w: 40 },
      { label: 'Status',         w: 32 },
    ];
    y = tableHeader(doc, hitCols, y);
    screeningHits.forEach((hit, i) => {
      y = checkBreak(doc, y, 10);
      y = tableRow(doc, hitCols, [
        hit.source?.replace(/_/g, ' ') || '—',
        hit.hit_name || '—',
        hit.confidence_score != null ? `${hit.confidence_score}%` : '—',
        hit.ai_recommendation?.replace(/_/g, ' ') || '—',
        hit.status?.replace(/_/g, ' ') || '—',
      ], y, i % 2 === 1);
    });

    // Analyst decisions
    const resolved = screeningHits.filter(h => h.analyst_justification);
    if (resolved.length > 0) {
      y = checkBreak(doc, y + 4, 12);
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.sectionText);
      doc.text('Analyst Decisions', MARGIN, y); y += 6;
      resolved.forEach(hit => {
        y = checkBreak(doc, y, 10);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.bodyText);
        doc.text(`• ${hit.hit_name} — ${hit.analyst_decision || '—'}`, MARGIN + 2, y); y += 5;
        if (hit.analyst_justification) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
          doc.setTextColor(...C.mutedText);
          const lines = doc.splitTextToSize(hit.analyst_justification, INNER_W - 6);
          doc.text(lines, MARGIN + 6, y); y += 5 * lines.length;
        }
      });
    }
    y += 4;
  }
  y = divider(doc, y + 2);

  // ── 4. Source of Funds / Wealth ──
  y = checkBreak(doc, y, 20);
  y = sectionHeader(doc, 4, 'Source of Funds / Source of Wealth', y);
  const sofText = kycCase.sof_narrative ||
    kycCase.case_notes?.substring(0, 400) ||
    'Source of Funds and Source of Wealth assessment conducted. Supporting documentation on file. Refer to case documents for full details.';
  y = para(doc, sofText, y);
  y = divider(doc, y + 4);

  // ── 5. Risk Indicators & Assessment ──
  y = checkBreak(doc, y, 20);
  y = sectionHeader(doc, 5, 'Risk Indicators & Assessment', y);

  if (!assessments || assessments.length === 0) {
    y = para(doc, 'No individual risk indicator assessments recorded. See consolidated classification below.', y);
  } else {
    const rCols = [
      { label: 'Indicator',   w: 60 },
      { label: 'Score',       w: 28 },
      { label: 'Override',    w: 22 },
      { label: 'Narrative',   w: 72 },
    ];
    y = tableHeader(doc, rCols, y);
    assessments.forEach((a, i) => {
      y = checkBreak(doc, y, 12);
      const narrative = (a.analyst_narrative || a.ai_narrative || '').substring(0, 120);
      y = tableRow(doc, rCols, [
        a.indicator_name || '—',
        a.score || '—',
        a.analyst_override ? 'Yes' : 'No',
        narrative || '—',
      ], y, i % 2 === 1);

      if (a.analyst_override && a.analyst_justification) {
        y = checkBreak(doc, y, 8);
        doc.setFontSize(7); doc.setTextColor(...C.mutedText);
        doc.setFont('helvetica', 'italic');
        const just = doc.splitTextToSize(`Override justification: ${a.analyst_justification}`, INNER_W - 10);
        doc.text(just, MARGIN + 6, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.bodyText);
        y += 5 * just.length + 1;
      }
    });
    y += 4;
  }
  y = divider(doc, y + 2);

  // ── 6. Consolidated Risk Classification ──
  y = checkBreak(doc, y, 28);
  y = sectionHeader(doc, 6, 'Consolidated Risk Classification', y);

  doc.setFillColor(...rc.bg);
  doc.roundedRect(MARGIN, y, 80, 16, 3, 3, 'F');
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...rc.text);
  doc.text(`${risk || 'UNCLASSIFIED'}`, MARGIN + 4, y + 10.5);
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
  doc.text('RISK CLASSIFICATION', MARGIN + 4, y + 15.5);
  doc.setTextColor(...C.bodyText);
  y += 22;

  if (kycCase.risk_override_justification) {
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor([180, 90, 0]);
    doc.text('⚠  Analyst risk override applied:', MARGIN, y); y += 5;
    y = para(doc, kycCase.risk_override_justification, y);
  }
  if (kycCase.compliance_advisory_note) {
    y = checkBreak(doc, y, 10);
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.sectionText);
    doc.text('Compliance Advisory Note:', MARGIN, y); y += 5;
    y = para(doc, kycCase.compliance_advisory_note, y);
  }
  y = divider(doc, y + 4);

  // ── 7. Control Measures ──
  y = checkBreak(doc, y, 20);
  y = sectionHeader(doc, 7, 'Control Measures & Mitigants', y);

  if (!controlMeasures || controlMeasures.length === 0) {
    y = para(doc, 'No control measures recorded for this case.', y);
  } else {
    const cmCols = [
      { label: 'Description', w: 80 },
      { label: 'Owner',       w: 38 },
      { label: 'Due Date',    w: 30 },
      { label: 'Status',      w: 34 },
    ];
    y = tableHeader(doc, cmCols, y);
    controlMeasures.forEach((cm, i) => {
      y = checkBreak(doc, y, 10);
      y = tableRow(doc, cmCols, [
        cm.description || '—',
        cm.owner_name || '—',
        cm.due_date || '—',
        cm.status?.replace(/_/g, ' ') || '—',
      ], y, i % 2 === 1);
    });
    y += 4;
  }
  y = divider(doc, y + 2);

  // ── 8. Sign-Off Record ──
  y = checkBreak(doc, y, 30);
  y = sectionHeader(doc, 8, 'Sign-Off Record', y);

  const signOffFields = [
    ['Submitted By',      kycCase.sign_off_submitted_by || currentUser?.full_name],
    ['Submitted At',      kycCase.sign_off_submitted_at ? format(new Date(kycCase.sign_off_submitted_at), 'd MMM yyyy HH:mm') : '—'],
    ['Approved By',       kycCase.sign_off_approved_by || '—'],
    ['Approved At',       kycCase.sign_off_approved_at  ? format(new Date(kycCase.sign_off_approved_at),  'd MMM yyyy HH:mm') : '—'],
    ['Rejection Reason',  kycCase.sign_off_rejection_reason || '—'],
  ];
  signOffFields.forEach(([l, v]) => { y = kvRow(doc, l, v, y); });
  y += 4;

  // Signature blocks
  y = checkBreak(doc, y, 28);
  ['Analyst Signature', 'Compliance Officer Signature'].forEach((label, i) => {
    const bx = MARGIN + i * (INNER_W / 2 + 4);
    doc.setDrawColor(...C.border); doc.setLineWidth(0.3);
    doc.rect(bx, y, INNER_W / 2 - 2, 20, 'S');
    doc.setFontSize(7); doc.setTextColor(...C.mutedText);
    doc.text(label, bx + 3, y + 5);
    doc.line(bx + 3, y + 16, bx + INNER_W / 2 - 8, y + 16);
    doc.text('Date: ___________', bx + 3, y + 19.5);
  });
  y += 26;

  // ── 9. Audit Trail Appendix ──
  if (auditEvents?.length > 0) {
    doc.addPage();
    y = 22;
    y = sectionHeader(doc, 9, 'Audit Trail Appendix', y);
    doc.setFontSize(7.5); doc.setTextColor(...C.mutedText);
    doc.text(`${auditEvents.length} events recorded — showing first 50 · Append-only audit log`, MARGIN, y); y += 8;

    const auCols = [
      { label: 'Timestamp',  w: 34 },
      { label: 'Actor',      w: 36 },
      { label: 'Type',       w: 20 },
      { label: 'Event',      w: 38 },
      { label: 'Notes',      w: 54 },
    ];
    y = tableHeader(doc, auCols, y);
    auditEvents.slice(0, 50).forEach((e, i) => {
      y = checkBreak(doc, y, 9);
      const ts = e.created_date ? format(new Date(e.created_date), 'd MMM yy HH:mm') : '—';
      y = tableRow(doc, auCols, [
        ts,
        e.actor_name || '—',
        e.actor_type || '—',
        e.event_type?.replace(/_/g, ' ') || '—',
        (e.notes || '').substring(0, 60),
      ], y, i % 2 === 1);
    });
  }

  // ── Footers on all pages ──────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) addFooter(doc, dateStr, p, pageCount);

  return doc;
}

// ── Step definitions (steps 1–7 must be complete before report) ────────────
const PREREQUISITE_STEPS = [
  { id: 1, label: 'Outreach & Documents',  stepKey: 'step_1_status' },
  { id: 2, label: 'Identity Verification', stepKey: 'step_2_status' },
  { id: 3, label: 'Screening',             stepKey: 'step_3_status' },
  { id: 4, label: 'Client Profile',        stepKey: 'step_4_status' },
  { id: 5, label: 'Source of Funds/Wealth',stepKey: 'step_5_status' },
  { id: 6, label: 'Risk Assessment',       stepKey: 'step_6_status' },
  { id: 7, label: 'Control Measures',      stepKey: 'step_7_status' },
];

// ── Component ──────────────────────────────────────────────────────────────
export default function KycReportStep({ kycCase, client, currentUser }) {
  const [generating, setGenerating] = useState(false);
  const [reports, setReports]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [shareLink, setShareLink]   = useState(null);
  const [viewerDoc, setViewerDoc]   = useState(null);

  useEffect(() => { loadReports(); }, [kycCase.id]);

  async function loadReports() {
    const kycReports = await base44.entities.KycReport.filter({ case_id: kycCase.id });
    setReports((kycReports || []).sort((a, b) => b.version_number - a.version_number));
    setLoading(false);
  }

  async function generateReport() {
    setGenerating(true);

    // Fetch all supporting data in parallel
    const [screeningHits, assessments, controlMeasures, auditEvents,
           relatedPartyLinks, relatedPartiesAll, tenantList] = await Promise.all([
      base44.entities.ScreeningHit.filter({ case_id: kycCase.id }),
      base44.entities.RiskAssessment.filter({ case_id: kycCase.id }),
      base44.entities.ControlMeasure.filter({ case_id: kycCase.id }),
      base44.entities.AuditEvent.filter({ case_id: kycCase.id }, '-created_date', 50),
      base44.entities.ClientRelatedPartyLink.filter({ client_id: kycCase.client_id }),
      base44.entities.RelatedParty.filter({ tenant_id: kycCase.tenant_id }),
      base44.entities.Tenant.filter({ id: kycCase.tenant_id }),
    ]);

    const tenant = tenantList?.[0] || null;
    const nextVersion = (reports[0]?.version_number || 0) + 1;

    const doc = await buildPDF({
      kycCase, client, currentUser,
      screeningHits: screeningHits || [],
      assessments: assessments || [],
      controlMeasures: controlMeasures || [],
      auditEvents: auditEvents || [],
      relatedPartyLinks: relatedPartyLinks || [],
      relatedParties: relatedPartiesAll || [],
      tenant,
      nextVersion,
    });

    const safeName = (client?.full_name || 'Client').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `KYC_Report_${safeName}_v${nextVersion}_${format(new Date(), 'yyyyMMdd')}.pdf`;
    const pdfBlob = doc.output('blob');
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });

    const { file_url } = await base44.integrations.Core.UploadFile({ file: pdfFile });

    // Create KycReport record for versioning
    const reportSnapshot = {
      client: client,
      case: { status: kycCase.status, risk_classification: kycCase.risk_classification },
      summary: { total_pages: doc.getNumberOfPages(), generated_at: new Date().toISOString() }
    };

    await base44.entities.KycReport.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      version_number: nextVersion,
      generated_at: new Date().toISOString(),
      generated_by_id: currentUser?.id,
      report_data_snapshot: reportSnapshot,
      pdf_url: file_url,
    });

    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id, case_id: kycCase.id,
      actor_user_id: currentUser?.id, actor_name: currentUser?.full_name,
      actor_type: 'User', event_type: 'kyc_report_generated',
      notes: `KYC Report v${nextVersion} generated — ${fileName}`,
    });

    await loadReports();
    setGenerating(false);
  }

  const latestReport = reports[0];
  const isApproved = kycCase?.status === 'Approved';

  const incompleteSteps = PREREQUISITE_STEPS.filter(s => !isStepComplete(kycCase, s.id));
  const allStepsComplete = incompleteSteps.length === 0;

  return (
    <div className="space-y-5">
      {viewerDoc && (
        <DocumentViewer
          fileUrl={viewerDoc.url}
          fileName={viewerDoc.name}
          onClose={() => setViewerDoc(null)}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            KYC Investigation Report
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Professional branded PDF · {reports.length} version{reports.length !== 1 ? 's' : ''} on file
          </p>
        </div>
        <div className="flex items-center gap-2">
          {reports.length > 0 && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={generateReport} disabled={generating || !allStepsComplete}>
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Regenerate
            </Button>
          )}
          <Button size="sm" className="gap-1.5 text-xs" onClick={generateReport} disabled={generating || !allStepsComplete}>
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {generating ? 'Building PDF…' : 'Generate Report'}
          </Button>
        </div>
      </div>

      {!isApproved && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
          <FileText className="w-3.5 h-3.5 flex-shrink-0" />
          Case not yet approved. A draft report can be generated; regenerate after sign-off for the final version.
        </div>
      )}

      {/* Step readiness gate */}
      {allStepsComplete ? (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800">
          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-emerald-600" />
          <span className="font-medium">All steps complete — ready to generate report</span>
        </div>
      ) : (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-red-800">
            The following steps must be completed before generating the report:
          </p>
          <ul className="space-y-1">
            {incompleteSteps.map(s => (
              <li key={s.stepKey} className="flex items-center gap-2 text-xs text-red-700">
                <XCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-500" />
                Step {s.id}: {s.label}
                <span className="text-red-400 ml-1">
                  ({(() => { const st = getStepStatus(kycCase, s.id); return st === 'in_progress' ? 'in progress' : st === 'flagged' ? 'flagged' : 'not started'; })()})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What's included */}
      <div className="bg-muted/30 border border-border rounded-xl p-3 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {['Client Profile','Related Parties','Screening Hits','Risk Indicators','Control Measures','Sign-Off & Audit Trail'].map(s => (
          <div key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />{s}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-card border-2 border-dashed border-border rounded-xl py-16 text-center space-y-2">
          <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-medium text-muted-foreground">No report generated yet</p>
          <p className="text-xs text-muted-foreground/60">Click "Generate Report" to create a full compliance PDF</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Latest report */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/20">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold">Report v{latestReport.version_number}</span>
              <span className="text-xs text-muted-foreground">— {latestReport.generated_at && format(new Date(latestReport.generated_at), 'd MMM yyyy')}</span>
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Latest</span>
              {isApproved && (
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Approved
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1 text-xs h-7"
                onClick={() => setViewerDoc({ url: latestReport.pdf_url, name: `Report_v${latestReport.version_number}` })}>
                <Eye className="w-3 h-3" /> Preview
              </Button>
              <a href={latestReport.pdf_url} download target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="gap-1 text-xs h-7">
                  <Download className="w-3 h-3" /> Download
                </Button>
              </a>
              {isApproved && (
                <Button size="sm" variant="outline" className="gap-1 text-xs h-7 text-violet-600 border-violet-200 hover:bg-violet-50"
                  onClick={() => setShareLink(latestReport.pdf_url)}>
                  <Share2 className="w-3 h-3" /> Share
                </Button>
              )}
            </div>
          </div>

          </div>

          {/* Share link */}
          {shareLink && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-1.5">
              <div className="text-xs font-semibold text-violet-700">Shareable Report Link</div>
              <div className="flex items-center gap-2">
                <input readOnly value={shareLink}
                  className="flex-1 text-xs bg-white border border-violet-200 rounded px-2 py-1 text-violet-800 font-mono"
                  onClick={e => e.target.select()} />
                <Button size="sm" variant="outline" className="text-xs h-7"
                  onClick={() => { navigator.clipboard.writeText(shareLink); }}>
                  Copy
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7"
                  onClick={() => setShareLink(null)}>
                  ✕
                </Button>
              </div>
            </div>
          )}

          {/* Version history */}
          {reports.length > 1 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground">Version History</span>
              </div>
              <div className="divide-y divide-border">
                {reports.slice(1).map(r => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-foreground">Version {r.version_number}</span>
                      <span className="text-xs text-muted-foreground">—</span>
                      <span className="text-xs text-muted-foreground">{r.generated_at && format(new Date(r.generated_at), 'd MMM yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1"
                        onClick={() => setViewerDoc({ url: r.pdf_url, name: `Report_v${r.version_number}` })}>
                        <Eye className="w-3 h-3" /> View
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}