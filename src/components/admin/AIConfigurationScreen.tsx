// ZUNARI CONTROL CENTER — AI CONFIGURATION SCREEN
// Provider credentials, feature routing and privacy.
// UI-only implementation - no AI configuration or provider setup.
// Displays empty state as required by AI data restrictions.

import React, { useState } from 'react';
import {
  Cpu,
  Shield,
  Key,
  Database,
  AlertTriangle,
  CheckCircle,
  Save
} from 'lucide-react';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { Input } from '../common/Input.tsx';
import { Select } from '../common/Select.tsx';
import { Toggle } from '../common/Toggle.tsx';

export const AIConfigurationScreen: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Empty AI configuration state - genuinely empty as required
  const aiConfig = {
    providers: [],
    models: [],
    apiEndpoints: [],
    features: {
      chat: false,
      completion: false,
      embedding: false,
      image: false,
      audio: false,
      video: false
    },
    security: {
      encryption: false,
      auditLogging: false,
      dataPrivacy: false
    },
    limits: {
      maxTokens: 0,
      maxRequests: 0,
      dailyBudget: 0
    }
  };

  const handleFeatureToggle = (feature: string, value: boolean) => {
    setHasChanges(true);
    // No backend endpoint exists for AI configuration; toggles are disabled.
  };

  const handleSaveConfig = async () => {
    setError('AI configuration cannot be saved: no backend endpoint exists for AI configuration persistence.');
  };
  if (isLoading) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">AI Configuration</h1>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <Card key={i} className="p-6">
              <div className="h-6 w-48 bg-white/5 rounded animate-pulse mb-4" />
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Configuration</h1>
          <p className="mt-1 text-neutral-400">
            Provider credentials, feature routing and privacy.
            <span className="block mt-1 text-sm text-amber-400">
              Note: AI configuration is not enabled in this phase.
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge type="violet" size="sm">
            <Cpu className="h-4 w-4 mr-1" />
            UI Only - No AI Data
          </Badge>
          {hasChanges && (
            <Badge type="amber" size="sm">Unsaved Changes</Badge>
          )}
        </div>
      </div>

      {/* Empty State */}
      <Card className="p-12 text-center">
        <div className="max-w-md mx-auto">
          <div className="w-20 h-20 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto mb-6">
            <Cpu className="w-10 h-10 text-violet-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-3">AI Infrastructure Not Configured</h2>
          <p className="text-neutral-400 mb-6">
            This section manages AI provider credentials, model configuration, and security settings.
            Currently, AI configuration is not available as production AI infrastructure is not approved in this phase.
          </p>
          <div className="space-y-3 text-sm text-neutral-500">
            <div className="flex items-center justify-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-400" />
              <span>AI configuration genuinely empty</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-400" />
              <span>No AI provider setup</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-400" />
              <span>No credentials required</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-400" />
              <span>Feature flags disabled by default</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Configuration Sections (visible but empty) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Provider Section */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Database className="h-5 w-5 text-cyan-400" />
            Providers
          </h2>
          <div className="space-y-3 text-sm text-neutral-400">
            <p>AI provider configuration: No providers configured</p>
            <p>API endpoints: Not available</p>
            <p>Authentication: Not required</p>
          </div>
        </Card>

        {/* Features Section */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Cpu className="h-5 w-5 text-cyan-400" />
            Feature Flags
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 border border-white/5 rounded-lg">
              <span className="text-neutral-300">Chat</span>
              <Toggle value={false} onChange={() => {}} disabled />
            </div>
            <div className="flex items-center justify-between p-3 border border-white/5 rounded-lg">
              <span className="text-neutral-300">Completion</span>
              <Toggle value={false} onChange={() => {}} disabled />
            </div>
            <div className="flex items-center justify-between p-3 border border-white/5 rounded-lg">
              <span className="text-neutral-300">Embedding</span>
              <Toggle value={false} onChange={() => {}} disabled />
            </div>
          </div>
        </Card>

        {/* Security Section */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-cyan-400" />
            Security
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 border border-white/5 rounded-lg">
              <span className="text-neutral-300">Encryption</span>
              <Toggle value={false} onChange={() => {}} disabled />
            </div>
            <div className="flex items-center justify-between p-3 border border-white/5 rounded-lg">
              <span className="text-neutral-300">Audit Logging</span>
              <Toggle value={false} onChange={() => {}} disabled />
            </div>
            <div className="flex items-center justify-between p-3 border border-white/5 rounded-lg">
              <span className="text-neutral-300">Data Privacy</span>
              <Toggle value={false} onChange={() => {}} disabled />
            </div>
          </div>
        </Card>

        {/* Limits Section */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-cyan-400" />
            Usage Limits
          </h2>
          <div className="space-y-3 text-sm text-neutral-400">
            <p>Max tokens per request: 0 (unlimited)</p>
            <p>Max requests per minute: 0 (no limit)</p>
            <p>Daily budget: $0.00 (not configured)</p>
          </div>
        </Card>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={handleSaveConfig}
          disabled={!hasChanges}
        >
          <>
            <Save className="h-4 w-4 mr-2" />
            Save Configuration
          </>
        </Button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300 text-sm flex items-center gap-2 mt-4">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};