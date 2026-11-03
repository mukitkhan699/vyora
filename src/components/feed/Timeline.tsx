import React, { useState, useEffect } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { Post } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useTheme } from '../../context/ThemeContext.tsx';
import { PostComposer } from './PostComposer.tsx';
import { PostCard } from './PostCard.tsx';

interface TimelineProps {
  onPostClick: (post: Post) => void;
  onReplyClick: (post: Post) => void;
  onUserClick: (username: string) => void;
  onTagClick: (tag: string) => void;
}

export const Timeline: React.FC<TimelineProps> = ({
  onPostClick,
  onReplyClick,
  onUserClick,
  onTagClick,
}) => {
  const { theme, accentTextClass, accentBgClass } = useTheme();
  const [feedType, setFeedType] = useState<'for-you' | 'following'>('for-you');
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPosts = async () => {
    try {
      setIsLoading(true);
      const data = await api.getPosts(feedType);
      setPosts(data);
    } catch (err) {
      console.warn('Failed to load timeline:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [feedType]);

  const handlePostCreated = (newPost: Post) => {
    setPosts(prev => [newPost, ...prev]);
  };

  const handleDeletePost = (postId: string) => {
    setPosts(prev => prev.filter(p => p.id !== postId));
  };

  const headerBg = theme === 'dark' ? 'bg-[#080b11]/90 border-white/[0.08]' : theme === 'dim' ? 'bg-[#0f172a]/90 border-neutral-700' : 'bg-white/90 border-neutral-200';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Sticky Header with Feed Tabs */}
      <div className={`sticky top-0 z-20 backdrop-blur-xl border-b ${headerBg}`}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold tracking-tight">Transmissions</h1>
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" title="Telemetry Relay Active" />
          </div>
          <button
            onClick={fetchPosts}
            className="p-2 rounded-full hover:bg-white/[0.06] text-neutral-400 hover:text-white transition-colors cursor-pointer"
            title="Refresh feed"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>

        <div className="flex border-b border-neutral-800/60">
          <button
            onClick={() => setFeedType('for-you')}
            className="flex-1 py-3 text-center text-sm font-bold relative hover:bg-neutral-800/20 transition-colors cursor-pointer"
          >
            <span className={feedType === 'for-you' ? 'text-white' : 'text-neutral-500'}>
              For you
            </span>
            {feedType === 'for-you' && (
              <span className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 rounded-full ${accentBgClass}`} />
            )}
          </button>

          <button
            onClick={() => setFeedType('following')}
            className="flex-1 py-3 text-center text-sm font-bold relative hover:bg-neutral-800/20 transition-colors cursor-pointer"
          >
            <span className={feedType === 'following' ? 'text-white' : 'text-neutral-500'}>
              Following
            </span>
            {feedType === 'following' && (
              <span className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 rounded-full ${accentBgClass}`} />
            )}
          </button>
        </div>
      </div>

      {/* Main Composer */}
      <PostComposer onPostCreated={handlePostCreated} />

      {/* Posts List */}
      <div className="divide-y divide-neutral-800/60 flex-1">
        {isLoading ? (
          <div className="p-12 flex justify-center text-neutral-500">
            <svg className="animate-spin h-7 w-7 text-sky-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : posts.length === 0 ? (
          <div className="p-12 text-center text-neutral-500 flex flex-col items-center gap-2">
            <Sparkles className="w-8 h-8 text-neutral-600 mb-1" />
            <h3 className="font-bold text-lg text-neutral-300">No posts yet</h3>
            <p className="text-sm max-w-sm">
              {feedType === 'following' 
                ? 'Follow other creators to see their latest updates here.' 
                : 'Be the first to share an update with the platform!'}
            </p>
          </div>
        ) : (
          posts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              onPostClick={onPostClick}
              onReplyClick={onReplyClick}
              onUserClick={onUserClick}
              onTagClick={onTagClick}
              onDeletePost={handleDeletePost}
            />
          ))
        )}
      </div>
    </div>
  );
};
