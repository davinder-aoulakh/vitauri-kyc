import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ChevronLeft, Sparkles, Loader2, Plus, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function OrgChart() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useTenant();
  const [client, setClient] = useState(null);
  const [relatedParties, setRelatedParties] = useState([]);
  const [chartNodes, setChartNodes] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [clientId]);

  async function loadData() {
    const [clientData, rpLinks] = await Promise.all([
      base44.entities.Client.filter({ id: clientId }),
      base44.entities.ClientRelatedPartyLink.filter({ client_id: clientId }),
    ]);
    const c = clientData?.[0];
    setClient(c);
    if (rpLinks?.length > 0) {
      const rps = await Promise.all(rpLinks.map(l => base44.entities.RelatedParty.filter({ id: l.related_party_id })));
      const flatRPs = rps.flat().filter(Boolean);
      const nodes = [
        { id: 'client', name: c?.full_name, type: client?.client_type || 'ORG', role: 'Client', ownership: null, status: 'In Progress' },
        ...flatRPs.map((rp, i) => ({
          id: rp.id,
          name: rp.full_name,
          type: rp.party_type,
          role: rp.role_in_relationship || 'Related Party',
          ownership: rp.ownership_percentage,
          status: 'Screening',
        })),
      ];
      setChartNodes(nodes);
      setRelatedParties(flatRPs);
    } else {
      setChartNodes([
        { id: 'client', name: c?.full_name, type: c?.client_type || 'ORG', role: 'Client', ownership: null, status: 'In Progress' },
      ]);
    }
    setLoading(false);
  }

  async function generateChart() {
    setGenerating(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a KYC compliance analyst. Based on the following client information, draft an organizational structure showing ownership and control relationships.

Client: ${client?.full_name}
Type: ${client?.client_type}
Country: ${client?.registered_country || 'Netherlands'}
Registration: ${client?.registration_number || 'N/A'}
Sector: ${client?.sector || 'Financial Services'}

Related parties already known: ${relatedParties.map(rp => `${rp.full_name} (${rp.role_in_relationship || 'Unknown role'}, ${rp.ownership_percentage || 0}%)`).join(', ') || 'None'}

Based on typical ownership structures for this type of entity in this jurisdiction, identify:
1. Likely UBOs (>25% ownership)
2. Board members/directors
3. Any additional entities that should be investigated

Return structured data for the org chart.`,
      response_json_schema: {
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string' },
                role: { type: 'string' },
                ownership_percentage: { type: 'number' },
                flag: { type: 'string' },
              },
            },
          },
          unregistered_parties: {
            type: 'array',
            items: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } } },
          },
          recommendation: { type: 'string' },
        },
      },
    });
    setAiSuggestions(result);
    setGenerating(false);
  }

  const nodeStatusColor = {
    'In Progress': 'bg-blue-100 text-blue-700 border-blue-200',
    Screening: 'bg-orange-100 text-orange-700 border-orange-200',
    Complete: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Verified: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Not Added': 'bg-slate-100 text-slate-600 border-slate-200',
    Pending: 'bg-amber-100 text-amber-700 border-amber-200',
  };

  return (
    <AppShell>
      <div className="p-6 max-w-screen-xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/client/${clientId}`)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back to Client
          </button>
        </div>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">Org Chart — {client?.full_name}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">AI-generated · Read-only · Last updated: {new Date().toLocaleDateString()}</p>
          </div>
          <Button onClick={generateChart} disabled={generating} className="gap-2">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? 'Generating…' : 'Regenerate'}
          </Button>
        </div>

        {/* Unregistered parties warning */}
        {aiSuggestions?.unregistered_parties?.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-amber-800">
                  AI detected {aiSuggestions.unregistered_parties.length} unregistered related {aiSuggestions.unregistered_parties.length === 1 ? 'party' : 'parties'}
                </div>
                <div className="text-xs text-amber-700 mt-1">Review below and add to related parties if applicable</div>
                <div className="mt-2 space-y-1">
                  {aiSuggestions.unregistered_parties.map((p, i) => (
                    <div key={i} className="flex items-center justify-between bg-amber-100/60 rounded-lg px-3 py-2">
                      <div>
                        <span className="text-xs font-medium text-amber-900">{p.name}</span>
                        {p.reason && <span className="text-xs text-amber-700 ml-2">— {p.reason}</span>}
                      </div>
                      <Button size="sm" variant="outline" className="text-xs h-6 border-amber-300 text-amber-700 hover:bg-amber-100">
                        <Plus className="w-3 h-3 mr-1" /> Add
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Chart Canvas */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl overflow-hidden min-h-96">
            <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground font-medium">Ownership Structure</div>
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="p-8 flex flex-col items-center gap-8">
                {/* Simple tree visualization */}
                {chartNodes.map((node, i) => (
                  <React.Fragment key={node.id}>
                    <div className={cn(
                      'border-2 rounded-xl p-4 w-64 text-center shadow-sm',
                      i === 0 ? 'border-primary bg-primary/5' : 'border-border bg-card'
                    )}>
                      <div className={cn('text-xs font-medium px-2 py-0.5 rounded-full inline-block mb-2', node.type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700')}>
                        {node.type}
                      </div>
                      <div className="font-semibold text-sm text-foreground">{node.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">{node.role}</div>
                      {node.ownership != null && (
                        <div className="text-xs font-semibold text-foreground mt-1">{node.ownership}%</div>
                      )}
                      <div className={cn('text-xs px-2 py-0.5 rounded-full border inline-block mt-2', nodeStatusColor[node.status] || 'bg-slate-100 text-slate-600 border-slate-200')}>
                        {node.status}
                      </div>
                    </div>
                    {i < chartNodes.length - 1 && (
                      <div className="flex flex-col items-center">
                        <div className="w-px h-6 bg-border" />
                        <div className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          {chartNodes[i + 1]?.ownership ? `${chartNodes[i + 1].ownership}% → ${chartNodes[i + 1].role}` : '↓'}
                        </div>
                        <div className="w-px h-6 bg-border" />
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          {/* AI Panel */}
          <div className="bg-purple-50/40 border border-purple-100 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-purple-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-semibold text-purple-800">AI Org Chart Agent</span>
            </div>
            <div className="p-4">
              {!aiSuggestions && !generating && (
                <div className="text-center py-8">
                  <Sparkles className="w-8 h-8 text-purple-400 mx-auto mb-3" />
                  <p className="text-xs text-purple-700 mb-4">
                    Click "Regenerate" to have the AI analyse the client's ownership structure from available documents and data.
                  </p>
                  <Button onClick={generateChart} disabled={generating} size="sm" className="gap-2 bg-purple-600 hover:bg-purple-700 text-white">
                    <Sparkles className="w-3.5 h-3.5" /> Generate Chart
                  </Button>
                </div>
              )}

              {generating && (
                <div className="flex flex-col items-center py-8 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
                  <p className="text-xs text-purple-700">Analysing ownership structure…</p>
                </div>
              )}

              {aiSuggestions && !generating && (
                <div className="space-y-4">
                  <div className="text-xs font-semibold text-purple-700">Analysis Complete</div>
                  {aiSuggestions.nodes?.map((node, i) => (
                    <div key={i} className="bg-white rounded-lg border border-purple-100 p-3 text-xs">
                      <div className="font-medium text-foreground">{node.name}</div>
                      <div className="text-muted-foreground">{node.role} {node.ownership_percentage ? `· ${node.ownership_percentage}%` : ''}</div>
                      {node.flag && <div className="text-amber-600 mt-1">⚠ {node.flag}</div>}
                    </div>
                  ))}
                  {aiSuggestions.recommendation && (
                    <div className="bg-purple-100 rounded-lg p-3 text-xs text-purple-800">
                      <strong>Recommendation</strong><br />{aiSuggestions.recommendation}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1">
                      <Check className="w-3 h-3" /> Accept
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs gap-1" onClick={generateChart}>
                      <Sparkles className="w-3 h-3" /> Regenerate
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}