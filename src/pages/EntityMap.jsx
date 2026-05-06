import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import RiskBadge from '@/components/shared/RiskBadge';
import {
  ChevronLeft, Loader2, Building2, User, Network,
  ZoomIn, ZoomOut, Maximize2, Info, ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Role → tier mapping ──────────────────────────────────────────────────────
function getRoleTier(role) {
  const r = (role || '').toLowerCase();
  if (r.includes('parent') || r.includes('holding')) return 'parent';
  if (r.includes('ubo') || r.includes('ultimate beneficial')) return 'ubo';
  if (r.includes('subsidiary') || r.includes('daughter')) return 'subsidiary';
  if (r.includes('director') || r.includes('board')) return 'director';
  if (r.includes('shareholder')) return 'shareholder';
  return 'other';
}

const TIER_STYLE = {
  client:     { bg: 'bg-primary/10 border-primary',       badge: 'bg-primary text-white',          label: 'CLIENT' },
  parent:     { bg: 'bg-sky-50 border-sky-400',           badge: 'bg-sky-500 text-white',           label: 'PARENT' },
  ubo:        { bg: 'bg-violet-50 border-violet-400',     badge: 'bg-violet-600 text-white',        label: 'UBO' },
  subsidiary: { bg: 'bg-emerald-50 border-emerald-400',   badge: 'bg-emerald-600 text-white',       label: 'SUBSIDIARY' },
  director:   { bg: 'bg-amber-50 border-amber-400',       badge: 'bg-amber-500 text-white',         label: 'DIRECTOR' },
  shareholder:{ bg: 'bg-rose-50 border-rose-400',         badge: 'bg-rose-500 text-white',          label: 'SHAREHOLDER' },
  other:      { bg: 'bg-slate-50 border-slate-300',       badge: 'bg-slate-500 text-white',         label: 'RELATED PARTY' },
};

const NODE_W = 200;
const NODE_H = 90;
const H_GAP  = 60;
const V_GAP  = 80;

// ── Layout engine ─────────────────────────────────────────────────────────────
// Tiers: parents (top), client (middle), subsidiaries + UBOs below, others alongside
function buildLayout(clientNode, partyNodes) {
  const rows = {
    parent:      [],
    client:      [clientNode],
    ubo:         [],
    subsidiary:  [],
    director:    [],
    shareholder: [],
    other:       [],
  };

  partyNodes.forEach(n => {
    const t = getRoleTier(n.role);
    rows[t] = rows[t] || [];
    rows[t].push(n);
  });

  const orderedTiers = ['parent', 'client', 'ubo', 'subsidiary', 'director', 'shareholder', 'other'];
  const layoutTiers = orderedTiers.filter(t => rows[t]?.length > 0);

  let y = 40;
  const positioned = [];

  layoutTiers.forEach(tier => {
    const nodes = rows[tier];
    const totalW = nodes.length * NODE_W + (nodes.length - 1) * H_GAP;
    let x = -totalW / 2 + NODE_W / 2;

    nodes.forEach(n => {
      positioned.push({ ...n, tier, x, y });
      x += NODE_W + H_GAP;
    });

    y += NODE_H + V_GAP;
  });

  return { positioned, totalHeight: y };
}

// ── Edge drawing ──────────────────────────────────────────────────────────────
function buildEdges(positioned, clientNode) {
  const edges = [];
  const clientPos = positioned.find(n => n.id === clientNode.id);
  if (!clientPos) return edges;

  positioned.forEach(n => {
    if (n.id === clientNode.id) return;
    const tier = n.tier;

    let from, to, color;
    if (tier === 'parent') {
      from = { x: n.x, y: n.y + NODE_H };
      to   = { x: clientPos.x, y: clientPos.y };
      color = '#38bdf8'; // sky
    } else if (tier === 'ubo') {
      from = { x: clientPos.x, y: clientPos.y + NODE_H };
      to   = { x: n.x, y: n.y };
      color = '#a78bfa'; // violet
    } else if (tier === 'subsidiary') {
      from = { x: clientPos.x, y: clientPos.y + NODE_H };
      to   = { x: n.x, y: n.y };
      color = '#34d399'; // emerald
    } else {
      from = { x: clientPos.x, y: clientPos.y + NODE_H / 2 };
      to   = { x: n.x - NODE_W / 2, y: n.y + NODE_H / 2 };
      color = '#94a3b8'; // slate
    }

    edges.push({ from, to, color, ownership: n.ownership, label: n.role });
  });

  return edges;
}

// ── Node card ─────────────────────────────────────────────────────────────────
function MapNode({ node, onClick, selected }) {
  const style = TIER_STYLE[node.tier] || TIER_STYLE.other;
  return (
    <div
      onClick={() => onClick(node)}
      className={cn(
        'absolute border-2 rounded-xl shadow-sm cursor-pointer transition-all duration-150 select-none',
        style.bg,
        selected ? 'ring-2 ring-primary ring-offset-2 shadow-lg scale-105' : 'hover:shadow-md hover:scale-[1.02]'
      )}
      style={{ left: node.x - NODE_W / 2, top: node.y, width: NODE_W, height: NODE_H }}
    >
      <div className="flex flex-col h-full px-3 py-2 justify-between">
        <div className="flex items-center justify-between">
          <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded', style.badge)}>
            {style.label}
          </span>
          {node.type === 'ORG' ? (
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <User className="w-3.5 h-3.5 text-slate-400" />
          )}
        </div>
        <div className="flex-1 flex flex-col justify-center">
          <div className="text-xs font-semibold text-foreground leading-tight line-clamp-2">{node.name}</div>
          {node.ownership != null && (
            <div className="text-[11px] font-bold text-primary mt-0.5">{node.ownership}%</div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-muted-foreground truncate max-w-[120px]">{node.role}</span>
          {node.clientId && (
            <ExternalLink className="w-2.5 h-2.5 text-primary/50 flex-shrink-0" />
          )}
        </div>
      </div>
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
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState(null);
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

    if (rpLinks?.length > 0) {
      const rps = await Promise.all(
        rpLinks.map(l => base44.entities.RelatedParty.filter({ id: l.related_party_id }))
      );
      const flat = rps.flat().filter(Boolean);
      // Enrich with link data (ownership, role)
      const enriched = flat.map(rp => {
        const link = rpLinks.find(l => l.related_party_id === rp.id);
        return {
          ...rp,
          role: link?.role || rp.role_in_relationship || 'Related Party',
          ownership: link?.ownership_percentage ?? rp.ownership_percentage ?? null,
        };
      });
      setRelatedParties(enriched);
    }
    setLoading(false);
  }

  const clientNode = client
    ? { id: 'client', name: client.full_name, type: client.client_type || 'ORG', role: 'Client', ownership: null, clientId: clientId }
    : null;

  const partyNodes = relatedParties.map(rp => ({
    id: rp.id, name: rp.full_name, type: rp.party_type, role: rp.role,
    ownership: rp.ownership, clientId: null, risk: rp.risk_classification,
    verificationStatus: rp.verification_status,
  }));

  const { positioned, totalHeight } = clientNode
    ? buildLayout(clientNode, partyNodes)
    : { positioned: [], totalHeight: 400 };

  const edges = clientNode ? buildEdges(positioned, clientNode) : [];

  // ── Canvas total size ──
  const allX = positioned.map(n => n.x);
  const minX = allX.length ? Math.min(...allX) - NODE_W / 2 - 60 : -300;
  const maxX = allX.length ? Math.max(...allX) + NODE_W / 2 + 60 : 300;
  const canvasW = maxX - minX;
  const canvasH = totalHeight + 60;
  const offsetX = -minX; // shift all nodes into positive canvas space

  // ── Fit on load ──
  useEffect(() => {
    if (!containerRef.current || positioned.length === 0) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    const fitScale = Math.min(width / canvasW, (height - 20) / canvasH, 1);
    setScale(fitScale);
    setPan({ x: (width - canvasW * fitScale) / 2, y: 20 });
  }, [loading]);

  // ── Pan handlers ──
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

  function handleNodeClick(node) {
    setSelected(node.id === selected ? null : node.id);
    if (node.id === 'client') navigate(`/client/${clientId}`);
  }

  function zoomIn()  { setScale(s => Math.min(s + 0.15, 2.5)); }
  function zoomOut() { setScale(s => Math.max(s - 0.15, 0.25)); }
  function resetView() {
    if (!containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    const fitScale = Math.min(width / canvasW, (height - 20) / canvasH, 1);
    setScale(fitScale);
    setPan({ x: (width - canvasW * fitScale) / 2, y: 20 });
  }

  const selectedNode = positioned.find(n => n.id === selected);

  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/client/${clientId}`)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Back to Client
            </button>
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-primary" />
              <div>
                <h1 className="text-sm font-semibold text-foreground leading-tight">Entity Map — {client?.full_name}</h1>
                <p className="text-xs text-muted-foreground">{positioned.length} entities · Click any node to select · Click client to open detail</p>
              </div>
            </div>
          </div>
          {/* Legend */}
          <div className="hidden lg:flex items-center gap-3 flex-wrap">
            {['parent','ubo','subsidiary','director','shareholder'].map(t => (
              <div key={t} className="flex items-center gap-1">
                <span className={cn('w-2.5 h-2.5 rounded-full', TIER_STYLE[t].badge)}></span>
                <span className="text-[10px] text-muted-foreground capitalize">{t}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* ── Canvas ── */}
          <div
            ref={containerRef}
            className={cn('flex-1 relative overflow-hidden bg-slate-50', dragging ? 'cursor-grabbing' : 'cursor-grab')}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : positioned.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-muted-foreground text-sm">No entities to display.</p>
              </div>
            ) : (
              <div
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                  transformOrigin: '0 0',
                  position: 'relative',
                  width: canvasW,
                  height: canvasH,
                }}
              >
                {/* SVG edges */}
                <svg
                  style={{ position: 'absolute', top: 0, left: 0, width: canvasW, height: canvasH, overflow: 'visible', pointerEvents: 'none' }}
                >
                  <defs>
                    <marker id="arrow-blue"   markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#38bdf8" /></marker>
                    <marker id="arrow-violet" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#a78bfa" /></marker>
                    <marker id="arrow-green"  markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#34d399" /></marker>
                    <marker id="arrow-slate"  markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" /></marker>
                  </defs>
                  {edges.map((e, i) => {
                    const fx = e.from.x + offsetX;
                    const tx = e.to.x + offsetX;
                    const fy = e.from.y;
                    const ty = e.to.y;
                    const mid = (fy + ty) / 2;
                    const d = `M ${fx} ${fy} C ${fx} ${mid}, ${tx} ${mid}, ${tx} ${ty}`;
                    const markerId = e.color === '#38bdf8' ? 'arrow-blue' : e.color === '#a78bfa' ? 'arrow-violet' : e.color === '#34d399' ? 'arrow-green' : 'arrow-slate';
                    const midX = (fx + tx) / 2;
                    const midY = (fy + ty) / 2;
                    return (
                      <g key={i}>
                        <path d={d} fill="none" stroke={e.color} strokeWidth="1.5" markerEnd={`url(#${markerId})`} opacity="0.7" />
                        {e.ownership != null && (
                          <text x={midX} y={midY - 4} textAnchor="middle" fontSize="9" fill={e.color} fontWeight="600">
                            {e.ownership}%
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>

                {/* Nodes */}
                {positioned.map(n => (
                  <MapNode
                    key={n.id}
                    node={{ ...n, x: n.x + offsetX }}
                    onClick={handleNodeClick}
                    selected={selected === n.id}
                  />
                ))}
              </div>
            )}

            {/* Zoom controls */}
            <div className="absolute bottom-4 right-4 flex flex-col gap-1 bg-card border border-border rounded-lg shadow-sm overflow-hidden">
              <button onClick={zoomIn}    className="p-2 hover:bg-muted transition-colors"><ZoomIn className="w-4 h-4 text-foreground" /></button>
              <div className="h-px bg-border" />
              <button onClick={zoomOut}   className="p-2 hover:bg-muted transition-colors"><ZoomOut className="w-4 h-4 text-foreground" /></button>
              <div className="h-px bg-border" />
              <button onClick={resetView} className="p-2 hover:bg-muted transition-colors"><Maximize2 className="w-4 h-4 text-foreground" /></button>
            </div>

            {/* Scale indicator */}
            <div className="absolute bottom-4 left-4 bg-card/80 border border-border rounded px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
              {Math.round(scale * 100)}% · {positioned.length} nodes · Drag to pan
            </div>
          </div>

          {/* ── Detail Panel ── */}
          {selectedNode && (
            <div className="w-72 flex-shrink-0 bg-card border-l border-border overflow-y-auto">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold">Entity Detail</span>
                <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <div className={cn('inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded mb-2', TIER_STYLE[selectedNode.tier]?.badge)}>
                    {TIER_STYLE[selectedNode.tier]?.label}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{selectedNode.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{selectedNode.role}</div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-border">
                    <span className="text-muted-foreground">Entity Type</span>
                    <span className="font-medium">{selectedNode.type === 'ORG' ? 'Organisation' : 'Natural Person'}</span>
                  </div>
                  {selectedNode.ownership != null && (
                    <div className="flex justify-between py-1.5 border-b border-border">
                      <span className="text-muted-foreground">Ownership</span>
                      <span className="font-bold text-primary">{selectedNode.ownership}%</span>
                    </div>
                  )}
                  {selectedNode.risk && (
                    <div className="flex justify-between py-1.5 border-b border-border">
                      <span className="text-muted-foreground">Risk Class</span>
                      <RiskBadge risk={selectedNode.risk} />
                    </div>
                  )}
                  {selectedNode.verificationStatus && (
                    <div className="flex justify-between py-1.5 border-b border-border">
                      <span className="text-muted-foreground">Verification</span>
                      <span className={cn('font-medium', selectedNode.verificationStatus === 'Verified' ? 'text-emerald-600' : selectedNode.verificationStatus === 'Rejected' ? 'text-red-600' : 'text-amber-600')}>
                        {selectedNode.verificationStatus?.replace(/_/g, ' ')}
                      </span>
                    </div>
                  )}
                </div>

                {selectedNode.id === 'client' ? (
                  <Button size="sm" className="w-full gap-1.5" onClick={() => navigate(`/client/${clientId}`)}>
                    <ExternalLink className="w-3.5 h-3.5" /> Open Client Detail
                  </Button>
                ) : (
                  <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground flex gap-2">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    This is a related party. Navigate to the client's Related Parties tab to view full detail.
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