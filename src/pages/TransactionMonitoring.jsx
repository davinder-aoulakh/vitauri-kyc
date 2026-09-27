import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import TransactionForm from '@/components/transactions/TransactionForm';
import TransactionList from '@/components/transactions/TransactionList';
import TransactionDetailPanel from '@/components/transactions/TransactionDetailPanel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Activity, Plus, CheckCircle, ShieldAlert } from 'lucide-react';

export default function TransactionMonitoring() {
  const { currentUser } = useTenant();
  const [transactions, setTransactions] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const loadAll = useCallback(async () => {
    if (!currentUser?.tenant_id) return;
    setLoading(true);
    const [txData, clientData] = await Promise.all([
      base44.entities.Transaction.filter({ tenant_id: currentUser.tenant_id }, '-created_date'),
      base44.entities.Client.filter({ tenant_id: currentUser.tenant_id }),
    ]);
    setTransactions(txData || []);
    setClients(clientData || []);
    setLoading(false);
  }, [currentUser]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Realtime — refresh whenever a Transaction record changes (e.g. webhook updates status).
  useEffect(() => {
    const unsubscribe = base44.entities.Transaction.subscribe(() => { loadAll(); });
    return unsubscribe;
  }, [loadAll]);

  const clientName = (id) => clients.find(c => c.id === id)?.full_name || '—';

  const approvedCount = transactions.filter(t => t.status === 'APPROVED').length;
  const reviewCount = transactions.filter(t => ['IN_REVIEW', 'AWAITING_USER'].includes(t.status)).length;
  const declinedCount = transactions.filter(t => t.status === 'DECLINED').length;

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
        <PageHeader
          title="Transaction Monitoring"
          subtitle="Screen fiat and crypto transactions for sanctions and wallet risk via Didit"
          actions={
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setShowForm(true)}>
              <Plus className="w-3.5 h-3.5" /> New Transaction
            </Button>
          }
        />

        <div className="grid grid-cols-3 gap-3">
          <KpiCard label="Approved" value={loading ? '…' : approvedCount} icon={CheckCircle} accentColor="#10B981" />
          <KpiCard label="Pending Review" value={loading ? '…' : reviewCount} icon={ShieldAlert} accentColor="#F59E0B" />
          <KpiCard label="Declined" value={loading ? '…' : declinedCount} icon={Activity} accentColor="#DC2626" />
        </div>

        <TransactionList
          transactions={transactions}
          clients={clients}
          loading={loading}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          onSelect={setSelected}
        />
      </div>

      {selected && (
        <TransactionDetailPanel
          transaction={selected}
          clientName={clientName(selected.client_id)}
          currentUser={currentUser}
          onClose={() => setSelected(null)}
          onUpdated={loadAll}
        />
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Screen a New Transaction</DialogTitle></DialogHeader>
          <TransactionForm
            clients={clients}
            onCancel={() => setShowForm(false)}
            onCreated={() => { setShowForm(false); loadAll(); }}
          />
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}