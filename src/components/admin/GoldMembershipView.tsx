import React, { useEffect, useState } from 'react';
import {
  Search,
  Award,
  Crown,
  Star,
  Loader,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { adminApi, AdminUserListItem, AdminRole } from '../../services/adminApi.ts';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { Input } from '../common/Input.tsx';
import { Select } from '../common/Select.tsx';

const getRoleBadge = (role: AdminRole | null) => {
  if (!role) return <Badge type="gray" size="xs">None</Badge>;
  const badges: Record<string, { label: string; color: 'blue' | 'gold' | 'violet' | 'amber' | 'cyan' }> = {
    super_admin: { label: 'Super Admin', color: 'gold' },
    admin: { label: 'Admin', color: 'violet' },
    moderator: { label: 'Moderator', color: 'blue' },
    verification_manager: { label: 'Verification', color: 'amber' },
    analyst: { label: 'Analyst', color: 'cyan' },
  };
  const badge = badges[role];
  return badge ? <Badge type={badge.color} size="xs">{badge.label}</Badge> : null;
};

export const GoldMembershipView: React.FC = () => {
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [goldFilter, setGoldFilter] = useState<'all' | 'gold' | 'none'>('all');

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminApi.getUsers({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        search: search || undefined,
      });
      let filtered = data.users;
      if (goldFilter !== 'all') {
        filtered = filtered.filter(u => goldFilter === 'gold' ? u.is_gold : !u.is_gold);
      }
      setUsers(filtered);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [page, pageSize, search, goldFilter]);

  const handleGoldToggle = async (user: AdminUserListItem) => {
    // Note: Gold membership toggle would need a separate backend endpoint
    // For now, we just show the current status
    alert('Gold membership management requires backend endpoint implementation');
  };

  if (loading && users.length === 0) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Gold Membership Management</h1>
        </div>
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-white/5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4 flex items-center gap-4 animate-pulse">
                <div className="h-10 w-10 rounded-full bg-white/5" />
                <div className="flex-1">
                  <div className="h-4 w-40 bg-white/5 rounded" />
                  <div className="mt-1 h-3 w-60 bg-white/5 rounded" />
                </div>
                <div className="h-6 w-24 bg-white/5 rounded" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Gold Membership Management</h1>
          <p className="mt-1 text-neutral-400">Manage Gold membership subscriptions and benefits</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300 text-sm flex items-center gap-2">
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={fetchUsers}>Retry</Button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Gold Members</p>
              <p className="mt-1 text-3xl font-bold text-white">
                {users.filter(u => u.is_gold).length}
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Award className="h-6 w-6 text-amber-400" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Standard Users</p>
              <p className="mt-1 text-3xl font-bold text-white">
                {users.filter(u => !u.is_gold).length}
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-neutral-500/10 flex items-center justify-center">
              <Star className="h-6 w-6 text-neutral-400" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Gold Rate</p>
              <p className="mt-1 text-3xl font-bold text-white">
                {users.length > 0 ? ((users.filter(u => u.is_gold).length / users.length) * 100).toFixed(1) : 0}%
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-emerald-400" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Total Users</p>
              <p className="mt-1 text-3xl font-bold text-white">{total}</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
              <Award className="h-6 w-6 text-cyan-400" />
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Input
            placeholder="Search username, name, email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="sm:col-span-2"
          />
          <Select
            value={goldFilter}
            onChange={(e) => { setGoldFilter(e.target.value as 'all' | 'gold' | 'none'); setPage(1); }}
            options={[
              { value: 'all', label: 'All Users' },
              { value: 'gold', label: 'Gold Members Only' },
              { value: 'none', label: 'Standard Users Only' },
            ]}
          />
        </div>
        <span className="text-sm text-neutral-500">{total} total</span>
      </Card>

      {/* Users Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Gold Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Verified</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-400 uppercase tracking-wider pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-neutral-500">No users found</td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.public_id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center">
                          <span className="font-bold text-white text-sm">{user.name?.charAt(0).toUpperCase() || 'U'}</span>
                        </div>
                        <div>
                          <div className="font-medium text-white truncate max-w-xs">{user.name}</div>
                          <div className="text-xs text-neutral-400 truncate max-w-xs font-mono">@{user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{getRoleBadge(user.admin_role)}</td>
                    <td className="px-4 py-3">
                      {user.is_gold ? (
                        <Badge type="gold" size="xs">Gold Member</Badge>
                      ) : (
                        <Badge type="gray" size="xs">Standard</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {user.verified ? <Badge type="blue" size="xs">Verified</Badge> : <Badge type="gray" size="xs">No</Badge>}
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-400 font-mono">
                      {typeof user.created_at === 'number' ? new Date(user.created_at).toLocaleDateString() : user.created_at}
                    </td>
                    <td className="px-4 py-3 text-right pr-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleGoldToggle(user)}
                          className="p-2 rounded-lg text-neutral-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                          title={user.is_gold ? 'Remove Gold' : 'Grant Gold'}
                        >
                          <Crown className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

function getRoleBadge(role: AdminRole | null) {
  if (!role) return <Badge type="gray" size="xs">None</Badge>;
  const badges: Record<string, { label: string; color: 'blue' | 'gold' | 'violet' | 'amber' | 'cyan' }> = {
    super_admin: { label: 'Super Admin', color: 'gold' },
    admin: { label: 'Admin', color: 'violet' },
    moderator: { label: 'Moderator', color: 'blue' },
    verification_manager: { label: 'Verification', color: 'amber' },
    analyst: { label: 'Analyst', color: 'cyan' },
  };
  const badge = badges[role];
  return badge ? <Badge type={badge.color} size="xs">{badge.label}</Badge> : null;
}