import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCw,
  Video as VideoIcon,
  VideoOff,
  Volume2,
} from 'lucide-react';

interface CallControlsProps {
  type: 'voice' | 'video';
  micOn: boolean;
  cameraOn: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onSwitchCamera?: () => void;
  canSwitchCamera?: boolean;
  onEnd: () => void;
  audioOutputs: MediaDeviceInfo[];
  selectedAudioOutputId: string;
  onSelectAudioOutput?: (deviceId: string) => void;
  speakerSupported: boolean;
  disabled?: boolean;
}

export const CallControls: React.FC<CallControlsProps> = ({
  type,
  micOn,
  cameraOn,
  onToggleMic,
  onToggleCamera,
  onSwitchCamera,
  canSwitchCamera = false,
  onEnd,
  audioOutputs,
  selectedAudioOutputId,
  onSelectAudioOutput,
  speakerSupported,
  disabled = false,
}) => {
  const [showOutputs, setShowOutputs] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const outputButtonsRef = useRef<HTMLButtonElement[]>([]);

  useEffect(() => {
    if (!showOutputs) return;
    const handleOutside = (event: MouseEvent) => {
      if (outputRef.current && !outputRef.current.contains(event.target as Node)) {
        setShowOutputs(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowOutputs(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showOutputs]);

  useEffect(() => {
    if (showOutputs) {
      const firstButton = outputButtonsRef.current[0];
      firstButton?.focus();
    }
  }, [showOutputs]);

  const handleOutputKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const buttons = outputButtonsRef.current;
    if (buttons.length === 0) return;

    let nextIndex = index;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        nextIndex = index < buttons.length - 1 ? index + 1 : 0;
        break;
      case 'ArrowUp':
        event.preventDefault();
        nextIndex = index > 0 ? index - 1 : buttons.length - 1;
        break;
      case 'Home':
        event.preventDefault();
        nextIndex = 0;
        break;
      case 'End':
        event.preventDefault();
        nextIndex = buttons.length - 1;
        break;
      case 'Escape':
        event.preventDefault();
        setShowOutputs(false);
        const volumeButton = outputRef.current?.querySelector('button[aria-label*="audio output"]') as HTMLButtonElement;
        volumeButton?.focus();
        return;
      default:
        return;
    }

    buttons[nextIndex]?.focus();
  };

  return (
    <div className="flex items-center justify-center gap-3 sm:gap-4" role="group" aria-label="Call controls">
      <ControlButton
        label={micOn ? 'Mute microphone' : 'Unmute microphone'}
        onClick={onToggleMic}
        disabled={disabled}
        active={!micOn}
        tone={micOn ? 'neutral' : 'danger'}
        icon={micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
      />

      {type === 'video' && (
        <>
          <ControlButton
            label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
            onClick={onToggleCamera}
            disabled={disabled}
            tone={cameraOn ? 'neutral' : 'danger'}
            icon={cameraOn ? <VideoIcon className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          />
          {canSwitchCamera && onSwitchCamera && (
            <ControlButton
              label="Switch camera"
              onClick={onSwitchCamera}
              disabled={disabled}
              tone="neutral"
              icon={<RefreshCw className="w-5 h-5" />}
            />
          )}
        </>
      )}

      <div className="relative" ref={outputRef}>
        <ControlButton
          label={speakerSupported ? 'Choose audio output' : 'Audio output selection is not supported by this browser'}
          onClick={() => speakerSupported && setShowOutputs((value) => !value)}
          disabled={!speakerSupported || disabled}
          tone="neutral"
          icon={<Volume2 className="w-5 h-5" />}
        />
        {showOutputs && speakerSupported && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 z-surface border z-border rounded-2xl p-1.5 z-shadow z-pop-enter" role="menu" aria-label="Audio output">
            <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide z-muted">
              Audio output
            </p>
            <button
              ref={(el) => { if (el) outputButtonsRef.current[0] = el; }}
              type="button"
              role="menuitem"
              onClick={() => {
                onSelectAudioOutput?.('');
                setShowOutputs(false);
              }}
              onKeyDown={(event) => handleOutputKeyDown(event, 0)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-xs z-secondary hover:z-surface-2 hover:z-text z-focus"
            >
              <span className="flex-1 truncate">System default</span>
              {!selectedAudioOutputId && <Check className="w-3.5 h-3.5 z-accent" aria-hidden="true" />}
            </button>
            {audioOutputs.map((device, index) => (
              <button
                key={device.deviceId || index}
                ref={(el) => { if (el) outputButtonsRef.current[index + 1] = el; }}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelectAudioOutput?.(device.deviceId);
                  setShowOutputs(false);
                }}
                onKeyDown={(event) => handleOutputKeyDown(event, index + 1)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-xs z-secondary hover:z-surface-2 hover:z-text z-focus"
              >
                <span className="flex-1 truncate">{device.label || `Audio output ${index + 1}`}</span>
                {selectedAudioOutputId === device.deviceId && <Check className="w-3.5 h-3.5 z-accent" aria-hidden="true" />}
              </button>
            ))}
            {audioOutputs.length === 0 && (
              <p className="px-2.5 py-2 text-[11px] z-muted">No separate output devices found.</p>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onEnd}
        disabled={disabled}
        aria-label="End call"
        className="w-14 h-14 rounded-full flex items-center justify-center transition-transform active:scale-95 z-focus disabled:opacity-60 z-shadow-soft z-btn-primary"
      >
        <PhoneOff className="w-5 h-5" />
      </button>
    </div>
  );
};

type ControlTone = 'neutral' | 'danger';

const ControlButton: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  tone: ControlTone;
  className?: string;
}> = ({ label, icon, onClick, disabled, active, tone, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-pressed={active}
    className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all active:scale-95 z-focus disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    style={
      tone === 'danger'
        ? {
            backgroundColor: 'var(--z-danger-soft)',
            color: 'var(--z-danger)',
            border: '1px solid color-mix(in srgb, var(--z-danger) 38%, transparent)',
          }
        : {
            backgroundColor: 'rgba(255,255,255,0.09)',
            color: '#F5F1E9',
            border: '1px solid rgba(255,255,255,0.12)',
          }
    }
  >
    {icon}
  </button>
);
