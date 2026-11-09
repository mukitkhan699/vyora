import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, Users } from 'lucide-react';
import { Room, RoomEvent, Track, RemoteParticipant, LocalParticipant } from 'livekit-client';

interface CallModalProps {
  roomName: string;
  token: string;
  livekitUrl: string;
  title: string;
  isGroup: boolean;
  onEndCall: () => void;
}

export const CallModal: React.FC<CallModalProps> = ({
  roomName,
  token,
  livekitUrl,
  title,
  isGroup,
  onEndCall,
}) => {
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [connectionState, setConnectionState] = useState('connecting');
  const [participants, setParticipants] = useState<Array<{ identity: string; name?: string }>>([]);

  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    const setupRoom = async () => {
      try {
        setConnectionState('connecting');
        await room.connect(livekitUrl, token);
        setConnectionState('connected');

        // Enable camera and microphone
        await room.localParticipant.enableCameraAndMicrophone();
        const camTrack = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camTrack?.track && localVideoRef.current) {
          camTrack.track.attach(localVideoRef.current);
        }

        // Handle participant tracks
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
            track.attach(remoteVideoRef.current);
          }
        });

        room.on(RoomEvent.ParticipantConnected, (p) => {
          setParticipants((prev) => [...prev, { identity: p.identity, name: p.name }]);
        });

        room.on(RoomEvent.ParticipantDisconnected, (p) => {
          setParticipants((prev) => prev.filter((item) => item.identity !== p.identity));
        });
      } catch (err) {
        console.warn('[LiveKit] Connection error:', err);
        setConnectionState('failed');
      }
    };

    void setupRoom();

    const timer = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    return () => {
      clearInterval(timer);
      room.disconnect();
      roomRef.current = null;
    };
  }, [roomName, token, livekitUrl]);

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextState = !isMicOn;
    await room.localParticipant.setMicrophoneEnabled(nextState);
    setIsMicOn(nextState);
  };

  const toggleVideo = async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextState = !isVideoOn;
    await room.localParticipant.setCameraEnabled(nextState);
    setIsVideoOn(nextState);
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md">
      <div className="bg-[#090B10] border border-white/10 rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col h-[75vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold">
              {title.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">{title}</h2>
              <div className="text-xs text-neutral-400 font-mono">
                {connectionState === 'connected' ? formatDuration(callDuration) : connectionState}...
              </div>
            </div>
          </div>
          {isGroup && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-neutral-300">
              <Users className="w-3.5 h-3.5 text-cyan-400" />
              <span>{participants.length + 1} active</span>
            </div>
          )}
        </div>

        {/* Video Stage */}
        <div className="flex-1 bg-black/60 relative p-4 flex items-center justify-center overflow-hidden">
          {/* Main Remote Video */}
          <div className="w-full h-full rounded-2xl bg-neutral-900 border border-white/5 overflow-hidden flex items-center justify-center relative">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-sm text-neutral-500 font-mono">Live transmission in progress</span>
            </div>
          </div>

          {/* Picture in picture local preview */}
          <div className="absolute bottom-6 right-6 w-36 h-28 sm:w-48 sm:h-36 rounded-xl bg-neutral-800 border-2 border-white/15 overflow-hidden shadow-xl z-20">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${!isVideoOn ? 'hidden' : ''}`}
            />
            {!isVideoOn && (
              <div className="w-full h-full flex items-center justify-center text-xs text-neutral-400">
                Camera off
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="p-4 border-t border-white/10 bg-[#0F172A] flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={toggleMic}
            className={`p-3.5 rounded-full transition-colors ${
              isMicOn ? 'bg-white/10 hover:bg-white/15 text-white' : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}
            title={isMicOn ? 'Mute Mic' : 'Unmute Mic'}
          >
            {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>

          <button
            type="button"
            onClick={toggleVideo}
            className={`p-3.5 rounded-full transition-colors ${
              isVideoOn ? 'bg-white/10 hover:bg-white/15 text-white' : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}
            title={isVideoOn ? 'Turn Camera Off' : 'Turn Camera On'}
          >
            {isVideoOn ? <VideoIcon className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>

          <button
            type="button"
            onClick={onEndCall}
            className="p-3.5 rounded-full bg-red-600 hover:bg-red-500 text-white font-bold transition-all shadow-lg hover:scale-105"
            title="End Call"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
