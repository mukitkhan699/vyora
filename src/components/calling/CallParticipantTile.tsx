import React, { useEffect, useRef } from 'react';
import { MicOff, VideoOff } from 'lucide-react';
import type { Track } from 'livekit-client';
import { Avatar } from '../common/Avatar.tsx';

interface VideoTrackViewProps {
  track: Track;
  muted?: boolean;
  mirrored?: boolean;
  className?: string;
}

export const VideoTrackView: React.FC<VideoTrackViewProps> = ({
  track,
  muted = false,
  mirrored = false,
  className = '',
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className={`w-full h-full object-cover ${mirrored ? '-scale-x-100' : ''} ${className}`}
    />
  );
};

interface AudioTrackViewProps {
  track: Track;
}

export const AudioTrackView: React.FC<AudioTrackViewProps> = ({ track }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    element.muted = false;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return <audio ref={audioRef} autoPlay className="hidden" />;
};

interface CallParticipantTileProps {
  name: string;
  avatarUrl?: string;
  track: Track | null;
  isLocal?: boolean;
  cameraOff?: boolean;
  micMuted?: boolean;
  speaking?: boolean;
  compact?: boolean;
  className?: string;
}

export const CallParticipantTile: React.FC<CallParticipantTileProps> = ({
  name,
  avatarUrl,
  track,
  isLocal = false,
  cameraOff = false,
  micMuted = false,
  speaking = false,
  compact = false,
  className = '',
}) => {
  const showVideo = Boolean(track) && !cameraOff;
  return (
    <div
      className={`relative overflow-hidden bg-black rounded-2xl border ${
        speaking ? 'border-[var(--z-accent-border)]' : 'border-[var(--z-border)]'
      } ${className}`}
      aria-live={speaking ? 'polite' : 'off'}
      aria-atomic={speaking}
    >
      {showVideo && track ? (
        <VideoTrackView track={track} muted={isLocal} mirrored={isLocal} />
      ) : (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2"
          style={{
            background:
              'radial-gradient(circle at 50% 35%, var(--z-accent-soft), var(--z-bg-deep) 72%)',
          }}
        >
          <Avatar
            src={avatarUrl}
            name={name}
            size={compact ? 'md' : 'xl'}
            className="!border-0"
          />
          {!compact && (
            <span className="text-xs font-semibold z-secondary max-w-[85%] truncate">{name}</span>
          )}
        </div>
      )}

      <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm max-w-full">
          <span className="truncate">{isLocal ? `${name} (you)` : name}</span>
        </span>
        {cameraOff && showVideo === false && (
          <span className="w-5 h-5 rounded-full bg-black/45 text-white flex items-center justify-center" aria-label="Camera off">
            <VideoOff className="w-3 h-3" aria-hidden="true" />
          </span>
        )}
        {micMuted && (
          <span className="w-5 h-5 rounded-full bg-black/45 text-white flex items-center justify-center" aria-label="Microphone muted">
            <MicOff className="w-3 h-3" aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );
};
