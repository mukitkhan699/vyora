import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Calendar, MapPin, Link as LinkIcon } from 'lucide-react';
import { User, Post } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { CdnImage } from '../common/CdnImage.tsx';
import { PostCard } from '../feed/PostCard.tsx';
import { EditProfileModal } from './EditProfileModal.tsx';
import { PostSkeleton } from '../common/LoadingSkeleton.tsx';
import { EmptyState } from '../common/EmptyState.tsx';
import { Modal } from '../common/Modal.tsx';
import { UserBadges } from '../common/UserBadges.tsx';
import { useApiQuery } from '../../hooks/useApiQuery.ts';

const PROFILE_POST_PAGE_SIZE = 20;

interface ProfileViewProps {
  username?: string;
  onBack: () => void;
  onPostClick: (post: Post) => void;
  onReplyClick: (post: Post) => void;
  onUserClick: (username: string) => void;
  onTagClick: (tag: string) => void;
}

function getSafeWebsiteUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  username,
  onBack,
  onPostClick,
  onReplyClick,
  onUserClick,
  onTagClick,
}) => {
  const { currentUser, updateCurrentUser } = useAuth();
  const { theme, accentBgClass, accentTextClass } = useTheme();

  const [followingOverride, setFollowingOverride] = useState<{ userId: string; value: boolean }>();
  const [activeTab, setActiveTab] = useState<'posts' | 'replies' | 'highlights' | 'media' | 'likes'>('posts');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showVerificationNotice, setShowVerificationNotice] = useState(false);
  const [additionalPosts, setAdditionalPosts] = useState<{
    userId: string;
    posts: Post[];
    hasMore: boolean;
  } | null>(null);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<{ userId: string; message: string } | null>(null);

  const targetUsername = username || currentUser?.username || 'mukitk';
  const profileQuery = useApiQuery<User & { isFollowing?: boolean }>(
    `/users/${encodeURIComponent(targetUsername)}`,
    () => api.getUserByUsername(targetUsername),
  );
  const requestedUsername = targetUsername.replace(/^@/, '').toLowerCase();
  const user = profileQuery.data?.username.toLowerCase() === requestedUsername
    ? profileQuery.data
    : null;
  const postsQuery = useApiQuery<Post[]>(
    `/posts?feed=for-you&authorId=${encodeURIComponent(user?.id ?? '')}&limit=${PROFILE_POST_PAGE_SIZE + 1}&offset=0`,
    () => user
      ? api.getPosts('for-you', user.id, { limit: PROFILE_POST_PAGE_SIZE + 1, offset: 0 })
      : Promise.resolve([]),
    Boolean(user?.id),
  );
  const currentUserId = user?.id;
  const profileIdRef = useRef<string | undefined>(currentUserId);
  profileIdRef.current = currentUserId;
  const cachedAdditionalPosts = additionalPosts?.userId === currentUserId ? additionalPosts : null;
  const posts = [
    ...(postsQuery.data ?? []).slice(0, PROFILE_POST_PAGE_SIZE),
    ...(cachedAdditionalPosts?.posts ?? []),
  ];
  const hasMorePosts = cachedAdditionalPosts
    ? cachedAdditionalPosts.hasMore
    : (postsQuery.data?.length ?? 0) > PROFILE_POST_PAGE_SIZE;
  const isFollowing = followingOverride && user && followingOverride.userId === user.id
    ? followingOverride.value
    : user?.isFollowing ?? false;
  const loading = profileQuery.isLoading;
  const isOwnProfile = currentUser && user && currentUser.id === user.id;
  const websiteUrl = getSafeWebsiteUrl(user?.website);

  useEffect(() => {
    setFollowingOverride(undefined);
    setActiveTab('posts');
    setAdditionalPosts(null);
    setLoadingMorePosts(false);
    setLoadMoreError(null);
  }, [targetUsername]);

  const handleLoadMorePosts = async () => {
    if (!user || loadingMorePosts || !hasMorePosts) return;
    const authorId = user.id;
    const offset = PROFILE_POST_PAGE_SIZE + (cachedAdditionalPosts?.posts.length ?? 0);
    setLoadingMorePosts(true);
    setLoadMoreError(null);
    try {
      const page = await api.getPosts('for-you', authorId, {
        limit: PROFILE_POST_PAGE_SIZE + 1,
        offset,
      });
      if (profileIdRef.current !== authorId) return;
      setAdditionalPosts({
        userId: authorId,
        posts: [...(cachedAdditionalPosts?.posts ?? []), ...page.slice(0, PROFILE_POST_PAGE_SIZE)],
        hasMore: page.length > PROFILE_POST_PAGE_SIZE,
      });
    } catch (error) {
      if (profileIdRef.current === authorId) {
        setLoadMoreError({
          userId: authorId,
          message: error instanceof Error ? error.message : 'Could not load more posts.',
        });
      }
    } finally {
      if (profileIdRef.current === authorId) setLoadingMorePosts(false);
    }
  };

  const handleToggleFollow = async () => {
    if (!user) return;
    const previous = isFollowing;
    setFollowingOverride({ userId: user.id, value: !previous });
    try {
      const res = await api.toggleFollow(user.id);
      setFollowingOverride({ userId: user.id, value: res.isFollowing });
    } catch (e) {
      setFollowingOverride({ userId: user.id, value: previous });
      console.warn(e);
    }
  };

  const handleProfileSave = async (data: Partial<User>) => {
    await updateCurrentUser(data);
  };

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen">
        <div className="h-44 sm:h-52 w-full bg-white/[0.04] animate-pulse" />
        <div className="p-4">
          <PostSkeleton />
          <PostSkeleton />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-12 text-center text-neutral-400">
        <h2 className="text-xl font-bold">This account doesn’t exist</h2>
        <p className="text-sm mt-1 text-neutral-500">Try searching for another user.</p>
        <Button onClick={onBack} size="sm" className="mt-4 mx-auto">
          Go Back
        </Button>
      </div>
    );
  }

  const headerBg =
    theme === 'dark'
      ? 'bg-[#090B10]/85 border-white/[0.08]'
      : theme === 'dim'
        ? 'bg-[#0F172A]/85 border-neutral-700'
        : 'bg-white/85 border-slate-200';

  const defaultBanner =
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop&q=80';

  const displayedPosts =
    activeTab === 'media'
      ? posts.filter((p) => p.mediaUrls && p.mediaUrls.length > 0)
      : activeTab === 'replies'
      ? posts.filter((p) => p.replyToId)
      : activeTab === 'likes'
      ? posts.filter((p) => p.isLiked)
      : posts.filter((p) => !p.replyToId);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Sticky Profile Header */}
      <div
        className={`sticky top-0 z-20 backdrop-blur-xl border-b ${headerBg} px-4 py-2.5 flex items-center gap-5`}
      >
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-full hover:bg-white/[0.08] cursor-pointer transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <div>
          <h2 className="text-base font-bold flex items-center gap-1.5 leading-tight text-white">
            {user.name}
            <UserBadges verified={user.verified} isGold={user.isGold} size="md" />
          </h2>
          <span className="text-xs text-neutral-400 font-mono">{posts.length} posts loaded</span>
        </div>
      </div>

      {/* Cover Banner */}
      <div className="h-44 sm:h-52 w-full bg-neutral-900 overflow-hidden relative">
        <CdnImage
          src={user.bannerUrl || defaultBanner}
          alt="Banner cover"
          className="w-full h-full object-cover"
        />
      </div>

      {/* Profile Details Container */}
      <div className="px-4 pb-4 border-b border-white/[0.08]">
        {/* Avatar & Edit/Follow Button Row */}
        <div className="flex flex-wrap items-end justify-between gap-3 -mt-12 sm:-mt-16 mb-4 relative z-10">
          <div className="shrink-0">
            <Avatar
              src={user.avatarUrl}
              name={user.name}
              size="xl"
              className="ring-4 ring-[#090B10] shadow-xl"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1 sm:pt-4 ml-auto">
            {isOwnProfile ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowVerificationNotice(true)}
                  className="font-medium"
                >
                  Get Verified
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowEditModal(true)}>
                  Edit profile
                </Button>
              </>
            ) : (
              <Button
                variant={isFollowing ? 'outline' : 'secondary'}
                size="sm"
                onClick={handleToggleFollow}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </Button>
            )}
          </div>
        </div>

        {/* Name and Handle */}
        <div className="mb-2.5">
          <h1 className="text-xl font-black flex items-center gap-1.5 leading-tight text-white">
            {user.name}
            <UserBadges verified={user.verified} isGold={user.isGold} size="md" />
          </h1>
          <span className="text-sm text-neutral-400 font-mono">@{user.username}</span>
        </div>

        {/* Bio */}
        {user.bio && (
          <p className="text-sm leading-relaxed text-neutral-200 mb-3 whitespace-pre-wrap">
            {user.bio}
          </p>
        )}

        {/* Meta Info: Location, Website, Joined Date */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-neutral-400 mb-3">
          {user.location && (
            <div className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              <span>{user.location}</span>
            </div>
          )}
          {websiteUrl && (
            <div className="flex items-center gap-1">
              <LinkIcon className="w-3.5 h-3.5" />
              <a
                href={websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`hover:underline ${accentTextClass}`}
              >
                {websiteUrl.replace(/^https?:\/\//, '')}
              </a>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            <span>{user.joinedDate}</span>
          </div>
        </div>

        {/* Follower Counts */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1">
            <span className="font-bold text-white">{user.followingCount}</span>
            <span className="text-neutral-500 font-sans">Following</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="font-bold text-white">{user.followersCount.toLocaleString()}</span>
            <span className="text-neutral-500 font-sans">Followers</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.08]">
        {(['posts', 'replies', 'highlights', 'media', 'likes'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-3 text-center text-xs sm:text-sm font-bold capitalize relative hover:bg-white/[0.03] cursor-pointer"
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

      {/* Profile Posts Feed */}
      <div className="divide-y divide-white/[0.06] flex-1">
        {postsQuery.isLoading && posts.length === 0 ? (
          <div className="p-4">
            <PostSkeleton />
            <PostSkeleton />
          </div>
        ) : postsQuery.error !== undefined && posts.length === 0 ? (
          <EmptyState
            title="Could not load posts"
            description="Please try again."
            actionLabel="Retry"
            onAction={postsQuery.refresh}
          />
        ) : displayedPosts.length === 0 ? (
          <EmptyState
            title={`No ${activeTab} yet`}
            description={`Posts, replies, and saved media from @${user.username} will appear here.`}
          />
        ) : (
          displayedPosts.map((post) => (
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
        {hasMorePosts && (
          <div className="p-4 text-center">
            {loadMoreError?.userId === user.id && (
              <p role="alert" className="text-xs text-red-400 mb-2">{loadMoreError.message}</p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadMorePosts}
              isLoading={loadingMorePosts}
              disabled={loadingMorePosts}
            >
              {loadMoreError?.userId === user.id ? 'Try again' : 'Load more posts'}
            </Button>
          </div>
        )}
      </div>

      {/* Edit Profile Modal */}
      {showEditModal && (
        <EditProfileModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          user={user}
          onSave={handleProfileSave}
        />
      )}

      {/* Verification Notice Modal */}
      {showVerificationNotice && (
        <Modal
          isOpen={showVerificationNotice}
          onClose={() => setShowVerificationNotice(false)}
          title="Account Verification"
          maxWidth="max-w-md"
        >
          <div className="text-center py-4 px-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4 text-cyan-400">
              <Badge type="blue" size="lg" />
            </div>
            <h3 className="text-lg font-bold mb-2">Verification applications coming soon</h3>
            <p className="text-sm text-neutral-400 leading-relaxed mb-6">
              We are working on a structured application workflow for verified badges. Check back soon for updates on how to apply.
            </p>
            <Button
              onClick={() => setShowVerificationNotice(false)}
              className="w-full"
              size="sm"
            >
              Got it
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
};
