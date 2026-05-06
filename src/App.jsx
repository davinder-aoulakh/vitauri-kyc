import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { TenantProvider, useTenant } from '@/lib/tenantContext';

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
import BatchUpload from './pages/BatchUpload';
import ClientPortal from './pages/ClientPortal';
import ReviewPlanner from './pages/ReviewPlanner';
import MIDashboard from './pages/MIDashboard';

// Redirects Vitauri Ops → /ops, blocks /ops for non-Ops roles
function OpsRouteGuard({ children }) {
  const { currentUser, loading } = useTenant();
  // Wait for user to load before enforcing route rules
  if (loading || !currentUser) return children;

  const isOps = currentUser.app_role === 'Vitauri Ops';

  if (isOps && window.location.pathname === '/') {
    window.location.replace('/ops');
    return null;
  }
  if (!isOps && window.location.pathname === '/ops') {
    window.location.replace('/');
    return null;
  }
  return children;
}

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
    <OpsRouteGuard>
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
      <Route path="/batch-upload" element={<BatchUpload />} />
      <Route path="/client/:id" element={<ClientDetail />} />
      <Route path="/org-chart/:clientId" element={<OrgChart />} />

      {/* Monitoring */}
      <Route path="/monitoring" element={<MonitoringAlerts />} />

      {/* Monitoring / Planning */}
      <Route path="/review-planner" element={<ReviewPlanner />} />
      <Route path="/mi-dashboard" element={<MIDashboard />} />

      {/* Admin */}
      <Route path="/tenant-config" element={<TenantConfig />} />
      <Route path="/user-management" element={<UserManagement />} />

      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </OpsRouteGuard>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <Routes>
            {/* Public client portal — no auth required, token-only */}
            <Route path="/portal/:token" element={<ClientPortal />} />
            {/* All other routes require auth */}
            <Route path="/*" element={
              <TenantProvider>
                <AuthenticatedApp />
              </TenantProvider>
            } />
          </Routes>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;