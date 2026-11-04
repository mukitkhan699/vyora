import React, { useState, useEffect } from 'react';
import { Search, TrendingUp, Filter, Sparkles } from 'lucide-react';
import { Post, User, TrendItem } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useTheme } from '../../context/ThemeContext.tsx';
import { PostCard } from '../feed/PostCard.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';

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
  const { theme, accentBgClass, accentTextClass } = useTheme();

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

  // Filter posts based on search query
  const filteredPosts = posts.filter(p => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const matchesContent = p.content.toLowerCase().includes(q);
    const matchesAuthor = p.author.name.toLowerCase().includes(q) || p.author.username.toLowerCase().includes(q);
    return matchesContent || matchesAuthor;
  });

  const mediaPosts = filteredPosts.filter(p => p.mediaUrls && p.mediaUrls.length > 0);
  const filteredUsers = users.filter(u => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.bio?.toLowerCase().includes(q);
  });

  const headerBg = theme === 'dark' ? 'bg-black/85 border-neutral-800' : theme === 'dim' ? 'bg-[#15202b]/85 border-neutral-700' : 'bg-white/85 border-neutral-200';
  const activeTabClass = theme === 'light' ? 'text-slate-900 font-bold' : 'text-white font-bold';
  const textInputClass = theme === 'light' ? 'text-slate-900' : 'text-white';
  const inputBg = theme === 'light' ? 'bg-neutral-100 focus:bg-white border-neutral-200' : 'bg-neutral-900 focus:bg-black border-neutral-800 focus:border-cyan-500';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Sticky Search Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-md border-b ${headerBg} p-3`}>
        <div className="relative flex items-center mb-2">
          <Search className="absolute left-4 w-4 h-4 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search keywords, #hashtags, or @people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`w-full rounded-full pl-11 pr-4 py-2 text-sm transition-all border outline-none placeholder:text-neutral-500 ${textInputClass} ${inputBg}`}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-4 text-xs text-neutral-400 hover:text-cyan-400 cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {/* Explore Tabs */}
        <div className="flex justify-around border-t border-neutral-800/40 pt-1 -mb-1">
          {(['top', 'latest', 'people', 'media'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="py-2 px-3 text-xs sm:text-sm font-bold capitalize relative hover:bg-neutral-800/20 rounded-lg cursor-pointer"
            >
              <span className={activeTab === tab ? activeTabClass : 'text-neutral-500'}>
                {tab}
              </span>
              {activeTab === tab && (
                <span className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-full ${accentBgClass}`} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'people' ? (
        <div className="divide-y divide-neutral-800/60 p-2">
          {filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-neutral-500 text-sm">No people found</div>
          ) : (
            filteredUsers.map(user => (
              <div
                key={user.id}
                onClick={() => onUserClick(user.username)}
                className="flex items-center justify-between p-3 hover:bg-neutral-900/40 rounded-xl cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Avatar src={user.avatarUrl} name={user.name} size="md" />
                  <div>
                    <div className="font-bold text-sm flex items-center gap-1">
                      {user.name}
                      {user.verified && <Badge type={user.isGold ? 'gold' : 'blue'} size="sm" />}
                    </div>
                    <div className="text-xs text-neutral-400">@{user.username}</div>
                    {user.bio && <p className="text-xs text-neutral-300 mt-1 line-clamp-1">{user.bio}</p>}
                  </div>
                </div>
                <Button size="sm" variant="outline">View</Button>
              </div>
            ))
          )}
        </div>
      ) : activeTab === 'media' ? (
        <div className="divide-y divide-neutral-800/60">
          {mediaPosts.length === 0 ? (
            <div className="p-8 text-center text-neutral-500 text-sm">No media posts found</div>
          ) : (
            mediaPosts.map(post => (
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
            <div className="p-4 border-b border-neutral-800/80">
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-sky-400" />
                Trends for you
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {trends.map(t => (
                  <div
                    key={t.id}
                    onClick={() => {
                      setQuery(t.topic);
                      onTagClick(t.topic);
                    }}
                    className="p-3 rounded-xl bg-neutral-900/40 border border-neutral-800/60 hover:bg-neutral-800/40 cursor-pointer transition-colors"
                  >
                    <span className="text-[11px] text-neutral-500">{t.category}</span>
                    <h4 className="font-bold text-sm text-neutral-200 mt-0.5">{t.topic}</h4>
                    <span className="text-xs text-neutral-500">{t.postsCount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Posts list */}
          <div className="divide-y divide-neutral-800/60">
            {filteredPosts.length === 0 ? (
              <div className="p-12 text-center text-neutral-500 text-sm">
                No matching posts found for "{query}"
              </div>
            ) : (
              filteredPosts.map(post => (
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
