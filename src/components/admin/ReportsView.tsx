import React, { useEffect, useState } from 'react';
import {
  Search,
  Flag,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader,
  MoreVertical,
} from 'lucide-react';
import { adminApi, AdminAuditLogEntry } from '../../services/adminApi.ts';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { Input } from '../common/Input.tsx';
import { Select } from '../common/Select.tsx';
import { formatRelativeTime } from '../../utils/format.ts';

type ReportType = 'user' | 'post';
type ReportStatus = 'pending' | 'reviewed' | 'dismissed' | 'action_taken';

interface ReportItem {
  id: string;
  type: ReportType;
  reporter_id: string;
  reporter_username: string;
  reported_user_id?: string;
  reported_username?: string;
  post_id?: string;
  post_preview?: string;
  reason: string;
  details?: string;
  status: ReportStatus;
  reviewed_by?: string;
  reviewed_at?: number;
  created_at: number;
}

const mockReports: ReportItem[] = [
  {
    id: 'report_1',
    type: 'user',
    reporter_id: 'user_auth_123',
    reporter_username: 'alice',
    reported_user_id: 'user_auth_456',
    reported_username: 'bob_spammer',
    reason: 'spam',
    details: 'Posting repetitive promotional content in multiple threads',
    status: 'pending',
    created_at: Date.now() - 3600000,
  },
  {
    id: 'report_2',
    type: 'post',
    reporter_id: 'user_auth_789',
    reporter_username: 'charlie',
    post_id: 'post_123',
    post_preview: 'This is a hateful message targeting...',
    reason: 'hate',
    details: 'Contains hate speech targeting a protected group',
    status: 'reviewed',
    reviewed_by: 'admin_john',
    reviewed_at: Date.now() - 7200000,
    created_at: Date.now() - 10800000,
  },
  {
    id: 'report_3',
    type: 'user',
    reporter_id: 'user_auth_999',
    reporter_username: 'diana',
    reported_user_id: 'user_auth_111',
    reported_username: 'fake_account',
    reason: 'fake',
    details: 'Impersonating a verified public figure',
    status: 'action_taken',
    reviewed_by: 'admin_jane',
    reviewed_at: Date.now() - 1800000,
    created_at: Date.now() - 3600000,
  },
];

const getStatusBadge = (status: ReportStatus) => {
  switch (status) {
    case 'pending': return <Badge type="amber" size="xs">Pending</Badge>;
    case 'reviewed': return <Badge type="blue" size="xs">Reviewed</Badge>;
    case 'dismissed': return <Badge type="gray" size="xs">Dismissed</Badge>;
    case 'action_taken': return <Badge type="emerald" size="xs">Action Taken</Badge>;
  }
};

const getReasonBadge = (reason: string) => {
  const colors: Record<string, 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink'> = {
    spam: 'orange',
    harassment: 'red',
    hate: 'red',
    violence: 'red',
    illegal: 'red',
    misinfo: 'yellow',
    fake: 'purple',
    other: 'gray' as any,
  };
  // Using available badge types
  const badgeColors: Record<string, 'blue' | 'gold' | 'cyan' | 'gray' | 'violet' | 'amber' | 'emerald' | 'rose'> = {
    spam: 'amber',
    harassment: 'rose',
    hate: 'rose',
    violence: 'rose',
    illegal: 'violet',
    misinfo: 'amber',
    fake: 'violet',
    other: 'gray' as any,
  };
  return <Badge type={badgeColors[reason] || 'gray'} size="xs">{reason}</Badge>;
};

export const ReportsView: React.FC = () => {
  const [reports, setReports] = useState<ReportItem[]>(mockReports);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'user' | 'post'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ReportStatus>('all');
  const [selectedReport, setSelectedReport] = useState<ReportItem | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionStatus, setActionStatus] = useState<ReportStatus>('pending');
  const [actionNote, setActionNote] = useState('');

  const fetchReports = async () => {
    setLoading(true);
    // In production, this would call adminApi.getReports()
    // For now, use mock data
    setReports(mockReports);
    setLoading(false);
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const handleAction = async (report: ReportItem, status: ReportStatus) => {
    setSelectedReport(report);
    setActionStatus(status);
    setActionNote('');
    setShowActionModal(true);
  };

  const confirmAction = async () => {
    if (!selectedReport) return;
    try {
      // In production: await adminApi.resolveReport(selectedReport.id, actionStatus, actionNote);
      setReports(reports.map(r => r.id === selectedReport.id ? { ...r, status: actionStatus, reviewed_by: 'current_admin', reviewed_at: Date.now() } : r));
      setShowActionModal(false);
      setSelectedReport(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update report');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Reports & Moderation</h1>
        </div>
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-white/5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 flex items-center gap-4 animate-pulse">
                <div className="h-8 w-8 rounded-lg bg-white/5" />
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

  const getStatusBadge = (status: ReportStatus) => {
    switch (status) {
      case 'pending': return <Badge type="amber" size="xs">Pending</Badge>;
      case 'reviewed': return <Badge type="blue" size="xs">Reviewed</Badge>;
      case 'dismissed': return <Badge type="gray" size="xs">Dismissed</Badge>;
      case 'action_taken': return <Badge type="emerald" size="xs">Action Taken</Badge>;
    }
  };

  const getReasonBadge = (reason: string) => {
    const badgeColors: Record<string, 'blue' | 'gold' | 'cyan' | 'gray' | 'violet' | 'amber' | 'emerald' | 'rose'> = {
      spam: 'amber',
      harassment: 'rose',
      hate: 'rose',
      violence: 'rose',
      illegal: 'violet',
      misinfo: 'amber',
      fake: 'violet',
      other: 'gray' as any,
    };
    return <Badge type={badgeColors[reason] || 'gray'} size="xs">{reason}</Badge>;
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Reports & Moderation</h1>
          <p className="mt-1 text-neutral-400">Review and moderate user reports</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Total Reports</p>
              <p className="mt-1 text-3xl font-bold text-white">{mockReports.length}</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
              <Flag className="h-6 w-6 text-cyan-400" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Pending Review</p>
              <p className="mt-1 text-3xl font-bold text-white">{mockReports.filter(r => r.status === 'pending').length}</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Flag className="h-6 w-6 text-amber-400" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Action Taken</p>
              <p className="mt-1 text-3xl font-bold text-white">{mockReports.filter(r => r.status === 'action_taken').length}</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Flag className="h-6 w-6 text-emerald-400" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Dismissed</p>
              <p className="mt-1 text-3xl font-bold text-white">{mockReports.filter(r => r.status === 'dismissed').length}</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-gray-500/10 flex items-center justify-center">
              <Flag className="h-6 w-6 text-gray-400" />
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Input
            placeholder="Search reports..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:col-span-2"
          />
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | 'user' | 'post')}
            options={[
              { value: 'all', label: 'All Types' },
              { value: 'user', label: 'User Reports' },
              { value: 'post', label: 'Post Reports' },
            ]}
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | ReportStatus)}
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'pending', label: 'Pending' },
              { value: 'reviewed', label: 'Reviewed' },
              { value: 'dismissed', label: 'Dismissed' },
              { value: 'action_taken', label: 'Action Taken' },
            ]}
          />
        </div>
      </Card>

      {/* Reports Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Reporter</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Target</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-400 uppercase tracking-wider pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {mockReports.map((report) => (
                <tr key={report.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <Badge type={report.type === 'user' ? 'blue' : 'violet'} size="xs">
                      {report.type === 'user' ? 'User Report' : 'Post Report'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center">
                        <span className="font-bold text-white text-xs">{report.reporter_username?.charAt(0).toUpperCase() || 'U'}</span>
                      </div>
                      <span className="font-medium text-white truncate">@{report.reporter_username}</span>
                    </div>
                  </td>
                    <td className="px-4 py-3">
                      {report.type === 'user' ? (
                        <span className="font-medium text-white truncate max-w-xs">@{report.reported_username}</span>
                      ) : (
                        <span className="font-medium text-white truncate max-w-xs">Post: {report.post_preview?.slice(0, 40)}...</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {getReasonBadge(report.reason)}
                    </td>
                    <td className="px-4 py-3">{getStatusBadge(report.status)}</td>
                    <td className="px-4 py-3 text-sm text-neutral-400 font-mono">
                      {formatRelativeTime(report.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right pr-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleAction(report, 'reviewed')}
                          className="p-2 rounded-lg text-neutral-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                          title="Mark Reviewed"
                        >
                          <CheckCircle className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleAction(report, 'dismissed')}
                          className="p-2 rounded-lg text-neutral-400 hover:text-gray-400 hover:bg-gray-500/10 transition-colors"
                          title="Dismiss"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleAction(report, 'action_taken')}
                          className="p-2 rounded-lg text-neutral-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                          title="Take Action"
                        >
                          <AlertTriangle className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
