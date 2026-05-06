import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { TenantProvider } from '@/lib/tenantContext';

// Page imports
import Dashboard from './pages/Dashboard';
import OpsDashboard from './pages/OpsDashboard';
import CasesList from './pages/CasesList';
import ClientSearch from './pages/ClientSearch';
import NewClient from './pages/NewClient';
import ClientDetail from './pages/ClientDetail';
import CaseWorkspace from './pages/CaseWorkspace';
import OrgChart from './pages/OrgChart';
import MonitoringAlerts from './pages/MonitoringAlerts';
import TenantConfig from './pages/TenantConfig';
import UserManagement from './pages/UserManagement';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          <div className="text-xs text-muted-foreground">Loading Vitauri KYC…</div>
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      {/* Main */}
      <Route path="/" element={<Dashboard />} />

      {/* Ops */}
      <Route path="/ops" element={<OpsDashboard />} />

      {/* Cases */}
      <Route path="/my-cases" element={<CasesList myOnly={true} />} />
      <Route path="/all-cases" element={<CasesList myOnly={false} />} />
      <Route path="/case/:id" element={<CaseWorkspace />} />

      {/* Clients */}
      <Route path="/client-search" element={<ClientSearch />} />
      <Route path="/new-client" element={<NewClient />} />
      <Route path="/client/:id" element={<ClientDetail />} />
      <Route path="/org-chart/:clientId" element={<OrgChart />} />

      {/* Monitoring */}
      <Route path="/monitoring" element={<MonitoringAlerts />} />

      {/* Admin */}
      <Route path="/tenant-config" element={<TenantConfig />} />
      <Route path="/user-management" element={<UserManagement />} />

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <TenantProvider>
          <Router>
            <AuthenticatedApp />
          </Router>
        </TenantProvider>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;