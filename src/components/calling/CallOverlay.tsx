import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionQuality,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type TrackPublication,
} from 'livekit-client';
import { Loader2, PhoneOff, ShieldAlert, Volume2, X } from 'lucide-react';
import type { ActiveCallInfo } from './types.ts';
import { Avatar } from '../common/Avatar.tsx';
import { CallControls } from './CallControls.tsx';
import { CallParticipantTile, AudioTrackView } from './CallParticipantTile.tsx';
import { formatDuration } from '../../utils/messaging.ts';

interface CallOverlayProps {
  call: ActiveCallInfo;
  currentUser: { id: string; name?: string; username: string; avatarUrl?: string };
  onEnd: () => Promise<void>;
  onError: (message: string) => void;
}

interface RemoteTile {
  identity: string;
  name: string;
  videoTrack: Track | null;
  audioTrack: Track | null;
  cameraOff: boolean;
  micMuted: boolean;
}

type Phase = 'connecting' | 'ringing' | 'active' | 'reconnecting' | 'ended' | 'failed';

interface TerminalState {
  title: string;
  message: string;
}

const hideDelayMs = 4500;
const noAnswerTimeoutMs = 60000;

const qualityLabel: Record<ConnectionQuality, string> = {
  [ConnectionQuality.Excellent]: 'Excellent connection',
  [ConnectionQuality.Good]: 'Good connection',
  [ConnectionQuality.Poor]: 'Poor connection',
  [ConnectionQuality.Lost]: 'Connection lost',
  [ConnectionQuality.Unknown]: '',
};

const describeMediaError = (error: unknown, device: 'microphone' | 'camera') => {
  const name = error instanceof Error ? error.name : '';
  const label = device === 'microphone' ? 'Microphone' : 'Camera';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return `${label} permission was denied. Allow access in your browser settings, then try again.`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return `No ${device} was found on this device.`;
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `${label} is unavailable because another application is using it.`;
  }
  if (name === 'OverconstrainedError') {
    return `The selected ${device} is no longer available.`;
  }
  return error instanceof Error && error.message
    ? error.message
    : `The ${device} could not be started.`;
};

export const CallOverlay: React.FC<CallOverlayProps> = ({
  call,
  currentUser,
  onEnd,
  onError,
}) => {
  const roomRef = useRef<Room | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const durationStartRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>('connecting');
  const [terminal, setTerminal] = useState<TerminalState | null>(null);
  const [remoteTiles, setRemoteTiles] = useState<RemoteTile[]>([]);
  const [localVideoTrack, setLocalVideoTrack] = useState<Track | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [quality, setQuality] = useState<ConnectionQuality>(ConnectionQuality.Unknown);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState('');
  const [mediaErrors, setMediaErrors] = useState<{ mic?: string; camera?: string }>({});
  const [ending, setEnding] = useState(false);
  const supportsOutputSelection =
    typeof window !== 'undefined' &&
    typeof HTMLMediaElement !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype;

  const hasRemote = remoteTiles.length > 0;

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const root = rootRef.current;
    if (!root) return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioOutputs(devices.filter((device) => device.kind === 'audiooutput'));
      setVideoInputs(devices.filter((device) => device.kind === 'videoinput'));
    } catch {
      setAudioOutputs([]);
      setVideoInputs([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const syncParticipants = () => {
      if (cancelled) return;
      const tiles: RemoteTile[] = [];
      room.remoteParticipants.forEach((participant: RemoteParticipant) => {
        const videoPublication = participant.getTrackPublication(Track.Source.Camera);
        const audioPublication = participant.getTrackPublication(Track.Source.Microphone);
        tiles.push({
          identity: participant.identity,
          name: participant.name || participant.identity,
          videoTrack: videoPublication?.track ?? null,
          audioTrack: audioPublication?.track ?? null,
          cameraOff: !videoPublication || videoPublication.isMuted,
          micMuted: !audioPublication || audioPublication.isMuted,
        });
      });
      setRemoteTiles(tiles);
    };

    const syncLocalVideo = () => {
      if (cancelled) return;
      const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
      setLocalVideoTrack(publication?.track ?? null);
    };

    const handleMuteChange = (publication: TrackPublication, participant: Participant) => {
      if (cancelled) return;
      if (participant === room.localParticipant) {
        if (publication.source === Track.Source.Microphone) {
          setMicOn(!publication.isMuted);
        }
        if (publication.source === Track.Source.Camera) {
          setCameraOn(!publication.isMuted);
          syncLocalVideo();
        }
      }
      syncParticipants();
    };

    room
      .on(RoomEvent.ParticipantConnected, syncParticipants)
      .on(RoomEvent.ParticipantDisconnected, syncParticipants)
      .on(RoomEvent.TrackSubscribed, syncParticipants)
      .on(RoomEvent.TrackUnsubscribed, syncParticipants)
      .on(RoomEvent.TrackMuted, handleMuteChange)
      .on(RoomEvent.TrackUnmuted, handleMuteChange)
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        if (!cancelled) {
          setSpeakingIds(new Set(speakers.map((speaker) => speaker.identity)));
        }
      })
      .on(RoomEvent.LocalTrackPublished, syncLocalVideo)
      .on(RoomEvent.LocalTrackUnpublished, syncLocalVideo)
      .on(RoomEvent.ConnectionQualityChanged, (nextQuality: ConnectionQuality) => {
        if (!cancelled) setQuality(nextQuality);
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!cancelled) setAudioPlaybackBlocked(!room.canPlaybackAudio);
      })
      .on(RoomEvent.Reconnecting, () => {
        if (!cancelled) setPhase('reconnecting');
      })
      .on(RoomEvent.Reconnected, () => {
        if (cancelled) return;
        syncParticipants();
        setPhase(room.remoteParticipants.size > 0 ? 'active' : 'ringing');
      })
      .on(RoomEvent.Disconnected, () => {
        if (cancelled) return;
        setSpeakingIds(new Set());
        setTerminal({
          title: 'Call disconnected',
          message: 'The call connection was lost. You can close this screen and try again.',
        });
        setPhase('ended');
      });

    const connect = async () => {
      try {
        await room.connect(call.livekitUrl, call.token);
        if (cancelled) {
          room.disconnect();
          return;
        }
        syncParticipants();

        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          if (!cancelled) {
            setMicOn(true);
            setMediaErrors((current) => ({ ...current, mic: undefined }));
          }
        } catch (error) {
          if (!cancelled) {
            setMicOn(false);
            setMediaErrors((current) => ({
              ...current,
              mic: describeMediaError(error, 'microphone'),
            }));
          }
        }

        if (call.type === 'video') {
          try {
            await room.localParticipant.setCameraEnabled(true);
            if (!cancelled) {
              setCameraOn(true);
              setMediaErrors((current) => ({ ...current, camera: undefined }));
              syncLocalVideo();
            }
          } catch (error) {
            if (!cancelled) {
              setCameraOn(false);
              setMediaErrors((current) => ({
                ...current,
                camera: describeMediaError(error, 'camera'),
              }));
            }
          }
        }

        void refreshDevices();
        syncParticipants();
        try {
          await room.startAudio();
          if (!cancelled) setAudioPlaybackBlocked(false);
        } catch {
          if (!cancelled) setAudioPlaybackBlocked(true);
        }
        if (!cancelled) {
          setPhase(room.remoteParticipants.size > 0 ? 'active' : 'ringing');
        }
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : 'The call could not be connected.';
        setTerminal({
          title: 'Unable to connect',
          message: /token|permission|unauthorized/i.test(message)
            ? 'The call connection was rejected. The invitation may have expired — close this screen and try again.'
            : message,
        });
        setPhase('failed');
      }
    };

    void connect();

    return () => {
      cancelled = true;
      room.disconnect();
      roomRef.current = null;
    };
  }, [call.callId, call.livekitUrl, call.token, call.type, refreshDevices]);

  useEffect(() => {
    if (!hasRemote) return;
    setPhase((current) =>
      current === 'ringing' || current === 'connecting' || current === 'failed'
        ? 'active'
        : current
    );
  }, [hasRemote]);

  useEffect(() => {
    if (phase !== 'ringing' || hasRemote) return;
    const timer = window.setTimeout(() => {
      setTerminal({
        title: 'No answer',
        message:
          call.type === 'video'
            ? 'No one joined the video call. You can close this screen and try again.'
            : 'No one answered the call. You can close this screen and try again.',
      });
      setPhase('failed');
    }, noAnswerTimeoutMs);
    return () => window.clearTimeout(timer);
  }, [phase, hasRemote, call.type]);

  useEffect(() => {
    if (!hasRemote) {
      durationStartRef.current = null;
      setDuration(0);
      return;
    }
    if (durationStartRef.current === null) durationStartRef.current = Date.now();
    const update = () => {
      if (durationStartRef.current !== null) {
        setDuration(Math.floor((Date.now() - durationStartRef.current) / 1000));
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [hasRemote]);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const revealControls = useCallback(() => {
    if (call.type !== 'video') return;
    setControlsVisible(true);
    clearHideTimer();
    if (phase !== 'active' && phase !== 'ringing' && phase !== 'reconnecting') return;
    hideTimerRef.current = window.setTimeout(() => {
      const focused = document.activeElement;
      const focusInside =
        focused instanceof HTMLElement && controlsRef.current?.contains(focused);
      if (!focusInside) setControlsVisible(false);
    }, hideDelayMs);
  }, [call.type, phase, clearHideTimer]);

  useEffect(() => {
    if (call.type !== 'video') {
      setControlsVisible(true);
      return;
    }
    revealControls();
    return clearHideTimer;
  }, [call.type, revealControls, clearHideTimer]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const handleToggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      setMediaErrors((current) => ({ ...current, mic: undefined }));
      void refreshDevices();
    } catch (error) {
      setMicOn(!next);
      setMediaErrors((current) => ({
        ...current,
        mic: describeMediaError(error, 'microphone'),
      }));
    }
  };

  const handleToggleCamera = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !cameraOn;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCameraOn(next);
      setMediaErrors((current) => ({ ...current, camera: undefined }));
      void refreshDevices();
      const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
      setLocalVideoTrack(publication?.track ?? null);
    } catch (error) {
      setCameraOn(!next);
      setMediaErrors((current) => ({
        ...current,
        camera: describeMediaError(error, 'camera'),
      }));
    }
  };

  const handleSwitchCamera = async () => {
    const room = roomRef.current;
    if (!room || videoInputs.length < 2) return;
    const currentDeviceId = localVideoTrack?.mediaStreamTrack.getSettings().deviceId;
    const currentIndex = videoInputs.findIndex((device) => device.deviceId === currentDeviceId);
    const nextDevice = videoInputs[(currentIndex + 1) % videoInputs.length];
    try {
      await room.switchActiveDevice('videoinput', nextDevice.deviceId);
      window.setTimeout(() => {
        const publication = roomRef.current?.localParticipant.getTrackPublication(
          Track.Source.Camera
        );
        setLocalVideoTrack(publication?.track ?? null);
      }, 150);
      void refreshDevices();
    } catch (error) {
      onError(
        error instanceof Error && error.message
          ? error.message
          : 'The camera could not be switched.'
      );
    }
  };

  const handleSelectAudioOutput = async (deviceId: string) => {
    const room = roomRef.current;
    if (!room || !supportsOutputSelection) return;
    try {
      await room.switchActiveDevice('audiooutput', deviceId || 'default');
      setSelectedAudioOutputId(deviceId);
    } catch {
      onError('The audio output could not be switched in this browser.');
    }
  };

  const handleEnableAudio = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
      setAudioPlaybackBlocked(false);
    } catch {
      onError('The browser blocked call audio. Tap the screen and try again.');
    }
  };

  const handleEnd = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await onEnd();
    } finally {
      setEnding(false);
    }
  };

  const connectionStatus = (() => {
    if (phase === 'failed') return terminal?.title || 'Call failed';
    if (phase === 'ended') return terminal?.title || 'Call ended';
    if (phase === 'reconnecting') return 'Reconnecting…';
    if (phase === 'connecting') return 'Connecting…';
    if (!hasRemote) return call.direction === 'outgoing' ? 'Calling…' : 'Waiting for others…';
    return formatDuration(duration);
  })();

  const subtitle = (() => {
    if (phase === 'failed' || phase === 'ended') return '';
    if (!hasRemote) {
      return call.type === 'video'
        ? 'Camera and microphone are requested as the call connects.'
        : 'The call is ringing.';
    }
    if (phase === 'reconnecting') return 'Trying to restore the call connection.';
    const qualityText = qualityLabel[quality];
    const base = call.type === 'video' ? 'Video call' : 'Voice call';
    return qualityText ? `${base} · ${qualityText}` : base;
  })();

  const showTerminal = phase === 'failed' || phase === 'ended';
  const showLocalPip = call.type === 'video';
  const canSwitchCamera = call.type === 'video' && videoInputs.length > 1;
  const singleRemote = remoteTiles.length === 1 ? remoteTiles[0] : null;
  const mediaBanner = mediaErrors.camera || mediaErrors.mic;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[85] flex flex-col z-safe-top z-safe-bottom outline-none"
      onPointerMove={revealControls}
      style={{
        backgroundColor: call.type === 'video' ? '#050505' : 'var(--z-bg-deep)',
        backgroundImage:
          call.type === 'video'
            ? undefined
            : 'radial-gradient(ellipse at 50% 0%, var(--z-accent-soft), transparent 55%)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label={call.type === 'video' ? 'Video call' : 'Voice call'}
    >
      <header className="shrink-0 px-4 sm:px-6 pt-3 pb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar
            src={call.avatarUrl}
            name={call.title}
            size="sm"
            className="!border-0 shrink-0"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold z-text truncate">{call.title}</p>
            <p className="text-[11px] z-muted truncate">
              {call.isGroup ? `Group call · ${remoteTiles.length + 1} participants` : 'Direct call'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-semibold z-secondary tabular-nums" role="status">
            {connectionStatus}
          </span>
          {quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost ? (
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: 'var(--z-warning)' }}
              title={qualityLabel[quality]}
            />
          ) : null}
        </div>
      </header>

      {audioPlaybackBlocked && !showTerminal && (
        <div className="shrink-0 mx-auto mb-1 w-[min(92%,30rem)] z-surface border z-border rounded-2xl px-3 py-2 flex items-center gap-2.5 z-shadow-soft z-pop-enter">
          <Volume2 className="w-4 h-4 shrink-0" style={{ color: 'var(--z-warning)' }} />
          <p className="text-[11px] z-secondary flex-1">Call audio is paused by your browser.</p>
          <button
            type="button"
            onClick={() => void handleEnableAudio()}
            className="h-8 px-3 rounded-lg text-[11px] font-semibold z-btn-primary z-focus"
          >
            Enable audio
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 relative px-2 sm:px-4 pb-2">
        {showTerminal ? (
          <div className="h-full flex items-center justify-center px-6">
            <div className="max-w-sm w-full z-surface border z-border rounded-3xl p-6 text-center z-shadow">
              <div
                className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                style={{
                  backgroundColor: 'var(--z-danger-soft)',
                  color: 'var(--z-danger)',
                }}
              >
                <PhoneOff className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold z-text z-display">{terminal?.title || 'Call ended'}</h2>
              <p className="text-sm z-secondary mt-2 leading-relaxed">
                {terminal?.message || 'This call has ended.'}
              </p>
              <button
                type="button"
                onClick={() => void handleEnd()}
                disabled={ending}
                className="mt-5 w-full h-11 rounded-xl font-semibold text-sm z-btn-primary z-focus disabled:opacity-60"
              >
                {ending ? 'Closing…' : 'Close'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {call.type === 'video' ? (
              <div className="h-full min-h-0 relative">
                {remoteTiles.length > 0 ? (
                  <div
                    className={`h-full min-h-0 overflow-y-auto z-scroll grid gap-2 ${
                      remoteTiles.length === 1
                        ? 'grid-cols-1'
                        : remoteTiles.length === 2
                          ? 'grid-cols-1 sm:grid-cols-2'
                          : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr'
                    }`}
                  >
                    {remoteTiles.map((tile) => (
                      <CallParticipantTile
                        key={tile.identity}
                        name={tile.name}
                        avatarUrl={singleRemote && !call.isGroup ? call.avatarUrl : undefined}
                        track={tile.videoTrack}
                        cameraOff={tile.cameraOff}
                        micMuted={tile.micMuted}
                        speaking={speakingIds.has(tile.identity)}
                        className="min-h-[42vh] sm:min-h-0"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center px-6">
                    <div className="relative mb-6">
                      <div className="absolute inset-0 rounded-full z-call-ring" aria-hidden="true" />
                      <Avatar src={call.avatarUrl} name={call.title} size="2xl" className="!border-0" />
                    </div>
                    <h2 className="text-xl sm:text-2xl font-bold z-text z-display">{call.title}</h2>
                    <p className="text-sm z-secondary mt-2 flex items-center gap-2">
                      {(phase === 'connecting' || phase === 'ringing') && (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      )}
                      {connectionStatus}
                    </p>
                    <p className="text-xs z-muted mt-2 max-w-xs">{subtitle}</p>
                  </div>
                )}

                {showLocalPip && (
                  <div className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 w-28 sm:w-40 aspect-[3/4] sm:aspect-video rounded-xl overflow-hidden border border-white/20 shadow-xl bg-black">
                    <CallParticipantTile
                      name={currentUser.name || currentUser.username}
                      avatarUrl={currentUser.avatarUrl}
                      track={localVideoTrack}
                      isLocal
                      cameraOff={!cameraOn}
                      micMuted={!micOn}
                      speaking={speakingIds.has(currentUser.id)}
                      compact
                      className="h-full w-full !rounded-none !border-0"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 overflow-y-auto z-scroll">
                {call.isGroup || remoteTiles.length > 1 ? (
                  <div className="w-full max-w-2xl">
                    <p className="text-[11px] uppercase tracking-[0.18em] font-semibold z-accent mb-4">
                      Group voice call
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {remoteTiles.map((tile) => (
                        <CallParticipantTile
                          key={tile.identity}
                          name={tile.name}
                          track={null}
                          micMuted={tile.micMuted}
                          speaking={speakingIds.has(tile.identity)}
                          className="aspect-square"
                        />
                      ))}
                      <CallParticipantTile
                        name={currentUser.name || currentUser.username}
                        avatarUrl={currentUser.avatarUrl}
                        track={null}
                        isLocal
                        micMuted={!micOn}
                        speaking={speakingIds.has(currentUser.id)}
                        className="aspect-square"
                      />
                    </div>
                    <p className="text-sm z-secondary mt-5 tabular-nums">{connectionStatus}</p>
                  </div>
                ) : (
                  <>
                    <div className="relative mb-6">
                      <div className="absolute inset-0 rounded-full z-call-ring" aria-hidden="true" />
                      <Avatar
                        src={call.avatarUrl}
                        name={call.title}
                        size="2xl"
                        className="!border-0"
                      />
                    </div>
                    <h2 className="text-2xl font-bold z-text z-display">{call.title}</h2>
                    <p className="text-sm z-secondary mt-2 flex items-center gap-2">
                      {(phase === 'connecting' || phase === 'ringing' || phase === 'reconnecting') && (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      )}
                      {connectionStatus}
                    </p>
                    <p className="text-xs z-muted mt-2 max-w-xs">{subtitle}</p>
                    {hasRemote && singleRemote && (
                      <p className="text-[11px] z-muted mt-1">
                        {singleRemote.name}
                        {singleRemote.micMuted ? ' · microphone muted' : ''}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {mediaBanner && !showTerminal && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[min(92%,30rem)] z-surface border z-border rounded-2xl p-3 z-shadow z-pop-enter" role="alert">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--z-warning)' }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold z-text">
                  {mediaErrors.camera ? 'Camera unavailable' : 'Microphone unavailable'}
                </p>
                <p className="text-[11px] z-secondary mt-1 leading-relaxed">
                  {mediaErrors.camera || mediaErrors.mic}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() =>
                      void (mediaErrors.camera ? handleToggleCamera() : handleToggleMic())
                    }
                    className="h-8 px-3 rounded-lg text-[11px] font-semibold z-btn-secondary z-focus"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setMediaErrors((current) =>
                        mediaErrors.camera ? { ...current, camera: undefined } : { ...current, mic: undefined }
                      )
                    }
                    className="h-8 w-8 rounded-lg flex items-center justify-center z-muted hover:z-text z-focus"
                    aria-label="Dismiss media warning"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {mediaErrors.camera && mediaErrors.mic && (
                  <p className="text-[10px] z-muted mt-1">Microphone: {mediaErrors.mic}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {!showTerminal && (
        <div
          ref={controlsRef}
          onPointerDown={revealControls}
          onFocus={revealControls}
          className={`shrink-0 px-3 pb-3 sm:pb-5 transition-opacity duration-300 ${
            controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          style={{
            paddingTop: call.type === 'video' ? '0.5rem' : '1rem',
            background:
              call.type === 'video'
                ? 'linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0))'
                : undefined,
          }}
        >
          <CallControls
            type={call.type}
            micOn={micOn}
            cameraOn={cameraOn}
            onToggleMic={() => void handleToggleMic()}
            onToggleCamera={() => void handleToggleCamera()}
            onSwitchCamera={() => void handleSwitchCamera()}
            canSwitchCamera={canSwitchCamera}
            onEnd={() => void handleEnd()}
            audioOutputs={audioOutputs}
            selectedAudioOutputId={selectedAudioOutputId}
            onSelectAudioOutput={(deviceId) => void handleSelectAudioOutput(deviceId)}
            speakerSupported={supportsOutputSelection}
            disabled={ending}
          />
          {call.type === 'video' && (
            <p className="text-center text-[10px] z-muted mt-2">
              Tap the screen to show or hide controls
            </p>
          )}
        </div>
      )}

      {!showTerminal && call.type === 'video' && !controlsVisible && (
        <button
          type="button"
          onClick={revealControls}
          aria-label="Show call controls"
          className="absolute inset-0 z-10"
          tabIndex={-1}
        />
      )}

      {remoteTiles.map((tile) =>
        tile.audioTrack ? (
          <AudioTrackView key={`audio-${tile.identity}`} track={tile.audioTrack} />
        ) : null
      )}

      {terminal?.title === 'No answer' && (
        <span className="sr-only" role="status">
          No answer
        </span>
      )}
    </div>
  );
};
