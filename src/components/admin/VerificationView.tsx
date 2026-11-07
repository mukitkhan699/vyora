import React, { useEffect, useState } from 'react';
import {
  Search,
  Shield,
  Award,
  UserCheck,
  UserX,
  Loader,
  AlertCircle,
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

export const VerificationView: React.FC = () => {
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [verificationFilter, setVerificationFilter] = useState<'all' | 'verified' | 'unverified'>('all');
  const [goldFilter, setGoldFilter] = useState<'all' | 'gold' | 'none'>('all');
  const [selectedUser, setSelectedUser] = useState<AdminUserListItem | null>(null);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyAction, setVerifyAction] = useState<'verify' | 'unverify' | 'gold' | 'ungold'>('verify');

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
      if (verificationFilter !== 'all') {
        filtered = filtered.filter(u => verificationFilter === 'verified' ? u.verified : !u.verified);
      }
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
  }, [page, pageSize, search, verificationFilter, goldFilter]);

  const handleVerify = async (user: AdminUserListItem, verified: boolean) => {
    try {
      await adminApi.updateUserRole(user.public_id, user.admin_role);
      // Note: Verification and Gold status would need separate backend endpoints
      // For now, we just refresh the list
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update verification');
    }
  };

  const handleGold = async (user: AdminUserListItem, gold: boolean) => {
    try {
      await adminApi.updateUserRole(user.public_id, user.admin_role);
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update Gold status');
    }
  };

  if (loading && users.length === 0) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Verification & Gold Management</h1>
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
          <h1 className="text-2xl font-bold text-white">Verification & Gold Management</h1>
          <p className="mt-1 text-neutral-400">Manage verification badges and Gold membership</p>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Input
            placeholder="Search username, name, email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="sm:col-span-2"
          />
          <Select
            value={verificationFilter}
            onChange={(e) => { setVerificationFilter(e.target.value as 'all' | 'verified' | 'unverified'); setPage(1); }}
            options={[
              { value: 'all', label: 'All' },
              { value: 'verified', label: 'Verified Only' },
              { value: 'unverified', label: 'Unverified Only' },
            ]}
          />
          <Select
            value={goldFilter}
            onChange={(e) => { setGoldFilter(e.target.value as 'all' | 'gold' | 'none'); setPage(1); }}
            options={[
              { value: 'all', label: 'All' },
              { value: 'gold', label: 'Gold Only' },
              { value: 'none', label: 'Non-Gold Only' },
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
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Verified</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Gold</th>
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
                    <td className="px-4 py-3">
                      {getRoleBadge(user.admin_role)}
                    </td>
                    <td className="px-4 py-3">
                      {user.verified ? (
                        <Badge type="blue" size="xs">Verified</Badge>
                      ) : (
                        <Badge type="gray" size="xs">Not Verified</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {user.is_gold ? (
                        <Badge type="gold" size="xs">Gold</Badge>
                      ) : (
                        <Badge type="gray" size="xs">Standard</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-400 font-mono">
                      {typeof user.created_at === 'number' ? new Date(user.created_at).toLocaleDateString() : user.created_at}
                    </td>
                    <td className="px-4 py-3 text-right pr-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setSelectedUser(user); setVerifyAction(user.verified ? 'unverify' : 'verify'); setShowVerifyModal(true); }}
                          className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                          title={user.verified ? 'Remove Verification' : 'Verify User'}
                        >
                          {user.verified ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => { setSelectedUser(user); setVerifyAction(user.is_gold ? 'ungold' : 'gold'); setShowVerifyModal(true); }}
                          className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                          title={user.is_gold ? 'Remove Gold' : 'Grant Gold'}
                        >
                          <Award className="h-4 w-4" />
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