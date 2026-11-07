import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '../context/ThemeContext.tsx';
import { AuthProvider, useAuth } from '../context/AuthContext.tsx';
import { AdminRoute } from '../components/admin/AdminRoute.tsx';
import { AdminDashboard } from '../components/admin/AdminDashboard.tsx';
import { AdminSidebar } from '../components/admin/AdminSidebar.tsx';
import { AuditLogView } from '../components/admin/AuditLogView.tsx';
import { UsersView } from '../components/admin/UsersView.tsx';
import { VerificationView } from '../components/admin/VerificationView.tsx';
import { GoldMembershipView } from '../components/admin/GoldMembershipView.tsx';
import { ReportsView } from '../components/admin/ReportsView.tsx';
import { AuditLogView as AuditLogViewFull } from '../components/admin/AuditLogView.tsx';
import { AdminAccountsView } from '../components/admin/AdminAccountsView.tsx';
import { AdminSettingsView } from '../components/admin/AdminSettingsView.tsx';
import { Loader, AlertCircle } from 'lucide-react';
import { AppConfig } from '../types/index.tsx';

interface AdminAppProps {
  appConfig: AppConfig | null;
}

function AdminApp({ appConfig }: AdminAppProps) {
  const { isAdmin, adminRole, adminLogout, refreshAdminSession } = useAuth();
  const [currentTab, setCurrentTab] = React.useState<string>('overview');
  const [sessionVerified, setSessionVerified] = React.useState(false);

  // Verify admin session on mount and when tab changes
  React.useEffect(() => {
    const verifySession = async () => {
      try {
        await refreshAdminSession();
        setSessionVerified(true);
      } catch {
        setSessionVerified(false);
      }
    };
    verifySession();
  }, [refreshAdminSession]);

  const handleAdminLogout = async () => {
    await adminLogout();
    setCurrentTab('overview');
  };

  const renderAdminContent = () => {
    switch (currentTab) {
      case 'overview':
        return <AdminDashboard />;
      case 'users':
        return <UsersView />;
      case 'verification':
        return <VerificationView />;
      case 'gold':
        return <GoldMembershipView />;
      case 'reports':
        return <ReportsView />;
      case 'audit':
        return <AuditLogViewFull />;
      case 'admin-accounts':
        return <AdminAccountsView />;
      case 'settings':
        return <AdminSettingsView />;
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

  if (!sessionVerified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#060910]">
        <div className="flex flex-col items-center gap-4">
          <Loader className="h-10 w-10 animate-spin text-cyan-400" />
          <p className="text-neutral-400">Verifying admin session...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <AdminRoute>
        <div className="min-h-screen flex items-center justify-center bg-[#060910] p-4">
          <div className="w-full max-w-md">
            <div className="rounded-3xl border border-white/[0.09] bg-[#0a0f18]/90 p-8 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl">
              <div className="mb-8 text-center">
                <AlertCircle className="h-12 w-12 text-rose-500 mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-white mb-2">Admin Access Required</h1>
                <p className="text-sm text-neutral-500">
                  Please sign in with an admin account to access the dashboard.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminRoute>
    );
  }

  return (
    <div className="min-h-screen flex justify-center selection:bg-cyan-500/30 selection:text-white">
      <div className="flex w-full max-w-7xl justify-between">
        <AdminSidebar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          onLogout={handleAdminLogout}
        />
        <main className="min-w-0 flex-1 min-h-screen border-r border-white/[0.08] pb-20 sm:pb-4 w-full">
          {renderAdminContent()}
        </main>
      </div>
    </div>
  );
}

function AdminShell() {
  const { isLoading, appConfig } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#060910]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin text-cyan-400 rounded-full border-4 border-cyan-400/20" />
          <p className="text-neutral-400">Initializing...</p>
        </div>
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