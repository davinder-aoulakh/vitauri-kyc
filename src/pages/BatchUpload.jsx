import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Upload, Download, CheckCircle, XCircle, AlertTriangle, ChevronLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { addDays, format } from 'date-fns';
import { findDuplicates } from '@/lib/dedup';

// CSV template columns
const NP_COLS  = ['client_type','full_name','date_of_birth','nationality','country_of_residence','primary_contact_email','primary_contact_phone','source_channel'];
const ORG_COLS = ['client_type','full_name','registration_number','lei_code','registered_country','registered_address','sector','legal_form','primary_contact_name','primary_contact_email','primary_contact_phone','source_channel'];
const ALL_COLS = [...new Set([...NP_COLS, ...ORG_COLS])];

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,''));
  return lines.slice(1).map((line, idx) => {
    // Handle quoted commas
    const vals = [];
    let cur = '', inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    vals.push(cur.trim());
    const row = { _rowNum: idx + 2 };
    headers.forEach((h, i) => { row[h] = vals[i] || ''; });
    return row;
  });
}

function validateRow(row, existingClients) {
  const errors = [];
  if (!row.client_type || !['NP','ORG'].includes(row.client_type.toUpperCase())) {
    errors.push('client_type must be NP or ORG');
  }
  if (!row.full_name?.trim()) errors.push('full_name is required');

  const type = row.client_type?.toUpperCase();
  if (type === 'ORG') {
    if (!row.registration_number?.trim()) errors.push('registration_number required for ORG');
    if (!row.registered_country?.trim()) errors.push('registered_country required for ORG');
  }
  if (row.primary_contact_email && !/^[^@]+@[^@]+\.[^@]+$/.test(row.primary_contact_email)) {
    errors.push('Invalid email format');
  }

  const country = row.registered_country || row.nationality || row.country_of_residence || '';
  const dups = findDuplicates(row.full_name || '', country, existingClients);
  if (dups.length > 0) {
    errors.push(`Possible duplicate: "${dups[0].client.full_name}" (${dups[0].score}% match)`);
  }

  return errors;
}

function downloadTemplate() {
  const header = ALL_COLS.join(',');
  const example = [
    'NP,"Van der Berg, Jan","1985-03-15","Netherlands (NL)","Netherlands (NL)","jan@example.com","+31612345678","Manual","","","","","","',
    'ORG,"Acme BV","","","NL12345678","","Netherlands (NL)","Herengracht 1, Amsterdam","Technology","BV","Finance Manager","contact@acme.nl","+31208765432","Manual"',
  ];
  const csv = [header, ...example].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'vitauri_client_template.csv'; a.click();
  URL.revokeObjectURL(url);
}

export default function BatchUpload() {
  const { currentUser } = useTenant();
  const navigate = useNavigate();

  const [rows, setRows]           = useState([]);       // parsed + validated rows
  const [importing, setImporting] = useState(false);
  const [imported, setImported]   = useState(null);     // { ok, failed }
  const [existingClients, setExistingClients] = useState([]);
  const fileRef = useRef();

  // Load existing clients for dedup on file parse
  async function loadClients() {
    if (existingClients.length) return existingClients;
    const d = await base44.entities.Client.filter({ tenant_id: currentUser.tenant_id });
    setExistingClients(d || []);
    return d || [];
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCSV(text);
    const clients = await loadClients();
    const validated = parsed.map(row => ({
      ...row,
      _errors: validateRow(row, clients),
    }));
    setRows(validated);
    setImported(null);
  }

  const validRows   = rows.filter(r => r._errors.length === 0);
  const invalidRows = rows.filter(r => r._errors.length > 0);

  async function handleImport() {
    setImporting(true);
    let ok = 0, failed = 0;
    for (const row of validRows) {
      const clientData = {
        tenant_id:              currentUser.tenant_id,
        client_type:            row.client_type?.toUpperCase(),
        full_name:              row.full_name,
        status:                 'Prospect',
        date_of_birth:          row.date_of_birth || undefined,
        nationality:            row.nationality || undefined,
        country_of_residence:   row.country_of_residence || undefined,
        registration_number:    row.registration_number || undefined,
        lei_code:               row.lei_code || undefined,
        registered_country:     row.registered_country || undefined,
        registered_address:     row.registered_address || undefined,
        sector:                 row.sector || undefined,
        legal_form:             row.legal_form || undefined,
        primary_contact_name:   row.primary_contact_name || undefined,
        primary_contact_email:  row.primary_contact_email || undefined,
        primary_contact_phone:  row.primary_contact_phone || undefined,
        source_channel:         row.source_channel || 'Batch',
      };
      try {
        const client = await base44.entities.Client.create(clientData);
        await base44.entities.AuditEvent.create({
          tenant_id: currentUser.tenant_id,
          client_id: client.id,
          actor_user_id: currentUser.id,
          actor_name: currentUser.full_name,
          actor_type: 'User',
          event_type: 'client_created',
          notes: 'Created via batch CSV upload',
          after_state: clientData,
        });
        // Create onboarding case
        await base44.entities.KycCase.create({
          tenant_id: currentUser.tenant_id,
          client_id: client.id,
          case_type: 'Onboarding',
          status: 'Draft',
          assigned_analyst_id: currentUser.id,
          due_date: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
          created_by_user_id: currentUser.id,
        });
        ok++;
      } catch {
        failed++;
      }
    }
    setImported({ ok, failed });
    setImporting(false);
    setRows([]);
  }

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto space-y-5">
        <PageHeader
          title="Batch Client Upload"
          subtitle="Import multiple clients from a CSV file with automatic validation and de-duplication"
          actions={
            <Button variant="outline" onClick={() => navigate('/new-client')} className="gap-2">
              <ChevronLeft className="w-4 h-4" /> Back to Single Client
            </Button>
          }
        />

        {/* Template download */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-sm mb-1">CSV Template</h3>
              <p className="text-xs text-muted-foreground max-w-lg">
                Download the template, fill in your clients (one per row), then upload below.
                Supported columns: <span className="font-mono text-xs">{ALL_COLS.join(', ')}</span>.
                Rows with errors will be shown in a preview before import.
              </p>
            </div>
            <Button variant="outline" onClick={downloadTemplate} className="gap-2 shrink-0">
              <Download className="w-4 h-4" /> Download Template
            </Button>
          </div>
        </div>

        {/* Upload area */}
        <div
          className={cn(
            'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors hover:border-primary/60 hover:bg-primary/5',
            'border-border bg-card'
          )}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); fileRef.current.files = e.dataTransfer.files; handleFile({ target: fileRef.current }); }}
        >
          <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <div className="text-sm font-medium">Drop your CSV here, or click to browse</div>
          <div className="text-xs text-muted-foreground mt-1">Supports .csv files up to 5 MB</div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
        </div>

        {/* Import success */}
        {imported && (
          <div className={cn(
            'rounded-xl border p-4 flex items-start gap-3',
            imported.failed > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'
          )}>
            <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" />
            <div>
              <div className="text-sm font-semibold">
                Import complete — {imported.ok} client{imported.ok !== 1 ? 's' : ''} created
                {imported.failed > 0 && `, ${imported.failed} failed`}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                An Onboarding KYC case has been created for each successful import, assigned to you.
              </div>
              <Button className="mt-2 h-7 text-xs" size="sm" onClick={() => navigate('/my-cases')}>
                View My Cases →
              </Button>
            </div>
          </div>
        )}

        {/* Preview table */}
        {rows.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">
                  Preview — {rows.length} rows
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="text-emerald-600 font-medium">{validRows.length} valid</span>
                  {invalidRows.length > 0 && (
                    <span className="text-red-600 font-medium"> · {invalidRows.length} with errors (will be skipped)</span>
                  )}
                </p>
              </div>
              <Button
                onClick={handleImport}
                disabled={validRows.length === 0 || importing}
                className="gap-2"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {importing ? 'Importing…' : `Import ${validRows.length} valid rows`}
              </Button>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-muted-foreground uppercase tracking-wide">
                      <th className="px-3 py-2.5 text-center w-8">#</th>
                      <th className="px-3 py-2.5 text-left">Status</th>
                      <th className="px-3 py-2.5 text-left">Type</th>
                      <th className="px-3 py-2.5 text-left">Name</th>
                      <th className="px-3 py-2.5 text-left">Country / Reg No.</th>
                      <th className="px-3 py-2.5 text-left">Contact Email</th>
                      <th className="px-3 py-2.5 text-left">Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map(row => {
                      const ok = row._errors.length === 0;
                      return (
                        <tr key={row._rowNum} className={cn(!ok && 'bg-red-50/60')}>
                          <td className="px-3 py-2.5 text-center text-muted-foreground">{row._rowNum}</td>
                          <td className="px-3 py-2.5 text-center">
                            {ok
                              ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                              : <XCircle className="w-3.5 h-3.5 text-red-500 mx-auto" />
                            }
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={cn('font-medium px-1.5 py-0.5 rounded',
                              row.client_type?.toUpperCase() === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                            )}>
                              {row.client_type?.toUpperCase() || '?'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-medium">{row.full_name || '—'}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {row.registered_country || row.nationality || '—'}
                            {row.registration_number ? ` · ${row.registration_number}` : ''}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">{row.primary_contact_email || '—'}</td>
                          <td className="px-3 py-2.5">
                            {row._errors.length > 0 ? (
                              <div className="space-y-0.5">
                                {row._errors.map((e, i) => (
                                  <div key={i} className="flex items-center gap-1 text-red-600">
                                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                    <span>{e}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-emerald-600">Ready to import</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}