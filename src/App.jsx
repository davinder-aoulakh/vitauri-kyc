import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import { ThemeProvider } from '@/lib/ThemeProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import { TenantProvider, useTenant } from '@/lib/tenantContext';
import { I18nProvider } from '@/lib/i18n';
import NetworkErrorToast from '@/components/shared/NetworkErrorToast';

// Auth pages
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';

// Page imports
import Dashboard from './pages/Dashboard';
import OpsDashboard from './pages/OpsDashboard';
import CasesList from './pages/CasesList';
import ClientSearch from './pages/ClientSearch';
import NewClient from './pages/NewClient';
import ClientDetail from './pages/ClientDetail';
import CaseWorkspace from './pages/CaseWorkspace';
import MonitoringAlerts from './pages/MonitoringAlerts';
import TenantConfig from './pages/TenantConfig';
import UserManagement from './pages/UserManagement';
import BatchUpload from './pages/BatchUpload';
import BatchScreening from './pages/BatchScreening';
import ClientPortal from './pages/ClientPortal';
import ReviewPlanner from './pages/ReviewPlanner';
import MIDashboard from './pages/MIDashboard';
import AiPromptLibrary from './pages/AiPromptLibrary';
import ArchiveClients from './pages/ArchiveClients';
import AuditLogs from './pages/AuditLogs';
import EntityMap from './pages/EntityMap';
import OutreachDashboard from './pages/OutreachDashboard';
import StandaloneOutreach from './pages/StandaloneOutreach';
import TenantOnboarding from './pages/TenantOnboarding';
import RiskDashboard from './pages/RiskDashboard';

// Redirects Vitauri Ops → /ops, blocks /ops for non-Ops roles
function OpsRouteGuard({ children }) {
  const { currentUser, loading } = useTenant();
  // Wait for user to load before enforcing route rules
  if (loading || !currentUser) return children;

  // Normalise role — may be on user directly or nested under user.data
  const role = currentUser.app_role || currentUser.data?.app_role;
  const isOps = role === 'Vitauri Ops';
  const path = window.location.pathname;

  if (isOps && path === '/') {
    window.location.replace('/ops');
    return null;
  }
  if (!isOps && path === '/ops') {
    window.location.replace('/');
    return null;
  }
  return children;
}

const AuthenticatedApp = () => {
  const { lang } = useTenant();

  return (
    <I18nProvider lang={lang || 'en'}>
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
      <Route path="/batch-screening" element={<BatchScreening />} />
      <Route path="/client/:id" element={<ClientDetail />} />
      <Route path="/entity-map/:clientId" element={<EntityMap />} />

      {/* Monitoring */}
      <Route path="/monitoring" element={<MonitoringAlerts />} />
      <Route path="/outreach-dashboard" element={<OutreachDashboard />} />
      <Route path="/outreach/new" element={<StandaloneOutreach />} />

      {/* Monitoring / Planning */}
      <Route path="/review-planner" element={<ReviewPlanner />} />
      <Route path="/mi-dashboard" element={<MIDashboard />} />
      <Route path="/risk-dashboard" element={<RiskDashboard />} />

      {/* Admin */}
      <Route path="/tenant-config" element={<TenantConfig />} />
      <Route path="/ai-prompts" element={<AiPromptLibrary />} />
      <Route path="/archive" element={<ArchiveClients />} />
      <Route path="/user-management" element={<UserManagement />} />
      <Route path="/audit-logs" element={<AuditLogs />} />

      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </OpsRouteGuard>
    </I18nProvider>
  );
};

function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <Routes>
            {/* Public client portal — no auth required, token-only */}
            <Route path="/portal/:token" element={<ClientPortal />} />
            {/* Public onboarding — token-gated, handles its own auth redirect */}
            <Route path="/onboard/:token" element={<TenantOnboarding />} />

            {/* Public auth pages */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* All other routes require auth */}
            <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
              <Route path="/*" element={
                <TenantProvider>
                  <AuthenticatedApp />
                </TenantProvider>
              } />
            </Route>
          </Routes>
        </Router>
        <Toaster />
        <NetworkErrorToast />
      </QueryClientProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}

export default App;