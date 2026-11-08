import React, { useState, useEffect } from 'react';
import { 
  Palette, 
  Check,
  ShieldCheck,
  Lock
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme, ThemeMode, AccentColor } from '../../context/ThemeContext.tsx';
import { Button } from '../common/Button.tsx';
import { api } from '../../services/api.ts';

export const SettingsView: React.FC = () => {
  const { currentUser } = useAuth();
  const { theme, setTheme, accent, setAccent } = useTheme();

  const [activeSection, setActiveSection] = useState<'appearance' | 'account'>('appearance');

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<{ success?: boolean; message: string } | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || newPassword.length < 12) {
      setPasswordStatus({ success: false, message: 'New password must be at least 12 characters.' });
      return;
    }
    try {
      setIsChangingPassword(true);
      const res = await api.changePassword(currentPassword, newPassword);
      setPasswordStatus({ success: true, message: res.message || 'Password changed successfully.' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      setPasswordStatus({ success: false, message: err.message || 'Failed to change password.' });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const accentsList: { id: AccentColor; label: string; bg: string }[] = [
    { id: 'cyan', label: 'Electric Cyan', bg: 'bg-[#48D8E8]' },
    { id: 'violet', label: 'Neon Violet', bg: 'bg-[#8B75FF]' },
    { id: 'emerald', label: 'Emerald', bg: 'bg-[#10B981]' },
    { id: 'amber', label: 'Amber', bg: 'bg-[#F59E0B]' },
    { id: 'coral', label: 'Coral', bg: 'bg-[#F43F5E]' },
    { id: 'blue', label: 'Sky Blue', bg: 'bg-[#3B82F6]' },
  ];

  const themesList: { id: ThemeMode; label: string; sub: string; bg: string; text: string; border: string }[] = [
    { id: 'dark', label: 'Dark', sub: 'Obsidian', bg: 'bg-[#090B10]', text: 'text-white', border: 'border-white/10' },
    { id: 'dim', label: 'Dim', sub: 'Dark Navy', bg: 'bg-[#0F172A]', text: 'text-[#F8FAFC]', border: 'border-neutral-700' },
    { id: 'light', label: 'Light', sub: 'Slate White', bg: 'bg-[#F8FAFC]', text: 'text-slate-900', border: 'border-slate-200' },
  ];

  const headerBg = theme === 'dark' ? 'bg-[#090B10]/85 border-white/[0.08]' : theme === 'dim' ? 'bg-[#0F172A]/85 border-neutral-700' : 'bg-white/85 border-slate-200';
  const cardBg = theme === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-[#11151D] border-white/[0.08]';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-xl border-b ${headerBg} px-4 py-3 flex items-center justify-between`}>
        <div>
          <h1 className="text-lg font-black tracking-tight text-white">Settings</h1>
          <p className="text-xs text-neutral-400">Manage your account and appearance</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.08] px-2 overflow-x-auto bg-black/20">
        {[
          { id: 'appearance', label: 'Appearance', icon: Palette },
          { id: 'account', label: 'Account & Security', icon: Lock },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id as 'appearance' | 'account')}
              className={`flex items-center gap-2 py-3 px-3.5 text-xs font-semibold border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                isActive ? `border-cyan-400 text-cyan-300 font-bold bg-cyan-400/[0.06]` : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="p-4 sm:p-6 max-w-2xl flex flex-col gap-5">
        {/* Section: Appearance */}
        {activeSection === 'appearance' && (
          <div className="flex flex-col gap-5">
            <div className={`p-4 rounded-2xl border ${cardBg}`}>
              <h2 className="text-sm font-bold mb-1 text-white">Accent Color</h2>
              <p className="text-xs text-neutral-400 mb-4">Choose your custom accent color for highlights, buttons, and links.</p>
              <div className="flex flex-wrap gap-3">
                {accentsList.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setAccent(item.id)}
                    className={`w-10 h-10 rounded-full ${item.bg} flex items-center justify-center text-black cursor-pointer transition-all hover:scale-105 ${
                      accent === item.id ? 'ring-4 ring-white/30 scale-105 shadow-lg' : ''
                    }`}
                    title={item.label}
                  >
                    {accent === item.id && <Check className="w-5 h-5 stroke-[3px]" />}
                  </button>
                ))}
              </div>
            </div>

            <div className={`p-4 rounded-2xl border ${cardBg}`}>
              <h2 className="text-sm font-bold mb-1 text-white">Theme</h2>
              <p className="text-xs text-neutral-400 mb-4">Choose the display mode for Zunari.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {themesList.map(t => (
                  <div
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${t.bg} ${t.text} ${
                      theme === t.id ? `ring-2 ring-cyan-400 ${t.border}` : t.border
                    }`}
                  >
                    <div>
                      <div className="font-bold text-sm">{t.label}</div>
                      <div className="text-[11px] opacity-70 font-mono mt-0.5">{t.sub}</div>
                    </div>
                    <div className={`w-4.5 h-4.5 rounded-full border flex items-center justify-center ${theme === t.id ? 'border-cyan-400 bg-cyan-400' : 'border-neutral-500'}`}>
                      {theme === t.id && <Check className="w-3 h-3 text-black stroke-[3px]" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Section: Account & Security */}
        {activeSection === 'account' && (
          <div className="flex flex-col gap-5">
            <div className={`p-4 rounded-2xl border ${cardBg}`}>
              <h2 className="text-sm font-bold mb-1 text-white">Account Information</h2>
              <div className="space-y-2 mt-3 text-xs">
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Display Name:</span>
                  <span className="font-bold text-white">{currentUser?.name}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Username:</span>
                  <span className="font-mono text-cyan-300">@{currentUser?.username}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Joined Date:</span>
                  <span className="text-neutral-200">{currentUser?.joinedDate}</span>
                </div>

              </div>
            </div>

            <div className={`p-4 rounded-2xl border ${cardBg}`}>
              <h2 className="text-sm font-bold mb-1 text-white">Change Security Key</h2>
              <p className="text-xs text-neutral-400 mb-3">Update your password to keep your account safe.</p>

              {passwordStatus && (
                <div className={`p-3 rounded-xl mb-3 text-xs ${passwordStatus.success ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                  {passwordStatus.message}
                </div>
              )}

              <form onSubmit={handleChangePassword} className="space-y-3">
                <div>
                  <label className="block text-xs text-neutral-300 mb-1">Current Password</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-300 mb-1">New Password (12+ chars)</label>
                  <input
                    type="password"
                    value={newPassword}
                    minLength={12}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                  />
                </div>
                <Button size="sm" type="submit" isLoading={isChangingPassword} className="mt-2">
                  Update Password
                </Button>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
