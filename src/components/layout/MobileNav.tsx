import React from 'react';
import { Home, Hash, Bell, Mail, Bookmark, User as UserIcon, Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { useKeyboardOpen } from '../../hooks/useKeyboard.ts';

interface MobileNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({ currentTab, onSelectTab }) => {
  const { unreadNotificationsCount } = useAuth();
  const { theme, accentTextClass } = useTheme();
  const keyboardOpen = useKeyboardOpen();

  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'explore', icon: Hash, label: 'Explore' },
    { id: 'notifications', icon: Bell, label: 'Notifications', badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : null },
    { id: 'messages', icon: Mail, label: 'Messages' },
    { id: 'bookmarks', icon: Bookmark, label: 'Saved' },
    { id: 'profile', icon: UserIcon, label: 'Profile' },
    { id: 'settings', icon: SettingsIcon, label: 'Settings' },
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
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = currentTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectTab(item.id)}
            aria-label={item.label}
            className="relative p-2 rounded-xl cursor-pointer transition-colors active:scale-90"
          >
            <Icon
              className={`w-5.5 h-5.5 transition-colors ${
                isActive ? `stroke-[2.5px] ${accentTextClass}` : 'text-neutral-400'
              }`}
            />
            {item.badge && (
              <span className="absolute top-1 right-1 bg-cyan-400 text-black text-[10px] font-black rounded-full w-4 h-4 flex items-center justify-center shadow-xs">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
};
