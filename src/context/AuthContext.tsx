import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, AppConfig } from '../types/index.ts';
import { api } from '../services/api.ts';
import { cdnManager } from '../utils/cdnManager.ts';

interface AuthContextType {
  currentUser: User | null;
  isAuthenticated: boolean;
  allUsers: User[];
  demoAccounts: Array<User & { defaultPassword?: string }>;
  login: (username: string, password?: string) => Promise<User>;
  register: (data: { username: string; name: string; password?: string; avatarUrl?: string; bio?: string }) => Promise<User>;
  logout: () => Promise<void>;
  switchUser: (user: User) => Promise<void>;
  updateCurrentUser: (data: Partial<User>) => Promise<User>;
  unreadNotificationsCount: number;
  refreshNotificationsCount: () => Promise<void>;
  appConfig: AppConfig | null;
  refreshConfig: () => Promise<void>;
  isLoading: boolean;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  authError: string | null;
  setAuthError: (err: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [demoAccounts, setDemoAccounts] = useState<Array<User & { defaultPassword?: string }>>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState<number>(0);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshConfig = async () => {
    try {
      const cfg = await api.getConfig();
      setAppConfig(cfg);
      if (cfg.appName && typeof document !== 'undefined') {
        document.title = `${cfg.appName} - Global Transmission Platform`;
      }
      if (cfg.cdnUrls && cfg.cdnUrls.length > 0) {
        cdnManager.setCdns(cfg.cdnUrls);
      }
    } catch (e) {
      console.warn('Could not fetch server config:', e);
    }
  };

  const refreshUsersAndDemos = async () => {
    try {
      const [users, demos] = await Promise.all([
        api.getUsers().catch(() => []),
        api.getDemoAccounts().then(r => r.accounts).catch(() => []),
      ]);
      setAllUsers(users);
      setDemoAccounts(demos);
    } catch (e) {
      console.warn('Failed to load users:', e);
    }
  };

  const checkBackendSession = async () => {
    try {
      const sessionRes = await api.getSession();
      if (sessionRes.authenticated && sessionRes.user) {
        setCurrentUser(sessionRes.user);
        api.setCurrentUserId(sessionRes.user.id);
        return sessionRes.user;
      }
    } catch (e) {
      // If token expired or none stored, attempt default session login or prompt
    }

    // Check if there is an active user stored or fallback to primary operator
    try {
      const savedUserId = localStorage.getItem('x_active_user_id') || 'mukitk';
      const loginRes = await api.login(savedUserId, 'vyora123');
      if (loginRes.user) {
        setCurrentUser(loginRes.user);
        return loginRes.user;
      }
    } catch (err) {
      // If auto-login fails, let currentUser be null so auth modal or sign-in is shown
      setCurrentUser(null);
    }
    return null;
  };

  const refreshNotificationsCount = async () => {
    try {
      const notifs = await api.getNotifications();
      const unread = notifs.filter(n => !n.read).length;
      setUnreadNotificationsCount(unread);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      // Artificial slight delay for smooth launcher branding display
      const minSplashTime = new Promise(resolve => setTimeout(resolve, 800));
      await Promise.all([refreshConfig(), refreshUsersAndDemos(), checkBackendSession(), minSplashTime]);
      await refreshNotificationsCount();
      setIsLoading(false);
    };
    init();
  }, []);

  const login = async (username: string, password?: string): Promise<User> => {
    setAuthError(null);
    try {
      const res = await api.login(username, password);
      setCurrentUser(res.user);
      localStorage.setItem('x_active_user_id', res.user.username);
      setIsAuthModalOpen(false);
      await refreshNotificationsCount();
      return res.user;
    } catch (err: any) {
      const msg = err.message || 'Login failed';
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const register = async (data: {
    username: string;
    name: string;
    password?: string;
    avatarUrl?: string;
    bio?: string;
  }): Promise<User> => {
    setAuthError(null);
    try {
      const res = await api.register(data);
      setCurrentUser(res.user);
      localStorage.setItem('x_active_user_id', res.user.username);
      setAllUsers(prev => [res.user, ...prev]);
      setIsAuthModalOpen(false);
      await refreshNotificationsCount();
      return res.user;
    } catch (err: any) {
      const msg = err.message || 'Registration failed';
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await api.logout();
    } catch (e) {
      console.warn('Backend logout warning:', e);
    } finally {
      setCurrentUser(null);
      localStorage.removeItem('x_active_user_id');
      setIsAuthModalOpen(true);
    }
  };

  const switchUser = async (user: User) => {
    try {
      // Authenticate via backend credentials
      const res = await api.login(user.username, 'vyora123');
      setCurrentUser(res.user);
      localStorage.setItem('x_active_user_id', res.user.username);
      await refreshNotificationsCount();
    } catch (e) {
      // Fallback
      setCurrentUser(user);
      api.setCurrentUserId(user.id);
      localStorage.setItem('x_active_user_id', user.username);
      refreshNotificationsCount();
    }
  };

  const updateCurrentUser = async (data: Partial<User>): Promise<User> => {
    const updated = await api.updateProfile(data);
    setCurrentUser(updated);
    setAllUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
    return updated;
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated: !!currentUser,
        allUsers,
        demoAccounts,
        login,
        register,
        logout,
        switchUser,
        updateCurrentUser,
        unreadNotificationsCount,
        refreshNotificationsCount,
        appConfig,
        refreshConfig,
        isLoading,
        isAuthModalOpen,
        setIsAuthModalOpen,
        authError,
        setAuthError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
