// KYC Dashboard (KYC + AML layout, phase 9): Reviews & backlog, Management information, Risk portfolio.
// Each tab is the existing page (Dashboard, MI Dashboard, Risk Dashboard) with its own permission check.
import React from 'react';
import { useTenant } from '@/lib/tenantContext';
import { kycDashboardTabs } from '@/lib/amlNav';
import TabbedPage from '@/components/layout/TabbedPage';
import Dashboard from './Dashboard';
import MIDashboard from './MIDashboard';
import RiskDashboard from './RiskDashboard';

const RENDER = { reviews: () => <Dashboard />, mi: () => <MIDashboard />, risk: () => <RiskDashboard /> };

export default function KycDashboard() {
  const { currentUser, tenant } = useTenant();
  const tabs = kycDashboardTabs(currentUser, tenant).map((t) => ({ ...t, render: RENDER[t.id] }));
  return <TabbedPage title="KYC Dashboard" tabs={tabs} />;
}
