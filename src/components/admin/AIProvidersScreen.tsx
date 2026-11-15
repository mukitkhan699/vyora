// ZUNARI CONTROL CENTER — AI PROVIDERS & MODELS SCREEN
// Provider directory and model catalogue.
// UI-only implementation - no AI infrastructure or provider integration.

import React from 'react';
import { Plug, Database, AlertCircle } from 'lucide-react';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';

export const AIProvidersScreen: React.FC = () => {
  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Providers & Models</h1>
          <p className="mt-1 text-neutral-400">
            Provider directory, model catalogue and pricing.
            <span className="block mt-1 text-sm text-amber-400">
              Note: AI provider infrastructure is not configured in this phase.
            </span>
          </p>
        </div>
        <Badge type="violet" size="sm">
          <Plug className="h-4 w-4 mr-1" />
          Not Connected
        </Badge>
      </div>

      {/* Empty State */}
      <Card className="p-12 text-center">
        <div className="max-w-md mx-auto">
          <div className="w-20 h-20 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto mb-6">
            <Plug className="w-10 h-10 text-violet-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-3">No AI Providers Configured</h2>
          <p className="text-neutral-400 mb-6">
            There are no AI providers registered in the system. AI provider
            integration and production AI infrastructure are not approved in
            this phase.
          </p>
          <div className="space-y-3 text-sm text-neutral-500">
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Provider directory: Not configured</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Model catalogue: Empty</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>API endpoints: Not available</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Pricing: Not configured</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Provider Table (Empty) */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <Database className="h-5 w-5 text-neutral-400" />
            Registered Providers
          </h3>
          <Badge type="gray" size="xs">0 providers</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Provider</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Models</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Endpoint</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-400 uppercase tracking-wider pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-neutral-500">No AI providers configured</td>
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
            <span>Create a provider settings table in the database (requires migration)</span>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs">
              2
            </div>
            <span>Build admin API endpoints for provider CRUD operations</span>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs">
              3
            </div>
            <span>Implement model catalogue with pricing information</span>
          </div>
        </div>
      </Card>
    </div>
  );
};
