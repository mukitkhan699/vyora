import React, { useEffect, useState } from 'react';
import { VyoraIcon } from './VyoraIcon.tsx';

interface LauncherSplashProps {
  isLoading: boolean;
  appName?: string;
}

export const LauncherSplash: React.FC<LauncherSplashProps> = ({
  isLoading,
  appName = 'VYORA',
}) => {
  const [visible, setVisible] = useState(true);
  const [progress, setProgress] = useState(15);
  const [statusText, setStatusText] = useState('Initiating quantum relay...');

  useEffect(() => {
    const timer1 = setTimeout(() => {
      setProgress(45);
      setStatusText('Connecting to Node.js backend cluster...');
    }, 200);

    const timer2 = setTimeout(() => {
      setProgress(85);
      setStatusText('Verifying operator session & multi-CDN pool...');
    }, 500);

    const timer3 = setTimeout(() => {
      setProgress(100);
      setStatusText('Relay ready. Entering VYORA Network.');
    }, 800);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  useEffect(() => {
    if (!isLoading) {
      setProgress(100);
      const exitTimer = setTimeout(() => {
        setVisible(false);
      }, 400);
      return () => clearTimeout(exitTimer);
    } else {
      setVisible(true);
    }
  }, [isLoading]);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#070a0f] transition-all duration-500 select-none ${
        !isLoading ? 'opacity-0 pointer-events-none scale-105' : 'opacity-100 scale-100'
      }`}
    >
      {/* Ambient background glow & grid accent */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,58,237,0.22),rgba(255,255,255,0))]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.12)_0%,transparent_60%)]" />

      {/* Futuristic Launcher Core */}
      <div className="relative flex flex-col items-center z-10 px-6 max-w-sm w-full text-center">
        {/* Pulsing Concentric Radar Rings */}
        <div className="relative flex items-center justify-center mb-8">
          <div className="absolute w-36 h-36 rounded-full border border-cyan-500/20 animate-ping opacity-30" />
          <div className="absolute w-28 h-28 rounded-full border border-purple-500/30 animate-pulse" />
          <div className="absolute w-20 h-20 rounded-full bg-gradient-to-tr from-purple-600/30 via-cyan-400/20 to-pink-500/20 blur-xl animate-pulse" />
          
          {/* Main App Launcher Icon */}
          <div className="relative transform hover:scale-105 transition-transform duration-300 drop-shadow-[0_0_25px_rgba(0,242,254,0.5)]">
            <VyoraIcon size="xl" glow={true} className="!w-20 !h-20" />
          </div>
        </div>

        {/* Brand Name & Tagline */}
        <div className="space-y-1 mb-8">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-purple-400 via-sky-300 to-cyan-300 bg-clip-text text-transparent drop-shadow-sm">
            {appName}
          </h1>
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80 font-mono font-semibold">
            Global Transmission Protocol
          </p>
        </div>

        {/* Minimal Progress Bar */}
        <div className="w-full bg-neutral-900/90 rounded-full h-1.5 p-0.5 border border-white/[0.08] overflow-hidden mb-3">
          <div
            className="h-full bg-gradient-to-r from-purple-500 via-sky-400 to-cyan-400 rounded-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(0,242,254,0.7)]"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Status Telemetry */}
        <div className="flex items-center justify-between w-full text-[11px] font-mono text-neutral-400 px-1">
          <span className="flex items-center gap-1.5 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            {statusText}
          </span>
          <span className="text-cyan-400 font-bold ml-2">{progress}%</span>
        </div>
      </div>

      {/* Footer Branding Note */}
      <div className="absolute bottom-6 text-[10px] font-mono tracking-widest text-neutral-600 uppercase">
        Node.js Backend Relay · PostgreSQL Ready
      </div>
    </div>
  );
};
