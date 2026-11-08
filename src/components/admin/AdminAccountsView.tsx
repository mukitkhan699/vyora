import React, { useEffect, useState } from 'react';
import {
  Search,
  Shield,
  UserPlus,
  UserX,
  UserCheck,
  Key,
  Loader,
  AlertCircle,
  MoreVertical,
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

export const AdminAccountsView: React.FC = () => {
  const [admins, setAdmins] = useState<AdminUserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<AdminRole | ''>('');
  const [selectedAdmin, setSelectedAdmin] = useState<AdminUserListItem | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAdminUsername, setNewAdminUsername] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<AdminRole>('admin');

  const fetchAdmins = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminApi.getUsers({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        search: search || undefined,
        role: roleFilter || undefined,
      });
      setAdmins(data.users);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
  }, [page, pageSize, search, roleFilter]);

  const handleRoleChange = async (admin: AdminUserListItem, newRole: AdminRole | null) => {
    try {
      await adminApi.updateUserRole(admin.public_id, newRole);
      fetchAdmins();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleRevokeAdmin = async (admin: AdminUserListItem) => {
    if (!confirm(`Revoke admin privileges for @${admin.username}?`)) return;
    try {
      await adminApi.updateUserRole(admin.public_id, null);
      fetchAdmins();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke admin');
    }
  };

  const handleCreateAdmin = async () => {
    if (!newAdminUsername.trim()) return;
    try {
      // Note: Creating admin accounts would need a backend endpoint
      // For now, we just show an alert
      alert('Creating admin accounts requires backend endpoint implementation');
      setShowCreateModal(false);
      setNewAdminUsername('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create admin');
    }
  };

  const roleOptions = [
    { value: '', label: 'Remove Admin Role' },
    { value: 'super_admin', label: 'Super Admin' },
    { value: 'admin', label: 'Admin' },
    { value: 'moderator', label: 'Moderator' },
    { value: 'verification_manager', label: 'Verification Manager' },
    { value: 'analyst', label: 'Analyst' },
  ];

  if (loading && admins.length === 0) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Admin Accounts</h1>
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
          <h1 className="text-2xl font-bold text-white">Admin Accounts</h1>
          <p className="mt-1 text-neutral-400">Manage administrator accounts and privileges</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add Admin
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300 text-sm flex items-center gap-2">
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={fetchAdmins}>Retry</Button>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
        </div>
        <span className="text-sm text-neutral-500">{total} total</span>
      </Card>

      {/* Admins Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Admin</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Verified</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Last Admin Action</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-400 uppercase tracking-wider pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {admins.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-neutral-500">No admin accounts found</td>
                </tr>
              ) : (
                admins.map((admin) => (
                  <tr key={admin.public_id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center">
                          <span className="font-bold text-white text-sm">{admin.name?.charAt(0).toUpperCase() || 'A'}</span>
                        </div>
                        <div>
                          <div className="font-medium text-white truncate max-w-xs">{admin.name}</div>
                          <div className="text-xs text-neutral-400 truncate max-w-xs font-mono">@{admin.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{getRoleBadge(admin.admin_role)}</td>
                    <td className="px-4 py-3">{getStatusBadge(!!admin.suspended_at)}</td>
                    <td className="px-4 py-3">
                      {admin.verified ? <Badge type="blue" size="xs">Verified</Badge> : <Badge type="gray" size="xs">No</Badge>}
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-400 font-mono">
                      {typeof admin.created_at === 'number' ? new Date(admin.created_at).toLocaleDateString() : admin.created_at}
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-400 font-mono">
                      {admin.last_admin_action_at ? (typeof admin.last_admin_action_at === 'number' ? new Date(admin.last_admin_action_at).toLocaleDateString() : admin.last_admin_action_at) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right pr-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setSelectedAdmin(admin); setShowRoleModal(true); }}
                          className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                          title="Change Role"
                        >
                          <Shield className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleRevokeAdmin(admin)}
                          className="p-2 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Revoke Admin"
                        >
                          <UserX className="h-4 w-4" />
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
