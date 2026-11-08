import React, { useState, useEffect } from 'react';
import { Search, Check, UserPlus, TrendingUp, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { api } from '../../services/api.ts';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';
import { UserBadges } from '../common/UserBadges.tsx';
import { Button } from '../common/Button.tsx';
import { TrendItem, User } from '../../types/index.ts';

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
  const { currentUser, allUsers } = useAuth();
  const { theme } = useTheme();

  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [followMap, setFollowMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.getTrends().then(setTrends).catch(console.warn);
  }, []);

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

  const followRecommendations = Array.isArray(allUsers) ? allUsers.filter((u) => u.id !== currentUser?.id).slice(0, 3) : [];

  return (
    <aside className="hidden lg:flex flex-col gap-4 w-80 xl:w-88 p-4 min-h-screen sticky top-0 overflow-y-auto shrink-0 select-none">
      {/* Search Input Bar */}
      <form onSubmit={handleSearchSubmit} className="sticky top-0 z-10 pt-0 pb-1">
        <div className="relative flex items-center">
          <Search className="absolute left-3.5 w-4 h-4 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search Zunari..."
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
          {(Array.isArray(trends) ? trends : []).slice(0, 5).map((t) => (
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
                      <UserBadges verified={user.verified} isGold={user.isGold} size="sm" />
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

      {/* Footer */}
      <footer className="px-2 text-[11px] text-neutral-500 flex flex-wrap gap-x-3 gap-y-1 font-mono">
        <span>Terms</span>
        <span>Privacy</span>
        <span>Cookies</span>
        <span>© 2026 Zunari</span>
      </footer>
    </aside>
  );
};
