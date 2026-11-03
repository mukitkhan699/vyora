import React, { useState } from 'react';
import { LogIn, UserPlus, Zap, KeyRound, AlertCircle, CheckCircle, Shield } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Modal } from '../common/Modal.tsx';
import { Button } from '../common/Button.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';
import { VyoraIcon } from '../common/VyoraIcon.tsx';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { login, register, demoAccounts, appConfig, authError, setAuthError } = useAuth();
  const { theme } = useTheme();

  const [activeTab, setActiveTab] = useState<'signin' | 'register' | 'demo'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetForm = () => {
    setUsername('');
    setPassword('');
    setName('');
    setBio('');
    setAuthError(null);
    setSuccessMessage(null);
  };

  const handleTabChange = (tab: 'signin' | 'register' | 'demo') => {
    setActiveTab(tab);
    setAuthError(null);
    setSuccessMessage(null);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setIsSubmitting(true);
    setAuthError(null);

    try {
      const user = await login(username.trim(), password.trim() || undefined);
      setSuccessMessage(`Operator authenticated: @${user.username}`);
      setTimeout(() => {
        onClose();
        resetForm();
      }, 400);
    } catch (err: any) {
      // Error handled by AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !name.trim()) return;

    setIsSubmitting(true);
    setAuthError(null);

    try {
      const user = await register({
        username: username.trim(),
        name: name.trim(),
        password: password.trim() || 'vyora123',
        bio: bio.trim(),
      });
      setSuccessMessage(`Account created & logged in: @${user.username}`);
      setTimeout(() => {
        onClose();
        resetForm();
      }, 400);
    } catch (err: any) {
      // Error handled by AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemoLogin = async (demoUsername: string, demoPass?: string) => {
    setIsSubmitting(true);
    setAuthError(null);

    try {
      const user = await login(demoUsername, demoPass || 'vyora123');
      setSuccessMessage(`Connected as @${user.username}`);
      setTimeout(() => {
        onClose();
        resetForm();
      }, 400);
    } catch (err: any) {
      // Error handled by AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass = theme === 'light'
    ? 'w-full bg-slate-100 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-cyan-500 focus:bg-white text-slate-900 transition-all'
    : 'w-full bg-[#0b0e17] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-cyan-400 focus:bg-[#070a0f] text-white transition-all placeholder:text-neutral-500';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" maxWidth="max-w-md">
      <div className="flex flex-col items-center pt-1 pb-3 text-center">
        {/* VYORA Branding Header */}
        <div className="mb-3">
          <VyoraIcon size="lg" glow={true} />
        </div>
        <h2 className="text-2xl font-black tracking-tight bg-gradient-to-r from-purple-400 via-sky-300 to-cyan-300 bg-clip-text text-transparent">
          {appConfig?.appName || 'VYORA'}
        </h2>
        <p className="text-xs text-neutral-400 font-mono mt-0.5 tracking-wider uppercase">
          Backend-Controlled Authentication
        </p>

        {/* Tab Switcher */}
        <div className="w-full grid grid-cols-3 gap-1 bg-white/[0.04] p-1 rounded-xl mt-5 mb-5 border border-white/[0.06]">
          <button
            type="button"
            onClick={() => handleTabChange('signin')}
            className={`py-2 text-xs font-semibold rounded-lg cursor-pointer transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'signin'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('register')}
            className={`py-2 text-xs font-semibold rounded-lg cursor-pointer transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'register'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Register</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('demo')}
            className={`py-2 text-xs font-semibold rounded-lg cursor-pointer transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'demo'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Demo IDs</span>
          </button>
        </div>

        {/* Alerts / Feedback */}
        {authError && (
          <div className="w-full mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2 text-left">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{authError}</span>
          </div>
        )}

        {successMessage && (
          <div className="w-full mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2 text-left">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Tab 1: SIGN IN */}
        {activeTab === 'signin' && (
          <form onSubmit={handleSignIn} className="w-full space-y-3.5 text-left">
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">
                Operator Username or Handle
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. mukitk or elonmusk"
                className={inputClass}
                required
                autoFocus
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-neutral-300">
                  Security Key / Password
                </label>
                <span className="text-[10px] text-neutral-500 font-mono">
                  Default demo: vyora123
                </span>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
              />
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || !username.trim()}
              size="lg"
              className="w-full mt-2 font-bold !rounded-xl"
            >
              {isSubmitting ? 'Authenticating on Backend...' : 'Authenticate Operator'}
            </Button>
          </form>
        )}

        {/* Tab 2: REGISTER */}
        {activeTab === 'register' && (
          <form onSubmit={handleRegister} className="w-full space-y-3 text-left">
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alex Vance"
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">
                Username (@handle)
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. alexvance"
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a password"
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1">
                Bio / Status (Optional)
              </label>
              <input
                type="text"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Building next-gen transmission relays..."
                className={inputClass}
              />
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || !username.trim() || !name.trim()}
              size="lg"
              className="w-full mt-2 font-bold !rounded-xl"
            >
              {isSubmitting ? 'Registering on Node.js...' : 'Create VYORA Account'}
            </Button>
          </form>
        )}

        {/* Tab 3: INSTANT DEMO ACCOUNTS */}
        {activeTab === 'demo' && (
          <div className="w-full space-y-2 text-left">
            <p className="text-xs text-neutral-400 mb-2">
              Select any pre-configured backend operator to sign in instantly:
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {demoAccounts.map((account) => (
                <div
                  key={account.id}
                  onClick={() => handleDemoLogin(account.username, account.defaultPassword)}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-white/[0.08] hover:border-cyan-500/40 hover:bg-cyan-500/[0.08] cursor-pointer transition-all group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar src={account.avatarUrl} name={account.name} size="sm" />
                    <div className="truncate leading-tight">
                      <div className="text-xs font-bold flex items-center gap-1 truncate text-white">
                        {account.name}
                        {account.verified && <Badge type={account.isGold ? 'gold' : 'blue'} size="sm" />}
                      </div>
                      <div className="text-[11px] text-neutral-400 font-mono truncate">
                        @{account.username}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-cyan-400 font-semibold group-hover:translate-x-0.5 transition-transform">
                    <span>Connect</span>
                    <KeyRound className="w-3.5 h-3.5" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-white/[0.08] w-full flex items-center justify-between text-[11px] text-neutral-500 font-mono">
          <span className="flex items-center gap-1">
            <Shield className="w-3 h-3 text-cyan-400" />
            Backend Session Validated
          </span>
          <span>Port 3000 Node.js API</span>
        </div>
      </div>
    </Modal>
  );
};
