import React, { useEffect, useState } from 'react';
import {
  Users,
  FileText,
  Shield,
  Activity,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Loader,
} from 'lucide-react';
import { adminApi, AdminStats } from '../../services/adminApi.ts';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { useAuth } from '../../context/AuthContext.tsx';

export const PlatformAnalyticsScreen: React.FC = () => {
  const { adminRole } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminApi.getStats();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const StatCard: React.FC<{ title: string; value: string | number; icon: React.ReactNode; color?: 'cyan' | 'violet' | 'amber' | 'emerald' | 'rose' }> = ({
    title,
    value,
    icon,
    color = 'cyan',
  }) => {
    const colorClasses: Record<string, { bg: string; text: string; border: string }> = {
      cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
      violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' },
      amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
      emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
      rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20' },
    };

    const c = colorClasses[color] || colorClasses.cyan;

    if (loading) {
      return (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="h-4 w-24 bg-white/5 rounded animate-pulse" />
            <div className={`h-10 w-10 rounded-xl ${c.bg} animate-pulse`} />
          </div>
          <div className="mt-4 h-8 w-32 bg-white/5 rounded animate-pulse" />
        </Card>
      );
    }

    return (
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{title}</p>
            <p className="mt-1 text-3xl font-bold text-white">{value}</p>
          </div>
          <div className={`h-10 w-10 rounded-xl ${c.bg} flex items-center justify-center`}>
            {icon}
          </div>
        </div>
      </Card>
    );
  };

  if (loading && !stats) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="h-8 w-64 bg-white/5 rounded" />
          <div className="h-10 w-32 bg-white/5 rounded" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <StatCard key={i} title="Loading" value="—" icon={<Users />} />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <StatCard key={i} title="Loading" value="—" icon={<FileText />} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-300 via-sky-300 to-purple-300 bg-clip-text text-transparent">
            Platform Analytics
          </h1>
          <p className="mt-1 text-neutral-400">
            Current platform totals sourced from the admin stats endpoint.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchStats}
            disabled={loading}
          >
            <Activity className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300 text-sm flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={fetchStats}>
            Retry
          </Button>
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Users"
          value={stats?.total_users.toLocaleString() || '—'}
          icon={<Users className="h-6 w-6" />}
          color="cyan"
        />
        <StatCard
          title="New Users (24h)"
          value={stats?.active_users_24h.toLocaleString() || '—'}
          icon={<Activity className="h-6 w-6" />}
          color="emerald"
        />
        <StatCard
          title="New Users (7d)"
          value={stats?.active_users_7d.toLocaleString() || '—'}
          icon={<TrendingUp className="h-6 w-6" />}
          color="violet"
        />
        <StatCard
          title="Admin Users"
          value={stats?.admin_users_count.toLocaleString() || '—'}
          icon={<Shield className="h-6 w-6" />}
          color="amber"
        />
      </div>

      {/* Content Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-2">
          <Card className="p-6">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-cyan-400" />
              Content Metrics
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Total Posts</span>
                <span className="text-white font-semibold">{stats?.total_posts.toLocaleString() || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Posts (24h)</span>
                <span className="text-white font-semibold">{stats?.posts_24h.toLocaleString() || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Posts (7d)</span>
                <span className="text-white font-semibold">{stats?.posts_7d.toLocaleString() || '—'}</span>
              </div>
              <div className="pt-4 border-t border-white/10">
                <div className="text-sm text-neutral-500 mb-2">Pending Reports</div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-neutral-400 text-sm">User Reports</span>
                  <Badge type="amber" size="xs">{stats?.pending_user_reports || 0} pending</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400 text-sm">Post Reports</span>
                  <Badge type="amber" size="xs">{stats?.pending_post_reports || 0} pending</Badge>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Engagement Summary */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-cyan-400" />
              Engagement Summary
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-cyan-400">{stats?.active_users_24h || 0}</div>
                <div className="text-xs text-neutral-500 mt-1">New users in last 24h</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-violet-400">{stats?.active_users_7d || 0}</div>
                <div className="text-xs text-neutral-500 mt-1">New users in last 7d</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-400">{stats?.posts_24h || 0}</div>
                <div className="text-xs text-neutral-500 mt-1">Posts in last 24h</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-400">
                  {stats?.suspended_users_count || 0}
                </div>
                <div className="text-xs text-neutral-500 mt-1">Suspended users</div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default PlatformAnalyticsScreen;
