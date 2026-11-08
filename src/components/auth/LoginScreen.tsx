import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  Radio,
  ShieldCheck,
  Sparkles,
  UserRound,
  Zap,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { api } from '../../services/api.ts';
import { VyoraIcon } from '../common/VyoraIcon.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';

type AuthMode = 'signin' | 'register' | 'forgot';

export const LoginScreen: React.FC = () => {
  const {
    login,
    register,
    demoAccounts,
    appConfig,
    authError,
    setAuthError,
    pendingVerificationEmail,
    clearPendingVerification,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('signin');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(pendingVerificationEmail
    ? `Account created. Verify ${pendingVerificationEmail}, then sign in.`
    : null);

  const brandName = appConfig?.appName || 'Zunari';

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setAuthError(null);
    setNotice(null);
    clearPendingVerification();
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setIsSubmitting(true);
    setNotice(null);
    try {
      await login(username.trim(), password);
    } catch {
      // AuthContext exposes the error message.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !email.trim() || password.length < 12) return;
    setIsSubmitting(true);
    setNotice(null);
    try {
      const result = await register({
        username: username.trim(),
        email: email.trim(),
        password,
      });
      if (!result.user) {
        setNotice(result.message || 'Account created. Verify your email, then sign in.');
        setMode('signin');
        setPassword('');
      }
    } catch {
      // AuthContext exposes the error message.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsSubmitting(true);
    setNotice(null);
    setAuthError(null);
    try {
      const result = await api.forgotPassword(email.trim());
      setNotice(result.message || 'If that email exists, a reset link is on its way.');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to send the reset email.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemoLogin = async (demoUsername: string, demoPassword?: string) => {
    setIsSubmitting(true);
    setNotice(null);
    try {
      await login(demoUsername, demoPassword || 'vyora123');
    } catch {
      // AuthContext exposes the error message.
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-xl border border-white/10 bg-white/[0.04] px-11 py-3 text-sm text-white outline-none transition-all placeholder:text-neutral-500 focus:border-cyan-400/70 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-400/10';

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#060910] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(121,40,202,0.22),transparent_38%),radial-gradient(circle_at_82%_78%,rgba(0,242,254,0.16),transparent_42%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:64px_64px]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl items-center px-5 py-8 lg:px-8">
        <div className="grid w-full items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <section className="hidden lg:block">
            <div className="flex items-center gap-3">
              <VyoraIcon size="lg" glow />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-3xl font-black tracking-tight bg-gradient-to-r from-purple-300 via-sky-300 to-cyan-300 bg-clip-text text-transparent">
                    {brandName}
                  </span>
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-cyan-200">
                    Relay
                  </span>
                </div>
                <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.28em] text-neutral-400">
                  Global transmission network
                </p>
              </div>
            </div>

            <h1 className="mt-10 max-w-xl text-5xl font-black leading-[1.05] tracking-tight">
              Secure access to the
              <span className="bg-gradient-to-r from-cyan-300 via-sky-300 to-purple-300 bg-clip-text text-transparent">
                {' '}real-time social relay.
              </span>
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-relaxed text-neutral-400">
              {appConfig?.appDescription ||
                'Broadcast ideas, follow operators, and move information across the network in real time.'}
            </p>

            <div className="mt-9 grid max-w-lg gap-3 sm:grid-cols-2">
              {[
                { icon: ShieldCheck, title: 'Secure sign-in', text: 'Protected access to your account.' },
                { icon: Radio, title: 'Live relay', text: 'Posts, signals, and direct transmissions in one feed.' },
                { icon: Sparkles, title: 'Your communities', text: 'Find people and ideas worth following.' },
                { icon: Zap, title: 'Real-time conversations', text: 'Share updates and stay in the conversation.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 backdrop-blur-sm">
                  <Icon className="h-4 w-4 text-cyan-300" />
                  <h3 className="mt-2.5 text-sm font-bold text-white">{title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-500">{text}</p>
                </div>
              ))}
            </div>

            <div className="mt-9 flex items-center gap-3 text-[11px] font-mono text-neutral-500">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Relay online
              </span>
              <span className="text-neutral-700">/</span>
              <span>Account protection</span>
            </div>
          </section>

          <section className="mx-auto w-full max-w-md">
            <div className="rounded-3xl border border-white/[0.09] bg-[#0a0f18]/90 p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-8">
              <div className="mb-6 flex items-center gap-3 lg:hidden">
                <VyoraIcon size="md" glow />
                <span className="text-xl font-black tracking-tight bg-gradient-to-r from-purple-300 via-sky-300 to-cyan-300 bg-clip-text text-transparent">
                  {brandName}
                </span>
              </div>

              <div className="mb-6">
                <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-cyan-300/80">
                  {mode === 'signin' ? 'Operator access' : mode === 'register' ? 'New operator' : 'Account recovery'}
                </p>
                <h2 className="mt-1.5 text-2xl font-black tracking-tight">
                  {mode === 'signin' ? 'Sign in to your relay' : mode === 'register' ? 'Create your account' : 'Reset your password'}
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  {mode === 'signin'
                    ? 'Use your operator handle and security key.'
                    : mode === 'register'
                      ? 'Register a handle, email, and a strong password.'
                      : 'We will email you a secure reset link.'}
                </p>
              </div>

              {authError && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{authError}</span>
                </div>
              )}

              {notice && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{notice}</span>
                </div>
              )}

              {mode === 'signin' && (
                <form onSubmit={handleSignIn} className="space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-neutral-300">Username</span>
                    <span className="relative block">
                      <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="username"
                        autoComplete="username"
                        autoFocus
                        required
                        className={inputClass}
                      />
                    </span>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-neutral-300">
                      <span>Password</span>
                      <button
                        type="button"
                        onClick={() => switchMode('forgot')}
                        className="cursor-pointer text-[11px] font-semibold text-cyan-300 hover:text-cyan-200"
                      >
                        Forgot?
                      </button>
                    </span>
                    <span className="relative block">
                      <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        autoComplete="current-password"
                        required
                        className={`${inputClass} pr-11`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer text-neutral-500 hover:text-neutral-300"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={isSubmitting || !username.trim() || !password}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 via-sky-500 to-cyan-400 px-4 py-3 text-sm font-bold text-white shadow-[0_12px_30px_-10px_rgba(0,242,254,0.5)] transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? 'Authenticating...' : 'Authenticate operator'}
                    {!isSubmitting && <ArrowRight className="h-4 w-4" />}
                  </button>

                  <p className="text-center text-xs text-neutral-500">
                    New to {brandName}?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('register')}
                      className="cursor-pointer font-semibold text-cyan-300 hover:text-cyan-200"
                    >
                      Create an account
                    </button>
                  </p>
                </form>
              )}

              {mode === 'register' && (
                <form onSubmit={handleRegister} className="space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-neutral-300">Username</span>
                    <span className="relative block">
                      <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="3-32 letters, numbers, underscores"
                        autoComplete="username"
                        minLength={3}
                        maxLength={32}
                        pattern="[A-Za-z0-9_]{3,32}"
                        required
                        className={inputClass}
                      />
                    </span>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-neutral-300">Email address</span>
                    <span className="relative block">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@domain.com"
                        autoComplete="email"
                        required
                        className={inputClass}
                      />
                    </span>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-neutral-300">Security key</span>
                    <span className="relative block">
                      <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 12 characters"
                        autoComplete="new-password"
                        minLength={12}
                        required
                        className={`${inputClass} pr-11`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer text-neutral-500 hover:text-neutral-300"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </span>
                    <span className="mt-1.5 block text-[11px] text-neutral-500">
                      Use 12+ characters. A verification link is emailed to confirm your address.
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={
                      isSubmitting ||
                      !username.trim() ||
                      !email.trim() ||
                      password.length < 12
                    }
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 via-sky-500 to-cyan-400 px-4 py-3 text-sm font-bold text-white shadow-[0_12px_30px_-10px_rgba(0,242,254,0.5)] transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? 'Creating account...' : 'Create account'}
                    {!isSubmitting && <ArrowRight className="h-4 w-4" />}
                  </button>

                  <p className="text-center text-xs text-neutral-500">
                    Already registered?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="cursor-pointer font-semibold text-cyan-300 hover:text-cyan-200"
                    >
                      Sign in
                    </button>
                  </p>
                </form>
              )}

              {mode === 'forgot' && (
                <form onSubmit={handleForgot} className="space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-neutral-300">Account email</span>
                    <span className="relative block">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@domain.com"
                        autoComplete="email"
                        autoFocus
                        required
                        className={inputClass}
                      />
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={isSubmitting || !email.trim()}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 via-sky-500 to-cyan-400 px-4 py-3 text-sm font-bold text-white shadow-[0_12px_30px_-10px_rgba(0,242,254,0.5)] transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? 'Sending link...' : 'Send reset link'}
                    {!isSubmitting && <ArrowRight className="h-4 w-4" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    className="flex w-full cursor-pointer items-center justify-center gap-1.5 text-xs font-semibold text-neutral-400 hover:text-white"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to sign in
                  </button>
                </form>
              )}

              {mode === 'signin' && demoAccounts.length > 0 && (
                <div className="mt-6 border-t border-white/[0.08] pt-5">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-500">
                      <Zap className="h-3 w-3 text-amber-300" />
                      Demo operators
                    </span>
                    <span className="text-[10px] font-mono text-neutral-600">one-click</span>
                  </div>
                  <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                    {demoAccounts.slice(0, 5).map((account) => (
                      <button
                        key={account.id}
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => handleDemoLogin(account.username, account.defaultPassword)}
                        className="group flex w-full cursor-pointer items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-2 text-left transition-all hover:border-cyan-400/30 hover:bg-cyan-400/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar src={account.avatarUrl} name={account.name} size="sm" />
                          <span className="min-w-0 truncate">
                            <span className="flex items-center gap-1 truncate text-xs font-bold text-white">
                              {account.name}
                              {account.verified && <Badge type={account.isGold ? 'gold' : 'blue'} size="sm" />}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-neutral-500">
                              @{account.username}
                            </span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-cyan-300 opacity-70 transition-opacity group-hover:opacity-100">
                          <KeyRound className="h-3.5 w-3.5" />
                          Connect
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 flex items-center justify-between border-t border-white/[0.08] pt-4 text-[10px] font-mono text-neutral-600">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3 w-3 text-emerald-400" />
                  Secure sign-in
                </span>
                <span>Zunari</span>
              </div>
            </div>

            <p className="mt-4 text-center text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-600">
              {brandName} · encrypted operator access
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
