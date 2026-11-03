import React, { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, MapPin, Link as LinkIcon, Sparkles } from 'lucide-react';
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

interface ProfileViewProps {
  username?: string;
  onBack: () => void;
  onPostClick: (post: Post) => void;
  onReplyClick: (post: Post) => void;
  onUserClick: (username: string) => void;
  onTagClick: (tag: string) => void;
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

  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [activeTab, setActiveTab] = useState<'posts' | 'replies' | 'highlights' | 'media' | 'likes'>('posts');
  const [showEditModal, setShowEditModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const targetUsername = username || currentUser?.username || 'mukitk';
  const isOwnProfile = currentUser && user && currentUser.id === user.id;

  useEffect(() => {
    fetchProfile();
  }, [targetUsername]);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const u = await api.getUserByUsername(targetUsername);
      setUser(u);
      setIsFollowing(u.isFollowing ?? false);
      const userPosts = await api.getPosts('for-you', u.id);
      setPosts(userPosts);
    } catch (e) {
      console.warn('Failed to load profile:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFollow = async () => {
    if (!user) return;
    try {
      const res = await api.toggleFollow(user.id);
      setIsFollowing(res.isFollowing);
      setUser(res.targetUser);
    } catch (e) {
      console.warn(e);
    }
  };

  const handleProfileSave = async (data: Partial<User>) => {
    const updated = await updateCurrentUser(data);
    setUser(updated);
  };

  if (loading) {
    return (
      <div className="p-12 flex justify-center text-neutral-500">
        <svg className="animate-spin h-7 w-7 text-sky-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-12 text-center text-neutral-400">
        <h2 className="text-xl font-bold">This account doesn’t exist</h2>
        <p className="text-sm mt-1 text-neutral-500">Try searching for another user.</p>
        <Button onClick={onBack} size="sm" className="mt-4 mx-auto">Go Back</Button>
      </div>
    );
  }

  const headerBg = theme === 'dark' ? 'bg-black/85 border-neutral-800' : theme === 'dim' ? 'bg-[#15202b]/85 border-neutral-700' : 'bg-white/85 border-neutral-200';

  const defaultBanner = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop&q=80';

  // Filter posts for active tab
  const displayedPosts = activeTab === 'media'
    ? posts.filter(p => p.mediaUrls && p.mediaUrls.length > 0)
    : activeTab === 'replies'
    ? posts.filter(p => p.replyToId)
    : activeTab === 'likes'
    ? posts.filter(p => p.isLiked)
    : posts.filter(p => !p.replyToId);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Sticky Profile Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-md border-b ${headerBg} px-4 py-2 flex items-center gap-6`}>
        <button
          onClick={onBack}
          className="p-2 rounded-full hover:bg-neutral-800/50 cursor-pointer transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <div>
          <h2 className="text-lg font-bold flex items-center gap-1 leading-tight">
            {user.name}
            {user.verified && <Badge type={user.isGold ? 'gold' : 'blue'} size="sm" />}
          </h2>
          <span className="text-xs text-neutral-500">{posts.length} posts</span>
        </div>
      </div>

      {/* Cover Banner */}
      <div className="h-44 sm:h-52 w-full bg-neutral-800 overflow-hidden relative">
        <CdnImage
          src={user.bannerUrl || defaultBanner}
          alt="Banner cover"
          className="w-full h-full object-cover"
        />
      </div>

      {/* Profile Details Container */}
      <div className="px-4 pb-4 border-b border-neutral-800/80">
        {/* Avatar & Edit/Follow Button Row */}
        <div className="flex items-end justify-between -mt-16 sm:-mt-20 mb-4">
          <Avatar
            src={user.avatarUrl}
            name={user.name}
            size="xl"
            className="ring-4 ring-black"
          />

          <div>
            {isOwnProfile ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEditModal(true)}
              >
                Edit profile
              </Button>
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
        <div className="mb-3">
          <h1 className="text-xl font-bold flex items-center gap-1.5 leading-tight">
            {user.name}
            {user.verified && <Badge type={user.isGold ? 'gold' : 'blue'} size="md" />}
          </h1>
          <span className="text-sm text-neutral-500">@{user.username}</span>
        </div>

        {/* Bio */}
        {user.bio && (
          <p className="text-sm leading-relaxed text-neutral-200 mb-3 whitespace-pre-wrap">
            {user.bio}
          </p>
        )}

        {/* Meta Info: Location, Website, Joined Date */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-neutral-500 mb-3">
          {user.location && (
            <div className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              <span>{user.location}</span>
            </div>
          )}
          {user.website && (
            <div className="flex items-center gap-1">
              <LinkIcon className="w-3.5 h-3.5" />
              <a
                href={user.website}
                target="_blank"
                rel="noreferrer"
                className={`hover:underline ${accentTextClass}`}
              >
                {user.website.replace(/^https?:\/\//, '')}
              </a>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            <span>{user.joinedDate}</span>
          </div>
        </div>

        {/* Follower Counts */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1">
            <span className="font-bold text-white">{user.followingCount}</span>
            <span className="text-neutral-500">Following</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="font-bold text-white">{user.followersCount.toLocaleString()}</span>
            <span className="text-neutral-500">Followers</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-800/80">
        {(['posts', 'replies', 'highlights', 'media', 'likes'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-3 text-center text-xs sm:text-sm font-bold capitalize relative hover:bg-neutral-800/20 cursor-pointer"
          >
            <span className={activeTab === tab ? 'text-white' : 'text-neutral-500'}>
              {tab}
            </span>
            {activeTab === tab && (
              <span className={`absolute bottom-0 left-0 right-0 h-1 rounded-full ${accentBgClass}`} />
            )}
          </button>
        ))}
      </div>

      {/* Profile Posts Feed */}
      <div className="divide-y divide-neutral-800/60 flex-1">
        {displayedPosts.length === 0 ? (
          <div className="p-12 text-center text-neutral-500 text-sm">
            No {activeTab} yet from this user.
          </div>
        ) : (
          displayedPosts.map(post => (
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

      {/* Edit Profile Modal */}
      {showEditModal && (
        <EditProfileModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          user={user}
          onSave={handleProfileSave}
        />
      )}
    </div>
  );
};
