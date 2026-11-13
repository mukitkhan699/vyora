// ZUNARI CONTROL CENTER — DEVELOPMENT SHOWCASE
// This component demonstrates the design foundation components.
// Intended for development and testing purposes only.
// NOT intended for production use.

import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { AdminShell } from './AdminShell';
import { Loader, AlertCircle } from 'lucide-react';

export const DesignFoundationTest: React.FC = () => {
  const { theme, setTheme, sidebar, setSidebar, tokens } = useTheme();
  const [currentTab, setCurrentTab] = useState('overview');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const handleLogin = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentTab('overview');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#060910]">
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          <div className="zc-card zc-card--raised zc-card__body--tight p-8 w-full">
            <h1 className="text-2xl font-bold text-white mb-2">Welcome to Zunari Control Center</h1>
            <p className="text-sm text-neutral-500 mb-4">This is a development showcase for design foundation components and should not be used in production.</p>
            
            <div className="space-y-4">
              <button 
                onClick={handleLogin}
                className="zc-btn zc-btn--primary zc-btn--block"
              >
                Sign In as Admin
              </button>
              
              <div className="text-center text-xs text-neutral-500 mt-4">
                Default credentials: super_admin / admin123
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AdminShell
      currentTab={currentTab}
      onSelectTab={setCurrentTab}
      onLogout={handleLogout}
    >
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-2">Development Showcase</h1>
          <p className="text-neutral-300">This showcases the design foundation components for development and testing.</p>
        </div>

        {/* Demo KPI Component */}
        <div className="zc-stack zc-stack--sm mb-6">
          <h2 className="zc-section-head__title">Key Performance Indicators</h2>
          <div className="zc-grid zc-grid--4--2">
            <div className="zc-kpi">
              <p className="zc-kpi__label">Active Users</p>
              <div className="zc-kpi__value">1,284</div>
              <div className="zc-kpi__delta up">
                <span className="zc-delta__value">+12.3%</span>
                <span className="zc-delta__label">vs last month</span>
              </div>
            </div>

            <div className="zc-kpi">
              <p className="zc-kpi__label">Active Sessions</p>
              <div className="zc-kpi__value">3,847</div>
              <div className="zc-kpi__delta up">
                <span className="zc-delta__value">+5.2%</span>
                <span className="zc-delta__label">vs last month</span>
              </div>
            </div>

            <div className="zc-kpi">
              <p className="zc-kpi__label">Content Items</p>
              <div className="zc-kpi__value">45,920</div>
              <div className="zc-kpi__delta down">
                <span className="zc-delta__value">-2.1%</span>
                <span className="zc-delta__label">vs last month</span>
              </div>
            </div>

            <div className="zc-kpi">
              <p className="zc-kpi__label">Storage Used</p>
              <div className="zc-kpi__value">15.6</div>
              <div className="zc-kpi__delta up">
                <span className="zc-delta__value">+0.8%</span>
                <span className="zc-delta__label">vs last month</span>
              </div>
            </div>
          </div>
        </div>

        {/* Demo Chart Component */}
        <div className="zc-card">
          <div className="zc-card__header">
            <h3 className="zc-section-head__title">User Growth</h3>
          </div>
          <div className="zc-card__body">
            <div className="zc-chart zc-chart--line" style="height: 250px">
              <div className="zc-chart__content">Chart would render here in production</div>
            </div>
          </div>
        </div>

        {/* Demo Badge Component */}
        <div className="mt-6">
          <h3 className="zc-section-head__title">Status Badges</h3>
          <div className="flex gap-2 mt-2">
            <span className="zc-badge zc-badge--success zc-badge--sm">Active</span>
            <span className="zc-badge zc-badge--accent zc-badge--sm">Verified</span>
            <span className="zc-badge zc-badge--violet zc-badge--sm">Admin</span>
            <span className="zc-badge zc-badge--info zc-badge--sm">Production</span>
          </div>
        </div>
      </div>
    </AdminShell>
  );
};
