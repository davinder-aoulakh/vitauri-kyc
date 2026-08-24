import React from 'react';
import { X, Loader2, ExternalLink, ChevronDown, AlertTriangle, Shield, Newspaper } from 'lucide-react';
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

export default function AmlHitSlidePanel({ hit, hitIndex, loading, onClose, onStatusChange, updatingHitId }) {
  const [dropdownOpen, setDropdownOpen] = React.useState(false);

  if (!hit) return null;

  const hitKey = hit.id || String(hitIndex);
  const isUpdating = updatingHitId === hitKey;
  const reviewStatus = hit.review_status || 'Unreviewed';
  const currentOption = REVIEW_OPTIONS.find(o => o.value === reviewStatus) || REVIEW_OPTIONS[0];

  const matchScore = hit.match_score ?? (hit.score != null ? Math.round(hit.score * 100) : null);
  const riskScore = hit.risk_score ?? null;

  const cats = hit.categories?.length ? hit.categories
    : hit.types?.length ? hit.types.map(t => t.name || t)
    : [];

  const datasets = hit.datasets?.length ? hit.datasets
    : hit.types?.length ? hit.types.map(t => t.name || t)
    : [];

  const adverseMedia = hit.adverse_media || hit.media_analysis;

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
              {cats.slice(0, 2).map((cat, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                  {typeof cat === 'string' ? cat : (cat.name || JSON.stringify(cat))}
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

          {/* Identity Details */}
          <div>
            <SectionHeading>Identity Details</SectionHeading>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
              {(hit.properties?.country || hit.country) && (
                <div>
                  <div className="text-xs text-muted-foreground">Country</div>
                  <div className="font-medium">🌍 {hit.properties?.country || hit.country}</div>
                </div>
              )}
              {(hit.properties?.birthDate || hit.date_of_birth) && (
                <div>
                  <div className="text-xs text-muted-foreground">Date of Birth</div>
                  <div className="font-medium">🗓 {hit.properties?.birthDate || hit.date_of_birth}</div>
                </div>
              )}
              {hit.gender && (
                <div>
                  <div className="text-xs text-muted-foreground">Gender</div>
                  <div className="font-medium">{hit.gender}</div>
                </div>
              )}
              {hit.nationality && (
                <div>
                  <div className="text-xs text-muted-foreground">Nationality</div>
                  <div className="font-medium">{hit.nationality}</div>
                </div>
              )}
              {hit.pep_level && (
                <div>
                  <div className="text-xs text-muted-foreground">PEP Level</div>
                  <div className="font-medium">{hit.pep_level}</div>
                </div>
              )}
              {hit.last_updated && (
                <div>
                  <div className="text-xs text-muted-foreground">Last Updated</div>
                  <div className="font-medium">{hit.last_updated}</div>
                </div>
              )}
              {hit.description && (
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground">Description</div>
                  <div className="font-medium">{hit.description}</div>
                </div>
              )}
            </div>
          </div>

          {/* Categories & Lists */}
          {(cats.length > 0 || datasets.length > 0) && (
            <div>
              <SectionHeading>Categories &amp; Lists</SectionHeading>
              <div className="space-y-2">
                {cats.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {cats.map((cat, i) => (
                      <span key={i} className="bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full text-xs font-medium border border-amber-200">
                        {typeof cat === 'string' ? cat : (cat.name || JSON.stringify(cat))}
                      </span>
                    ))}
                  </div>
                )}
                {datasets.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {datasets.map((ds, i) => {
                      const label = typeof ds === 'string' ? ds : (ds.name || String(ds));
                      return (
                        <span key={i} className="bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full text-xs font-medium border border-purple-200">
                          {label}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sources */}
          {hit.sources?.length > 0 && (
            <div>
              <SectionHeading>Sources</SectionHeading>
              <div className="flex flex-wrap gap-2">
                {hit.sources.map((src, i) => (
                  <span key={i} className="text-xs bg-muted border border-border px-2.5 py-1 rounded-md font-medium">
                    {typeof src === 'string' ? src : (src.name || src.source || JSON.stringify(src))}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Adverse Media */}
          {adverseMedia ? (
            <div>
              <SectionHeading>
                <span className="flex items-center gap-1.5"><Newspaper className="w-3.5 h-3.5" /> Adverse Media</span>
              </SectionHeading>

              {/* Summary bar */}
              <div className="flex flex-wrap items-center gap-3 text-xs mb-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                {adverseMedia.sentiment && (
                  <span className={cn('font-semibold px-2 py-0.5 rounded-full',
                    adverseMedia.sentiment_score < -1 ? 'bg-red-100 text-red-700' :
                    adverseMedia.sentiment_score < 0  ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-600'
                  )}>
                    {adverseMedia.sentiment}
                  </span>
                )}
                {adverseMedia.sentiment_score != null && (
                  <span className="text-muted-foreground">Score: <strong>{adverseMedia.sentiment_score}</strong></span>
                )}
                {adverseMedia.entity_type && (
                  <span className="text-muted-foreground">Entity: <strong>{adverseMedia.entity_type}</strong></span>
                )}
              </div>

              {/* Keywords */}
              {adverseMedia.adverse_keywords?.length > 0 && (
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

              {/* Articles */}
              {adverseMedia.articles?.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-medium text-muted-foreground">
                    Articles ({adverseMedia.articles.length})
                  </div>
                  {adverseMedia.articles.slice(0, 8).map((article, i) => (
                    <div key={i} className="bg-card border border-border rounded-xl p-3 flex gap-3">
                      {article.thumbnail && (
                        <img src={article.thumbnail} alt="" className="w-14 h-12 rounded-lg object-cover flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {article.sentiment && (
                            <span className={cn('text-xs px-1.5 py-0 rounded font-semibold',
                              article.sentiment?.toLowerCase().includes('highly') ? 'bg-red-100 text-red-700' :
                              article.sentiment?.toLowerCase().includes('negative') ? 'bg-orange-100 text-orange-700' :
                              'bg-slate-100 text-slate-600'
                            )}>
                              {article.sentiment.toUpperCase()}
                            </span>
                          )}
                          {article.country && <span className="text-xs text-muted-foreground">🌍 {article.country}</span>}
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
                        {article.snippet && (
                          <div className="text-xs text-muted-foreground mt-1 line-clamp-3">{article.snippet}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!adverseMedia.articles?.length && !adverseMedia.adverse_keywords?.length && (
                <div className="text-xs text-muted-foreground italic">No article or keyword details available.</div>
              )}
            </div>
          ) : (
            !loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-3 px-4 bg-muted/30 rounded-lg border border-border">
                <Shield className="w-4 h-4 flex-shrink-0 opacity-50" />
                No adverse media data for this hit.
              </div>
            )
          )}

          {/* Raw match type */}
          {(hit.match_type || hit.match_types?.length > 0) && (
            <div>
              <SectionHeading>Match Type</SectionHeading>
              <span className="text-xs bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-md font-medium">
                {hit.match_type || hit.match_types?.[0]}
              </span>
            </div>
          )}

        </div>
      </div>
    </>
  );
}