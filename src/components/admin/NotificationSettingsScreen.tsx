// Phase 3E: Notification Settings — honest view of existing notification infrastructure.

import React, { useEffect, useState } from 'react';
import {
  Bell,
  AlertTriangle,
  Info,
  Shield,
  Database,
  Clock,
} from 'lucide-react';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';

export const NotificationSettingsScreen: React.FC = () => {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // No backend endpoint exists for admin notification settings, so there is
    // nothing to load. The screen remains in a steady honest state.
    setLoading(false);
  }, []);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-300 via-sky-300 to-purple-300 bg-clip-text text-transparent">
            Notification Settings
          </h1>
          <p className="mt-1 text-neutral-400">
            Review notification infrastructure and supported settings.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4 p-6 animate-pulse">
          <div className="h-8 w-48 bg-white/5 rounded" />
          <div className="h-4 w-32 bg-white/5 rounded" />
          <div className="h-4 w-20 bg-white/5 rounded" />
        </div>
      ) : (
        <>
          {/* Existing notification infrastructure */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Bell className="h-5 w-5 text-cyan-400" />
                  Notification Infrastructure
                </h2>
                <p className="mt-1 text-neutral-400">
                  Notification records that genuinely exist in the database.
                </p>
              </div>
              <Badge type="gray" size="xs">
                Read-only
              </Badge>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg">
                <div>
                  <h3 className="font-medium text-white">zunari_notifications table</h3>
                  <p className="text-sm text-neutral-400">
                    Stores user activity notifications (like, repost, reply, follow, mention).
                  </p>
                </div>
                <Badge type="emerald" size="xs">
                  Exists
                </Badge>
              </div>

              <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg">
                <div>
                  <h3 className="font-medium text-white">User notification read/unread</h3>
                  <p className="text-sm text-neutral-400">
                    is_read flag per notification, mark-all-read endpoint available.
                  </p>
                </div>
                <Badge type="emerald" size="xs">
                  Supported
                </Badge>
              </div>

              <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg">
                <div>
                  <h3 className="font-medium text-white">Realtime notification delivery</h3>
                  <p className="text-sm text-neutral-400">
                    Socket.IO notification:new event for connected users.
                  </p>
                </div>
                <Badge type="emerald" size="xs">
                  Supported
                </Badge>
              </div>
            </div>
          </Card>

          {/* Admin notification settings — not configured */}
          <Card className="p-6 border-l-4 border-l-rose-500/30">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-rose-400" />
                  Admin Notification Settings
                </h2>
                <p className="mt-1 text-neutral-400">
                  Preferences that an administrator can change and persist.
                </p>
              </div>
              <Badge type="rose" size="xs">
                Not configured
              </Badge>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-rose-500/5 rounded-lg border border-rose-500/10">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-medium text-white">No persistence mechanism exists</h3>
                    <p className="text-sm text-neutral-400 mt-1">
                      There is no database table, configuration store, or API endpoint
                      for admin notification preferences. The following settings cannot
                      be changed or saved:
                    </p>
                    <ul className="list-disc list-inside text-sm text-neutral-400 mt-2 space-y-1">
                      <li>Push notification enablement</li>
                      <li>Email notification enablement</li>
                      <li>Realtime notification toggles</li>
                      <li>Notification delivery providers</li>
                      <li>Notification scheduling or throttling</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <SettingRow
                  label="Push notifications"
                  status="not_configured"
                  description="No settings table or API endpoint to persist this preference."
                />
                <SettingRow
                  label="Email notifications"
                  status="not_configured"
                  description="No email delivery provider or settings infrastructure configured."
                />
                <SettingRow
                  label="Realtime updates"
                  status="not_configured"
                  description="Realtime delivery exists for user notifications, but no admin toggle persists."
                />
              </div>
            </div>
          </Card>

          {/* What would be required */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Database className="h-5 w-5 text-neutral-400" />
                  Requirements for Implementation
                </h2>
                <p className="mt-1 text-neutral-400">
                  What would need to exist before admin notification settings can be offered.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="p-3 bg-white/5 rounded-lg">
                <p className="text-sm text-neutral-400">
                  A new database table (e.g. <code className="text-cyan-400">zunari_notification_settings</code>)
                  would be required to store admin notification preferences. This would need
                  a database migration, which is outside the scope of this phase.
                </p>
              </div>
              <div className="p-3 bg-white/5 rounded-lg">
                <p className="text-sm text-neutral-400">
                  A new admin API endpoint (e.g. <code className="text-cyan-400">GET/PATCH /api/admin/notification-settings</code>)
                  would be required to read and write settings, with server-side permission
                  enforcement.
                </p>
              </div>
              <div className="p-3 bg-white/5 rounded-lg">
                <p className="text-sm text-neutral-400">
                  No new notification delivery system, queue, worker, scheduler, or provider
                  integration should be created — only persistence of existing preferences.
                </p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

interface SettingRowProps {
  label: string;
  status: 'not_configured' | 'unsupported' | 'unavailable';
  description: string;
}

const SettingRow: React.FC<SettingRowProps> = ({ label, status, description }) => {
  const statusConfig: Record<string, { color: 'rose' | 'gray'; label: string }> = {
    not_configured: { color: 'rose', label: 'Not configured' },
    unsupported: { color: 'gray', label: 'Not supported' },
    unavailable: { color: 'gray', label: 'Unavailable' },
  };

  const config = statusConfig[status];

  return (
    <div className="p-4 bg-white/5 rounded-lg border border-white/10">
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-medium text-white">{label}</h4>
        <Badge type={config.color} size="xs">{config.label}</Badge>
      </div>
      <p className="text-xs text-neutral-500">{description}</p>
    </div>
  );
};

export default NotificationSettingsScreen;
