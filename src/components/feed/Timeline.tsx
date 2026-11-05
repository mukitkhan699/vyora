import React, { useState, useEffect } from 'react';
import { Sparkles, RefreshCw, Radio } from 'lucide-react';
import { Post } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useTheme } from '../../context/ThemeContext.tsx';
import { PostComposer } from './PostComposer.tsx';
import { PostCard } from './PostCard.tsx';
import { PostSkeleton } from '../common/LoadingSkeleton.tsx';
import { EmptyState } from '../common/EmptyState.tsx';

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
  const { theme, accentBgClass } = useTheme();
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
    setPosts((prev) => [newPost, ...prev]);
  };

  const handleDeletePost = (postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  };

  const headerBg =
    theme === 'dark'
      ? 'bg-[#090B10]/85 border-white/[0.08]'
      : theme === 'dim'
        ? 'bg-[#0F172A]/85 border-neutral-700'
        : 'bg-white/85 border-slate-200';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Sticky Header with Feed Tabs */}
      <div className={`sticky top-0 z-20 backdrop-blur-xl border-b ${headerBg}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-black tracking-tight text-white">Home</h1>
            <span
              className="w-2 h-2 rounded-full bg-cyan-400 inline-block animate-pulse"
              title="Relay Connected"
            />
          </div>
          <button
            type="button"
            onClick={fetchPosts}
            className="p-1.5 rounded-xl hover:bg-white/[0.08] text-neutral-400 hover:text-white transition-colors cursor-pointer"
            title="Refresh feed"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>

        {/* Following / For You Tabs */}
        <div className="flex border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => setFeedType('for-you')}
            className="flex-1 py-3 text-center text-sm font-bold relative hover:bg-white/[0.03] transition-colors cursor-pointer"
          >
            <span className={feedType === 'for-you' ? 'text-white' : 'text-neutral-500'}>
              For you
            </span>
            {feedType === 'for-you' && (
              <span
                className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.75 rounded-full ${accentBgClass}`}
              />
            )}
          </button>

          <button
            type="button"
            onClick={() => setFeedType('following')}
            className="flex-1 py-3 text-center text-sm font-bold relative hover:bg-white/[0.03] transition-colors cursor-pointer"
          >
            <span className={feedType === 'following' ? 'text-white' : 'text-neutral-500'}>
              Following
            </span>
            {feedType === 'following' && (
              <span
                className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.75 rounded-full ${accentBgClass}`}
              />
            )}
          </button>
        </div>
      </div>

      {/* Main Composer */}
      <PostComposer onPostCreated={handlePostCreated} />

      {/* Posts List */}
      <div className="divide-y divide-white/[0.06] flex-1">
        {isLoading ? (
          <div>
            <PostSkeleton />
            <PostSkeleton />
            <PostSkeleton />
          </div>
        ) : posts.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="w-6 h-6 text-cyan-400" />}
            title="No posts in this feed yet"
            description={
              feedType === 'following'
                ? 'Follow other accounts to see their updates right here in your feed.'
                : 'Share your thoughts and publish the very first post on Zunari!'
            }
          />
        ) : (
          posts.map((post) => (
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
