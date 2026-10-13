import React from 'react';

const BAND_TEXT = {
  Low: 'text-risk-low',
  Medium: 'text-risk-medium',
  High: 'text-risk-high',
  Unacceptable: 'text-risk-unacceptable',
};

const R = 44;
const C = 2 * Math.PI * R;

/** Circular dynamic-risk gauge with score, band and 30-day change. */
export default function RiskGauge({ risk }) {
  if (!risk) {
    return (
      <div className="flex items-center gap-4">
        <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-dashed border-border text-xs text-muted-foreground">No score</div>
        <p className="max-w-[180px] text-xs text-muted-foreground">Dynamic risk is computed after the next alert, profile approval or nightly run.</p>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, risk.score)) / 100;
  const delta = risk.delta_30d;
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-28 w-28 flex-shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" strokeWidth="8" className="stroke-muted" />
          <circle
            cx="50" cy="50" r={R} fill="none" strokeWidth="8" strokeLinecap="round"
            className={`${BAND_TEXT[risk.band] || 'text-primary'} stroke-current transition-all duration-700`}
            strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold leading-none text-foreground">{risk.score}</span>
          <span className={`mt-1 text-[11px] font-semibold uppercase tracking-wide ${BAND_TEXT[risk.band] || ''}`}>{risk.band}</span>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {delta == null ? 'No 30-day history yet' : (
          <>was {risk.reference_score} · <span className={delta > 0 ? 'font-medium text-destructive' : 'font-medium text-foreground'}>{delta > 0 ? '+' : ''}{delta}</span> in 30 days</>
        )}
      </div>
    </div>
  );
}