import React, { useState, useEffect } from 'react';
import { 
  Globe, 
  Database, 
  Palette, 
  Sliders, 
  Check, 
  RefreshCw, 
  Server, 
  HardDrive,
  FileCode,
  ShieldCheck,
  Zap,
  Radio
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme, ThemeMode, AccentColor } from '../../context/ThemeContext.tsx';
import { Button } from '../common/Button.tsx';
import { CDNInfo } from '../../types/index.ts';
import { api } from '../../services/api.ts';

interface SettingsViewProps {
  onOpenBackend?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onOpenBackend }) => {
  const { appConfig, refreshConfig } = useAuth();
  const { theme, setTheme, accent, setAccent } = useTheme();

  const [activeSection, setActiveSection] = useState<'backend-config' | 'cdn' | 'database' | 'appearance'>('backend-config');
  const [cdns, setCdns] = useState<CDNInfo[]>([]);
  const [isTestingCdn, setIsTestingCdn] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadCdnHealth();
  }, []);

  const loadCdnHealth = async () => {
    try {
      const res = await api.getCdnHealth();
      setCdns(res.cdns || []);
    } catch {
      // Fallback to active appConfig CDNs
      if (appConfig?.cdnUrls) {
        setCdns(appConfig.cdnUrls.map(url => ({
          url,
          name: new URL(url).hostname,
          status: 'active',
        })));
      }
    }
  };

  const handleTestCdns = async () => {
    setIsTestingCdn(true);
    await loadCdnHealth();
    setIsTestingCdn(false);
  };

  const handleReloadConfig = async () => {
    setIsRefreshing(true);
    await refreshConfig();
    await loadCdnHealth();
    setIsRefreshing(false);
  };

  const accentsList: { id: AccentColor; label: string; bg: string }[] = [
    { id: 'cyan', label: 'Electric Cyan', bg: 'bg-[#00f2fe]' },
    { id: 'violet', label: 'Neon Violet', bg: 'bg-[#8b5cf6]' },
    { id: 'emerald', label: 'Quantum Emerald', bg: 'bg-[#00ff88]' },
    { id: 'amber', label: 'Pulse Amber', bg: 'bg-[#ffb300]' },
    { id: 'coral', label: 'Solar Coral', bg: 'bg-[#ff3366]' },
    { id: 'blue', label: 'Deep Vyora-Blue', bg: 'bg-[#1d9bf0]' },
  ];

  const themesList: { id: ThemeMode; label: string; sub: string; bg: string; text: string; border: string }[] = [
    { id: 'dark', label: 'Lights out', sub: 'Obsidian Space (#080b11)', bg: 'bg-[#080b11]', text: 'text-white', border: 'border-white/10' },
    { id: 'dim', label: 'Dim', sub: 'Dark Navy (#0f172a)', bg: 'bg-[#0f172a]', text: 'text-[#f1f5f9]', border: 'border-neutral-700' },
    { id: 'light', label: 'Default', sub: 'Crisp Slate (#f8fafc)', bg: 'bg-[#f8fafc]', text: 'text-black', border: 'border-neutral-200' },
  ];

  const headerBg = theme === 'dark' ? 'bg-[#080b11]/90 border-white/[0.08]' : theme === 'dim' ? 'bg-[#0f172a]/90 border-neutral-700' : 'bg-white/90 border-neutral-200';
  const cardBg = theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-[#0d121c]/70 border-white/[0.08]';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-xl border-b ${headerBg} px-4 py-3 flex items-center justify-between`}>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">VYORA Architecture & State</h1>
          <p className="text-xs text-neutral-400">All configurations, file URLs, and data are managed solely by the backend</p>
        </div>
        <Button size="sm" variant="outline" onClick={handleReloadConfig} isLoading={isRefreshing}>
          <RefreshCw className="w-3.5 h-3.5" /> Sync Backend
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.08] px-2 overflow-x-auto bg-black/20">
        {[
          { id: 'backend-config', label: 'Backend Config', icon: Sliders },
          { id: 'cdn', label: 'Multi-CDN Relay', icon: Globe },
          { id: 'database', label: 'PostgreSQL DB', icon: Database },
          { id: 'appearance', label: 'Appearance', icon: Palette },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id as any)}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-mono font-medium border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                isActive ? `border-cyan-400 text-cyan-300 font-bold bg-cyan-500/10` : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="p-4 sm:p-6 max-w-2xl flex flex-col gap-6">
        {/* Banner indicating Frontend is decoupled and config-free */}
        <div className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-800/40 flex items-start gap-3">
          <Zap className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed text-cyan-200">
            <span className="font-bold text-white">Centralized Backend Architecture: </span>
            The frontend does not store or manage configurations. The Node.js backend handles all environment variables, limits, multi-CDNs, file uploads, and PostgreSQL database queries, transmitting URLs and state dynamically.
          </div>
        </div>

        {/* Section 1: Centralized Backend Configuration (Read-only single source of truth) */}
        {activeSection === 'backend-config' && (
          <div className="flex flex-col gap-5">
            <div className={`p-4 rounded-2xl border ${cardBg}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Server className="w-5 h-5 text-cyan-400" />
                  <h2 className="text-base font-bold">Node.js API Configuration</h2>
                </div>
                {onOpenBackend && (
                  <Button size="sm" variant="outline" onClick={onOpenBackend}>
                    <FileCode className="w-3.5 h-3.5" /> Inspect Backend Code
                  </Button>
                )}
              </div>

              <p className="text-xs text-neutral-400 leading-relaxed mb-4">
                These values are served dynamically from the backend at <code className="text-cyan-400 font-mono">/api/config</code>:
              </p>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Application Name:</span>
                  <span className="font-bold text-white font-mono">{appConfig?.appName || 'VYORA'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Tagline:</span>
                  <span className="font-mono text-cyan-300">{appConfig?.appTagline || 'Decoupled Global Social Intelligence Network'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Max Post Transmission:</span>
                  <span className="font-mono text-white">{appConfig?.maxPostLength || 280} characters</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">File Upload Endpoint:</span>
                  <span className="font-mono text-emerald-400">{appConfig?.fileEndpoints?.upload || '/api/upload'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">File Delivery Base URL:</span>
                  <span className="font-mono text-emerald-400">{appConfig?.fileEndpoints?.filesBase || '/api/files'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Media Catalog API:</span>
                  <span className="font-mono text-emerald-400">{appConfig?.fileEndpoints?.mediaCatalog || '/api/media/catalog'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Interactive Polls:</span>
                  <span className="font-mono text-white">{appConfig?.enablePolls ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Direct Messaging:</span>
                  <span className="font-mono text-white">{appConfig?.enableDirectMessages ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Server Node Runtime:</span>
                  <span className="font-mono text-cyan-300">{appConfig?.nodeVersion || 'v22.x'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Server Uptime:</span>
                  <span className="font-mono text-neutral-300">{appConfig?.serverUptime ? `${appConfig.serverUptime}s` : 'Active'}</span>
                </div>
              </div>
            </div>

            {/* How to modify parameters in backend */}
            <div className={`p-4 rounded-2xl border ${cardBg}`}>
              <h3 className="font-bold text-sm mb-2 text-white">How backend parameters are configured</h3>
              <p className="text-xs text-neutral-400 mb-3">
                Parameters are defined in <code className="text-cyan-400 font-mono">.env</code> on the backend server. To update configuration, modify your server environment variables:
              </p>
              <pre className="bg-black/80 p-3 rounded-xl text-xs font-mono text-emerald-400 overflow-x-auto">
{`# Server Environment Configuration (.env)
APP_NAME="VYORA"
APP_TAGLINE="Decoupled Global Social Intelligence Network"
MAX_POST_LENGTH=280
CDN_URLS="https://images.unsplash.com,https://picsum.photos,https://avatars.githubusercontent.com"
DATABASE_TYPE="auto" # "postgres" | "auto" | "memory"`}
              </pre>
            </div>
          </div>
        )}

        {/* Section 2: Multi-CDN Edge Distribution (Served by backend) */}
        {activeSection === 'cdn' && (
          <div className="flex flex-col gap-5">
            <div className={`p-4 rounded-2xl border ${cardBg}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Globe className="w-5 h-5 text-cyan-400" />
                  <h2 className="text-base font-bold">Multi-CDN Edge Cluster</h2>
                </div>
                <Button size="sm" variant="outline" onClick={handleTestCdns} isLoading={isTestingCdn}>
                  <RefreshCw className="w-3.5 h-3.5" /> Ping CDNs
                </Button>
              </div>

              <p className="text-xs text-neutral-400 leading-relaxed mb-4">
                The backend delivers all file and asset URLs using the active multi-CDN relay defined in the server environment. The client connects and fails over automatically if any edge network experiences high latency.
              </p>

              {/* Active CDN list from Backend */}
              <div className="flex flex-col gap-2">
                {cdns.map((cdn, idx) => (
                  <div
                    key={cdn.url}
                    className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-neutral-800"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded-full bg-cyan-950 text-cyan-400 text-xs font-mono flex items-center justify-center font-bold border border-cyan-800/40">
                        {idx + 1}
                      </span>
                      <div className="truncate">
                        <div className="text-xs font-bold font-mono text-neutral-200 truncate">{cdn.url}</div>
                        <div className="text-[11px] text-neutral-500">{cdn.name}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-mono text-neutral-300">
                        {cdn.latencyMs !== undefined ? `${cdn.latencyMs}ms` : 'Ready'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Backend File Serving Information */}
            <div className={`p-4 rounded-2xl border ${cardBg}`}>
              <div className="flex items-center gap-2 mb-2">
                <HardDrive className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm text-white">Backend File & Media Storage</h3>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed mb-2">
                Uploaded images, avatars, and transmissions are delivered directly via the backend file handler at <code className="text-emerald-400 font-mono">/api/files/:fileId</code> with immutable HTTP caching.
              </p>
              <div className="text-xs font-mono text-neutral-500">
                Supports: JPEG, PNG, WebP, GIF, SVG (up to 10MB per transmission)
              </div>
            </div>
          </div>
        )}

        {/* Section 3: PostgreSQL Database */}
        {activeSection === 'database' && (
          <div className="flex flex-col gap-5">
            <div className={`p-4 rounded-2xl border ${cardBg}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-cyan-400" />
                  <h2 className="text-base font-bold">PostgreSQL Architecture</h2>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                  appConfig?.databaseStatus?.connected
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                }`}>
                  {appConfig?.databaseStatus?.type || 'PostgreSQL'}
                </span>
              </div>

              <div className="space-y-2 text-xs mb-4">
                <div className="flex justify-between py-1.5 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Database Driver:</span>
                  <span className="font-mono text-neutral-200">pg (node-postgres connection pool)</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Configured Mode:</span>
                  <span className="font-mono text-neutral-200">{appConfig?.databaseType || 'auto'}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Connection State:</span>
                  <span className="font-mono text-neutral-200">{appConfig?.databaseStatus?.details}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/[0.06]">
                  <span className="text-neutral-400">Active Tables:</span>
                  <span className="font-mono text-neutral-200">users, posts, likes, reposts, bookmarks, follows, notifications, messages</span>
                </div>
              </div>

              <div className="bg-black/80 p-3 rounded-xl border border-neutral-800">
                <div className="text-xs font-bold text-neutral-300 mb-1">PostgreSQL .env variables:</div>
                <pre className="text-[11px] font-mono text-neutral-400 overflow-x-auto">
{`# Connect via direct URL:
DATABASE_URL="postgresql://user:password@localhost:5432/vyora_social"

# Or configure host, port, credentials:
SQL_HOST="localhost"
SQL_PORT=5432
SQL_USER="postgres"
SQL_PASSWORD="your_password"
SQL_DB_NAME="vyora_social"`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Section 4: Appearance & Themes */}
        {activeSection === 'appearance' && (
          <div className="flex flex-col gap-6">
            <div className={`p-4 rounded-2xl border ${cardBg}`}>
              <h2 className="text-base font-bold mb-1">Color Accent</h2>
              <p className="text-xs text-neutral-400 mb-4">Choose your custom transmission highlight color.</p>
              <div className="flex flex-wrap gap-4">
                {accentsList.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setAccent(item.id)}
                    className={`w-12 h-12 rounded-full ${item.bg} flex items-center justify-center text-white cursor-pointer transition-transform hover:scale-105 ${
                      accent === item.id ? 'ring-4 ring-white/30 scale-105' : ''
                    }`}
                    title={item.label}
                  >
                    {accent === item.id && <Check className="w-6 h-6 stroke-[3px]" />}
                  </button>
                ))}
              </div>
            </div>

            <div className={`p-4 rounded-2xl border ${cardBg}`}>
              <h2 className="text-base font-bold mb-1">Background Theme</h2>
              <p className="text-xs text-neutral-400 mb-4">Choose how you want VYORA to look on your screen.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {themesList.map(t => (
                  <div
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${t.bg} ${t.text} ${
                      theme === t.id ? `ring-2 ring-cyan-400 ${t.border}` : t.border
                    }`}
                  >
                    <div>
                      <div className="font-bold text-sm">{t.label}</div>
                      <div className="text-xs opacity-70">{t.sub}</div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${theme === t.id ? 'border-cyan-400 bg-cyan-400' : 'border-neutral-500'}`}>
                      {theme === t.id && <Check className="w-3.5 h-3.5 text-black stroke-[3px]" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
