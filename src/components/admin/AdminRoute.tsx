import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { adminApi, AdminRole, AdminPermissions } from '../../services/adminApi.ts';
import { Loader, AlertCircle, Shield, LogOut } from 'lucide-react';
import { Button } from '../common/Button.tsx';

interface AdminRouteProps {
  children: React.ReactNode;
  allowedRoles?: AdminRole[];
  requiredPermission?: keyof AdminPermissions;
}

/**
 * AdminRoute - Client-side route protection for admin dashboard.
 *
 * SECURITY NOTE: The authorization checks in this component are PRESENTATION-ONLY.
 * They control which UI elements are rendered and whether the login form is shown.
 *
 * ALL SECURITY DECISIONS ARE ENFORCED SERVER-SIDE via:
 * - requireAdminSession() middleware on every /api/admin/* endpoint
 * - requirePermission() checks for specific actions
 * - Role-based permission validation in the backend
 *
 * Frontend role/permission state can be manipulated in the browser;
 * never trust it for security decisions. Backend authorization remains mandatory.
 */
export const AdminRoute: React.FC<AdminRouteProps> = ({
  children,
  allowedRoles,
  requiredPermission,
}) => {
  const { isAdmin, adminRole, adminPermissions, refreshAdminSession, adminLogin, adminLogout, isLoading, authError, setAuthError } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const hasPermission = (permission: keyof AdminPermissions) => {
    if (!adminPermissions) return false;
    const perm = adminPermissions[permission];
    // AdminPermissions values are always objects with boolean properties
    return typeof perm === 'object' && perm !== null && Object.values(perm).some(v => v === true);
  };

  const checkAccess = () => {
    if (!isAdmin || !adminRole) return false;
    if (allowedRoles && !allowedRoles.includes(adminRole)) return false;
    if (requiredPermission && !hasPermission(requiredPermission)) return false;
    return true;
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      await adminLogin(username.trim(), password);
      setShowLogin(false);
      setUsername('');
      setPassword('');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Admin login failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleAdminLogout = async () => {
    await adminLogout();
    setShowLogin(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#060910]">
        <Loader className="h-10 w-10 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (!checkAccess()) {
    if (!isAdmin) {
      return (
        <AdminLoginForm
          show={showLogin || true}
          onClose={() => setShowLogin(false)}
          username={username}
          setUsername={setUsername}
          password={password}
          setPassword={setPassword}
          error={loginError}
          isLoading={isLoggingIn}
          onSubmit={handleAdminLogin}
        />
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-[#060910] text-white p-8">
        <div className="max-w-md text-center">
          <AlertCircle className="h-16 w-16 text-rose-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-neutral-400 mb-6">
            You don't have permission to access the admin dashboard.
            {adminRole && (
              <>
                <br />Your role: <strong className="text-cyan-300 capitalize">{adminRole.replace('_', ' ')}</strong>
              </>
            )}
          </p>
          <Button variant="secondary" onClick={handleAdminLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Switch Account
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

interface AdminLoginFormProps {
  show: boolean;
  onClose: () => void;
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  error: string | null;
  isLoading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

const AdminLoginForm: React.FC<AdminLoginFormProps> = ({
  show,
  onClose,
  username,
  setUsername,
  password,
  setPassword,
  error,
  isLoading,
  onSubmit,
}) => {
  if (!show) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#060910] p-4">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-white/[0.09] bg-[#0a0f18]/90 p-8 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          <div className="mb-8 text-center">
            <Shield className="h-12 w-12 text-cyan-400 mx-auto mb-4" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-300 via-sky-300 to-purple-300 bg-clip-text text-transparent">
              Admin Dashboard
            </h1>
            <p className="mt-2 text-sm text-neutral-500">Secure administrator access</p>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-neutral-300">Username or Email</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin username"
                autoComplete="username"
                autoFocus
                required
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition-all placeholder:text-neutral-500 focus:border-cyan-400/70 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-400/10"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-neutral-300">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                required
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition-all placeholder:text-neutral-500 focus:border-cyan-400/70 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-400/10"
              />
            </label>

            <Button
              type="submit"
              disabled={isLoading || !username.trim() || !password}
              className="w-full"
              size="lg"
            >
              {isLoading ? 'Signing in...' : 'Access Dashboard'}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-neutral-500">
            Only authorized administrators can access this area.
          </p>
        </div>
      </div>
    </div>
  );
};