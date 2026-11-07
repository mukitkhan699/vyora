import React, { useEffect, useState } from 'react';
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Download,
} from 'lucide-react';
import { adminApi, AdminAuditLogEntry, AdminRole } from '../../services/adminApi.ts';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { formatRelativeTime } from '../../utils/format.ts';

interface AuditLogViewProps {
  currentUserRole?: AdminRole;
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({ currentUserRole }) => {
  const [logs, setLogs] = useState<AdminAuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState({
    adminId: '',
    action: '',
    targetType: '',
    targetId: '',
    startDate: '',
    endDate: '',
  });
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError(null);
      const offset = (page - 1) * pageSize;
      const params: any = {
        limit: pageSize,
        offset,
        sortOrder,
      };
      if (filters.adminId) params.adminId = filters.adminId;
      if (filters.action) params.action = filters.action;
      if (filters.targetType) params.targetType = filters.targetType;
      if (filters.targetId) params.targetId = filters.targetId;
      if (filters.startDate) params.startDate = new Date(filters.startDate).getTime();
      if (filters.endDate) params.endDate = new Date(filters.endDate).getTime() + 86400000; // end of day

      const data = await adminApi.getAuditLog(params);
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, pageSize, sortOrder, filters]);

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({
      adminId: '',
      action: '',
      targetType: '',
      targetId: '',
      startDate: '',
      endDate: '',
    });
    setPage(1);
  };

  const getActionBadge = (action: string) => {
    if (action.includes('suspend')) return <Badge type="rose" size="xs">{action}</Badge>;
    if (action.includes('role.grant')) return <Badge type="emerald" size="xs">{action}</Badge>;
    if (action.includes('role.revoke')) return <Badge type="amber" size="xs">{action}</Badge>;
    if (action.includes('login')) return <Badge type="cyan" size="xs">{action}</Badge>;
    if (action.includes('session')) return <Badge type="violet" size="xs">{action}</Badge>;
    if (action.includes('bootstrap')) return <Badge type="gold" size="xs">{action}</Badge>;
    return <Badge type="gray" size="xs">{action}</Badge>;
  };

  const getTargetTypeBadge = (type: string) => {
    const colors: Record<string, 'blue' | 'gold' | 'cyan' | 'gray' | 'violet' | 'amber' | 'emerald' | 'rose'> = {
      user: 'cyan',
      post: 'violet',
      admin_session: 'amber',
      badge: 'gold',
      config: 'rose',
    };
    return <Badge type={colors[type] || 'gray'} size="xs">{type}</Badge>;
  };

  const totalPages = Math.ceil(total / pageSize);

  if (loading && logs.length === 0) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="h-24 bg-white/5" />
          ))}
        </div>
        <Card className="h-96 bg-white/5" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-6 text-rose-300">
          <p className="font-semibold mb-2">Failed to load audit log</p>
          <p className="text-sm mb-4">{error}</p>
          <Button variant="outline" onClick={fetchLogs}>Retry</Button>
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
            Audit Log
          </h1>
          <p className="mt-1 text-neutral-400">
            Administrative actions and system events
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchLogs}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => {}}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          <input
            type="text"
            placeholder="Admin ID / Username"
            value={filters.adminId}
            onChange={(e) => handleFilterChange('adminId', e.target.value)}
            className="px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-cyan-400 placeholder:text-neutral-500"
          />
          <input
            type="text"
            placeholder="Action (e.g. user.suspend)"
            value={filters.action}
            onChange={(e) => handleFilterChange('action', e.target.value)}
            className="px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-cyan-400 placeholder:text-neutral-500"
          />
          <input
            type="text"
            placeholder="Target Type (user, post, etc.)"
            value={filters.targetType}
            onChange={(e) => handleFilterChange('targetType', e.target.value)}
            className="px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-cyan-400 placeholder:text-neutral-500"
          />
          <input
            type="text"
            placeholder="Target ID"
            value={filters.targetId}
            onChange={(e) => handleFilterChange('targetId', e.target.value)}
            className="px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-cyan-400 placeholder:text-neutral-500"
          />
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => handleFilterChange('startDate', e.target.value)}
            className="px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-cyan-400"
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => handleFilterChange('endDate', e.target.value)}
            className="px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-cyan-400"
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-sm text-neutral-400">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                className="px-2 py-1 bg-black/40 border border-white/10 rounded text-sm text-white outline-none"
              >
                <option value="desc">Newest First</option>
                <option value="asc">Oldest First</option>
              </select>
            </label>
            <span className="text-sm text-neutral-500">
              {total} total • Page {page} of {totalPages || 1}
            </span>
          </div>
          {(filters.adminId || filters.action || filters.targetType || filters.targetId || filters.startDate || filters.endDate) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <Filter className="h-4 w-4 mr-1" />
              Clear Filters
            </Button>
          )}
        </div>
      </Card>

      {/* Log Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Time</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Action</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Target</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Admin</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">IP / UA</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-neutral-500">
                    No audit log entries found
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-sm text-neutral-300 font-mono">
                      {formatRelativeTime(log.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {getActionBadge(log.action)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {getTargetTypeBadge(log.target_type)}
                        <code className="text-sm text-neutral-400 font-mono">{log.target_id}</code>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-300">
                      {log.admin_username || log.admin_id}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500 max-w-xs truncate">
                      {log.ip_address || '—'} {log.user_agent ? ` / ${log.user_agent.slice(0, 30)}...` : ''}
                    </td>
                    <td className="px-4 py-3">
                      {log.metadata && Object.keys(log.metadata).length > 0 ? (
                        <details className="text-xs">
                          <summary className="text-neutral-500 cursor-pointer">View details</summary>
                          <pre className="mt-1 p-2 bg-black/40 rounded text-neutral-300 max-h-32 overflow-auto">
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <span className="text-neutral-600">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between">
            <span className="text-sm text-neutral-500">
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};