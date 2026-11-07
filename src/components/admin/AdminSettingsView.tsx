import React, { useEffect, useState } from 'react';
import {
  Shield,
  Users,
  Key,
  Bell,
  Palette,
  Database,
  Globe,
  Save,
  Loader,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { adminApi, AdminRole } from '../../services/adminApi.ts';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { Input } from '../common/Input.tsx';
import { Select } from '../common/Select.tsx';
import { Toggle } from '../common/Toggle.tsx';

interface RolePermission {
  role: AdminRole;
  permissions: Record<string, unknown>;
  description: string;
}

export const AdminSettingsView: React.FC = () => {
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedRoles, setExpandedRoles] = useState<string[]>([]);

  const fetchPermissions = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminApi.getRolePermissions();
      setRolePermissions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load permissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPermissions();
  }, []);

  const handlePermissionChange = (role: AdminRole, permissionPath: string, value: boolean) => {
    setRolePermissions((prev) => {
      return prev.map((rp) => {
        if (rp.role !== role) return rp;
        const newPermissions = { ...rp.permissions };
        // Navigate the nested object path (e.g., "users.read")
        const keys = permissionPath.split('.');
        let current: any = newPermissions;
        for (let i = 0; i < keys.length - 1; i++) {
          current = current[keys[i]] = { ...current[keys[i]] };
        }
        current[keys[keys.length - 1]] = value;
        return { ...rp, permissions: newPermissions };
      });
    });
  };

  const handleSavePermissions = async (role: AdminRole) => {
    const rp = rolePermissions.find(rp => rp.role === role);
    if (!rp) return;

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await adminApi.updateRolePermissions(role, rp.permissions, rp.description);
      setSuccess(`Permissions updated for ${role}`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const toggleExpanded = (role: AdminRole) => {
    setExpandedRoles(prev => prev.includes(role)
      ? prev.filter(r => r !== role)
      : [...prev, role]);
  };

  const formatPermissionKey = (key: string) => {
    return key
      .split('.')
      .map(k => k.charAt(0).toUpperCase() + k.slice(1))
      .join(' › ');
  };

  const getPermissionValue = (obj: any, path: string): boolean => {
    return path.split('.').reduce((o, k) => (o || {})[k], obj) === true;
  };

  if (loading) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Admin Settings</h1>
        </div>
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="p-4 animate-pulse">
              <div className="h-6 w-48 bg-white/5 rounded mb-4" />
              <div className="space-y-3">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="h-8 w-full bg-white/5 rounded animate-pulse" />
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Settings</h1>
          <p className="mt-1 text-neutral-400">Configure roles, permissions, and system settings</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-300 text-sm flex items-center gap-2">
          <CheckCircle className="h-5 w-5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Role Permissions */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Role Permissions</h2>
            <p className="mt-1 text-neutral-400">Manage permissions for each admin role</p>
          </div>
        </div>

        <div className="space-y-4">
          {rolePermissions.map((rp) => {
            const isExpanded = expandedRoles.includes(rp.role);
            return (
              <Card key={rp.role} className="p-4" variant="bordered">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center">
                      <Shield className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white capitalize">{rp.role.replace('_', ' ')}</h3>
                      <p className="text-sm text-neutral-400">{rp.description}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpanded(rp.role)}
                  >
                    {expandedRoles.includes(rp.role) ? 'Collapse' : 'Expand'}
                  </Button>
                </div>

                {isExpanded && (
                  <div className="space-y-3 mt-4 animate-in fade-in duration-200">
                    {Object.entries(rp.permissions).map(([category, perms]) => (
                      <div key={category} className="border-l-2 border-white/10 pl-4">
                        <h4 className="font-medium text-neutral-300 mb-2 capitalize">{category}</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {Object.entries(perms as Record<string, boolean>).map(([perm, value]) => (
                            <label key={perm} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={value}
                                onChange={(e) => handlePermissionChange(rp.role, `${category}.${perm}`, e.target.checked)}
                                className="w-4 h-4 rounded border-white/20 bg-black/40 text-cyan-500 focus:ring-2 focus:ring-cyan-500"
                              />
                              <span className="text-sm text-neutral-300">{formatPermissionKey(perm)}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div className="mt-4 flex justify-end">
                      <Button
                        variant="primary"
                        onClick={() => handleSavePermissions(rp.role)}
                        disabled={saving}
                      >
                        {saving ? (
                          <>
                            <Loader className="h-4 w-4 animate-spin mr-2" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 mr-2" />
                            Save Changes
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* System Settings */}
        <Card className="p-6 mt-6">
          <h2 className="text-xl font-bold text-white mb-6">System Configuration</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Database className="h-5 w-5 text-cyan-400" />
                Database
              </h3>
              <div className="space-y-3 text-sm text-neutral-400">
                <p>PostgreSQL (Neon)</p>
                <p>Connection pooling enabled</p>
                <p>Automatic backups: Daily</p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Globe className="h-5 w-5 text-cyan-400" />
                CORS & Origins
              </h3>
              <div className="space-y-3 text-sm text-neutral-400">
                <p>Public: https://zunari.duckdns.org</p>
                <p>Admin: https://admin-zunari.duckdns.org</p>
                <p>Socket.IO: Same origins</p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Palette className="h-5 w-5 text-cyan-400" />
                Theme & Appearance
              </h3>
              <div className="space-y-3 text-sm text-neutral-400">
                <p>Default: Dark</p>
                <p>Accent: Cyan</p>
                <p>User preference stored in localStorage</p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Bell className="h-5 w-5 text-cyan-400" />
                Notifications
              </h3>
              <div className="space-y-3 text-sm text-neutral-400">
                <p>Push notifications: Enabled</p>
                <p>Email notifications: Disabled</p>
                <p>Realtime updates: Enabled</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};