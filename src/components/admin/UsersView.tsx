import React, { useEffect, useState } from 'react';
import {
  Search,
  UserPlus,
  Shield,
  UserX,
  UserCheck,
  MoreVertical,
  Loader,
} from 'lucide-react';
import { adminApi, AdminUserListItem, AdminRole } from '../../services/adminApi.ts';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { Input } from '../common/Input.tsx';
import { Select } from '../common/Select.tsx';
import { formatRelativeTime } from '../../utils/format.ts';

const getRoleBadge = (role: AdminRole | null) => {
  if (!role) return <Badge type="gray" size="xs">None</Badge>;
  const badges: Record<AdminRole, { label: string; color: 'blue' | 'gold' | 'violet' | 'amber' | 'cyan' }> = {
    super_admin: { label: 'Super Admin', color: 'gold' },
    admin: { label: 'Admin', color: 'violet' },
    moderator: { label: 'Moderator', color: 'blue' },
    verification_manager: { label: 'Verification', color: 'amber' },
    analyst: { label: 'Analyst', color: 'cyan' },
  };
  const badge = badges[role];
  return badge ? <Badge type={badge.color} size="xs">{badge.label}</Badge> : null;
};

const getStatusBadge = (suspended: boolean) => {
  return suspended ? (
    <Badge type="rose" size="xs">Suspended</Badge>
  ) : (
    <Badge type="emerald" size="xs">Active</Badge>
  );
};

export const UsersView: React.FC = () => {
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<AdminRole | ''>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [sortBy, setSortBy] = useState<'created_at' | 'username' | 'last_admin_action_at'>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedUser, setSelectedUser] = useState<AdminUserListItem | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminApi.getUsers({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        search: search || undefined,
        role: roleFilter || undefined,
        suspended: statusFilter === 'suspended',
        sortBy,
        sortOrder,
      });
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [page, pageSize, search, roleFilter, statusFilter, sortBy, sortOrder]);

  const handleRoleChange = async (user: AdminUserListItem, newRole: AdminRole | null) => {
    try {
      await adminApi.updateUserRole(user.public_id, newRole);
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleSuspend = async (user: AdminUserListItem) => {
    if (!suspendReason.trim()) return;
    try {
      await adminApi.suspendUser(user.public_id, suspendReason);
      setShowSuspendModal(false);
      setSuspendReason('');
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to suspend user');
    }
  };

  const handleUnsuspend = async (user: AdminUserListItem) => {
    try {
      await adminApi.unsuspendUser(user.public_id);
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to unsuspend user');
    }
  };

  const openRoleModal = (user: AdminUserListItem) => {
    setSelectedUser(user);
    setShowRoleModal(true);
  };

  const openSuspendModal = (user: AdminUserListItem) => {
    setSelectedUser(user);
    setSuspendReason('');
    setShowSuspendModal(true);
  };

  const roleOptions = [
    { value: '', label: 'Remove Admin Role' },
    { value: 'super_admin', label: 'Super Admin' },
    { value: 'admin', label: 'Admin' },
    { value: 'moderator', label: 'Moderator' },
    { value: 'verification_manager', label: 'Verification Manager' },
    { value: 'analyst', label: 'Analyst' },
  ];

  if (loading && users.length === 0) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">User Management</h1>
        </div>
        <Card className="p-0 overflow-hidden">
          <div className="p-4 border-b border-white/10">
            <div className="h-6 w-48 bg-white/5 rounded animate-pulse" />
          </div>
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
          <h1 className="text-2xl font-bold text-white">User Management</h1>
          <p className="mt-1 text-neutral-400">Manage user accounts, roles, and status</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300 text-sm flex items-center gap-2">
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={fetchUsers}>Retry</Button>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <Input
            placeholder="Search username, name, email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="sm:col-span-2"
          />
          <Select
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value as AdminRole | ''); setPage(1); }}
            options={[
              { value: '', label: 'All Roles' },
              { value: 'super_admin', label: 'Super Admin' },
              { value: 'admin', label: 'Admin' },
              { value: 'moderator', label: 'Moderator' },
              { value: 'verification_manager', label: 'Verification Manager' },
              { value: 'analyst', label: 'Analyst' },
            ]}
          />
          <Select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as 'all' | 'active' | 'suspended'); setPage(1); }}
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
            ]}
          />
          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'created_at' | 'username' | 'last_admin_action_at')}
            options={[
              { value: 'created_at', label: 'Created' },
              { value: 'username', label: 'Username' },
              { value: 'last_admin_action_at', label: 'Last Admin Action' },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}>
            {sortOrder === 'asc' ? '↑ Asc' : '↓ Desc'}
          </Button>
          <span className="text-sm text-neutral-500">{total} total</span>
        </div>
      </Card>

      {/* Users Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Verified</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Gold</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Last Admin Action</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-400 uppercase tracking-wider pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-neutral-500">No users found</td>
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
                    <td className="px-4 py-3">{getStatusBadge(!!user.suspended_at)}</td>
                    <td className="px-4 py-3">
                      {user.verified ? <Badge type="blue" size="xs">Verified</Badge> : <Badge type="gray" size="xs">No</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      {user.is_gold ? <Badge type="gold" size="xs">Gold</Badge> : <Badge type="gray" size="xs">No</Badge>}
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-400 font-mono">
                      {typeof user.created_at === 'number' ? new Date(user.created_at).toLocaleDateString() : user.created_at}
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-400 font-mono">
                      {user.last_admin_action_at ? (typeof user.last_admin_action_at === 'number' ? new Date(user.last_admin_action_at).toLocaleDateString() : user.last_admin_action_at) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right pr-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openRoleModal(user)}
                          className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                          title="Change Role"
                        >
                          <Shield className="h-4 w-4" />
                        </button>
                        {user.suspended_at ? (
                          <button
                            onClick={() => handleUnsuspend(user)}
                            className="p-2 rounded-lg text-neutral-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                            title="Unsuspend"
                          >
                            <UserCheck className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => openSuspendModal(user)}
                            className="p-2 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Suspend"
                          >
                            <UserX className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > pageSize && (
          <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between">
            <span className="text-sm text-neutral-500">
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
              <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.min(Math.ceil(total / pageSize), p + 1))} disabled={page >= Math.ceil(total / pageSize)}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {/* Role Change Modal */}
      {showRoleModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0f18]/95 p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <h2 className="text-lg font-bold text-white mb-4">Change Role for @{selectedUser.username}</h2>
            <Select
              value={selectedUser.admin_role || ''}
              onChange={(e) => handleRoleChange(selectedUser, e.target.value || null)}
              options={[
                { value: '', label: 'Remove Admin Role' },
                { value: 'super_admin', label: 'Super Admin' },
                { value: 'admin', label: 'Admin' },
                { value: 'moderator', label: 'Moderator' },
                { value: 'verification_manager', label: 'Verification Manager' },
                { value: 'analyst', label: 'Analyst' },
              ]}
              className="mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setShowRoleModal(false); setSelectedUser(null); }}>Cancel</Button>
              <Button onClick={() => { setShowRoleModal(false); setSelectedUser(null); }}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* Suspend Modal */}
      {showSuspendModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0f18]/95 p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <h2 className="text-lg font-bold text-white mb-4">Suspend @{selectedUser.username}</h2>
            <p className="text-neutral-400 mb-4">Please provide a reason for suspension. The user will be notified.</p>
            <textarea
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Reason for suspension..."
              rows={4}
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-cyan-400 placeholder:text-neutral-500 mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setShowSuspendModal(false); setSuspendReason(''); setSelectedUser(null); }}>Cancel</Button>
              <Button variant="destructive" onClick={() => handleSuspend(selectedUser)} disabled={!suspendReason.trim()}>Suspend User</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};