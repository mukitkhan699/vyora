import React, { useEffect, useState } from 'react';
import {
  Users,
  FileText,
  Flag,
  History,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Shield,
  Clock,
  Activity,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { adminApi, AdminStats, AdminAuditLogEntry } from '../../services/adminApi.ts';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { formatRelativeTime } from '../../utils/format.ts';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
  color?: 'cyan' | 'violet' | 'amber' | 'emerald' | 'rose';
  loading?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon,
  trend,
  color = 'cyan',
  loading = false,
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
        {trend && <div className="mt-2 h-4 w-20 bg-white/5 rounded animate-pulse" />}
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
      {trend && (
        <div className="mt-3 flex items-center gap-2">
          <TrendingUp className={`h-4 w-4 ${trend.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} />
          <span className={`text-sm font-medium ${trend.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
          </span>
        </div>
      )}
    </Card>
  );
};

interface RecentActivityProps {
  activities: AdminAuditLogEntry[];
  loading?: boolean;
}

const RecentActivity: React.FC<RecentActivityProps> = ({ activities, loading = false }) => {
  const getActionIcon = (action: string) => {
    if (action.includes('suspend')) return <AlertTriangle className="h-4 w-4 text-rose-400" />;
    if (action.includes('role.grant')) return <Shield className="h-4 w-4 text-cyan-400" />;
    if (action.includes('role.revoke')) return <Shield className="h-4 w-4 text-rose-400" />;
    if (action.includes('login')) return <Activity className="h-4 w-4 text-emerald-400" />;
    if (action.includes('session')) return <Clock className="h-4 w-4 text-amber-400" />;
    return <Activity className="h-4 w-4 text-neutral-400" />;
  };

  const formatAction = (action: string) => {
    return action
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  if (loading) {
    return (
      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <h3 className="font-semibold text-white">Recent Admin Activity</h3>
        </div>
        <div className="divide-y divide-white/5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 flex items-center gap-4 animate-pulse">
              <div className="h-8 w-8 rounded-lg bg-white/5" />
              <div className="flex-1">
                <div className="h-4 w-40 bg-white/5 rounded" />
                <div className="mt-1 h-3 w-60 bg-white/5 rounded" />
              </div>
              <div className="h-4 w-24 bg-white/5 rounded" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (activities.length === 0) {
    return (
      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <h3 className="font-semibold text-white">Recent Admin Activity</h3>
        </div>
        <div className="p-8 text-center text-neutral-500">
          <Activity className="h-12 w-12 mx-auto mb-3 text-neutral-700" />
          <p>No recent admin activity</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <h3 className="font-semibold text-white">Recent Admin Activity</h3>
        <Badge type="blue" size="sm">{activities.length} events</Badge>
      </div>
      <div className="divide-y divide-white/5">
        {activities.slice(0, 10).map((activity) => (
          <div key={activity.id} className="p-4 flex items-start gap-4 hover:bg-white/[0.02] transition-colors">
            <div className="mt-0.5 flex-shrink-0">{getActionIcon(activity.action)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-white">{formatAction(activity.action)}</span>
                <Badge type="gray" size="xs">{activity.target_type}</Badge>
              </div>
              <p className="mt-1 text-sm text-neutral-500 truncate">
                Target: <code className="text-neutral-400 font-mono">{activity.target_id}</code>
                {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                  <>
                    {' | '}
                    <span className="text-neutral-600">
                      {JSON.stringify(activity.metadata).slice(0, 100)}
                    </span>
                  </>
                )}
              </p>
              <p className="mt-1 text-xs text-neutral-600 flex items-center gap-2">
                <span>by</span>
                <code className="font-mono text-neutral-400">{activity.admin_username || activity.admin_id}</code>
                <span>•</span>
                <span>{formatRelativeTime(activity.created_at)}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

export const AdminDashboard: React.FC = () => {
  const { adminRole } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<AdminAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [statsData, activityData] = await Promise.all([
        adminApi.getStats(),
        adminApi.getAuditLog({ limit: 20, sortOrder: 'desc' }),
      ]);
      setStats(statsData);
      setRecentActivity(activityData.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <StatCard key={i} title="Loading" value="—" icon={<Users />} loading />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="h-64 bg-white/5">
              <div className="h-full w-full" />
            </Card>
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
            Admin Dashboard
          </h1>
          <p className="mt-1 text-neutral-400">
            System overview and administrative activity
            {adminRole && (
              <>
                <span className="mx-2 text-neutral-600">|</span>
                <Badge type={adminRole === 'super_admin' ? 'gold' : adminRole === 'admin' ? 'violet' : 'blue'} size="sm">
                  {adminRole.replace('_', ' ')}
                </Badge>
              </>
            )}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={fetchData} disabled={loading}>
          <Activity className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300 text-sm flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={fetchData}>
            Retry
          </Button>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Users"
          value={stats?.total_users.toLocaleString() || '—'}
          icon={<Users className="h-6 w-6" />}
          color="cyan"
          trend={stats ? { value: 0, label: 'vs last week' } : undefined}
        />
        <StatCard
          title="Active (24h)"
          value={stats?.active_users_24h.toLocaleString() || '—'}
          icon={<Activity className="h-6 w-6" />}
          color="emerald"
        />
        <StatCard
          title="Active (7d)"
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

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Posts"
          value={stats?.total_posts.toLocaleString() || '—'}
          icon={<FileText className="h-6 w-6" />}
          color="cyan"
        />
        <StatCard
          title="Posts (24h)"
          value={stats?.posts_24h.toLocaleString() || '—'}
          icon={<FileText className="h-6 w-6" />}
          color="emerald"
        />
        <StatCard
          title="Pending Reports"
          value={(Number(stats?.pending_user_reports || 0) + Number(stats?.pending_post_reports || 0)).toLocaleString() || '—'}
          icon={<Flag className="h-6 w-6" />}
          color="amber"
          trend={{ value: 0, label: 'needs review' }}
        />
        <StatCard
          title="Suspended Users"
          value={stats?.suspended_users_count.toLocaleString() || '—'}
          icon={<AlertTriangle className="h-6 w-6" />}
          color="rose"
        />
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <RecentActivity activities={recentActivity} loading={loading} />
        </div>

        {/* Quick Actions / System Health */}
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5 text-cyan-400" />
              Quick Actions
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                size="sm"
                className="h-20 flex flex-col items-center justify-center gap-2"
              >
                <Users className="h-5 w-5" />
                <span className="text-xs">Manage Users</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-20 flex flex-col items-center justify-center gap-2"
              >
                <FileText className="h-5 w-5" />
                <span className="text-xs">Moderate Posts</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-20 flex flex-col items-center justify-center gap-2"
              >
                <Flag className="h-5 w-5" />
                <span className="text-xs">Review Reports</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-20 flex flex-col items-center justify-center gap-2"
              >
                <History className="h-5 w-5" />
                <span className="text-xs">Audit Log</span>
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-emerald-400" />
              System Health
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-400">Database</span>
                <Badge type="emerald" size="xs">Healthy</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-400">Storage (B2)</span>
                <Badge type="emerald" size="xs">Connected</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-400">Realtime</span>
                <Badge type="emerald" size="xs">Active</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-400">Admin Sessions</span>
                <Badge type="cyan" size="xs">{recentActivity.filter(a => a.action.includes('session')).length} recent</Badge>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Attention Needed
            </h3>
            <div className="space-y-2">
              {Number(stats?.pending_user_reports || 0) > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Flag className="h-4 w-4 text-amber-400" />
                  <span className="text-neutral-300">{stats?.pending_user_reports} user report(s) pending</span>
                </div>
              )}
              {Number(stats?.pending_post_reports || 0) > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Flag className="h-4 w-4 text-amber-400" />
                  <span className="text-neutral-300">{stats?.pending_post_reports} post report(s) pending</span>
                </div>
              )}
              {Number(stats?.suspended_users_count || 0) > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                  <span className="text-neutral-300">{stats?.suspended_users_count} suspended user(s)</span>
                </div>
              )}
              {(Number(stats?.pending_user_reports || 0) === 0 &&
                Number(stats?.pending_post_reports || 0) === 0 &&
                Number(stats?.suspended_users_count || 0) === 0) && (
                <div className="flex items-center gap-2 text-sm text-emerald-400">
                  <Shield className="h-4 w-4" />
                  <span>No urgent items requiring attention</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};