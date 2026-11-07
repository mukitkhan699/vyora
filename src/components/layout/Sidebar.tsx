import React, { useState } from 'react';
import {
  Home,
  Hash,
  Bell,
  Mail,
  Bookmark,
  User as UserIcon,
  Settings as SettingsIcon,
  Radio,
  MoreHorizontal,
  LogOut,
  ShieldCheck,
  ExternalLink,
  Shield,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
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
  const { currentUser, logout, unreadNotificationsCount, appConfig, isAdmin, adminRole } = useAuth();
  const { theme, accentTextClass, accentBgClass, isDark } = useTheme();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const brandName = appConfig?.appName || 'Zunari';

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'explore', label: 'Explore', icon: Hash },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : null,
    },
    { id: 'messages', label: 'Messages', icon: Mail },
    { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
    { id: 'profile', label: 'Profile', icon: UserIcon },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
    ...(isAdmin ? [{ id: 'overview', label: 'Admin', icon: Shield }] : []),
  ];

  const hoverBg = theme === 'light' ? 'hover:bg-slate-100' : 'hover:bg-white/[0.06]';
  const activeBg =
    theme === 'light'
      ? 'bg-slate-100 font-bold text-slate-900 shadow-xs'
      : 'bg-white/[0.08] border border-white/10 text-white font-bold';
  const menuBg =
    theme === 'dark'
      ? 'bg-[#10131A] border-white/10'
      : theme === 'dim'
        ? 'bg-[#162035] border-neutral-700'
        : 'bg-white border-slate-200';

  return (
    <aside className="w-18 xl:w-68 h-screen sticky top-0 flex flex-col justify-between py-4 px-2 xl:px-4 border-r border-white/[0.08] z-20 select-none shrink-0 transition-all duration-200">
      <div className="flex flex-col gap-2">
        {/* Brand Header */}
        <div
          onClick={() => onSelectTab('home')}
          className={`flex items-center gap-3 p-2.5 rounded-2xl ${hoverBg} cursor-pointer transition-all group w-fit xl:w-full`}
          title={`${brandName} - Global Social Intelligence Network`}
        >
          <VyoraIcon size="md" glow={true} />
          <div className="hidden xl:flex flex-col leading-tight">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-violet-400 via-sky-300 to-cyan-300 bg-clip-text text-transparent">
                {brandName}
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-md bg-cyan-400/10 text-cyan-300 border border-cyan-400/20 font-semibold">
                Network
              </span>
            </div>
            <span className="text-[10px] text-neutral-400 font-mono tracking-wider flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
              CONNECTED
            </span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex flex-col gap-1 mt-3" aria-label="Main Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <Tooltip key={item.id} content={item.label} position="right" delay={150}>
                <button
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-3.5 px-3 py-2.5 xl:py-3 rounded-2xl transition-all cursor-pointer text-left w-full ${hoverBg} ${
                    isActive ? activeBg : 'text-neutral-400 font-medium hover:text-neutral-200'
                  }`}
                >
                  <div className="relative shrink-0 mx-auto xl:mx-0">
                    <Icon
                      className={`w-5.5 h-5.5 transition-transform group-hover:scale-105 ${
                        isActive ? `stroke-[2.5px] ${accentTextClass}` : ''
                      }`}
                    />
                    {item.badge && (
                      <span
                        className={`absolute -top-1.5 -right-2 ${accentBgClass} text-black text-[10px] font-black rounded-full w-4.5 h-4.5 flex items-center justify-center shadow-md animate-in zoom-in-75`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <span className="hidden xl:inline text-[15px] tracking-tight leading-none">
                    {item.label}
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </nav>

        {/* Primary Post / Compose Button */}
        <div className="mt-4 px-1 xl:px-0">
          <Button
            onClick={onOpenCompose}
            size="lg"
            className="w-full shadow-lg !p-3 xl:!py-3 !rounded-2xl flex items-center justify-center gap-2 text-sm xl:text-base font-bold"
          >
            <Radio className="w-5 h-5 xl:hidden" />
            <span className="hidden xl:inline tracking-wide">Post</span>
          </Button>
        </div>
      </div>

      {/* User Mini-Profile & Menu */}
      <div className="relative">
        {showUserMenu && currentUser && (
          <div
            className={`absolute bottom-full left-0 mb-3 w-64 ${menuBg} border rounded-2xl shadow-2xl p-2 z-30 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150`}
          >
            <div className="px-3 py-2.5 border-b border-white/[0.08]">
              <div className="text-xs font-bold text-white truncate">{currentUser.name}</div>
              <div className="text-[11px] text-neutral-400 truncate font-mono">
                @{currentUser.username}
              </div>
              <div className="mt-1.5 flex items-center gap-1 text-[10px] font-mono text-emerald-400">
                <ShieldCheck className="w-3 h-3" />
                Session active & authenticated
              </div>
            </div>

            <div className="pt-1.5 flex flex-col gap-1">
              <button
                type="button"
                onClick={() => {
                  onSelectTab('profile');
                  setShowUserMenu(false);
                }}
                className={`w-full flex items-center gap-2.5 p-2 rounded-xl text-left text-xs font-semibold text-neutral-300 cursor-pointer ${hoverBg}`}
              >
                <UserIcon className="w-3.5 h-3.5 text-cyan-400" />
                <span>View profile</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onSelectTab('settings');
                  setShowUserMenu(false);
                }}
                className={`w-full flex items-center gap-2.5 p-2 rounded-xl text-left text-xs font-semibold text-neutral-300 cursor-pointer ${hoverBg}`}
              >
                <SettingsIcon className="w-3.5 h-3.5 text-violet-400" />
                <span>Settings & preferences</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowUserMenu(false);
                  logout();
                }}
                className="w-full flex items-center gap-2.5 p-2 rounded-xl text-left text-xs font-semibold text-rose-400 cursor-pointer hover:bg-rose-500/10"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log out</span>
              </button>
            </div>
          </div>
        )}

        {currentUser && (
          <button
            type="button"
            onClick={() => setShowUserMenu(!showUserMenu)}
            aria-label="User account menu"
            className={`w-full flex items-center justify-between p-2 rounded-2xl cursor-pointer transition-all border border-transparent hover:border-white/[0.08] ${hoverBg}`}
          >
            <div className="flex items-center gap-3 min-w-0 mx-auto xl:mx-0">
              <Avatar
                src={currentUser.avatarUrl}
                name={currentUser.name}
                size="md"
                isOnline={true}
              />
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
            <MoreHorizontal className="hidden xl:block w-4 h-4 text-neutral-400 shrink-0" />
          </button>
        )}
      </div>
    </aside>
  );
};
