// Consistent risk classification color mapping

export const RISK_COLORS = {
  Low: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  },
  Medium: {
    bg: 'bg-amber-100',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
  },
  High: {
    bg: 'bg-red-100',
    text: 'text-red-700',
    border: 'border-red-200',
    dot: 'bg-red-500',
    badge: 'bg-red-100 text-red-700 border-red-200',
  },
  Unacceptable: {
    bg: 'bg-red-950',
    text: 'text-red-200',
    border: 'border-red-900',
    dot: 'bg-red-900',
    badge: 'bg-red-950 text-red-200 border-red-900',
  },
};

export const STATUS_COLORS = {
  Draft:               'bg-slate-100 text-slate-600 border-slate-200',
  In_Progress:         'bg-blue-100 text-blue-700 border-blue-200',
  Outreach_Pending:    'bg-purple-100 text-purple-700 border-purple-200',
  Screening:           'bg-orange-100 text-orange-700 border-orange-200',
  Assessment:          'bg-yellow-100 text-yellow-700 border-yellow-200',
  QC:                  'bg-indigo-100 text-indigo-700 border-indigo-200',
  Compliance_Review:   'bg-violet-100 text-violet-700 border-violet-200',
  Sign_Off_Pending:    'bg-amber-100 text-amber-800 border-amber-200',
  Approved:            'bg-emerald-100 text-emerald-700 border-emerald-200',
  Rejected:            'bg-red-100 text-red-700 border-red-200',
  Closed:              'bg-slate-100 text-slate-500 border-slate-200',
};

export const CLIENT_STATUS_COLORS = {
  Prospect:       'bg-blue-100 text-blue-700',
  Active:         'bg-emerald-100 text-emerald-700',
  Inactive:       'bg-slate-100 text-slate-600',
  Former:         'bg-gray-100 text-gray-600',
  Rejected:       'bg-red-100 text-red-700',
  Unacceptable:   'bg-red-950 text-red-200',
};

export function getRiskBadgeClass(risk) {
  return RISK_COLORS[risk]?.badge || 'bg-slate-100 text-slate-600 border-slate-200';
}

export function getStatusBadgeClass(status) {
  return STATUS_COLORS[status] || 'bg-slate-100 text-slate-600 border-slate-200';
}

export function formatStatus(status) {
  return status?.replace(/_/g, ' ') || '—';
}