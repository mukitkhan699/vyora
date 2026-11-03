import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { VyoraIcon } from './VyoraIcon.tsx';

interface LauncherSplashProps {
  isLoading: boolean;
  appName?: string;
}

const BOOT_STEPS = [
  { at: 0, progress: 18, label: 'Preparing secure workspace' },
  { at: 260, progress: 48, label: 'Connecting to relay services' },
  { at: 620, progress: 76, label: 'Restoring operator session' },
  { at: 980, progress: 100, label: 'Ready to transmit' },
];

export const LauncherSplash: React.FC<LauncherSplashProps> = ({
  isLoading,
  appName = 'VYORA',
}) => {
  const [visible, setVisible] = useState(true);
  const [progress, setProgress] = useState(BOOT_STEPS[0].progress);
  const [statusText, setStatusText] = useState(BOOT_STEPS[0].label);

  useEffect(() => {
    const timers = BOOT_STEPS.slice(1).map((step) =>
      setTimeout(() => {
        setProgress(step.progress);
        setStatusText(step.label);
      }, step.at),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      setProgress(100);
      setStatusText('Ready to transmit');
      const exitTimer = setTimeout(() => setVisible(false), 420);
      return () => clearTimeout(exitTimer);
    }
    setVisible(true);
  }, [isLoading]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#060910] select-none transition-all duration-500 ${
        !isLoading ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(0,242,254,0.1),transparent_32%),radial-gradient(circle_at_50%_62%,rgba(121,40,202,0.12),transparent_40%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:56px_56px]" />

      <div className="relative z-10 flex w-full max-w-xs flex-col items-center px-6 text-center">
        <div className="relative mb-7 flex h-24 w-24 items-center justify-center">
          <div className="absolute inset-0 rounded-[28px] border border-white/[0.08] bg-white/[0.025] backdrop-blur-sm" />
          <div className="absolute inset-1 rounded-[24px] border border-cyan-400/10" />
          <div className="absolute -inset-3 rounded-[34px] border border-cyan-400/10 animate-[spin_9s_linear_infinite]" />
          <div className="absolute -inset-3 rounded-[34px] border-t border-cyan-300/50 animate-[spin_2.4s_linear_infinite]" />
          <VyoraIcon size="xl" glow className="!h-12 !w-12" />
        </div>

        <h1 className="bg-gradient-to-r from-purple-300 via-sky-300 to-cyan-300 bg-clip-text text-3xl font-black tracking-tight text-transparent">
          {appName}
        </h1>
        <p className="mt-1.5 text-[10px] font-mono uppercase tracking-[0.3em] text-cyan-300/70">
          Global transmission network
        </p>

        <div className="mt-8 w-full">
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-400 via-sky-400 to-cyan-300 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-[10px] font-mono">
            <span className="flex min-w-0 items-center gap-1.5 text-neutral-500">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />
              <span className="truncate">{statusText}</span>
            </span>
            <span className="shrink-0 tabular-nums text-neutral-400">{progress}%</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-7 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-neutral-600">
        <ShieldCheck className="h-3 w-3 text-neutral-500" />
        Secure session · Local-first runtime
      </div>
    </div>
  );
};
