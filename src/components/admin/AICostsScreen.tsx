// ZUNARI CONTROL CENTER — AI COSTS & BUDGETS SCREEN
// Expenditure, budgets, quotas and projections.
// UI-only implementation - no AI infrastructure or cost tracking.

import React from 'react';
import { Wallet, AlertCircle } from 'lucide-react';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';

export const AICostsScreen: React.FC = () => {
  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Costs & Budgets</h1>
          <p className="mt-1 text-neutral-400">
            Expenditure, budgets, quotas and projections.
            <span className="block mt-1 text-sm text-amber-400">
              Note: AI cost tracking is not configured in this phase.
            </span>
          </p>
        </div>
        <Badge type="violet" size="sm">
          <Wallet className="h-4 w-4 mr-1" />
          Not Connected
        </Badge>
      </div>

      {/* Empty State */}
      <Card className="p-12 text-center">
        <div className="max-w-md mx-auto">
          <div className="w-20 h-20 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto mb-6">
            <Wallet className="w-10 h-10 text-violet-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-3">No AI Cost Data</h2>
          <p className="text-neutral-400 mb-6">
            Cost tracking, budgets and projections are not available because
            AI infrastructure is not approved in this phase.
          </p>
          <div className="space-y-3 text-sm text-neutral-500">
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Expenditure tracking: Not available</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Budget configuration: Not set up</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Quota management: Not configured</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Cost projections: Not available</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Cost Metrics Grid (Zero) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Total AI Spend
              </p>
              <p className="mt-1 text-3xl font-bold text-white">$0.00</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Wallet className="h-6 w-6 text-violet-400" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-neutral-500">per month</span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Active Budgets
              </p>
              <p className="mt-1 text-3xl font-bold text-white">0</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-violet-400" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-neutral-500">configured</span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Quota Used
              </p>
              <p className="mt-1 text-3xl font-bold text-white">0%</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-violet-400" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-neutral-500">of limit</span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Projected Spend
              </p>
              <p className="mt-1 text-3xl font-bold text-white">$0.00</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Wallet className="h-6 w-6 text-violet-400" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-neutral-500">next 30 days</span>
          </div>
        </Card>
      </div>

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
            <span>Create AI cost tracking and billing infrastructure (requires backend work)</span>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs">
              2
            </div>
            <span>Build API endpoints for cost and budget queries</span>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs">
              3
            </div>
            <span>Implement budget configuration and alerting</span>
          </div>
        </div>
      </Card>
    </div>
  );
};
