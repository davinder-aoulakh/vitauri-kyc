import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { buildCoverageView, coverageRange, fetchAll } from '@/lib/tmCoverage';

const CLOSED_ALERT = ['closed_false_positive', 'closed_no_action', 'reported'];
export const LIFECYCLES = ['booked', 'reversed', 'corrected', 'declined', 'intended'];

/** All coverage data for one tenant + month. Every query is tenant-scoped and filtered on the server. */
export function useCoverageData(tenantId, month, clients, enabled) {
  return useQuery({
    queryKey: ['tmCoverage', tenantId, month, clients?.length || 0],
    enabled: !!tenantId && enabled && !!clients,
    staleTime: 30000,
    queryFn: async () => {
      const { monthStart, monthEnd, start, end } = coverageRange(month);
      const monthFrom = `${monthStart}T00:00:00.000Z`;
      const monthTo = `${monthEnd}T23:59:59.999Z`;
      const [accounts, rows, connections, uploads, inReview, closedAlerts, dupAgg] = await Promise.all([
        fetchAll((cursor) => base44.entities.BankAccount.filter({ tenant_id: tenantId, status: 'active' }, { limit: 500, cursor })),
        fetchAll((cursor) => base44.entities.CoverageDay.filter({ tenant_id: tenantId, date: { $gte: start, $lte: end } }, { sort: 'date', limit: 1000, cursor }), 20),
        fetchAll((cursor) => base44.entities.BankConnection.filter({ tenant_id: tenantId }, { limit: 500, cursor })),
        fetchAll((cursor) => base44.entities.StatementUpload.filter({ tenant_id: tenantId, status: 'committed' }, { sort: '-committed_at', limit: 500, cursor, fields: ['client_id', 'bank_account_id', 'committed_at'] }), 2),
        fetchAll((cursor) => base44.entities.Transaction.filter({ tenant_id: tenantId, status: 'IN_REVIEW', executed_at: { $gte: monthFrom, $lte: monthTo } }, { limit: 1000, cursor, fields: ['id'] })),
        fetchAll((cursor) => base44.entities.TmAlert.filter({ tenant_id: tenantId, status: { $in: CLOSED_ALERT } }, { limit: 1000, cursor, fields: ['transaction_ids'] })),
        base44.entities.TransactionIngestBatch.aggregate({ query: { tenant_id: tenantId, created_date: { $gte: monthFrom, $lte: monthTo } }, sum: ['duplicate_count'] }),
      ]);
      // Tenant-level lifecycle counts for the month (executed date, or intended date for intended transactions).
      const lifecycle = Object.fromEntries(await Promise.all(LIFECYCLES.map(async (lc) => {
        const dateField = lc === 'intended' ? 'intended_at' : 'executed_at';
        const n = await base44.entities.Transaction.count({ tenant_id: tenantId, lifecycle: lc, [dateField]: { $gte: monthFrom, $lte: monthTo } }).catch(() => null);
        return [lc, typeof n === 'number' ? n : n?.count ?? null];
      })));
      const closedTxn = new Set(closedAlerts.flatMap((a) => a.transaction_ids || []));
      const unreviewed = inReview.filter((t) => !closedTxn.has(t.id)).length;
      const duplicates = dupAgg?.rows?.[0]?.sum_duplicate_count || 0;
      return { ...buildCoverageView({ accounts, rows, connections, uploads, clients, start, end, unreviewed, duplicates }), start, end, lifecycle };
    },
  });
}