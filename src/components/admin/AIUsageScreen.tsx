// ZUNARI CONTROL CENTER — AI USAGE EXPLORER SCREEN
// Request-level ledger with advanced filters.
// UI-only implementation - no AI infrastructure or usage tracking.

import React from 'react';
import { TableProperties, AlertCircle } from 'lucide-react';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';

export const AIUsageScreen: React.FC = () => {
  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Usage Explorer</h1>
          <p className="mt-1 text-neutral-400">
            Request-level ledger with advanced filters.
            <span className="block mt-1 text-sm text-amber-400">
              Note: AI usage tracking is not configured in this phase.
            </span>
          </p>
        </div>
        <Badge type="violet" size="sm">
          <TableProperties className="h-4 w-4 mr-1" />
          No Data Available
        </Badge>
      </div>

      {/* Empty State */}
      <Card className="p-12 text-center">
        <div className="max-w-md mx-auto">
          <div className="w-20 h-20 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto mb-6">
            <TableProperties className="w-10 h-10 text-violet-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-3">No AI Usage Data</h2>
          <p className="text-neutral-400 mb-6">
            The Usage Explorer is currently empty because AI infrastructure is
            not approved in this phase. No request-level ledger exists.
          </p>
          <div className="space-y-3 text-sm text-neutral-500">
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Request ledger: Not available</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Advanced filters: Not connected</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Request history: Empty</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Usage Table (Empty) */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <TableProperties className="h-5 w-5 text-neutral-400" />
            AI Requests
          </h3>
          <Badge type="gray" size="xs">0 requests</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Timestamp</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Provider</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Model</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Tokens</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Latency</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-neutral-500">No AI requests recorded</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Requirements */}
      <Card className="p-6 border-l-4 border-l-rose-500/30">
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-rose-400" />
          Implementation Requirements
        </h3>
        <div className="space-y-3 text-sm text-neutral-400">
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs">
              1
            </div>
            <span>Create AI usage logging infrastructure (requires backend work)</span>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs">
              2
            </div>
            <span>Build API endpoints for usage ledger queries</span>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs">
              3
            </div>
            <span>Implement advanced filtering and pagination</span>
          </div>
        </div>
      </Card>
    </div>
  );
};
