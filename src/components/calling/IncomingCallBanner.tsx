import React from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { Avatar } from '../common/Avatar.tsx';

interface IncomingCallBannerProps {
  caller: { name: string; username: string; avatarUrl: string };
  type: 'voice' | 'video';
  onAccept: () => void;
  onReject: () => void;
}

export const IncomingCallBanner: React.FC<IncomingCallBannerProps> = ({
  caller,
  type,
  onAccept,
  onReject,
}) => {
  return (
    <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-4 duration-300">
      <div className="bg-[#0F172A] border border-cyan-500/30 rounded-2xl p-4 shadow-2xl flex items-center gap-4 min-w-80 backdrop-blur-md">
        <div className="relative">
          <Avatar src={caller.avatarUrl} name={caller.name} size="md" />
          <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-cyan-400 text-black">
            {type === 'video' ? <Video className="w-3 h-3" /> : <Phone className="w-3 h-3" />}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold text-white truncate">{caller.name}</h4>
          <p className="text-xs text-neutral-400">Incoming {type} transmission...</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            className="p-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors"
            title="Decline"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="p-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold shadow-md hover:scale-105 transition-all"
            title="Accept"
          >
            <Phone className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
