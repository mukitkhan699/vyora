import React, { useState } from 'react';
import {
  Home,
  Hash,
  Bell,
  Mail,
  Bookmark,
  User as UserIcon,
  Radio,
  MoreHorizontal,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { VyoraIcon } from '../common/VyoraIcon.tsx';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenCompose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  onOpenCompose,
}) => {
  const { currentUser, logout, unreadNotificationsCount, appConfig } = useAuth();
  const { theme, accentTextClass, accentBgClass } = useTheme();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const brandName = appConfig?.appName || 'VYORA';

  const navItems = [
    { id: 'home', label: 'Transmissions', icon: Home },
    { id: 'explore', label: 'Explore Relay', icon: Hash },
    {
      id: 'notifications',
      label: 'Signals',
      icon: Bell,
      badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : null,
    },
    { id: 'messages', label: 'Vyora-Direct', icon: Mail },
    { id: 'bookmarks', label: 'Archived', icon: Bookmark },
    { id: 'profile', label: 'Operator ID', icon: UserIcon },
  ];

  const hoverBg = theme === 'light' ? 'hover:bg-slate-100' : 'hover:bg-cyan-500/[0.08]';
  const activeBg =
    theme === 'light' ? 'bg-slate-100 font-bold' : 'bg-cyan-500/[0.12] border border-cyan-500/20';
  const menuBg =
    theme === 'dark'
      ? 'bg-[#0b0e17] border-cyan-500/20'
      : theme === 'dim'
        ? 'bg-[#15202b] border-neutral-700'
        : 'bg-white border-neutral-200';

  return (
    <aside className="w-18 xl:w-72 h-screen sticky top-0 flex flex-col justify-between p-3 border-r border-white/[0.08] z-20 select-none">
      <div className="flex flex-col gap-2">
        <div
          onClick={() => onSelectTab('home')}
          className={`flex items-center gap-3.5 p-2 rounded-2xl ${hoverBg} cursor-pointer transition-all group`}
          title={`${brandName} - Global Real-Time Transmission Platform`}
        >
          <VyoraIcon size="md" glow={true} />
          <div className="hidden xl:flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-2xl tracking-tight bg-gradient-to-r from-purple-400 via-sky-300 to-cyan-300 bg-clip-text text-transparent">
                {brandName}
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                Relay
              </span>
            </div>
            <span className="text-[10px] text-neutral-400 font-mono tracking-wider flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
              SECURE SESSION
            </span>
          </div>
        </div>

        <nav className="flex flex-col gap-1 mt-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`flex items-center gap-4 px-3.5 py-3 rounded-2xl transition-all cursor-pointer text-left w-fit xl:w-full ${hoverBg} ${
                  isActive ? `${activeBg} text-white font-bold` : 'text-neutral-400 font-medium'
                }`}
              >
                <div className="relative">
                  <Icon
                    className={`w-5.5 h-5.5 ${isActive ? 'stroke-[2.4px] ' + accentTextClass : ''}`}
                  />
                  {item.badge && (
                    <span
                      className={`absolute -top-1.5 -right-2 ${accentBgClass} text-black text-[10px] font-black rounded-full w-4.5 h-4.5 flex items-center justify-center shadow-sm`}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className="hidden xl:inline text-[16px] tracking-tight leading-none">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="mt-3">
          <Button
            onClick={onOpenCompose}
            size="lg"
            className="w-full shadow-lg !p-3 xl:!py-3.5 !rounded-2xl flex items-center justify-center gap-2"
          >
            <Radio className="w-5 h-5 xl:hidden" />
            <span className="hidden xl:inline text-base font-bold tracking-wide">Transmit</span>
          </Button>
        </div>
      </div>

      <div className="relative">
        {showUserMenu && currentUser && (
          <div
            className={`absolute bottom-full left-0 mb-3 w-64 ${menuBg} border rounded-2xl shadow-2xl p-2 z-30 backdrop-blur-xl`}
          >
            <div className="px-3 py-2.5 border-b border-white/[0.08]">
              <div className="text-xs font-bold text-white truncate">{currentUser.name}</div>
              <div className="text-[11px] text-neutral-400 truncate font-mono">
                @{currentUser.username}
              </div>
              <div className="mt-1.5 flex items-center gap-1 text-[10px] font-mono text-emerald-400">
                <ShieldCheck className="w-3 h-3" />
                Secure session active
              </div>
            </div>

            <div className="pt-1.5 flex flex-col gap-1">
              <button
                onClick={() => {
                  onSelectTab('profile');
                  setShowUserMenu(false);
                }}
                className={`w-full flex items-center gap-2 p-2 rounded-xl text-left text-xs font-semibold text-neutral-300 cursor-pointer ${hoverBg}`}
              >
                <UserIcon className="w-3.5 h-3.5 text-cyan-400" />
                <span>View operator profile</span>
              </button>

              <button
                onClick={() => {
                  setShowUserMenu(false);
                  logout();
                }}
                className="w-full flex items-center gap-2 p-2 rounded-xl text-left text-xs font-semibold text-red-400 cursor-pointer hover:bg-red-500/10"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        )}

        {currentUser && (
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className={`w-full flex items-center justify-between p-2.5 rounded-2xl cursor-pointer transition-colors border border-transparent hover:border-white/[0.08] ${hoverBg}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Avatar src={currentUser.avatarUrl} name={currentUser.name} size="md" />
              <div className="hidden xl:flex flex-col text-left truncate leading-tight">
                <span className="font-bold text-sm flex items-center gap-1 truncate text-white">
                  {currentUser.name}
                  {currentUser.verified && (
                    <Badge type={currentUser.isGold ? 'gold' : 'blue'} size="sm" />
                  )}
                </span>
                <span className="text-xs text-neutral-400 truncate font-mono">
                  @{currentUser.username}
                </span>
              </div>
            </div>
            <MoreHorizontal className="hidden xl:block w-5 h-5 text-neutral-400 shrink-0" />
          </button>
        )}
      </div>
    </aside>
  );
};
