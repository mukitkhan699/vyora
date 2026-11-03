import React, { useState, useEffect } from 'react';
import { 
  Code2, 
  Copy, 
  Check, 
  FileCode, 
  Download, 
  Server, 
  Cpu, 
  Database, 
  Globe, 
  Terminal 
} from 'lucide-react';
import { BackendCodeFile } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Button } from '../common/Button.tsx';

export const BackendCodeView: React.FC = () => {
  const { appConfig } = useAuth();
  const { theme, accentTextClass, accentBgClass } = useTheme();

  const [files, setFiles] = useState<BackendCodeFile[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchBackendCode();
  }, []);

  const fetchBackendCode = async () => {
    try {
      setLoading(true);
      const res = await api.getBackendCode();
      setFiles(res.files);
    } catch (err) {
      console.warn('Failed to load backend code:', err);
    } finally {
      setLoading(false);
    }
  };

  const currentFile = files[selectedFileIndex] || null;

  const handleCopy = () => {
    if (currentFile) {
      navigator.clipboard.writeText(currentFile.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (currentFile) {
      const blob = new Blob([currentFile.code], { type: 'text/typescript' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentFile.name.replace('/', '_');
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const headerBg = theme === 'dark' ? 'bg-[#080b11]/90 border-white/[0.08]' : theme === 'dim' ? 'bg-[#0f172a]/90 border-neutral-700' : 'bg-white/90 border-neutral-200';
  const cardBg = theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-[#0d121c]/70 border-white/[0.08]';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-xl border-b ${headerBg} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2.5">
          <Terminal className={`w-5 h-5 ${accentTextClass}`} />
          <div>
            <h1 className="text-lg font-extrabold flex items-center gap-2">
              Node.js Backend Engine
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                Express + PostgreSQL
              </span>
            </h1>
            <p className="text-xs text-neutral-400">
              100% of platform configuration is managed in the backend API layer
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleDownload} title="Download file">
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Download</span>
          </Button>
          <Button size="sm" variant="primary" onClick={handleCopy}>
            {copied ? <Check className="w-3.5 h-3.5 text-black" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : 'Copy Code'}</span>
          </Button>
        </div>
      </div>

      {/* Backend Architecture Overview Banner */}
      <div className="p-4 border-b border-white/[0.08]">
        <div className={`p-4 rounded-2xl border ${cardBg} flex flex-col gap-3 text-xs`}>
          <div className="flex items-center justify-between">
            <span className="font-bold text-sm text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-400" />
              Centralized Backend Architecture
            </span>
            <span className="font-mono text-[11px] text-cyan-400">
              Node {appConfig?.nodeVersion || 'v22'}
            </span>
          </div>
          <p className="text-neutral-400 leading-relaxed text-[12px]">
            In VYORA, the client application does not store hardcoded configuration. The backend service at <code className="text-cyan-300 font-mono">/server/config.ts</code> controls brand identity, maximum payload sizes, multi-CDN URLs, PostgreSQL connections, feature gates, and security rules.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
            <div className="p-2 rounded-lg bg-black/40 border border-white/[0.06]">
              <span className="text-neutral-500 block text-[10px]">DATABASE</span>
              <span className="text-emerald-400 font-bold">{appConfig?.databaseStatus?.type || 'PostgreSQL'}</span>
            </div>
            <div className="p-2 rounded-lg bg-black/40 border border-white/[0.06]">
              <span className="text-neutral-500 block text-[10px]">ACTIVE CDNS</span>
              <span className="text-cyan-400 font-bold">{appConfig?.cdnUrls?.length || 3} Edge Relays</span>
            </div>
            <div className="p-2 rounded-lg bg-black/40 border border-white/[0.06]">
              <span className="text-neutral-500 block text-[10px]">PAYLOAD MAX</span>
              <span className="text-amber-400 font-bold">{appConfig?.maxPostLength || 280} Chars</span>
            </div>
            <div className="p-2 rounded-lg bg-black/40 border border-white/[0.06]">
              <span className="text-neutral-500 block text-[10px]">UPTIME</span>
              <span className="text-purple-400 font-bold">{appConfig?.serverUptime ? `${appConfig.serverUptime}s` : 'Active'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* File Selector Tabs */}
      <div className="flex border-b border-white/[0.08] px-2 overflow-x-auto bg-black/30 scrollbar-none">
        {files.map((file, idx) => {
          const isSelected = selectedFileIndex === idx;
          return (
            <button
              key={file.path}
              onClick={() => setSelectedFileIndex(idx)}
              className={`flex items-center gap-2 py-3 px-3.5 text-xs font-mono font-medium border-b-2 cursor-pointer transition-all whitespace-nowrap ${
                isSelected
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-500/10'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.02]'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>{file.name}</span>
            </button>
          );
        })}
      </div>

      {/* Code Viewer Panel */}
      <div className="flex-1 p-4 flex flex-col">
        {loading ? (
          <div className="m-auto p-12 text-center text-neutral-500">
            <svg className="animate-spin h-7 w-7 text-cyan-400 mx-auto mb-2" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Retrieving backend source files...</span>
          </div>
        ) : currentFile ? (
          <div className="flex flex-col flex-1 rounded-2xl overflow-hidden border border-white/[0.08] bg-[#05070a]">
            {/* File info bar */}
            <div className="px-4 py-2.5 bg-black/60 border-b border-white/[0.06] flex items-center justify-between text-xs font-mono">
              <span className="text-neutral-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span className="text-white font-bold">{currentFile.path}</span>
                <span className="text-neutral-500 hidden sm:inline">— {currentFile.description}</span>
              </span>
              <span className="text-neutral-500">{currentFile.code.split('\n').length} lines</span>
            </div>

            {/* Code contents with line numbers */}
            <div className="flex-1 overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-neutral-200 select-text">
              <pre className="table w-full">
                {currentFile.code.split('\n').map((line, idx) => (
                  <div key={idx} className="table-row hover:bg-cyan-500/[0.04]">
                    <span className="table-cell pr-4 text-right text-neutral-600 select-none text-[11px] w-8">
                      {idx + 1}
                    </span>
                    <span className="table-cell whitespace-pre">{line}</span>
                  </div>
                ))}
              </pre>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
