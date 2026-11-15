// ZUNARI CONTROL CENTER — AI PERFORMANCE & ERRORS SCREEN
// Success rate, latency, failures and anomalies.
// UI-only implementation - no AI infrastructure or performance monitoring.

import React from 'react';
import { Activity, AlertCircle } from 'lucide-react';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';

export const AIPerformanceScreen: React.FC = () => {
  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Performance & Errors</h1>
          <p className="mt-1 text-neutral-400">
            Success rate, latency, failures and anomalies.
            <span className="block mt-1 text-sm text-amber-400">
              Note: AI performance monitoring is not configured in this phase.
            </span>
          </p>
        </div>
        <Badge type="violet" size="sm">
          <Activity className="h-4 w-4 mr-1" />
          Not Available
        </Badge>
      </div>

      {/* Empty State */}
      <Card className="p-12 text-center">
        <div className="max-w-md mx-auto">
          <div className="w-20 h-20 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto mb-6">
            <Activity className="w-10 h-10 text-violet-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-3">No Performance Data</h2>
          <p className="text-neutral-400 mb-6">
            Performance monitoring, success rates, and error tracking are not
            available because AI infrastructure is not approved in this phase.
          </p>
          <div className="space-y-3 text-sm text-neutral-500">
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Success rate tracking: Not available</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Latency monitoring: Not configured</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Error tracking: Not connected</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Anomaly detection: Not active</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Performance Metrics Grid (Zero) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Success Rate
              </p>
              <p className="mt-1 text-3xl font-bold text-white">0%</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Activity className="h-6 w-6 text-violet-400" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-neutral-500">of requests</span>
          </div>
        </Card>
        <Card className="p-5">
          <div class="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Average Latency
              </p>
              <p className="mt-1 text-3xl font-bold text-white">0ms</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-violet-400" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-neutral-500">response time</span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Error Rate
              </p>
              <p className="mt-1 text-3xl font-bold text-white">0%</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-violet-400" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-neutral-500">failed requests</span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Anomalies
              </p>
              <p className="mt-1 text-3xl font-bold text-white">0</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-violet-400" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-neutral-500">detected</span>
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
            <span>Create AI performance monitoring infrastructure (requires backend work)</span>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs">
              2
            </div>
            <span>Build API endpoints for latency and error queries</span>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-xs">
              3
            </div>
            <span>Implement anomaly detection and alerting</span>
          </div>
        </div>
      </Card>
    </div>
  );
};
