import React from 'react';
import { X, Loader2, ExternalLink, ChevronDown, Shield, Newspaper } from 'lucide-react';
import { cn } from '@/lib/utils';

const REVIEW_OPTIONS = [
  { value: 'Unreviewed',      label: 'Unreviewed',      style: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'Confirmed Match', label: 'Confirmed Match', style: 'bg-red-100 text-red-700 border-red-200' },
  { value: 'False Positive',  label: 'False Positive',  style: 'bg-slate-100 text-slate-600 border-slate-200' },
  { value: 'Inconclusive',    label: 'Inconclusive',    style: 'bg-amber-100 text-amber-700 border-amber-200' },
];

function ScoreBar({ value, danger = 80 }) {
  if (value == null) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-2">
        <div
          className={cn('h-2 rounded-full transition-all', value >= danger ? 'bg-red-500' : value >= 50 ? 'bg-amber-400' : 'bg-slate-400')}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <span className="text-sm font-semibold tabular-nums w-10 text-right">{value}%</span>
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 mt-1">{children}</div>
  );
}

// Didit stores multi-value fields as arrays in properties{}
function propFirst(hit, key) {
  const val = hit?.properties?.[key];
  if (!val) return null;
  return Array.isArray(val) ? val[0] : val;
}
function propAll(hit, key) {
  const val = hit?.properties?.[key];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export default function AmlHitSlidePanel({ hit, hitIndex, loading, onClose, onStatusChange, updatingHitId }) {
  const [dropdownOpen, setDropdownOpen] = React.useState(false);

  if (!hit) return null;

  const hitKey = hit.id || String(hitIndex);
  const isUpdating = updatingHitId === hitKey;
  const reviewStatus = hit.review_status || 'Unreviewed';
  const currentOption = REVIEW_OPTIONS.find(o => o.value === reviewStatus) || REVIEW_OPTIONS[0];

  const matchScore = hit.match_score ?? (hit.score != null ? Math.round(hit.score * 100) : null);
  const riskScore = hit.risk_score ?? null;

  // datasets[] = ["PEP Level 2", "Sanctions", ...] — the primary list memberships in Didit V3
  const datasets = hit.datasets?.length ? hit.datasets : [];

  // Aliases from properties.alias or properties.name (additional names)
  const aliases = [
    ...propAll(hit, 'alias'),
    ...propAll(hit, 'also_known_as'),
  ].filter(Boolean);

  // Names listed on the hit (all variants)
  const allNames = propAll(hit, 'name').filter(n => n !== hit.caption);

  const dob = propFirst(hit, 'birthDate') || hit.date_of_birth;
  const country = propFirst(hit, 'country') || hit.country;
  const nationality = propFirst(hit, 'nationality') || hit.nationality;

  // Didit V3 adverse media fields — try all known field names
  const adverseMediaMatches = hit.adverse_media_matches || [];
  const adverseMediaDetails = hit.adverse_media_details || null;
  // Normalise into a single shape the template can render
  const adverseMedia = adverseMediaDetails || hit.adverse_media || hit.media_analysis || null;
  const hasAdverseMedia = adverseMedia || adverseMediaMatches.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Slide panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[520px] max-w-[95vw] flex flex-col bg-card border-l border-border shadow-2xl animate-slide-in-right overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border bg-muted/30 flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-foreground truncate">
                {hit.caption || hit.name || `AML Hit ${(hitIndex ?? 0) + 1}`}
              </span>
              {datasets.slice(0, 2).map((ds, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                  {String(ds)}
                </span>
              ))}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Full hit evidence &amp; source details</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading full hit details…
            </div>
          )}

          {/* Review Status */}
          <div>
            <SectionHeading>Review Status</SectionHeading>
            <div className="relative inline-block">
              <button
                onClick={() => setDropdownOpen(v => !v)}
                disabled={isUpdating}
                className={cn(
                  'px-3 py-1.5 rounded-lg border font-medium text-sm flex items-center gap-2 select-none',
                  currentOption.style,
                  isUpdating && 'opacity-50 cursor-not-allowed'
                )}
              >
                {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : currentOption.label}
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
              {dropdownOpen && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setDropdownOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-[70] bg-card border border-border rounded-lg shadow-xl min-w-[190px] py-1">
                    {REVIEW_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { setDropdownOpen(false); onStatusChange(hit, opt.value); }}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center gap-2.5',
                          opt.value === reviewStatus && 'opacity-40 pointer-events-none'
                        )}
                      >
                        <span className={cn('w-2 h-2 rounded-full flex-shrink-0 border', opt.style)} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Scores */}
          <div>
            <SectionHeading>Scoring</SectionHeading>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Match Score</div>
                <ScoreBar value={matchScore} danger={90} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Risk Score</div>
                <ScoreBar value={riskScore} danger={80} />
              </div>
            </div>
          </div>

          {/* Identity Details — sourced from hit.properties{} */}
          <div>
            <SectionHeading>Identity Details</SectionHeading>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
              {dob && (
                <div>
                  <div className="text-xs text-muted-foreground">Date of Birth</div>
                  <div className="font-medium">{Array.isArray(dob) ? dob[0] : dob}</div>
                </div>
              )}
              {country && (
                <div>
                  <div className="text-xs text-muted-foreground">Country</div>
                  <div className="font-medium">{country}</div>
                </div>
              )}
              {nationality && (
                <div>
                  <div className="text-xs text-muted-foreground">Nationality</div>
                  <div className="font-medium">{nationality}</div>
                </div>
              )}
              {hit.first_seen && (
                <div>
                  <div className="text-xs text-muted-foreground">First Seen</div>
                  <div className="font-medium">{new Date(hit.first_seen).toLocaleDateString()}</div>
                </div>
              )}
              {hit.last_seen && (
                <div>
                  <div className="text-xs text-muted-foreground">Last Seen</div>
                  <div className="font-medium">{new Date(hit.last_seen).toLocaleDateString()}</div>
                </div>
              )}
              {hit.target != null && (
                <div>
                  <div className="text-xs text-muted-foreground">Direct Target</div>
                  <div className="font-medium">{hit.target ? 'Yes' : 'No'}</div>
                </div>
              )}

              {/* All name variants */}
              {allNames.length > 0 && (
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground">Name Variants</div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {allNames.map((n, i) => (
                      <span key={i} className="bg-muted border border-border px-2 py-0.5 rounded text-xs font-medium">{n}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Aliases */}
              {aliases.length > 0 && (
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground">Also Known As</div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {aliases.map((alias, i) => (
                      <span key={i} className="bg-muted border border-border px-2 py-0.5 rounded text-xs font-medium">{alias}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Source URL */}
              {hit.url && (
                <div className="col-span-2">
                  <a href={hit.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium">
                    View on source registry <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Lists / Datasets */}
          {datasets.length > 0 && (
            <div>
              <SectionHeading>Lists / Datasets</SectionHeading>
              <div className="flex flex-wrap gap-1.5">
                {datasets.map((ds, i) => (
                  <span key={i} className="bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full text-xs font-medium border border-amber-200">
                    {String(ds)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Adverse Media — shown when datasets includes "Adverse Media" or we have match data */}
          {(hasAdverseMedia || datasets.some(d => String(d).toLowerCase().includes('adverse'))) && (
            <div>
              <SectionHeading>
                <span className="flex items-center gap-1.5"><Newspaper className="w-3.5 h-3.5" /> Adverse Media</span>
              </SectionHeading>

              {/* adverse_media_matches[] — array of individual match objects from Didit */}
              {adverseMediaMatches.length > 0 && (
                <div className="space-y-2.5 mb-3">
                  <div className="text-xs font-medium text-muted-foreground">Matches ({adverseMediaMatches.length})</div>
                  {adverseMediaMatches.map((match, i) => {
                    // Didit adverse_media_matches shape varies; render all useful fields
                    const title = match.title || match.caption || match.name || match.url || `Match ${i + 1}`;
                    const url = match.url || match.source_url;
                    const date = match.date || match.published_at || match.created_at;
                    const snippet = match.snippet || match.summary || match.description;
                    const source = match.source || match.publisher || match.outlet;
                    const categories = match.categories || match.tags || [];
                    return (
                      <div key={i} className="bg-card border border-border rounded-xl p-3 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {categories.map((c, ci) => (
                            <span key={ci} className="text-xs px-1.5 py-0 rounded font-semibold bg-orange-100 text-orange-700">{c}</span>
                          ))}
                          {source && <span className="text-xs text-muted-foreground">{source}</span>}
                          {date && <span className="text-xs text-muted-foreground/60">{new Date(date).toLocaleDateString?.() ?? date}</span>}
                        </div>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer"
                            className="text-sm font-medium text-primary hover:underline line-clamp-2 flex items-start gap-1">
                            {title}<ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-60" />
                          </a>
                        ) : (
                          <div className="text-sm font-medium line-clamp-2">{title}</div>
                        )}
                        {snippet && <div className="text-xs text-muted-foreground line-clamp-3">{snippet}</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* adverse_media_details — structured object from Didit */}
              {adverseMedia?.adverse_keywords?.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Adverse Keywords</div>
                  <div className="flex flex-wrap gap-1.5">
                    {adverseMedia.adverse_keywords.map((kw, i) => (
                      <span key={i} className="bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full text-xs font-medium">
                        {typeof kw === 'string' ? kw : `${kw.keyword || kw.word}${kw.count ? ` ×${kw.count}` : ''}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {adverseMedia?.articles?.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-medium text-muted-foreground">Articles ({adverseMedia.articles.length})</div>
                  {adverseMedia.articles.slice(0, 8).map((article, i) => (
                    <div key={i} className="bg-card border border-border rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {article.sentiment && (
                          <span className={cn('text-xs px-1.5 py-0 rounded font-semibold',
                            article.sentiment?.toLowerCase().includes('negative') ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'
                          )}>
                            {article.sentiment.toUpperCase()}
                          </span>
                        )}
                        {article.date && <span className="text-xs text-muted-foreground/60">{article.date}</span>}
                      </div>
                      {article.url ? (
                        <a href={article.url} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-medium text-primary hover:underline line-clamp-2 flex items-start gap-1">
                          {article.title || article.url}
                          <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-60" />
                        </a>
                      ) : (
                        <div className="text-sm font-medium line-clamp-2">{article.title}</div>
                      )}
                      {article.snippet && <div className="text-xs text-muted-foreground mt-1 line-clamp-3">{article.snippet}</div>}
                    </div>
                  ))}
                </div>
              )}

              {!hasAdverseMedia && !loading && (
                <div className="text-xs text-muted-foreground italic px-1">
                  Listed as Adverse Media — no article details returned by Didit for this hit.
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  );
}