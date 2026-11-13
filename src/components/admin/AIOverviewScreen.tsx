// ZUNARI CONTROL CENTER — AI OVERVIEW SCREEN
// AI Overview dashboard showing AI traffic, cost, latency and budget health.
// UI-only implementation - no AI infrastructure or provider integration.
// Displays empty state as required by AI data restrictions.

import React, { useEffect, useState } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  Clock, 
  AlertCircle,
  Wallet,
  DollarSign,
  BarChart2
} from 'lucide-react';
import { Card } from '../common/Card.tsx';
import { Badge }}>{badge}`)
import { Button } from '../common/Button.tsx';
import { adminApi } from '../../services/adminApi.ts';

interface AIOverviewData {
  totalAIRequests: number;
  totalAICosts: number;
  averageLatency: number;
  budgetRemaining: number;
  budgetPercentage: number;
}

export const AIOverviewScreen: React.FC = () => {
  const [data, setData] = useState<AIOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // AI API is not configured per requirements - return empty state
    const mockData: AIOverviewData = {
      totalAIRequests: 0,
      totalAICosts: 0,
      averageLatency: 0,
      budgetRemaining: 0,
      budgetPercentage: 0,
    };
    setData(mockData);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">AI Overview</h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="h-4 w-24 bg-white/5 rounded animate-pulse" />
                  <div className="mt-1 h-8 w-32 bg-white/5 rounded animate-pulse" />
                </div>
                <div className="h-10 w-10 rounded-xl bg-white/5 animate-pulse" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Overview</h1>
          <p className="mt-1 text-neutral-400">
            Total AI traffic, cost, latency and budget health.
            <span className="block mt-1 text-sm text-amber-400">
              Note: AI infrastructure is not configured in this phase.
            </span>
          </p>
        </div>
        <Badge type="violet" size="sm">
          <Activity className="h-4 w-4 mr-1" />
          UI Only - No AI Data
        </Badge>
      </div>

      {/* Empty State Message */}
      <Card className="p-12 text-center">
        <div className="max-w-md mx-auto">
          <div className="w-20 h-20 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto mb-6">
            <BarChart2 className="w-10 h-10 text-violet-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-3">AI Infrastructure Not Configured</h2>
          <p className="text-neutral-400 mb-6">
            The AI Overview dashboard is currently empty because AI provider integration and production AI infrastructure are not approved in this phase.
          </p>
          <div className="space-y-3 text-sm text-neutral-500">
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>AI Overview: Not configured</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Providers & Models: Not connected</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Usage Explorer: No data available</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>User & Feature Usage: Not configured</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Costs & Budgets: Not connected</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Performance & Errors: Not available</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400" />
              <span>AI Configuration: Not set up</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Metrics Grid (Empty) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Total AI Requests
              </p>
              <p className="mt-1 text-3xl font-bold text-white">0</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Activity className="h-6 w-6 text-violet-400" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-neutral-500">vs last month</span>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Total AI Costs
              </p>
              <p className="mt-1 text-3xl font-bold text-white">$0.00</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <DollarSign className="h-6 w-6 text-violet-400" />
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
                Average Latency
              </p>
              <p className="mt-1 text-3xl font-bold text-white">0ms</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Clock className="h-6 w-6 text-violet-400" />
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
                Budget Remaining
              </p>
              <p className="mt-1 text-3xl font-bold text-white">$0.00</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Wallet className="h-6 w-6 text-violet-400" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-400" />
            <span className="text-sm text-amber-400">Not configured</span>
          </div>
        </Card>
      </div>
    </div>
  );
};