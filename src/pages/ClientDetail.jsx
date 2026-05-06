import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import RiskBadge from '@/components/shared/RiskBadge';
import StatusBadge from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Plus, ChevronRight, Network, FileText, User, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { CLIENT_STATUS_COLORS } from '@/lib/riskColors';

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useTenant();
  const [client, setClient] = useState(null);
  const [cases, setCases] = useState([]);
  const [relatedParties, setRelatedParties] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [id]);

  async function loadData() {
    const [clientData, casesData, rpLinks, docsData, auditData] = await Promise.all([
      base44.entities.Client.filter({ id }),
      base44.entities.KycCase.filter({ client_id: id }, '-created_date'),
      base44.entities.ClientRelatedPartyLink.filter({ client_id: id }),
      base44.entities.Document.filter({ client_id: id }),
      base44.entities.AuditEvent.filter({ client_id: id }, '-created_date', 50),
    ]);
    const c = clientData?.[0];
    setClient(c);
    setCases(casesData || []);
    setDocuments(docsData || []);
    setAuditEvents(auditData || []);

    if (rpLinks?.length > 0) {
      const rps = await Promise.all(
        rpLinks.map(link => base44.entities.RelatedParty.filter({ id: link.related_party_id }))
      );
      setRelatedParties(rps.flat().filter(Boolean));
    }
    setLoading(false);
  }

  if (loading) return <AppShell><div className="p-8 text-center text-muted-foreground">Loading client…</div></AppShell>;
  if (!client) return <AppShell><div className="p-8 text-center text-muted-foreground">Client not found.</div></AppShell>;

  const activeCase = cases.find(c => !['Approved','Closed','Rejected'].includes(c.status));

  return (
    <AppShell>
      <div className="p-6 max-w-screen-xl mx-auto space-y-5">
        {/* Header */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center text-sm font-semibold flex-shrink-0',
                client.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
              )}>
                {client.client_type === 'ORG' ? <Building2 className="w-5 h-5" /> : <User className="w-5 h-5" />}
              </div>
              <div>
                <div className="flex items-center flex-wrap gap-2">
                  <h1 className="text-xl font-semibold text-foreground">{client.full_name}</h1>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', client.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700')}>
                    {client.client_type}
                  </span>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', CLIENT_STATUS_COLORS[client.status] || 'bg-slate-100 text-slate-600')}>
                    {client.status}
                  </span>
                  <RiskBadge risk={client.risk_classification} />
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {client.registered_country || client.nationality || '—'}
                  {client.registration_number ? ` · KvK ${client.registration_number}` : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/org-chart/${id}`)}>
                <Network className="w-3.5 h-3.5" /> Org Chart
              </Button>
              {activeCase && (
                <Button size="sm" className="gap-1.5" onClick={() => navigate(`/case/${activeCase.id}`)}>
                  Open Case <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-4 border-t border-border">
            {[
              { label: 'Total Cases', value: cases.length },
              { label: 'Related Parties', value: relatedParties.length },
              { label: 'Documents', value: documents.length },
              { label: 'Next Review', value: client.next_review_date ? format(new Date(client.next_review_date), 'd MMM yyyy') : 'Not set' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className="text-lg font-bold text-foreground">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="profile">
          <TabsList className="bg-card border border-border h-auto p-1 gap-1">
            {['profile', 'related-parties', 'cases', 'documents', 'audit-trail'].map(t => (
              <TabsTrigger key={t} value={t} className="capitalize text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-white">
                {t.replace('-', ' ')}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile">
            <div className="bg-card border border-border rounded-xl p-5 space-y-5">
              <ProfileSection client={client} />
            </div>
          </TabsContent>

          {/* Related Parties Tab */}
          <TabsContent value="related-parties">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="font-semibold text-sm">Related Parties</h3>
                <Button size="sm" variant="outline" className="gap-1 text-xs">
                  <Plus className="w-3 h-3" /> Add Related Party
                </Button>
              </div>
              {relatedParties.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">No related parties added yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase">
                      <th className="text-left px-4 py-2.5">Name</th>
                      <th className="text-left px-4 py-2.5">Type</th>
                      <th className="text-left px-4 py-2.5">Role</th>
                      <th className="text-left px-4 py-2.5">Ownership %</th>
                      <th className="text-left px-4 py-2.5">Risk</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {relatedParties.map(rp => (
                      <tr key={rp.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">{rp.full_name}</td>
                        <td className="px-4 py-3"><span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', rp.party_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700')}>{rp.party_type}</span></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{rp.role_in_relationship || '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{rp.ownership_percentage != null ? `${rp.ownership_percentage}%` : '—'}</td>
                        <td className="px-4 py-3"><RiskBadge risk={rp.risk_classification} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          {/* Cases Tab */}
          <TabsContent value="cases">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="font-semibold text-sm">KYC Cases</h3>
              </div>
              {cases.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">No cases found for this client</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase">
                      <th className="text-left px-4 py-2.5">Case Type</th>
                      <th className="text-left px-4 py-2.5">Status</th>
                      <th className="text-left px-4 py-2.5">Risk</th>
                      <th className="text-left px-4 py-2.5">Due Date</th>
                      <th className="text-left px-4 py-2.5">Created</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {cases.map(c => (
                      <tr key={c.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => navigate(`/case/${c.id}`)}>
                        <td className="px-4 py-3 font-medium">{c.case_type?.replace(/_/g,' ')}</td>
                        <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                        <td className="px-4 py-3"><RiskBadge risk={c.risk_classification} /></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{c.due_date ? format(new Date(c.due_date),'d MMM yyyy') : '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{c.created_date ? format(new Date(c.created_date),'d MMM yyyy') : '—'}</td>
                        <td className="px-4 py-3 text-right"><span className="text-xs text-primary font-medium">Open →</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="font-semibold text-sm">Documents</h3>
                <Button size="sm" variant="outline" className="gap-1 text-xs"><Plus className="w-3 h-3" /> Upload</Button>
              </div>
              {documents.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">No documents uploaded yet</div>
              ) : (
                <div className="divide-y divide-border">
                  {documents.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30">
                      <div className="flex items-center gap-3">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium">{doc.file_name}</div>
                          <div className="text-xs text-muted-foreground">{doc.doc_type?.replace(/_/g,' ')} · v{doc.version}</div>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="text-xs" onClick={() => window.open(doc.file_url, '_blank')}>Download</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Audit Trail Tab */}
          <TabsContent value="audit-trail">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold text-sm">Audit Trail</h3>
                <span className="text-xs text-muted-foreground">Append-only — cannot be edited or deleted</span>
              </div>
              {auditEvents.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">No audit events yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase">
                      <th className="text-left px-4 py-2.5">Timestamp</th>
                      <th className="text-left px-4 py-2.5">Actor</th>
                      <th className="text-left px-4 py-2.5">Type</th>
                      <th className="text-left px-4 py-2.5">Event</th>
                      <th className="text-left px-4 py-2.5">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {auditEvents.map(e => (
                      <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{e.created_date ? format(new Date(e.created_date),'d MMM HH:mm') : '—'}</td>
                        <td className="px-4 py-3 text-xs font-medium">{e.actor_name || '—'}</td>
                        <td className="px-4 py-3"><span className={cn('text-xs px-1.5 py-0.5 rounded-full', e.actor_type==='AI_Agent'?'bg-purple-100 text-purple-700':e.actor_type==='System'?'bg-blue-100 text-blue-700':'bg-slate-100 text-slate-600')}>{e.actor_type}</span></td>
                        <td className="px-4 py-3 text-xs">{e.event_type?.replace(/_/g,' ')}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{e.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function ProfileSection({ client }) {
  const isOrg = client.client_type === 'ORG';
  const fields = isOrg
    ? [
        { label: 'Legal Name', value: client.full_name },
        { label: 'Legal Form', value: client.legal_form },
        { label: 'KvK Number', value: client.registration_number },
        { label: 'LEI Code', value: client.lei_code },
        { label: 'Country', value: client.registered_country },
        { label: 'Address', value: client.registered_address },
        { label: 'Sector', value: client.sector },
        { label: 'Contact', value: client.primary_contact_email },
      ]
    : [
        { label: 'Full Name', value: client.full_name },
        { label: 'Date of Birth', value: client.date_of_birth },
        { label: 'Nationality', value: client.nationality },
        { label: 'Country of Residence', value: client.country_of_residence },
        { label: 'ID Type', value: client.id_type },
        { label: 'ID Number', value: client.id_number },
        { label: 'Contact Email', value: client.primary_contact_email },
        { label: 'Contact Phone', value: client.primary_contact_phone },
      ];

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold mb-3">{isOrg ? 'Organisation Details' : 'Personal Details'}</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          {fields.map(f => (
            <div key={f.label} className="flex justify-between py-1 border-b border-border/50">
              <span className="text-xs text-muted-foreground">{f.label}</span>
              <span className="text-xs font-medium text-foreground">{f.value || '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* FATCA/CRS Placeholder */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span className="text-xs font-semibold text-amber-800">FATCA / CRS — Schema Pending</span>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          {[
            { label: 'Tax Residency', value: client.tax_residency },
            { label: 'TIN(s)', value: client.tin },
            { label: 'Classification', value: client.entity_classification },
            { label: 'Reporting Status', value: client.fatca_reporting_status },
          ].map(f => (
            <div key={f.label} className="flex justify-between py-1 border-b border-amber-200/50">
              <span className="text-xs text-amber-700">{f.label}</span>
              <span className="text-xs font-medium text-amber-900">{f.value || '—'}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-amber-600 mt-2 italic">Pending Gino/Glenn schema confirmation</p>
      </div>
    </>
  );
}