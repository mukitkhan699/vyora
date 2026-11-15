import React, { useEffect, useState } from 'react';
import {
  Activity,
  Database,
  Cloud,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader,
  Clock,
  RefreshCw,
  Info,
} from 'lucide-react';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { useAuth } from '../../context/AuthContext.tsx';

type HealthState = 'healthy' | 'degraded' | 'unavailable' | 'not_monitored' | 'checking';

interface HealthStatus {
  name: string;
  status: HealthState;
  description: string;
  icon: React.ReactNode;
}

export const SystemHealthScreen: React.FC = () => {
  const { adminRole } = useAuth();
  const [healthStatus, setHealthStatus] = useState<HealthStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getStatusColor = (status: HealthState): 'emerald' | 'amber' | 'red' | 'gray' => {
    switch (status) {
      case 'healthy': return 'emerald';
      case 'degraded': return 'amber';
      case 'unavailable': return 'red';
      case 'not_monitored':
      case 'checking':
      default: return 'gray';
    }
  };

  const getStatusIcon = (status: HealthState) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="h-5 w-5 text-emerald-400" />;
      case 'degraded': return <AlertTriangle className="h-5 w-5 text-amber-400" />;
      case 'unavailable': return <XCircle className="h-5 w-5 text-red-400" />;
      case 'not_monitored':
      case 'checking':
      default: return <Info className="h-5 w-5 text-neutral-400" />;
    }
  };

  const checkSystemHealth = async () => {
    try {
      setLoading(true);
      setError(null);

      const results: HealthStatus[] = [];

      // Real check: backend API liveness via the existing /health endpoint.
      try {
        const response = await fetch('/health', { cache: 'no-store' });
        if (response.ok) {
          results.push({
            name: 'Backend API',
            status: 'healthy',
            description: 'Backend API is reachable.',
            icon: <Activity className="h-5 w-5" />,
          });
        } else {
          results.push({
            name: 'Backend API',
            status: 'unavailable',
            description: `Backend API responded with status ${response.status}.`,
            icon: <XCircle className="h-5 w-5" />,
          });
        }
      } catch {
        results.push({
          name: 'Backend API',
          status: 'unavailable',
          description: 'Unable to reach the backend API.',
          icon: <XCircle className="h-5 w-5" />,
        });
      }

      // No dependency-specific health-check endpoint exists on the backend, so
      // these statuses are not currently monitored. They are intentionally not
      // marked healthy without a real check.
      const notMonitored: { name: string; description: string }[] = [
        {
          name: 'PostgreSQL Database',
          description: 'Database status is not currently monitored. No dependency health-check endpoint is available.',
        },
        {
          name: 'Object Storage',
          description: 'Object storage status is not currently monitored. No dependency health-check endpoint is available.',
        },
        {
          name: 'WebSocket Server',
          description: 'WebSocket status is not currently monitored. No dependency health-check endpoint is available.',
        },
        {
          name: 'Admin Sessions',
          description: 'Admin session status is not currently monitored. No dependency health-check endpoint is available.',
        },
      ];

      for (const dependency of notMonitored) {
        results.push({
          name: dependency.name,
          status: 'not_monitored',
          description: dependency.description,
          icon: <Info className="h-5 w-5" />,
        });
      }

      setHealthStatus(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkSystemHealth();
  }, []);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-300 via-sky-300 to-purple-300 bg-clip-text text-transparent">
            System Health
          </h1>
          <p className="mt-1 text-neutral-400">
            Dependency status monitoring. Only real health-check results are shown.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={checkSystemHealth}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Check Now
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300 text-sm flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={checkSystemHealth}>
            Retry
          </Button>
        </div>
      )}

      {/* Health Overview */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Health Overview</h3>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-lg animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-white/5" />
                  <div className="h-4 w-32 bg-white/5 rounded" />
                </div>
                <div className="flex items-center gap-4">
                  <div className="h-4 w-20 bg-white/5 rounded" />
                  <div className="h-4 w-16 bg-white/5 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {healthStatus.map((service) => (
              <div
                key={service.name}
                className="flex items-center justify-between p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <div className="flex items-center gap-4 flex-1">
                  {getStatusIcon(service.status)}
                  <div className="flex-1">
                    <h4 className="font-medium text-white">{service.name}</h4>
                    <p className="text-sm text-neutral-400">{service.description}</p>
                  </div>
                </div>
                <Badge type={getStatusColor(service.status)} size="sm">
                  {service.status.replace('_', ' ')}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default SystemHealthScreen;
