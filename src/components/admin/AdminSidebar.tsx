import React from 'react';
import {
  LayoutDashboard,
  Users,
  FileText,
  Flag,
  Shield,
  BarChart2,
  Settings,
  LogOut,
  Activity,
  History,
  ShieldCheck,
  Award,
  Crown,
  Users2,
  FileText as FileTextIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { adminApi, AdminRole } from '../../services/adminApi.ts';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { Tooltip } from '../common/Tooltip.tsx';

interface AdminSidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onLogout: () => void;
}

const adminNavItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, roles: ['super_admin', 'admin', 'moderator', 'verification_manager', 'analyst'] as AdminRole[] },
  { id: 'users', label: 'Users', icon: Users, roles: ['super_admin', 'admin', 'moderator', 'verification_manager', 'analyst'] as AdminRole[] },
  { id: 'verification', label: 'Verification', icon: ShieldCheck, roles: ['super_admin', 'admin', 'verification_manager'] as AdminRole[] },
  { id: 'gold', label: 'Gold Membership', icon: Award, roles: ['super_admin', 'admin'] as AdminRole[] },
  { id: 'reports', label: 'Reports', icon: Flag, roles: ['super_admin', 'admin', 'moderator'] as AdminRole[] },
  { id: 'audit', label: 'Audit Log', icon: History, roles: ['super_admin', 'admin', 'moderator', 'verification_manager', 'analyst'] as AdminRole[] },
  { id: 'admin-accounts', label: 'Admin Accounts', icon: Users2, roles: ['super_admin', 'admin'] as AdminRole[] },
  { id: 'settings', label: 'Settings', icon: Settings, roles: ['super_admin', 'admin'] as AdminRole[] },
];

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  currentTab,
  onSelectTab,
  onLogout,
}) => {
  const { adminRole, adminPermissions, adminLogout, currentUser } = useAuth();

  const filteredNavItems = adminNavItems.filter(
    (item) => !adminRole || item.roles.includes(adminRole),
  );

  const theme = 'dark';
  const hoverBg = 'hover:bg-white/[0.06]';
  const activeBg = 'bg-white/[0.08] border border-white/10 text-white font-bold';

  const getRoleBadge = (role: AdminRole | null) => {
    if (!role) return null;
    const badges: Record<AdminRole, { label: string; color: 'blue' | 'gold' | 'violet' | 'amber' | 'cyan' }> = {
      super_admin: { label: 'Super Admin', color: 'gold' },
      admin: { label: 'Admin', color: 'violet' },
      moderator: { label: 'Moderator', color: 'blue' },
      verification_manager: { label: 'Verification', color: 'amber' },
      analyst: { label: 'Analyst', color: 'cyan' },
    };
    const badge = badges[role];
    return badge ? <Badge type={badge.color} size="xs">{badge.label}</Badge> : null;
  };

  return (
    <aside className="w-18 xl:w-64 h-screen sticky top-0 flex flex-col justify-between py-4 px-2 xl:px-4 border-r border-white/[0.08] z-20 select-none shrink-0 transition-all duration-200 bg-[#060910]">
      <div className="flex flex-col gap-2">
        {/* Brand Header */}
        <div
          onClick={() => onSelectTab('overview')}
          className={`flex items-center gap-3 p-2.5 rounded-2xl ${hoverBg} cursor-pointer transition-all group w-fit xl:w-full`}
          title="Admin Dashboard"
        >
          <div className="relative">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-emerald-400 border-2 border-[#060910]" />
          </div>
          <div className="hidden xl:flex flex-col leading-tight">
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-cyan-300 via-sky-300 to-purple-300 bg-clip-text text-transparent">
              Admin
            </span>
            <span className="text-[10px] text-neutral-400 font-mono tracking-wider flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
              SECURE
            </span>
          </div>
        </div>

        {/* Role Badge */}
        {adminRole && (
          <div className="mx-auto xl:mx-0 px-2">
            {getRoleBadge(adminRole)}
          </div>
        )}

        {/* Navigation Items */}
        <nav className="flex flex-col gap-1 mt-3" aria-label="Admin Navigation">
          {filteredNavItems.map((item) => {
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
                        isActive ? 'stroke-[2.5px] text-cyan-400' : ''
                      }`}
                    />
                  </div>
                  <span className="hidden xl:inline text-[15px] tracking-tight leading-none">
                    {item.label}
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </nav>
      </div>

      {/* User Info & Logout */}
      <div className="relative">
        {currentUser && (
          <div className="p-2 rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-center gap-3 min-w-0 mx-auto xl:mx-0 mb-3">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                <span className="font-bold text-white text-sm">
                  {currentUser.name?.charAt(0).toUpperCase() || 'A'}
                </span>
              </div>
              <div className="hidden xl:flex flex-col text-left truncate leading-tight flex-1 min-w-0">
                <span className="font-bold text-sm truncate text-white">{currentUser.name}</span>
                <span className="text-xs text-neutral-400 truncate font-mono">@{currentUser.username}</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={onLogout}
            >
              <LogOut className="h-4 w-4 mr-2" />
              <span>Sign Out</span>
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
};