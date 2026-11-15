// Phase 3C: Security Events — genuine security activity from the admin audit log.

import React, { useEffect, useState } from 'react';
import {
  Shield,
  AlertTriangle,
  RefreshCw,
  Activity,
  ShieldCheck,
  Users,
  MoreVertical,
  FileText,
} from 'lucide-react';
import { adminApi, SecurityEvent } from '../../services/adminApi.ts';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { Input } from '../common/Input.tsx';
import { useAuth } from '../../context/AuthContext.tsx';

const EVENTS_PER_PAGE = 50;

const SECURITY_ACTION_CATEGORIES: Record<string, string> = {
  'admin.session.revoke': 'Session',
  'admin.session.revoke_all': 'Session',
  'admin.session.create': 'Session',
  'admin.logout': 'Session',
  'admin.role.grant': 'Role',
  'admin.role.revoke': 'Role',
  'user.suspend': 'Account',
  'admin.login.failed': 'Authentication',
  'admin.login.success': 'Authentication',
  'admin.permission.denied': 'Authorization',
  'report.user.create': 'User Report',
  'report.user.reviewed': 'User Report',
  'report.user.dismissed': 'User Report',
  'report.user.action_taken': 'User Report',
  'report.post.create': 'Post Report',
  'report.post.reviewed': 'Post Report',
  'report.post.dismissed': 'Post Report',
  'report.post.action_taken': 'Post Report',
  'bootstrap.super_admin': 'System',
};

const categoryColor = (category: string): 'cyan' | 'violet' | 'amber' | 'emerald' | 'gray' | 'rose' => {
  switch (category) {
    case 'Session': return 'cyan';
    case 'Role': return 'violet';
    case 'Account': return 'rose';
    case 'Authentication': return 'cyan';
    case 'Authorization': return 'violet';
    case 'User Report': return 'amber';
    case 'Post Report': return 'amber';
    case 'System': return 'emerald';
    default: return 'gray';
  }
};

const categoryForAction = (action: string): string => {
  return SECURITY_ACTION_CATEGORIES[action] || 'Other';
};

const formatEventDescription = (event: SecurityEvent): string => {
  const { action, target_type, target_id } = event;
  const category = categoryForAction(action);
  switch (category) {
    case 'Session':
      if (action === 'admin.session.revoke_all') return `Revoked all admin sessions for user ${target_id}`;
      if (action === 'admin.session.revoke') return `Revoked admin session ${target_id}`;
      if (action === 'admin.session.create') return `Created admin session for ${target_id}`;
      if (action === 'admin.logout') return `Admin logout for ${target_id}`;
      return `${action} on ${target_type} ${target_id}`;
    case 'Role':
      return action === 'admin.role.grant'
        ? `Granted admin role to ${target_id}`
        : `Revoked admin role from ${target_id}`;
    case 'Account':
      return `Suspended account ${target_id}`;
    case 'Authentication':
      if (action === 'admin.login.failed') return `Failed admin login for ${target_id}`;
      if (action === 'admin.login.success') return `Successful admin login for ${target_id}`;
      return `${action} on ${target_type} ${target_id}`;
    case 'Authorization':
      return `Permission denied for ${target_type} ${target_id}`;
    case 'User Report':
      return `User report ${target_id} ${action.split('.')[1]}`;
    case 'Post Report':
      return `Post report ${target_id} ${action.split('.')[1]}`;
    case 'System':
      return 'Bootstrapped super admin';
    default:
      return `${action} on ${target_type} ${target_id}`;
  }
};

export const SecurityEventsScreen: React.FC = () => {
  const { adminRole, adminPermissions } = useAuth();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [actor, setActor] = useState('');
  const [startDate, setStartDate] = useState<number | null>(null);
  const [endDate, setEndDate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Server-side permissions are enforced by requireAdminSession() /
  // requirePermission() middleware on every /api/admin/* endpoint. The client
  // mirrors this for presentation only; it is never trusted for security.
  const canReadAudit = adminPermissions?.audit?.read || adminRole === 'super_admin' || adminRole === 'admin';

  const fetchEvents = async () => {
    if (!canReadAudit) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const offset = (page - 1) * EVENTS_PER_PAGE;
      const data = await adminApi.getSecurityEvents({
        limit: EVENTS_PER_PAGE,
        offset,
        search: search || undefined,
        adminId: actor || undefined,
        startDate: startDate ?? undefined,
        endDate: endDate ?? undefined,
        sortOrder: 'desc',
      });

      setEvents(data.events);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load security events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [search, actor, startDate, endDate, page]);

  const totalPages = Math.max(1, Math.ceil(total / EVENTS_PER_PAGE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-300 via-sky-300 to-purple-300 bg-clip-text text-transparent">
            Security Events
          </h1>
          <p className="mt-1 text-neutral-400">
            Genuine security activity recorded in the admin audit log.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchEvents}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Permission notice */}
      {!canReadAudit && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300 text-sm">
          <AlertTriangle className="h-4 w-4 mr-2 shrink-0" />
          You do not have permission to view security events.
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300 text-sm flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={fetchEvents}>
            Retry
          </Button>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Input
            placeholder="Search by action..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Input
            placeholder="Filter by actor..."
            value={actor}
            onChange={(e) => {
              setActor(e.target.value);
              setPage(1);
            }}
          />
          <div className="flex items-end gap-2">
            <input
              type="date"
              value={startDate ? new Date(startDate).toISOString().split('T')[0] : ''}
              onChange={(e) => {
                if (e.target.value) {
                  setStartDate(new Date(e.target.value).setUTCHours(0, 0, 0, 0));
                  setPage(1);
                } else {
                  setStartDate(null);
                  setPage(1);
                }
              }}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition-all focus:border-cyan-400/70 focus:bg-white/[0.07]"
            />
            <input
              type="date"
              value={endDate ? new Date(endDate).toISOString().split('T')[0] : ''}
              onChange={(e) => {
                if (e.target.value) {
                  setEndDate(new Date(e.target.value).setUTCHours(23, 59, 59, 999));
                  setPage(1);
                } else {
                  setEndDate(null);
                  setPage(1);
                }
              }}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition-all focus:border-cyan-400/70 focus:bg-white/[0.07]"
            />
          </div>
        </div>
        <p className="text-xs text-neutral-500 mt-2">
          Events are sourced from the admin audit log. Only verified security-relevant
          action types are shown; ordinary administrative actions are not classified
          as security events.
        </p>
      </Card>

      {/* Events list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="p-4 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-full bg-white/5" />
                <div className="flex-1">
                  <div className="h-4 w-32 bg-white/5 rounded" />
                  <div className="mt-1 h-3 w-24 bg-white/5 rounded" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-3 w-full bg-white/5 rounded" />
                <div className="h-3 w-1/2 bg-white/5 rounded" />
              </div>
            </Card>
          ))}
        </div>
      ) : events.length === 0 ? (
        <Card className="p-12 text-center">
          <Shield className="h-16 w-16 mx-auto mb-4 text-neutral-700" />
          <h3 className="text-xl font-semibold text-white mb-2">No Security Events</h3>
          <p className="text-neutral-400 mb-6 max-w-xs mx-auto">
            {search || actor || startDate || endDate
              ? 'No security events match your filters.'
              : 'No security-relevant activity has been recorded in the audit log.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const category = categoryForAction(event.action);
            return (
              <Card key={event.id} className="p-4 hover:bg-white/[0.02] transition-colors border-l-2 border-transparent hover:border-white/10">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                      {category === 'Session' ? (
                        <Activity className="h-4 w-4 text-cyan-400" />
                      ) : category === 'Role' ? (
                        <ShieldCheck className="h-4 w-4 text-violet-400" />
                      ) : category === 'Account' ? (
                        <Users className="h-4 w-4 text-rose-400" />
                      ) : category === 'Authentication' ? (
                        <Activity className="h-4 w-4 text-cyan-400" />
                      ) : category === 'Authorization' ? (
                        <Shield className="h-4 w-4 text-violet-400" />
                      ) : category === 'System' ? (
                        <Shield className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <FileText className="h-4 w-4 text-amber-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-sm font-medium text-white truncate">{formatEventDescription(event)}</span>
                        <Badge type={categoryColor(category)} size="xs">
                          {category}
                        </Badge>
                      </div>
                      <p className="text-xs text-neutral-500 truncate">
                        {event.admin_username || 'unknown actor'} &middot;
                        {event.target_type} {event.target_id}
                      </p>
                      <span className="text-xs text-neutral-500">
                        {formatDate(event.created_at)}
                      </span>
                    </div>
                  </div>
                  <MoreVertical className="h-4 w-4 text-neutral-500 shrink-0" />
                </div>
                <div className="mt-2 pt-2 border-t border-white/5">
                  <div className="text-xs text-neutral-400 font-mono mb-1">{event.action}</div>
                  {event.metadata && Object.keys(event.metadata).length > 0 && (
                    <div className="text-xs text-neutral-500 break-all">
                      {JSON.stringify(event.metadata)}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-neutral-400">
            Page {safePage} of {totalPages} &middot; {total} event{total === 1 ? '' : 's'}
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
      )}
    </div>
  );
};

export default SecurityEventsScreen;
