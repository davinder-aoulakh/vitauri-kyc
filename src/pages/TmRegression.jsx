import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isVitauriOps } from '@/lib/permissions';
import AppLogo from '@/components/shared/AppLogo';
import EmptyState from '@/components/shared/EmptyState';
import InlineError from '@/components/shared/InlineError';
import FixtureList from '@/components/ops/regression/FixtureList';
import ResultsTable from '@/components/ops/regression/ResultsTable';
import EndpointCheckPanel from '@/components/ops/regression/EndpointCheckPanel';
import CredentialsPanel from '@/components/ops/regression/CredentialsPanel';
import CredentialReadersTable from '@/components/ops/regression/CredentialReadersTable';
import RlsCoverageTable from '@/components/ops/regression/RlsCoverageTable';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, FlaskConical, Loader2, Play } from 'lucide-react';

const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';

export default function TmRegression() {
  const { currentUser } = useTenant();
  const navigate = useNavigate();
  const [demos, setDemos] = useState([]);
  const [tenantId, setTenantId] = useState('');
  const [fixtures, setFixtures] = useState([]);
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (currentUser && !isVitauriOps(currentUser.app_role)) navigate('/');
  }, [currentUser]);

  useEffect(() => {
    if (!isVitauriOps(currentUser?.app_role)) return;
    base44.entities.Tenant.filter({ status: 'Demo' }).then((list) => setDemos(Array.isArray(list) ? list : list?.items || []));
  }, [currentUser]);

  async function loadTenant(id) {
    setTenantId(id); setError(''); setRun(null); setLoading(true);
    try {
      await base44.functions.invoke('runTmRegression', { action: 'seed', tenant_id: id });
      const fx = await base44.entities.TmTestFixture.filter({ tenant_id: id }, { sort: 'order', limit: 100 });
      setFixtures(fx.items || fx);
      const last = await base44.entities.TmRegressionRun.filter({ tenant_id: id }, { sort: '-created_date', limit: 1 });
      setRun((last.items || last)[0] || null);
    } catch (e) { setError(errMsg(e)); }
    setLoading(false);
  }

  async function runSuite() {
    setRunning(true); setError('');
    try {
      const res = await base44.functions.invoke('runTmRegression', { action: 'run', tenant_id: tenantId });
      setRun(res.data.run);
    } catch (e) { setError(errMsg(e)); }
    setRunning(false);
  }

  return (
    <div className="min-h-screen bg-background font-inter">
      <header className="h-14 bg-navy border-b border-navy-border flex items-center gap-3 px-6">
        <AppLogo size={28} />
        <span className="text-white font-semibold text-sm">Vitauri KYC</span>
        <span className="text-white/40 text-sm">|</span>
        <span className="text-white/60 text-xs font-medium uppercase tracking-widest">TM regression test harness</span>
      </header>
      <div className="p-6 max-w-screen-xl mx-auto space-y-5">
        <button onClick={() => navigate('/ops')} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Ops dashboard</button>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
          <b>Test harness.</b> Demo tenants only. Replays signed sample Didit webhooks through the live webhook with tm_core OFF and then ON, then restores the original flag.
          Test clients, cases and transactions are created and removed automatically. Terminal session fixtures use placeholder session ids; put a real Didit session id in the payload to exercise the full path.
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={tenantId} onValueChange={loadTenant}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Choose a Demo tenant" /></SelectTrigger>
            <SelectContent>{demos.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={runSuite} disabled={!tenantId || loading || running || fixtures.length === 0} className="gap-2">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} {running ? 'Running… (about a minute)' : 'Run regression'}
          </Button>
        </div>
        {error && <InlineError message={error} onRetry={tenantId ? () => loadTenant(tenantId) : undefined} />}
        {!tenantId && <EmptyState icon={FlaskConical} title="Choose a Demo tenant" description={demos.length ? 'Fixtures are seeded automatically the first time.' : 'No Demo tenants exist. Set a tenant status to Demo first.'} />}
        {loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {tenantId && !loading && fixtures.length > 0 && <FixtureList fixtures={fixtures} />}
        {run && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-semibold text-sm">Last run</span>
              <span className="text-muted-foreground">{run.started_at && new Date(run.started_at).toLocaleString()} by {run.run_by_name}</span>
              <span className="text-emerald-700 font-medium">{run.passed} passed</span>
              <span className={run.failed ? 'text-red-600 font-medium' : 'text-muted-foreground'}>{run.failed} failed</span>
              <span className={run.flag_restored ? 'text-muted-foreground' : 'text-red-600 font-semibold'}>{run.flag_restored ? 'tm_core restored' : 'tm_core NOT restored, check Features'}</span>
            </div>
            {run.error && <InlineError message={run.error} />}
            <ResultsTable results={run.results || []} />
          </div>
        )}
        {tenantId && <EndpointCheckPanel tenantId={tenantId} />}
        <CredentialsPanel />
        <CredentialReadersTable />
        <RlsCoverageTable />
      </div>
    </div>
  );
}