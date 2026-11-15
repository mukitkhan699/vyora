// Phase 3B: Content Management — real post listing from the production database.

import React, { useEffect, useState } from 'react';
import {
  FileText,
  Image,
  Shield,
  Loader,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { adminApi, AdminPost } from '../../services/adminApi.ts';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { Input } from '../common/Input.tsx';
import { useAuth } from '../../context/AuthContext.tsx';

const POSTS_PER_PAGE = 20;

interface PostSummary {
  id: string;
  content: string;
  created_at: number;
  author: {
    id: string;
    username: string;
    name: string;
    avatar_url: string;
    is_verified: boolean;
    is_gold: boolean;
  };
  likes_count: number;
  replies_count: number;
  reposts_count: number;
  views_count: number;
  media_urls: string[];
}

export const ContentManagementScreen: React.FC = () => {
  const { adminRole, adminPermissions } = useAuth();
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Server-side permissions are enforced by requireAdminSession() /
  // requirePermission() middleware on every /api/admin/* endpoint. The client
  // mirrors this for presentation only; it is never trusted for security.
  const canReadPosts =
    adminPermissions?.posts?.read ||
    adminRole === 'super_admin' ||
    adminRole === 'admin' ||
    adminRole === 'moderator' ||
    adminRole === 'analyst';

  const fetchPosts = async () => {
    if (!canReadPosts) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const offset = (page - 1) * POSTS_PER_PAGE;
      const data = await adminApi.getAdminPosts({
        limit: POSTS_PER_PAGE,
        offset,
        search: search || undefined,
        sortBy: 'created_at',
        sortOrder: 'desc',
      });

      const postSummaries: PostSummary[] = data.posts.map((post) => ({
        id: post.id,
        content: post.content,
        created_at: post.created_at,
        author: {
          id: post.author_public_id,
          username: post.author_username,
          name: post.author_name,
          avatar_url: post.author_avatar_url,
          is_verified: post.author_verified,
          is_gold: post.author_is_gold,
        },
        likes_count: post.likes_count,
        replies_count: post.replies_count,
        reposts_count: post.reposts_count,
        views_count: post.views_count,
        media_urls: post.media_urls,
      }));

      setPosts(postSummaries);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [search, page]);

  const totalPages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'active': return 'emerald';
      case 'flagged': return 'amber';
      case 'suspended': return 'red';
      case 'deleted': return 'gray';
      default: return 'gray';
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-300 via-sky-300 to-purple-300 bg-clip-text text-transparent">
            Content Management
          </h1>
          <p className="mt-1 text-neutral-400">
            Review published posts from the production database.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPosts}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Permission notice */}
      {!canReadPosts && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300 text-sm">
          <AlertTriangle className="h-4 w-4 mr-2 shrink-0" />
          You do not have permission to view posts.
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300 text-sm flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={fetchPosts}>
            Retry
          </Button>
        </div>
      )}

      {/* Search */}
      <Card className="p-4">
        <div className="flex gap-3">
          <Input
            placeholder="Search posts by content, author, or name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <p className="text-xs text-neutral-500 mt-2">
          Search matches post content, author username, and author name.
        </p>
      </Card>

      {/* Posts grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="p-4 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-full bg-white/5" />
                <div className="flex-1">
                  <div className="h-4 w-32 bg-white/5 rounded" />
                  <div className="mt-1 h-3 w-20 bg-white/5 rounded" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-3 w-full bg-white/5 rounded" />
                <div className="h-3 w-3/4 bg-white/5 rounded" />
                <div className="h-3 w-1/2 bg-white/5 rounded" />
              </div>
            </Card>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="h-16 w-16 mx-auto mb-4 text-neutral-700" />
          <h3 className="text-xl font-semibold text-white mb-2">No Posts Found</h3>
          <p className="text-neutral-400 mb-6 max-w-xs mx-auto">
            {search
              ? 'No posts match your search. Try adjusting your search terms.'
              : 'There are no posts in the database yet.'}
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {posts.map((post) => (
              <Card key={post.id} className="p-4 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center shrink-0">
                      {post.author.is_verified ? (
                        <Shield className="h-5 w-5 text-white" />
                      ) : (
                        <Image className="h-5 w-5 text-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <h3 className="font-semibold text-white truncate">{post.author.name}</h3>
                        {post.author.is_gold && (
                          <Badge type="gold" size="xs">Gold</Badge>
                                                    )}
                      </div>
                      <p className="text-sm text-neutral-400 truncate">
                        @{post.author.username}
                      </p>
                      <span className="text-xs text-neutral-500">
                        {formatDate(post.created_at)}
                      </span>
                    </div>
                  </div>
                  {post.media_urls.length > 0 && (
                    <Badge type="cyan" size="xs">
                      {post.media_urls.length} media
                    </Badge>
                  )}
                </div>

                <p className="text-neutral-300 text-sm mb-3 line-clamp-3">
                  {post.content}
                </p>

                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="flex items-center gap-1 text-neutral-400">
                    <span className="text-cyan-400">❤</span>
                    <span>{post.likes_count}</span>
                  </div>
                  <div className="flex items-center gap-1 text-neutral-400">
                    <span className="text-violet-400">💬</span>
                    <span>{post.replies_count}</span>
                  </div>
                  <div className="flex items-center gap-1 text-neutral-400">
                    <span className="text-rose-400">🔁</span>
                    <span>{post.reposts_count}</span>
                  </div>
                  <div className="flex items-center gap-1 text-neutral-400">
                    <span className="text-emerald-400">👁</span>
                    <span>{post.views_count}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-neutral-400">
              Page {safePage} of {totalPages} &middot; {total} post{total === 1 ? '' : 's'}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={safePage === 1 || loading}
                onClick={() => setPage(safePage - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={safePage === totalPages || loading}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ContentManagementScreen;
