import React, { useState, useEffect } from 'react';
import { Search, Globe, Check, UserPlus, RefreshCw, Server } from 'lucide-react';
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
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  onSearch,
  onSelectTag,
}) => {
  const { currentUser, allUsers, appConfig } = useAuth();
  const { theme } = useTheme();

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
      setFollowMap(prev => ({ ...prev, [user.id]: res.isFollowing }));
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

  const cardBg = theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-[#0d121c]/70 border-white/[0.08] backdrop-blur-xl';
  const inputBg = theme === 'light' ? 'bg-slate-100 focus:bg-white border-slate-200' : 'bg-[#0b0e17] focus:bg-[#070a0f] border-white/[0.08] focus:border-cyan-400';

  // Users to recommend (excluding current user)
  const followRecommendations = allUsers.filter(u => u.id !== currentUser?.id).slice(0, 3);

  return (
    <aside className="hidden lg:flex flex-col gap-4 w-80 xl:w-88 p-3 min-h-screen sticky top-0 overflow-y-auto">
      {/* Search Input */}
      <form onSubmit={handleSearchSubmit} className="sticky top-0 z-10 pt-1 pb-2">
        <div className="relative flex items-center">
          <Search className="absolute left-4 w-4 h-4 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search VYORA transmissions..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={`w-full rounded-full pl-11 pr-4 py-2.5 text-sm transition-all border outline-none placeholder:text-neutral-500 ${inputBg}`}
          />
        </div>
      </form>

      {/* Multi-CDN Status & Resiliency Card */}
      <div className={`rounded-2xl p-4 border ${cardBg}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-sky-400" />
            <h3 className="font-bold text-sm">Multi-CDN Edge Pool</h3>
          </div>
          <button
            onClick={handleTestCdns}
            disabled={isTestingCdn}
            className="p-1 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors cursor-pointer"
            title="Ping CDNs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTestingCdn ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <p className="text-xs text-neutral-400 mb-3">
          Configured in <code className="bg-neutral-800/80 px-1 py-0.5 rounded text-[11px]">.env</code> with automatic failover.
        </p>

        <div className="space-y-1.5 text-xs">
          {cdnList.map((cdn, idx) => (
            <div key={cdn.url} className="flex items-center justify-between py-1 border-b border-neutral-800/40 last:border-0">
              <span className="font-mono text-[11px] text-neutral-300 truncate max-w-[170px]">
                {cdn.name}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-neutral-400 font-mono">
                  {cdn.latencyMs ? `${cdn.latencyMs}ms` : 'active'}
                </span>
              </div>
            </div>
          ))}
        </div>

        {appConfig?.databaseStatus && (
          <div className="mt-3 pt-2.5 border-t border-neutral-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-neutral-400">
              <Server className="w-3.5 h-3.5" />
              <span>Database</span>
            </div>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${appConfig.databaseStatus.connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-sky-500/10 text-sky-400'}`}>
              {appConfig.databaseStatus.type}
            </span>
          </div>
        )}
      </div>

      {/* What's happening / Trends */}
      <div className={`rounded-2xl p-4 border ${cardBg}`}>
        <h3 className="text-lg font-bold mb-3">What's happening</h3>
        <div className="flex flex-col gap-3">
          {trends.map((t) => (
            <div
              key={t.id}
              onClick={() => onSelectTag?.(t.topic)}
              className="cursor-pointer group flex flex-col transition-opacity hover:opacity-80"
            >
              <span className="text-xs text-neutral-500">{t.category}</span>
              <span className="text-sm font-bold group-hover:underline">{t.topic}</span>
              <span className="text-xs text-neutral-500">{t.postsCount}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Who to follow */}
      <div className={`rounded-2xl p-4 border ${cardBg}`}>
        <h3 className="text-lg font-bold mb-3">Who to follow</h3>
        <div className="flex flex-col gap-3.5">
          {followRecommendations.map((user) => {
            const isFollowing = followMap[user.id] ?? false;
            return (
              <div key={user.id} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar src={user.avatarUrl} name={user.name} size="md" />
                  <div className="truncate leading-tight">
                    <div className="text-sm font-bold flex items-center gap-1 truncate">
                      {user.name}
                      {user.verified && <Badge type={user.isGold ? 'gold' : 'blue'} size="sm" />}
                    </div>
                    <div className="text-xs text-neutral-400 truncate">@{user.username}</div>
                  </div>
                </div>
                <Button
                  variant={isFollowing ? 'outline' : 'secondary'}
                  size="sm"
                  onClick={() => handleToggleFollow(user)}
                  className="shrink-0 text-xs"
                >
                  {isFollowing ? 'Following' : 'Follow'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer disclaimer */}
      <div className="px-3 text-[11px] text-neutral-500 flex flex-wrap gap-x-2.5 gap-y-1 font-mono">
        <span>VYORA Protocol</span>
        <span>Node.js API</span>
        <span>PostgreSQL</span>
        <span>Multi-CDN Edge</span>
        <span>© 2026 VYORA Network</span>
      </div>
    </aside>
  );
};
