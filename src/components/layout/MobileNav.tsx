import React, { useState } from 'react';
import { Home, Hash, Bell, Bookmark, User as UserIcon, Settings as SettingsIcon, Mail, LogOut, MoreHorizontal } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { useKeyboardOpen } from '../../hooks/useKeyboard.ts';

interface MobileNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({ currentTab, onSelectTab }) => {
  const { unreadNotificationsCount, logout } = useAuth();
  const { theme, accentTextClass } = useTheme();
  const keyboardOpen = useKeyboardOpen();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'explore', icon: Hash, label: 'Explore' },
    { id: 'notifications', icon: Bell, label: 'Notifications', badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : null },
    { id: 'bookmarks', icon: Bookmark, label: 'Saved' },
    { id: 'qelari', icon: null, label: 'Qelari' },
    { id: 'profile', icon: UserIcon, label: 'Profile' },
  ];

  const bg =
    theme === 'dark'
      ? 'bg-[#090B10]/95 border-white/[0.08]'
      : theme === 'dim'
        ? 'bg-[#0F172A]/95 border-neutral-700'
        : 'bg-white/95 border-slate-200';

  if (keyboardOpen) return null;

  return (
    <nav
      aria-label="Mobile Navigation"
      className={`sm:hidden fixed bottom-0 left-0 right-0 z-40 h-[var(--z-mobile-nav-height)] border-t ${bg} backdrop-blur-xl flex items-center justify-around py-2 px-1 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] transition-opacity duration-150`}
    >
      {accountMenuOpen && (
        <div className={`absolute bottom-full right-2 mb-2 w-52 rounded-2xl border p-2 shadow-2xl ${
          theme === 'light' ? 'bg-white border-slate-200' : 'bg-[#10131A] border-white/10'
        }`}>
          <button
            type="button"
            onClick={() => {
              setAccountMenuOpen(false);
              onSelectTab('settings');
            }}
            className="w-full flex items-center gap-2 rounded-xl p-2.5 text-left text-sm text-neutral-300 hover:bg-white/[0.06]"
          >
            <SettingsIcon className="w-4 h-4 text-violet-400" />
            Settings
          </button>
          <button
            type="button"
            onClick={() => {
              setAccountMenuOpen(false);
              onSelectTab('messages');
            }}
            className="w-full flex items-center gap-2 rounded-xl p-2.5 text-left text-sm text-neutral-300 hover:bg-white/[0.06]"
          >
            <Mail className="w-4 h-4 text-cyan-400" />
            Messages
          </button>
          <button
            type="button"
            onClick={() => {
              setAccountMenuOpen(false);
              void logout();
            }}
            className="w-full flex items-center gap-2 rounded-xl p-2.5 text-left text-sm text-rose-400 hover:bg-rose-500/10"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      )}
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = currentTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setAccountMenuOpen(false);
              onSelectTab(item.id);
            }}
            aria-label={item.label}
            className="relative p-2 rounded-xl cursor-pointer transition-colors active:scale-90"
          >
            {item.id === 'qelari' ? (
              <img
                src="/qelari_navbar_logo.svg"
                alt=""
                aria-hidden="true"
                className={`w-5.5 h-5.5 object-contain transition-opacity ${
                  isActive ? '' : 'opacity-75'
                }`}
              />
            ) : Icon ? (
              <Icon
                className={`w-5.5 h-5.5 transition-colors ${
                  isActive ? `stroke-[2.5px] ${accentTextClass}` : 'text-neutral-400'
                }`}
              />
            ) : null}
            {item.badge && (
              <span className="absolute top-1 right-1 bg-cyan-400 text-black text-[10px] font-black rounded-full w-4 h-4 flex items-center justify-center shadow-xs">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setAccountMenuOpen((open) => !open)}
        aria-label="Account menu"
        aria-expanded={accountMenuOpen}
        title="Account menu"
        className="relative p-2 rounded-xl cursor-pointer transition-colors active:scale-90"
      >
        <MoreHorizontal className={`w-5.5 h-5.5 transition-colors ${accountMenuOpen ? `stroke-[2.5px] ${accentTextClass}` : 'text-neutral-400'}`} />
      </button>
    </nav>
  );
};
