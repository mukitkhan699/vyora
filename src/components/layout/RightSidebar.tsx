import React, { useState, useEffect } from 'react';
import { Search, Globe, Check, UserPlus, RefreshCw, Server, TrendingUp, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { api } from '../../services/api.ts';
import { cdnManager } from '../../utils/cdnManager.ts';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { TrendItem, User, CDNInfo } from '../../types/index.ts';

interface RightSidebarProps {
  onSearch?: (query: string) => void;
  onSelectTag?: (tag: string) => void;
  onUserClick?: (username: string) => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  onSearch,
  onSelectTag,
  onUserClick,
}) => {
  const { currentUser, allUsers, appConfig } = useAuth();
  const { theme, accentTextClass } = useTheme();

  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [followMap, setFollowMap] = useState<Record<string, boolean>>({});
  const [cdnList, setCdnList] = useState<CDNInfo[]>([]);
  const [isTestingCdn, setIsTestingCdn] = useState(false);

  useEffect(() => {
    api.getTrends().then(setTrends).catch(console.warn);
    setCdnList(cdnManager.getCdnHealthList());
  }, []);

  const handleTestCdns = async () => {
    setIsTestingCdn(true);
    const results = await cdnManager.testAllCdns();
    setCdnList(results);
    setIsTestingCdn(false);
  };

  const handleToggleFollow = async (user: User) => {
    try {
      const res = await api.toggleFollow(user.id);
      setFollowMap((prev) => ({ ...prev, [user.id]: res.isFollowing }));
    } catch (e) {
      console.warn('Error following user:', e);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim() && onSearch) {
      onSearch(searchInput.trim());
    }
  };

  const cardBg =
    theme === 'light'
      ? 'bg-slate-50 border-slate-200'
      : 'bg-[#11151D] border-white/[0.08] backdrop-blur-xl';
  const inputBg =
    theme === 'light'
      ? 'bg-slate-100 focus:bg-white border-slate-200 text-slate-900'
      : 'bg-[#0B0E14] focus:bg-[#070A0F] border-white/[0.08] focus:border-cyan-400 text-white';

  const followRecommendations = allUsers.filter((u) => u.id !== currentUser?.id).slice(0, 3);

  return (
    <aside className="hidden lg:flex flex-col gap-4 w-80 xl:w-88 p-4 min-h-screen sticky top-0 overflow-y-auto shrink-0 select-none">
      {/* Search Input Bar */}
      <form onSubmit={handleSearchSubmit} className="sticky top-0 z-10 pt-0 pb-1">
        <div className="relative flex items-center">
          <Search className="absolute left-3.5 w-4 h-4 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search VYORA..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={`w-full rounded-2xl pl-10 pr-9 py-2.5 text-sm transition-all border outline-none placeholder:text-neutral-500 ${inputBg}`}
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-3 text-neutral-400 hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </form>

      {/* Trending Topics Widget */}
      <div className={`rounded-2xl p-4 border ${cardBg}`}>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-cyan-400" />
          <h3 className="text-base font-bold tracking-tight">Trends for you</h3>
        </div>
        <div className="flex flex-col gap-3">
          {trends.slice(0, 5).map((t) => (
            <div
              key={t.id}
              onClick={() => {
                setSearchInput(t.topic);
                onSelectTag?.(t.topic);
              }}
              className="cursor-pointer group flex flex-col transition-colors p-1 -mx-1 rounded-xl hover:bg-white/[0.04]"
            >
              <span className="text-[11px] text-neutral-500">{t.category}</span>
              <span className="text-sm font-bold text-neutral-200 group-hover:text-cyan-300 transition-colors">
                {t.topic}
              </span>
              <span className="text-[11px] text-neutral-500">{t.postsCount} posts</span>
            </div>
          ))}
        </div>
      </div>

      {/* Who to follow Widget */}
      <div className={`rounded-2xl p-4 border ${cardBg}`}>
        <h3 className="text-base font-bold tracking-tight mb-3">Suggested accounts</h3>
        <div className="flex flex-col gap-3">
          {followRecommendations.map((user) => {
            const isFollowing = followMap[user.id] ?? false;
            return (
              <div key={user.id} className="flex items-center justify-between gap-2">
                <div
                  onClick={() => onUserClick?.(user.username)}
                  className="flex items-center gap-2.5 min-w-0 cursor-pointer group"
                >
                  <Avatar src={user.avatarUrl} name={user.name} size="sm" />
                  <div className="truncate leading-tight">
                    <div className="text-xs font-bold flex items-center gap-1 truncate group-hover:underline">
                      {user.name}
                      {user.verified && <Badge type={user.isGold ? 'gold' : 'blue'} size="sm" />}
                    </div>
                    <div className="text-[11px] text-neutral-400 truncate font-mono">
                      @{user.username}
                    </div>
                  </div>
                </div>
                <Button
                  variant={isFollowing ? 'outline' : 'secondary'}
                  size="xs"
                  onClick={() => handleToggleFollow(user)}
                  className="shrink-0 text-xs font-semibold"
                >
                  {isFollowing ? 'Following' : 'Follow'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Multi-CDN Resiliency Status Card */}
      <div className={`rounded-2xl p-4 border ${cardBg}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-xs">Edge CDN Relay Pool</h3>
          </div>
          <button
            onClick={handleTestCdns}
            disabled={isTestingCdn}
            className="p-1 rounded-lg hover:bg-white/[0.08] text-neutral-400 hover:text-white transition-colors cursor-pointer"
            title="Ping CDNs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTestingCdn ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="space-y-1.5 text-xs">
          {cdnList.slice(0, 3).map((cdn) => (
            <div
              key={cdn.url}
              className="flex items-center justify-between py-1 border-b border-white/[0.04] last:border-0"
            >
              <span className="font-mono text-[11px] text-neutral-300 truncate max-w-[170px]">
                {cdn.name}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
                <span className="text-[10px] text-neutral-400 font-mono">
                  {cdn.latencyMs ? `${cdn.latencyMs}ms` : 'active'}
                </span>
              </div>
            </div>
          ))}
        </div>

        {appConfig?.databaseStatus && (
          <div className="mt-2.5 pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-neutral-400">
              <Server className="w-3.5 h-3.5" />
              <span className="text-[11px]">Database</span>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-md ${
                appConfig.databaseStatus.connected
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
              }`}
            >
              {appConfig.databaseStatus.type}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="px-2 text-[11px] text-neutral-500 flex flex-wrap gap-x-3 gap-y-1 font-mono">
        <span>Terms</span>
        <span>Privacy</span>
        <span>Cookies</span>
        <span>© 2026 VYORA</span>
      </footer>
    </aside>
  );
};
