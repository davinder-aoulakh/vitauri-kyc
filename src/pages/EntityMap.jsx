/**
 * EntityMap — Interactive network map for client entities.
 * Features:
 *  - Related parties with role-tier layout
 *  - Cross-entity connections (shared related parties across clients)
 *  - KYC case jump links directly from any node
 *  - Ownership % on edges, drag-pan, zoom, fit-to-screen
 *  - Detail panel with verification, risk, and direct case navigation
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import RiskBadge from '@/components/shared/RiskBadge';
import StatusBadge from '@/components/shared/StatusBadge';
import {
  ChevronLeft, Loader2, Building2, User, Network,
  ZoomIn, ZoomOut, Maximize2, ExternalLink, FolderOpen,
  Shield, GitFork, RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

// ── Design constants ─────────────────────────────────────────────────────────
const NODE_W = 210;
const NODE_H = 96;
const H_GAP  = 70;
const V_GAP  = 90;

const TIER_STYLE = {
  client:      { bg: 'bg-primary/10 border-primary',       badge: 'bg-primary text-white',          label: 'CLIENT',       color: '#1A6BFF' },
  parent:      { bg: 'bg-sky-50 border-sky-400',           badge: 'bg-sky-500 text-white',           label: 'PARENT CO',    color: '#38bdf8' },
  ubo:         { bg: 'bg-violet-50 border-violet-400',     badge: 'bg-violet-600 text-white',        label: 'UBO',          color: '#a78bfa' },
  subsidiary:  { bg: 'bg-emerald-50 border-emerald-400',   badge: 'bg-emerald-600 text-white',       label: 'SUBSIDIARY',   color: '#34d399' },
  director:    { bg: 'bg-amber-50 border-amber-400',       badge: 'bg-amber-500 text-white',         label: 'DIRECTOR',     color: '#f59e0b' },
  shareholder: { bg: 'bg-rose-50 border-rose-400',         badge: 'bg-rose-500 text-white',          label: 'SHAREHOLDER',  color: '#f43f5e' },
  cross:       { bg: 'bg-orange-50 border-orange-400',     badge: 'bg-orange-500 text-white',        label: 'CROSS-ENTITY', color: '#f97316' },
  other:       { bg: 'bg-slate-50 border-slate-300',       badge: 'bg-slate-500 text-white',         label: 'RELATED PARTY',color: '#94a3b8' },
};

function getRoleTier(role) {
  const r = (role || '').toLowerCase();
  if (r.includes('parent') || r.includes('holding')) return 'parent';
  if (r.includes('ubo') || r.includes('ultimate beneficial')) return 'ubo';
  if (r.includes('subsidiary') || r.includes('daughter')) return 'subsidiary';
  if (r.includes('director') || r.includes('board')) return 'director';
  if (r.includes('shareholder')) return 'shareholder';
  return 'other';
}

// ── Layout engine ─────────────────────────────────────────────────────────────
function buildLayout(clientNode, partyNodes) {
  const rows = { parent: [], client: [clientNode], ubo: [], subsidiary: [], director: [], shareholder: [], cross: [], other: [] };
  partyNodes.forEach(n => { const t = n.tier || getRoleTier(n.role); (rows[t] = rows[t] || []).push({ ...n, tier: t }); });
  const orderedTiers = ['parent', 'client', 'ubo', 'subsidiary', 'director', 'shareholder', 'cross', 'other'];
  let y = 40;
  const positioned = [];
  orderedTiers.forEach(tier => {
    const nodes = rows[tier];
    if (!nodes?.length) return;
    const totalW = nodes.length * NODE_W + (nodes.length - 1) * H_GAP;
    let x = -totalW / 2 + NODE_W / 2;
    nodes.forEach(n => { positioned.push({ ...n, tier, x, y }); x += NODE_W + H_GAP; });
    y += NODE_H + V_GAP;
  });
  return { positioned, totalHeight: y };
}

function buildEdges(positioned, clientNode) {
  const edges = [];
  const clientPos = positioned.find(n => n.id === clientNode.id);
  if (!clientPos) return edges;
  positioned.forEach(n => {
    if (n.id === clientNode.id) return;
    const tier = n.tier;
    const style = TIER_STYLE[tier] || TIER_STYLE.other;
    let from, to;
    if (tier === 'parent') {
      from = { x: n.x, y: n.y + NODE_H };
      to   = { x: clientPos.x, y: clientPos.y };
    } else if (['ubo','subsidiary','director','shareholder','cross','other'].includes(tier)) {
      from = { x: clientPos.x, y: clientPos.y + NODE_H };
      to   = { x: n.x, y: n.y };
    } else {
      from = { x: clientPos.x, y: clientPos.y + NODE_H / 2 };
      to   = { x: n.x - NODE_W / 2, y: n.y + NODE_H / 2 };
    }
    edges.push({ from, to, color: style.color, ownership: n.ownership, label: n.role, isCross: tier === 'cross' });
  });
  return edges;
}

// ── Node Card ─────────────────────────────────────────────────────────────────
function MapNode({ node, onClick, selected }) {
  const style = TIER_STYLE[node.tier] || TIER_STYLE.other;
  return (
    <div
      onClick={() => onClick(node)}
      className={cn(
        'absolute border-2 rounded-xl shadow-sm cursor-pointer transition-all duration-150 select-none',
        style.bg,
        selected ? 'ring-2 ring-primary ring-offset-2 shadow-xl scale-105 z-10' : 'hover:shadow-md hover:scale-[1.02] z-0'
      )}
      style={{ left: node.x - NODE_W / 2, top: node.y, width: NODE_W, height: NODE_H }}
    >
      <div className="flex flex-col h-full px-3 py-2 gap-1 justify-between">
        <div className="flex items-center justify-between">
          <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded', style.badge)}>
            {style.label}
          </span>
          <div className="flex items-center gap-1">
            {node.caseCount > 0 && (
              <span className="text-[9px] bg-primary/10 text-primary px-1 rounded font-bold">
                {node.caseCount} case{node.caseCount !== 1 ? 's' : ''}
              </span>
            )}
            {node.type === 'ORG' ? <Building2 className="w-3.5 h-3.5 text-slate-400" /> : <User className="w-3.5 h-3.5 text-slate-400" />}
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <div className="text-xs font-semibold text-foreground leading-tight line-clamp-2">{node.name}</div>
          {node.ownership != null && (
            <div className="text-[11px] font-bold text-primary mt-0.5">{node.ownership}%</div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[9px] text-muted-foreground truncate max-w-[130px]">{node.role}</span>
          <div className="flex items-center gap-0.5">
            {node.isCrossEntity && <GitFork className="w-2.5 h-2.5 text-orange-400" />}
            {(node.clientId || node.caseCount > 0) && <ExternalLink className="w-2.5 h-2.5 text-primary/50" />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Case list sub-component ───────────────────────────────────────────────────
function CaseList({ cases, navigate }) {
  if (!cases?.length) return <p className="text-xs text-muted-foreground">No active cases found.</p>;
  return (
    <div className="space-y-2">
      {cases.map(c => (
        <div key={c.id} className="border border-border rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-medium text-foreground">{c.case_type?.replace(/_/g, ' ')}</span>
            <StatusBadge status={c.status} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {c.due_date ? `Due ${format(new Date(c.due_date), 'd MMM yyyy')}` : 'No due date'}
            </span>
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2"
              onClick={() => navigate(`/case/${c.id}`)}>
              <FolderOpen className="w-3 h-3" /> Open
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EntityMap() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useTenant();

  const [client, setClient]           = useState(null);
  const [relatedParties, setRelatedParties] = useState([]);
  const [casesMap, setCasesMap]       = useState({}); // clientId or rpId → cases[]
  const [crossLinks, setCrossLinks]   = useState([]); // other clients sharing same RP
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState(null);
  const [nodeCases, setNodeCases]     = useState(null); // cases for selected client node
  const [loadingCases, setLoadingCases] = useState(false);
  const [scale, setScale]             = useState(1);
  const [pan, setPan]                 = useState({ x: 0, y: 0 });
  const [dragging, setDragging]       = useState(false);
  const [dragStart, setDragStart]     = useState(null);
  const containerRef = useRef(null);

  useEffect(() => { loadData(); }, [clientId]);

  async function loadData() {
    setLoading(true);
    const [clientData, rpLinks] = await Promise.all([
      base44.entities.Client.filter({ id: clientId }),
      base44.entities.ClientRelatedPartyLink.filter({ client_id: clientId }),
    ]);
    const c = clientData?.[0];
    setClient(c);

    // Load KYC cases for this client
    const clientCases = await base44.entities.KycCase.filter({ client_id: clientId });
    const cMap = { [clientId]: clientCases || [] };

    if (rpLinks?.length > 0) {
      // Fetch all RP records + cross-client links for same RPs
      const rpIds = rpLinks.map(l => l.related_party_id);
      const [rps, allLinksForRPs] = await Promise.all([
        Promise.all(rpIds.map(id => base44.entities.RelatedParty.filter({ id }))).then(r => r.flat().filter(Boolean)),
        Promise.all(rpIds.map(id => base44.entities.ClientRelatedPartyLink.filter({ related_party_id: id }))).then(r => r.flat().filter(Boolean)),
      ]);

      // Find other clients sharing these RPs
      const otherClientIds = [...new Set(
        allLinksForRPs.filter(l => l.client_id !== clientId).map(l => l.client_id)
      )];

      let crossClients = [];
      if (otherClientIds.length > 0) {
        crossClients = await Promise.all(otherClientIds.map(id => base44.entities.Client.filter({ id }))).then(r => r.flat().filter(Boolean));
        // Pre-load cases for cross-entity clients
        const crossCases = await Promise.all(otherClientIds.map(id => base44.entities.KycCase.filter({ client_id: id })));
        otherClientIds.forEach((id, i) => { cMap[id] = crossCases[i] || []; });
      }

      setCrossLinks(crossClients);

      const enriched = rps.map(rp => {
        const link = rpLinks.find(l => l.related_party_id === rp.id);
        const sharedWith = allLinksForRPs.filter(l => l.related_party_id === rp.id && l.client_id !== clientId);
        return {
          ...rp,
          role: link?.role || rp.role_in_relationship || 'Related Party',
          ownership: link?.ownership_percentage ?? rp.ownership_percentage ?? null,
          isCrossEntity: sharedWith.length > 0,
          sharedWithClientIds: sharedWith.map(l => l.client_id),
        };
      });
      setRelatedParties(enriched);
    }

    setCasesMap(cMap);
    setLoading(false);
  }

  // Build nodes
  const clientNode = client
    ? { id: 'client', name: client.full_name, type: client.client_type || 'ORG', role: 'Primary Client', tier: 'client', ownership: null, clientId, caseCount: (casesMap[clientId] || []).length }
    : null;

  const partyNodes = relatedParties.map(rp => ({
    id: rp.id, name: rp.full_name, type: rp.party_type, role: rp.role,
    tier: rp.isCrossEntity ? 'cross' : getRoleTier(rp.role),
    ownership: rp.ownership, clientId: null,
    risk: rp.risk_classification,
    verificationStatus: rp.verification_status,
    isCrossEntity: rp.isCrossEntity,
    sharedWithClientIds: rp.sharedWithClientIds || [],
    caseCount: 0,
  }));

  const { positioned, totalHeight } = clientNode
    ? buildLayout(clientNode, partyNodes)
    : { positioned: [], totalHeight: 400 };

  const edges = clientNode ? buildEdges(positioned, clientNode) : [];

  const allX = positioned.map(n => n.x);
  const minX = allX.length ? Math.min(...allX) - NODE_W / 2 - 60 : -300;
  const maxX = allX.length ? Math.max(...allX) + NODE_W / 2 + 60 : 300;
  const canvasW = maxX - minX;
  const canvasH = totalHeight + 60;
  const offsetX = -minX;

  useEffect(() => {
    if (!containerRef.current || positioned.length === 0) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    const fitScale = Math.min(width / canvasW, (height - 20) / canvasH, 1.2);
    setScale(Math.min(fitScale, 1));
    setPan({ x: (width - canvasW * fitScale) / 2, y: 20 });
  }, [loading]);

  const onMouseDown = useCallback(e => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);
  const onMouseMove = useCallback(e => {
    if (!dragging || !dragStart) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);
  const onMouseUp = useCallback(() => setDragging(false), []);

  async function handleNodeClick(node) {
    if (selected === node.id) { setSelected(null); setNodeCases(null); return; }
    setSelected(node.id);
    setNodeCases(null);

    if (node.id === 'client') {
      setNodeCases(casesMap[clientId] || []);
    } else if (node.sharedWithClientIds?.length > 0) {
      // For cross-entity nodes, load cases from all connected clients
      const allCases = node.sharedWithClientIds.flatMap(id => casesMap[id] || []);
      setNodeCases(allCases);
    }
  }

  function zoomIn()  { setScale(s => Math.min(s + 0.15, 3)); }
  function zoomOut() { setScale(s => Math.max(s - 0.15, 0.2)); }
  function resetView() {
    if (!containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    const fitScale = Math.min(width / canvasW, (height - 20) / canvasH, 1.2);
    setScale(Math.min(fitScale, 1));
    setPan({ x: (width - canvasW * fitScale) / 2, y: 20 });
  }

  const selectedNode = positioned.find(n => n.id === selected);
  const crossCount = relatedParties.filter(r => r.isCrossEntity).length;

  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(`/client/${clientId}`)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-4 h-4" /> Back to Client
            </button>
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-primary" />
              <div>
                <h1 className="text-sm font-semibold leading-tight">Entity Network — {client?.full_name}</h1>
                <p className="text-xs text-muted-foreground">
                  {positioned.length} entities · {edges.length} connections
                  {crossCount > 0 && <span className="ml-2 text-orange-500 font-medium">· {crossCount} cross-entity link{crossCount !== 1 ? 's' : ''}</span>}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Legend */}
            <div className="hidden lg:flex items-center gap-3 flex-wrap">
              {['parent','ubo','subsidiary','director','shareholder','cross'].map(t => (
                <div key={t} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: TIER_STYLE[t].color }} />
                  <span className="text-[10px] text-muted-foreground capitalize">{t.replace('-', ' ')}</span>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={loadData}>
              <RefreshCw className="w-3 h-3" /> Refresh
            </Button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* ── Canvas ── */}
          <div
            ref={containerRef}
            className={cn('flex-1 relative overflow-hidden', dragging ? 'cursor-grabbing' : 'cursor-grab')}
            style={{ background: 'radial-gradient(circle at 50% 50%, #f0f4ff 0%, #f8fafc 100%)' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Building entity map…</span>
                </div>
              </div>
            ) : positioned.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center space-y-2">
                  <Network className="w-12 h-12 text-muted-foreground/20 mx-auto" />
                  <p className="text-sm text-muted-foreground">No related parties to display.</p>
                  <p className="text-xs text-muted-foreground/60">Add related parties from the client's Related Parties tab.</p>
                </div>
              </div>
            ) : (
              <div style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                transformOrigin: '0 0', position: 'relative',
                width: canvasW, height: canvasH,
              }}>
                {/* SVG edges */}
                <svg style={{ position: 'absolute', top: 0, left: 0, width: canvasW, height: canvasH, overflow: 'visible', pointerEvents: 'none' }}>
                  <defs>
                    {Object.entries(TIER_STYLE).map(([key, s]) => (
                      <marker key={key} id={`arrow-${key}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                        <path d="M0,0 L0,6 L8,3 z" fill={s.color} />
                      </marker>
                    ))}
                  </defs>
                  {edges.map((e, i) => {
                    const fx = e.from.x + offsetX, tx = e.to.x + offsetX;
                    const fy = e.from.y, ty = e.to.y;
                    const mid = (fy + ty) / 2;
                    const d = `M ${fx} ${fy} C ${fx} ${mid}, ${tx} ${mid}, ${tx} ${ty}`;
                    const tierKey = Object.keys(TIER_STYLE).find(k => TIER_STYLE[k].color === e.color) || 'other';
                    return (
                      <g key={i}>
                        <path d={d} fill="none" stroke={e.color} strokeWidth={e.isCross ? 2 : 1.5}
                          strokeDasharray={e.isCross ? '6 3' : undefined}
                          markerEnd={`url(#arrow-${tierKey})`} opacity="0.7" />
                        {e.ownership != null && (
                          <text x={(fx + tx) / 2} y={(fy + ty) / 2 - 5} textAnchor="middle"
                            fontSize="9" fill={e.color} fontWeight="700">
                            {e.ownership}%
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>

                {/* Nodes */}
                {positioned.map(n => (
                  <MapNode key={n.id} node={{ ...n, x: n.x + offsetX }}
                    onClick={handleNodeClick} selected={selected === n.id} />
                ))}
              </div>
            )}

            {/* Zoom controls */}
            <div className="absolute bottom-4 right-4 flex flex-col bg-card border border-border rounded-lg shadow overflow-hidden">
              <button onClick={zoomIn}    className="p-2 hover:bg-muted transition-colors"><ZoomIn  className="w-4 h-4" /></button>
              <div className="h-px bg-border" />
              <button onClick={zoomOut}   className="p-2 hover:bg-muted transition-colors"><ZoomOut className="w-4 h-4" /></button>
              <div className="h-px bg-border" />
              <button onClick={resetView} className="p-2 hover:bg-muted transition-colors"><Maximize2 className="w-4 h-4" /></button>
            </div>

            {/* Scale indicator */}
            <div className="absolute bottom-4 left-4 bg-card/80 border border-border rounded px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
              {Math.round(scale * 100)}% · {positioned.length} nodes · Drag to pan · Click node to inspect
            </div>
          </div>

          {/* ── Detail Panel ── */}
          {selectedNode && (
            <div className="w-80 flex-shrink-0 bg-card border-l border-border overflow-y-auto flex flex-col">
              <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0">
                <span className="text-sm font-semibold">Entity Detail</span>
                <button onClick={() => { setSelected(null); setNodeCases(null); }}
                  className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
              </div>

              <div className="p-4 space-y-4 flex-1">
                {/* Identity */}
                <div>
                  <span className={cn('inline-flex text-[9px] font-bold px-1.5 py-0.5 rounded mb-2', TIER_STYLE[selectedNode.tier]?.badge)}>
                    {TIER_STYLE[selectedNode.tier]?.label}
                  </span>
                  <div className="text-sm font-semibold text-foreground mt-1">{selectedNode.name}</div>
                  <div className="text-xs text-muted-foreground">{selectedNode.role}</div>
                </div>

                {/* Attributes */}
                <div className="space-y-0 border border-border rounded-lg overflow-hidden">
                  {[
                    ['Entity Type', selectedNode.type === 'ORG' ? 'Organisation' : 'Natural Person'],
                    selectedNode.ownership != null ? ['Ownership', `${selectedNode.ownership}%`] : null,
                    selectedNode.risk ? ['Risk Class', null, <RiskBadge key="r" risk={selectedNode.risk} />] : null,
                    selectedNode.verificationStatus ? ['Verification', selectedNode.verificationStatus?.replace(/_/g, ' ')] : null,
                    selectedNode.isCrossEntity ? ['Cross-Entity', `Shared with ${selectedNode.sharedWithClientIds?.length || 0} other client(s)`] : null,
                  ].filter(Boolean).map(([label, value, node], i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 text-xs border-b border-border last:border-0">
                      <span className="text-muted-foreground">{label}</span>
                      {node || (
                        <span className={cn('font-medium',
                          label === 'Verification' && value === 'Verified' ? 'text-emerald-600' :
                          label === 'Verification' && value === 'Rejected' ? 'text-red-600' :
                          label === 'Ownership' ? 'text-primary font-bold' :
                          label === 'Cross-Entity' ? 'text-orange-600' : ''
                        )}>{value}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Actions */}
                {selectedNode.id === 'client' ? (
                  <div className="space-y-2">
                    <Button size="sm" className="w-full gap-1.5" onClick={() => navigate(`/client/${clientId}`)}>
                      <ExternalLink className="w-3.5 h-3.5" /> Open Client Detail
                    </Button>

                    {/* Client's KYC cases */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <FolderOpen className="w-3.5 h-3.5 text-primary" />
                        <span className="text-xs font-semibold">KYC Cases</span>
                      </div>
                      {loadingCases
                        ? <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                        : <CaseList cases={nodeCases} navigate={navigate} />
                      }
                    </div>
                  </div>
                ) : selectedNode.isCrossEntity ? (
                  <div className="space-y-3">
                    {/* Links to shared clients */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <GitFork className="w-3.5 h-3.5 text-orange-500" />
                        <span className="text-xs font-semibold text-orange-700">Cross-Entity Connections</span>
                      </div>
                      <div className="space-y-1.5">
                        {crossLinks
                          .filter(cl => selectedNode.sharedWithClientIds?.includes(cl.id))
                          .map(cl => (
                            <div key={cl.id} className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                              <div>
                                <div className="text-xs font-medium">{cl.full_name}</div>
                                <div className="text-[10px] text-muted-foreground">{cl.client_type} · {cl.status}</div>
                              </div>
                              <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2"
                                onClick={() => navigate(`/client/${cl.id}`)}>
                                View
                              </Button>
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Cases from shared clients */}
                    {nodeCases?.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <FolderOpen className="w-3.5 h-3.5 text-primary" />
                          <span className="text-xs font-semibold">Related Cases</span>
                        </div>
                        <CaseList cases={nodeCases} navigate={navigate} />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground flex gap-2">
                    <Shield className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                    View full detail and verification records in the client's Related Parties tab.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}