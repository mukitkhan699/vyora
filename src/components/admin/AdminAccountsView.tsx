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
    verification_manager: { label: 'Verification Manager', color: 'amber' },
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
  const [pendingRole, setPendingRole] = useState<AdminRole | null | undefined>(undefined);
  const [roleConfirmPassword, setRoleConfirmPassword] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AdminUserListItem | null>(null);
  const [revokePassword, setRevokePassword] = useState('');
  const [newAdminUsername, setNewAdminUsername] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<AdminRole>('admin');
  const [createPassword, setCreatePassword] = useState('');
  const [creating, setCreating] = useState(false);

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

  const handleRoleChange = async (admin: AdminUserListItem, newRole: AdminRole | null, confirmPassword?: string) => {
    try {
      await adminApi.updateUserRole(admin.public_id, newRole, confirmPassword);
      setShowRoleModal(false);
      setSelectedAdmin(null);
      setPendingRole(undefined);
      setRoleConfirmPassword('');
      fetchAdmins();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleRevokeAdmin = async (admin: AdminUserListItem) => {
    setRevokeTarget(admin);
    setRevokePassword('');
    setShowRevokeDialog(true);
  };

  const handleConfirmRevoke = async () => {
    if (!revokeTarget) return;
    if (!revokePassword.trim()) {
      alert('Your current admin password is required to revoke admin privileges.');
      return;
    }
    try {
      await adminApi.updateUserRole(revokeTarget.public_id, null, revokePassword);
      setShowRevokeDialog(false);
      setRevokeTarget(null);
      setRevokePassword('');
      fetchAdmins();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke admin');
    }
  };

  const openCreateModal = () => {
    setNewAdminUsername('');
    setNewAdminEmail('');
    setNewAdminPassword('');
    setNewAdminName('');
    setNewAdminRole('admin');
    setCreatePassword('');
    setError(null);
    setShowCreateModal(true);
  };

  const handleCreateAdmin = async () => {
    if (!newAdminUsername.trim()) {
      setError('Username is required.');
      return;
    }
    if (!newAdminEmail.trim()) {
      setError('Email is required.');
      return;
    }
    const emailPattern = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
    if (!emailPattern.test(newAdminEmail)) {
      setError('A valid email address is required.');
      return;
    }
    if (!newAdminPassword.trim()) {
      setError('Password is required.');
      return;
    }
    if (newAdminPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!/[A-Z]/.test(newAdminPassword)) {
      setError('Password must contain at least one uppercase letter.');
      return;
    }
    if (!/[a-z]/.test(newAdminPassword)) {
      setError('Password must contain at least one lowercase letter.');
      return;
    }
    if (!/[0-9]/.test(newAdminPassword)) {
      setError('Password must contain at least one number.');
      return;
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newAdminPassword)) {
      setError('Password must contain at least one special character.');
      return;
    }
    if (!createPassword.trim()) {
      setError('Your current admin password is required to create an admin account.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await adminApi.createAdminUser({
        username: newAdminUsername.trim(),
        email: newAdminEmail.trim().toLowerCase(),
        password: newAdminPassword,
        name: newAdminName.trim() || newAdminUsername.trim(),
        adminRole: newAdminRole,
        confirmPassword: createPassword,
      });
      setShowCreateModal(false);
      setCreating(false);
      fetchAdmins();
    } catch (err) {
      setCreating(false);
      setError(err instanceof Error ? err.message : 'Failed to create admin account');
    }
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setNewAdminUsername('');
    setNewAdminEmail('');
    setNewAdminPassword('');
    setNewAdminName('');
    setNewAdminRole('admin');
    setCreatePassword('');
    setError(null);
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
        <Button onClick={openCreateModal}>
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
                          onClick={() => {
                            setSelectedAdmin(admin);
                            setPendingRole(admin.admin_role ?? undefined);
                            setRoleConfirmPassword('');
                            setShowRoleModal(true);
                          }}
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
      {/* Revoke Admin Confirmation Dialog */}
      {showRevokeDialog && revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0f18]/95 p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <h2 className="text-lg font-bold text-white mb-4">Revoke Admin for @{revokeTarget.username}</h2>
            <p className="text-sm text-neutral-400 mb-6">
              Revoking admin privileges requires step-up authentication. Enter your current admin password to confirm.
            </p>
            <Input
              type="password"
              value={revokePassword}
              onChange={(e) => setRevokePassword(e.target.value)}
              placeholder="Your current admin password"
              className="mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setShowRevokeDialog(false); setRevokeTarget(null); setRevokePassword(''); }}>Cancel</Button>
              <Button variant="danger" onClick={handleConfirmRevoke} disabled={!revokePassword.trim()}>
                Revoke Admin
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Change Role Dialog */}
      {showRoleModal && selectedAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0f18]/95 p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <h2 className="text-lg font-bold text-white mb-4">Change Role for @{selectedAdmin.username}</h2>
            <p className="text-sm text-neutral-400 mb-6">
              Role changes require step-up authentication. Select the new role and enter your current admin password to confirm.
            </p>
            <Select
              value={pendingRole ?? selectedAdmin.admin_role ?? ''}
              onChange={(e) => setPendingRole((e.target.value || null) as AdminRole | null)}
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
            <Input
              type="password"
              value={roleConfirmPassword}
              onChange={(e) => setRoleConfirmPassword(e.target.value)}
              placeholder="Your current admin password"
              className="mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setShowRoleModal(false); setSelectedAdmin(null); setPendingRole(undefined); setRoleConfirmPassword(''); }}>Cancel</Button>
              <Button
                onClick={() => handleRoleChange(selectedAdmin, pendingRole ?? selectedAdmin.admin_role ?? null, roleConfirmPassword || undefined)}
                disabled={pendingRole === undefined || pendingRole === selectedAdmin.admin_role || !roleConfirmPassword.trim()}
              >
                Save Role
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Create Admin Dialog */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0f18]/95 p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <h2 className="text-lg font-bold text-white mb-4">Create Admin Account</h2>
            <p className="text-sm text-neutral-400 mb-6">
              Creating an admin account is restricted to super admins and requires step-up authentication.
            </p>
            <Input
              value={newAdminUsername}
              onChange={(e) => setNewAdminUsername(e.target.value)}
              placeholder="Username"
              className="mb-3"
            />
            <Input
              type="email"
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              placeholder="Email address"
              className="mb-3"
            />
            <Input
              value={newAdminName}
              onChange={(e) => setNewAdminName(e.target.value)}
              placeholder="Full name (optional)"
              className="mb-3"
            />
            <Input
              type="password"
              value={newAdminPassword}
              onChange={(e) => setNewAdminPassword(e.target.value)}
              placeholder="New admin password (8+ chars, upper/lower/digit/special)"
              className="mb-3"
            />
            <Select
              value={newAdminRole}
              onChange={(e) => setNewAdminRole(e.target.value as AdminRole)}
              options={roleOptions.filter(o => o.value !== '')}
              className="mb-3"
            />
            <Input
              type="password"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              placeholder="Your current admin password (step-up)"
              className="mb-4"
            />
            {error && (
              <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-rose-300 text-sm">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeCreateModal} disabled={creating}>
                Cancel
              </Button>
              <Button onClick={handleCreateAdmin} disabled={creating}>
                {creating ? 'Creating...' : 'Create Admin'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
