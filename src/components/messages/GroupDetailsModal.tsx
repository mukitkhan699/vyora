import React, { useState } from 'react';
import { X, UserPlus, LogOut, Trash2 } from 'lucide-react';
import { Conversation, User } from '../../types/index.ts';
import { Avatar } from '../common/Avatar.tsx';
import { UserBadges } from '../common/UserBadges.tsx';

interface GroupDetailsModalProps {
  conversation: Conversation;
  currentUserId: string;
  allUsers: User[];
  onClose: () => void;
  onLeave: () => Promise<void>;
  onAddParticipants: (userIds: string[]) => Promise<void>;
  onRemoveParticipant: (userId: string) => Promise<void>;
}

export const GroupDetailsModal: React.FC<GroupDetailsModalProps> = ({
  conversation,
  currentUserId,
  allUsers,
  onClose,
  onLeave,
  onAddParticipants,
  onRemoveParticipant,
}) => {
  const [showAdd, setShowAdd] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const participants = conversation.participants || [];
  const currentMember = participants.find((p) => p.userId === currentUserId);
  const canManage = currentMember?.role === 'owner' || currentMember?.role === 'admin';

  const existingIds = new Set(participants.filter((p) => !p.leftAt).map((p) => p.userId));
  const availableToAdd = allUsers.filter((u) => !existingIds.has(u.id));

  const handleAddSubmit = async () => {
    if (selectedToAdd.length === 0) return;
    try {
      setLoading(true);
      await onAddParticipants(selectedToAdd);
      setSelectedToAdd([]);
      setShowAdd(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-[#0F172A] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Group Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-5">
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold text-2xl mb-2">
              {conversation.title?.slice(0, 2).toUpperCase() || 'GP'}
            </div>
            <h3 className="text-lg font-bold text-white">{conversation.title}</h3>
            <p className="text-xs text-neutral-400 font-mono mt-0.5">
              {participants.filter((p) => !p.leftAt).length} active members
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Members
              </span>
              {canManage && !showAdd && (
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="text-xs text-cyan-400 hover:underline flex items-center gap-1 font-medium"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Add Member
                </button>
              )}
            </div>

            {showAdd && (
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-2">
                <span className="text-xs text-neutral-300 font-medium">Select users to add:</span>
                <div className="max-h-36 overflow-y-auto divide-y divide-white/5">
                  {availableToAdd.length === 0 ? (
                    <div className="text-xs text-neutral-500 py-2">No additional contacts available.</div>
                  ) : (
                    availableToAdd.map((u) => {
                      const isSel = selectedToAdd.includes(u.id);
                      return (
                        <div
                          key={u.id}
                          onClick={() =>
                            setSelectedToAdd((prev) =>
                              prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id],
                            )
                          }
                          className="py-1.5 flex items-center gap-2 cursor-pointer"
                        >
                          <input type="checkbox" checked={isSel} onChange={() => {}} className="rounded" />
                          <Avatar src={u.avatarUrl} name={u.name} size="sm" />
                          <span className="text-xs text-white truncate">{u.name}</span>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="flex justify-end gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAdd(false);
                      setSelectedToAdd([]);
                    }}
                    className="text-xs text-neutral-400 hover:text-white px-2 py-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={selectedToAdd.length === 0 || loading}
                    onClick={handleAddSubmit}
                    className="text-xs font-bold bg-cyan-400 text-black px-3 py-1 rounded-lg hover:brightness-110 disabled:opacity-40"
                  >
                    Add Selected
                  </button>
                </div>
              </div>
            )}

            <div className="divide-y divide-white/5 border border-white/10 rounded-xl bg-white/[0.02]">
              {participants.map((p) => {
                const u = p.user;
                if (!u) return null;
                const isLeft = Boolean(p.leftAt);
                return (
                  <div key={p.userId} className="p-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar src={u.avatarUrl} name={u.name} size="sm" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white flex items-center gap-1 truncate">
                          {u.name}
                          <UserBadges verified={u.verified} isGold={u.isGold} size="sm" />
                          {p.role !== 'member' && (
                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300">
                              {p.role}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-neutral-400 font-mono truncate">
                          {isLeft ? '(Left group)' : `@${u.username}`}
                        </div>
                      </div>
                    </div>

                    {!isLeft && canManage && p.userId !== currentUserId && (
                      <button
                        type="button"
                        onClick={() => onRemoveParticipant(p.userId)}
                        className="text-neutral-500 hover:text-red-400 p-1.5 rounded-lg transition-colors"
                        title="Remove member"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/10 bg-[#090B10] flex justify-between">
          <button
            type="button"
            onClick={onLeave}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-400 hover:text-red-300 rounded-lg hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-4 h-4" /> Leave Group
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium text-neutral-400 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
