// AML Dashboard (KYC + AML layout, phase 9, spec sections 2 and 10): Overview, Data coverage, Detection quality.
// Each tab is the existing page (Reports & MI, Data coverage, Quality) with its own permission check.
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useTenant } from '@/lib/tenantContext';
import { amlLayoutOn, amlDashboardTabs } from '@/lib/amlNav';
import TabbedPage from '@/components/layout/TabbedPage';
import TmMi from './TmMi';
import TmCoverage from './TmCoverage';
import TmQuality from './TmQuality';

const RENDER = { overview: () => <TmMi />, coverage: () => <TmCoverage />, quality: () => <TmQuality /> };

export default function AmlDashboard() {
  const { currentUser, tenant, loading } = useTenant();
  if (loading && !tenant) return null;
  if (!amlLayoutOn(tenant)) return <Navigate to="/tm/mi" replace />;
  const tabs = amlDashboardTabs(currentUser, tenant).map((t) => ({ ...t, render: RENDER[t.id] }));
  return <TabbedPage title="AML Dashboard" tabs={tabs} />;
}
