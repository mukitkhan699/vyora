import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '../context/ThemeContext.tsx';
import { AuthProvider, useAuth } from '../context/AuthContext.tsx';
import { AdminRoute } from '../components/admin/AdminRoute.tsx';
import { AdminDashboard } from '../components/admin/AdminDashboard.tsx';
import { AdminSidebar } from '../components/admin/AdminSidebar.tsx';
import { AuditLogView } from '../components/admin/AuditLogView.tsx';
import { AppConfig } from '../types/index.tsx';

interface AdminAppProps {
  appConfig: AppConfig | null;
}

function AdminApp({ appConfig }: AdminAppProps) {
  const [currentTab, setCurrentTab] = React.useState<string>('overview');

  const handleAdminLogout = () => {
    setCurrentTab('overview');
  };

  const renderAdminContent = () => {
    switch (currentTab) {
      case 'overview':
        return <AdminDashboard />;
      case 'audit':
        return <AuditLogView />;
      case 'users':
      case 'posts':
      case 'reports':
      case 'stats':
      case 'settings':
      default:
        return (
          <div className="p-6 text-center text-neutral-500">
            <div className="text-6xl mb-4">🚧</div>
            <h2 className="text-xl font-semibold text-white mb-2">
              {currentTab.charAt(0).toUpperCase() + currentTab.slice(1)}
            </h2>
            <p>Coming soon — this section is under development.</p>
          </div>
        );
    }
  };

  return (
    <AdminRoute>
      <div className="min-h-screen flex justify-center selection:bg-cyan-500/30 selection:text-white">
        <div className="flex w-full max-w-7xl justify-between">
          <AdminSidebar
            currentTab={currentTab}
            onSelectTab={setCurrentTab}
            onLogout={() => {}}
          />
          <main className="min-w-0 flex-1 min-h-screen border-r border-white/[0.08] max-w-2xl pb-20 sm:pb-4 w-full">
            {renderAdminContent()}
          </main>
        </div>
      </div>
    </AdminRoute>
  );
}

function AdminShell() {
  const { isLoading, appConfig } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#060910]">
        <div className="h-10 w-10 animate-spin text-cyan-400 rounded-full border-4 border-cyan-400/20" />
      </div>
    );
  }

  return <AdminApp appConfig={appConfig} />;
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <AdminShell />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);