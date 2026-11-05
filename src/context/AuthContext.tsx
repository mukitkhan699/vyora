import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, AppConfig } from '../types/index.ts';
import { api, AuthUser } from '../services/api.ts';

export interface RegisterResult {
  user: User | null;
  emailVerificationRequired: boolean;
  email?: string;
  message?: string;
}

interface AuthContextType {
  currentUser: User | null;
  isAuthenticated: boolean;
  allUsers: User[];
  demoAccounts: Array<User & { defaultPassword?: string }>;
  login: (username: string, password: string) => Promise<User>;
  register: (data: { username: string; email: string; password: string; name?: string }) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  updateCurrentUser: (data: Partial<User>) => Promise<User>;
  unreadNotificationsCount: number;
  refreshNotificationsCount: () => Promise<void>;
  appConfig: AppConfig | null;
  refreshConfig: () => Promise<void>;
  isLoading: boolean;
  authError: string | null;
  setAuthError: (err: string | null) => void;
  pendingVerificationEmail: string | null;
  clearPendingVerification: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toUser(user: AuthUser | User | null | undefined): User | null {
  if (!user) return null;
  return {
    id: String(user.id),
    name: user.name || user.username || 'Zunari Operator',
    username: user.username,
    avatarUrl:
      user.avatarUrl ||
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
    bannerUrl: user.bannerUrl,
    bio: user.bio,
    location: user.location,
    website: user.website,
    verified: Boolean(user.verified),
    isGold: Boolean(user.isGold),
    followersCount: user.followersCount ?? 0,
    followingCount: user.followingCount ?? 0,
    joinedDate: user.joinedDate || 'Joined Just Now',
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [demoAccounts, setDemoAccounts] = useState<Array<User & { defaultPassword?: string }>>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState<number>(0);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);

  const refreshConfig = async () => {
    try {
      const cfg = await api.getConfig();
      setAppConfig(cfg);
      if (cfg.appName && typeof document !== 'undefined') {
        document.title = `${cfg.appName} - Real-Time Social Network`;
      }
    } catch (e) {
      console.warn('Could not fetch server config:', e);
    }
  };

  const refreshUsersAndDemos = async () => {
    try {
      const [users, demos] = await Promise.all([
        api.getUsers().catch(() => []),
        api.getDemoAccounts().then((result) => result.accounts).catch(() => []),
      ]);
      setAllUsers(users);
      setDemoAccounts(demos);
    } catch (e) {
      console.warn('Failed to load users:', e);
    }
  };

  const refreshNotificationsCount = async () => {
    try {
      const notifications = await api.getNotifications();
      setUnreadNotificationsCount(notifications.filter((notification) => !notification.read).length);
    } catch {
      setUnreadNotificationsCount(0);
    }
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      const minimumSplash = new Promise((resolve) => setTimeout(resolve, 650));
      const sessionPromise = api
        .getSession()
        .then((session) => {
          if (session.authenticated && session.user) {
            const user = toUser(session.user);
            setCurrentUser(user);
            return user;
          }
          setCurrentUser(null);
          return null;
        })
        .catch(() => {
          setCurrentUser(null);
          return null;
        });

      await Promise.all([refreshConfig(), sessionPromise, minimumSplash]);
      await refreshUsersAndDemos();
      await refreshNotificationsCount();
      setIsLoading(false);
    };
    init();
  }, []);

  const login = async (username: string, password: string): Promise<User> => {
    setAuthError(null);
    try {
      const res = await api.login(username, password);
      const user = toUser(res.user);
      if (!user) throw new Error('The server did not return a valid account.');
      setCurrentUser(user);
      setPendingVerificationEmail(null);
      await refreshUsersAndDemos();
      await refreshNotificationsCount();
      return user;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setAuthError(message);
      throw new Error(message);
    }
  };

  const register = async (data: {
    username: string;
    email: string;
    password: string;
    name?: string;
  }): Promise<RegisterResult> => {
    setAuthError(null);
    try {
      const res = await api.register(data);
      if (res.authenticated && res.user) {
        const user = toUser(res.user);
        if (user) {
          setCurrentUser(user);
              await refreshUsersAndDemos();
          await refreshNotificationsCount();
          return { user, emailVerificationRequired: false };
        }
      }

      setPendingVerificationEmail(res.email || data.email);
      const message =
        res.message ||
        'Account created. Check your email to verify your address, then sign in.';

      // Email verification is optional in the default local configuration.
      // If the backend allows unverified login, transparently sign in now.
      try {
        const loginRes = await api.login(data.username, data.password);
        const user = toUser(loginRes.user);
        if (user) {
          setCurrentUser(user);
          setPendingVerificationEmail(null);
              await refreshUsersAndDemos();
          await refreshNotificationsCount();
          return { user, emailVerificationRequired: false };
        }
      } catch {
        // Verification required: leave the user on the sign-in screen.
      }

      return {
        user: null,
        emailVerificationRequired: true,
        email: res.email || data.email,
        message,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setAuthError(message);
      throw new Error(message);
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await api.logout();
    } catch (e) {
      console.warn('Backend logout warning:', e);
    } finally {
      setCurrentUser(null);
      setUnreadNotificationsCount(0);
      setPendingVerificationEmail(null);
    }
  };

  const updateCurrentUser = async (data: Partial<User>): Promise<User> => {
    const updated = await api.updateProfile(data);
    setCurrentUser(updated);
    setAllUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
    return updated;
  };

  const clearPendingVerification = () => setPendingVerificationEmail(null);

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
        updateCurrentUser,
        unreadNotificationsCount,
        refreshNotificationsCount,
        appConfig,
        refreshConfig,
        isLoading,
        authError,
        setAuthError,
        pendingVerificationEmail,
        clearPendingVerification,
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
