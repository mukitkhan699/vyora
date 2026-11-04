import React, { useState, useEffect } from 'react';
import { Search, TrendingUp, X } from 'lucide-react';
import { Post, User, TrendItem } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useTheme } from '../../context/ThemeContext.tsx';
import { PostCard } from '../feed/PostCard.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { PostSkeleton } from '../common/LoadingSkeleton.tsx';
import { EmptyState } from '../common/EmptyState.tsx';

interface ExploreViewProps {
  initialQuery?: string;
  onPostClick: (post: Post) => void;
  onReplyClick: (post: Post) => void;
  onUserClick: (username: string) => void;
  onTagClick: (tag: string) => void;
}

export const ExploreView: React.FC<ExploreViewProps> = ({
  initialQuery = '',
  onPostClick,
  onReplyClick,
  onUserClick,
  onTagClick,
}) => {
  const { theme, accentBgClass } = useTheme();

  const [query, setQuery] = useState(initialQuery);
  const [activeTab, setActiveTab] = useState<'top' | 'latest' | 'people' | 'media'>('top');
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  useEffect(() => {
    api.getTrends().then(setTrends).catch(console.warn);
    api.getUsers().then(setUsers).catch(console.warn);
    fetchPosts();
  }, []);

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const allPosts = await api.getPosts('for-you');
      setPosts(allPosts);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  };

  const filteredPosts = posts.filter((p) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const matchesContent = p.content.toLowerCase().includes(q);
    const matchesAuthor =
      p.author.name.toLowerCase().includes(q) ||
      p.author.username.toLowerCase().includes(q);
    return matchesContent || matchesAuthor;
  });

  const mediaPosts = filteredPosts.filter((p) => p.mediaUrls && p.mediaUrls.length > 0);
  const filteredUsers = users.filter((u) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.bio?.toLowerCase().includes(q)
    );
  });

  const headerBg =
    theme === 'dark'
      ? 'bg-[#090B10]/85 border-white/[0.08]'
      : theme === 'dim'
        ? 'bg-[#0F172A]/85 border-neutral-700'
        : 'bg-white/85 border-slate-200';
  const inputBg =
    theme === 'light'
      ? 'bg-slate-100 focus:bg-white border-slate-200 text-slate-900'
      : 'bg-[#10141D] focus:bg-[#070A0F] border-white/10 focus:border-cyan-400 text-white';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Sticky Search & Filter Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-xl border-b ${headerBg} p-3.5`}>
        <div className="relative flex items-center mb-2.5">
          <Search className="absolute left-3.5 w-4 h-4 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search keywords, #hashtags, or @people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`w-full rounded-2xl pl-10 pr-9 py-2 text-sm transition-all border outline-none placeholder:text-neutral-500 ${inputBg}`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 text-neutral-400 hover:text-white p-0.5 cursor-pointer"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Explore Tabs */}
        <div className="flex justify-around border-t border-white/[0.06] pt-1">
          {(['top', 'latest', 'people', 'media'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="py-2 px-3 text-xs sm:text-sm font-bold capitalize relative hover:bg-white/[0.04] rounded-xl cursor-pointer"
            >
              <span className={activeTab === tab ? 'text-white' : 'text-neutral-500'}>
                {tab}
              </span>
              {activeTab === tab && (
                <span
                  className={`absolute bottom-0 left-0 right-0 h-0.75 rounded-full ${accentBgClass}`}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="divide-y divide-white/[0.06]">
          <PostSkeleton />
          <PostSkeleton />
          <PostSkeleton />
        </div>
      ) : activeTab === 'people' ? (
        <div className="divide-y divide-white/[0.06]">
          {filteredUsers.length === 0 ? (
            <EmptyState
              title="No accounts found"
              description={`No accounts match your search for "${query}". Try another query.`}
            />
          ) : (
            filteredUsers.map((user) => (
              <div
                key={user.id}
                onClick={() => onUserClick(user.username)}
                className="flex items-center justify-between p-4 hover:bg-white/[0.02] cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar src={user.avatarUrl} name={user.name} size="md" />
                  <div className="min-w-0">
                    <div className="font-bold text-sm flex items-center gap-1 text-white truncate">
                      {user.name}
                      {user.verified && <Badge type={user.isGold ? 'gold' : 'blue'} size="sm" />}
                    </div>
                    <div className="text-xs text-neutral-400 font-mono">@{user.username}</div>
                    {user.bio && (
                      <p className="text-xs text-neutral-300 mt-1 line-clamp-1">{user.bio}</p>
                    )}
                  </div>
                </div>
                <Button size="xs" variant="outline" className="ml-3 shrink-0">
                  View
                </Button>
              </div>
            ))
          )}
        </div>
      ) : activeTab === 'media' ? (
        <div className="divide-y divide-white/[0.06]">
          {mediaPosts.length === 0 ? (
            <EmptyState
              title="No media found"
              description="There are no posts containing photos or videos matching this filter."
            />
          ) : (
            mediaPosts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onPostClick={onPostClick}
                onReplyClick={onReplyClick}
                onUserClick={onUserClick}
                onTagClick={onTagClick}
              />
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col">
          {/* Trending Categories Section if no query */}
          {!query && (
            <div className="p-4 border-b border-white/[0.08]">
              <h2 className="text-base font-bold mb-3 flex items-center gap-2 text-white">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                Featured trends
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {trends.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => {
                      setQuery(t.topic);
                      onTagClick(t.topic);
                    }}
                    className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] cursor-pointer transition-colors"
                  >
                    <span className="text-[11px] text-neutral-500">{t.category}</span>
                    <h4 className="font-bold text-sm text-neutral-200 mt-0.5">{t.topic}</h4>
                    <span className="text-xs text-neutral-500 font-mono">{t.postsCount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Posts list */}
          <div className="divide-y divide-white/[0.06]">
            {filteredPosts.length === 0 ? (
              <EmptyState
                title="No posts found"
                description={`No posts match your search for "${query}". Try searching with different keywords.`}
              />
            ) : (
              filteredPosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onPostClick={onPostClick}
                  onReplyClick={onReplyClick}
                  onUserClick={onUserClick}
                  onTagClick={onTagClick}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
