// ZUNARI CONTROL CENTER — ADMIN SHELL COMPONENTS
import React, { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { ZCC } from '../../zcc';
import { Activity, FileText, Flag, BadgeCheck, Sparkles, Plug, TableProperties, Users, Wallet, Gauge, ShieldCheck, ScrollText, ShieldAlert, Cpu, Bell } from 'lucide-react';

// Admin Navigation Data (matching prototype)
export const ADMIN_NAV = [
  {
    group: "Overview",
    items: [
      { id: "overview", label: "Dashboard", icon: "layout-dashboard", desc: "Operational overview of the platform." },
      { id: "analytics", label: "Platform Analytics", icon: "chart-no-axes-combined", desc: "Growth, engagement and audience analysis." },
      { id: "health", label: "System Health", icon: "activity", desc: "Service status, incidents and queue depth." },
    ],
  },
  {
    group: "Community Management",
    items: [
      { id: "users", label: "Users & Accounts", icon: "users", desc: "Every account on the platform, its status and restrictions." },
      { id: "content", label: "Content Management", icon: "file-text", desc: "Discover, review and moderate published content." },
      { id: "reports", label: "Reports & Moderation", icon: "flag", desc: "Report queue, decisions and appeals." },
      { id: "verification", label: "Verification & Badges", icon: "badge-check", desc: "Verification applications and the badge programme." },
    ],
  },
  {
    group: "AI Intelligence",
    accent: "ai",
    items: [
      { id: "ai-overview", label: "AI Overview", icon: "sparkles", desc: "Total AI traffic, cost, latency and budget health." },
      { id: "ai-providers", label: "Providers & Models", icon: "plug", desc: "Provider directory, model catalogue and pricing." },
      { id: "ai-usage", label: "Usage Explorer", icon: "table-properties", desc: "Request-level ledger with advanced filters." },
      { id: "ai-users", label: "User & Feature Usage", icon: "users-round", desc: "Consumption by account, by feature and by quota." },
      { id: "ai-costs", label: "Costs & Budgets", icon: "wallet", desc: "Expenditure, budgets, quotas and projections." },
      { id: "ai-performance", label: "Performance & Errors", icon: "gauge", desc: "Success rate, latency, failures and anomalies." },
    ],
  },
  {
    group: "Security & Governance",
    items: [
      { id: "admin-accounts", label: "Admin Accounts & Roles", icon: "shield-check", desc: "Administrator accounts, roles and permissions." },
      { id: "audit", label: "Audit Logs", icon: "scroll-text", desc: "Every administrative action, filterable and exportable." },
      { id: "security", label: "Security Events", icon: "shield-alert", desc: "Threat signals, session posture and control status." },
    ],
  },
  {
    group: "Configuration",
    items: [
      { id: "settings", label: "Platform Settings", icon: "settings", desc: "Platform-wide configuration and policy." },
      { id: "ai-config", label: "AI Configuration", icon: "cpu", desc: "Provider credentials, feature routing and privacy." },
      { id: "notifications", label: "Notification Settings", icon: "bell", desc: "Which events notify whom, and where." },
    ],
  },
];

export const AdminSidebar: React.FC<{ 
  currentTab: string; 
  onSelectTab: (tab: string) => void; 
  onLogout: () => void;
}> = ({ currentTab, onSelectTab, onLogout }) => {
  const { theme, setTheme, sidebar, setSidebar } = useTheme();
  const navItems = ZCC.flatNav;

  return (
    <aside className="zc-shell__sidebar" data-sidebar={sidebar}>
      <div className="zc-shell__sidebar-header">
        <div className="zc-shell__brand">
          <div className="zc-shell__logo">
            <span className="zc-icon">Z</span>
          </div>
          <span className="zc-shell__title">Zunari CC</span>
        </div>
        <button 
          className="zc-shell__collapse-btn"
          onClick={() => setSidebar(sidebar === 'expanded' ? 'collapsed' : 'expanded')}
          aria-label={sidebar === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebar === 'expanded' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
      </div>

      <nav className="zc-shell__nav">
        {ADMIN_NAV.map((group, groupIndex) => (
          <div key={groupIndex} className="zc-shell__nav-group">
            {sidebar === 'expanded' && (
              <div className="zc-shell__group-title">{group.group}</div>
            )}
            <ul className="zc-shell__nav-list">
              {group.items.map((item) => {
                const IconComponent = {
                  'layout-dashboard': Menu,
                  'chart-no-axes-combined': Activity,
                  'activity': Activity,
                  'users': Users,
                  'file-text': FileText,
                  'flag': Flag,
                  'badge-check': BadgeCheck,
                  'sparkles': Sparkles,
                  'plug': Plug,
                  'table-properties': TableProperties,
                  'users-round': Users,
                  'wallet': Wallet,
                  'gauge': Gauge,
                  'shield-check': ShieldCheck,
                  'scroll-text': ScrollText,
                  'shield-alert': ShieldAlert,
                  'settings': Settings,
                  'cpu': Cpu,
                  'bell': Bell,
                }[item.icon] || Menu;

                return (
                  <li key={item.id} className="zc-shell__nav-item">
                    <button
                      className={`zc-shell__nav-link ${currentTab === item.id ? 'active' : ''} ${group.accent === 'ai' ? 'ai-accent' : ''}`}
                      onClick={() => onSelectTab(item.id)}
                      title={sidebar === 'expanded' ? item.desc : item.label}
                    >
                      <IconComponent size={20} className="zc-shell__nav-icon" />
                      {sidebar === 'expanded' && (
                        <span className="zc-shell__nav-label">{item.label}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="zc-shell__sidebar-footer">
        <div className="zc-shell__theme-toggle">
          <button
            className={`zc-shell__theme-btn ${theme === 'light' ? 'active' : ''}`}
            onClick={() => setTheme('light')}
            aria-label="Light theme"
          >
            <Sun size={18} />
          </button>
          <button
            className={`zc-shell__theme-btn ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => setTheme('dark')}
            aria-label="Dark theme"
          >
            <Moon size={18} />
          </button>
        </div>
        <button
          className="zc-shell__logout-btn"
          onClick={onLogout}
          title="Logout"
        >
          <LogOut size={20} />
          {sidebar === 'expanded' && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
};

export const AdminTopbar: React.FC<{ title: string; currentTab: string; onMenuClick: () => void; }> = ({ 
  title, 
  currentTab, 
  onMenuClick 
}) => {
  const { theme, setTheme } = useTheme();

  return (
    <header className="zc-shell__topbar">
      <div className="zc-shell__topbar-left">
        <button 
          className="zc-shell__menu-btn"
          onClick={onMenuClick}
          aria-label="Toggle menu"
        >
          <Menu size={20} />
        </button>
        <div className="zc-shell__breadcrumb">
          <span className="zc-shell__breadcrumb-item">Control Center</span>
          <span className="zc-shell__breadcrumb-separator">/</span>
          <span className="zc-shell__breadcrumb-item active">{title}</span>
        </div>
      </div>

      <div className="zc-shell__topbar-right">
        <div className="zc-shell__theme-mobile">
          <button
            className={`zc-shell__theme-btn ${theme === 'light' ? 'active' : ''}`}
            onClick={() => setTheme('light')}
            aria-label="Light theme"
          >
            <Sun size={18} />
          </button>
          <button
            className={`zc-shell__theme-btn ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => setTheme('dark')}
            aria-label="Dark theme"
          >
            <Moon size={18} />
          </button>
        </div>
      </div>
    </header>
  );
};

export const AdminShell: React.FC<{ 
  children: React.ReactNode; 
  currentTab: string; 
  onSelectTab: (tab: string) => void; 
  onLogout: () => void;
}> = ({ children, currentTab, onSelectTab, onLogout }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { sidebar } = useTheme();

  return (
    <div className="zc-shell">
      <AdminSidebar
        currentTab={currentTab}
        onSelectTab={onSelectTab}
        onLogout={onLogout}
      />

      <main className="zc-shell__main" data-sidebar={sidebar}>
        <AdminTopbar
          title={currentTab.charAt(0).toUpperCase() + currentTab.slice(1)}
          currentTab={currentTab}
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
        />

        <div className="zc-shell__content">
          {children}
        </div>
      </main>

      {sidebarOpen && (
        <div 
          className="zc-shell__mobile-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
};
