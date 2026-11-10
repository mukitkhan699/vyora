import React, { useMemo, useState } from 'react';
import {
  Check,
  Crown,
  Edit3,
  LogOut,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { Conversation, User } from '../../types/index.ts';
import { Avatar } from '../common/Avatar.tsx';
import { UserBadges } from '../common/UserBadges.tsx';
import { Modal } from '../common/Modal.tsx';
import { ConfirmationDialog } from '../common/ConfirmationDialog.tsx';
import { GroupAvatar } from './GroupAvatar.tsx';

interface GroupDetailsModalProps {
  conversation: Conversation;
  currentUserId: string;
  allUsers: User[];
  onClose: () => void;
  onLeave: () => Promise<void>;
  onAddParticipants: (userIds: string[]) => Promise<void>;
  onRemoveParticipant: (userId: string) => Promise<void>;
  onUpdateConversation: (data: { title?: string; avatarUrl?: string }) => Promise<void>;
}

export const GroupDetailsModal: React.FC<GroupDetailsModalProps> = ({
  conversation,
  currentUserId,
  allUsers,
  onClose,
  onLeave,
  onAddParticipants,
  onRemoveParticipant,
  onUpdateConversation,
}) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title || '');
  const [avatarUrl, setAvatarUrl] = useState(conversation.avatarUrl || '');
  const [showAdd, setShowAdd] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const participants = conversation.participants || [];
  const activeParticipants = participants.filter((participant) => !participant.leftAt);
  const currentMember = participants.find((participant) => participant.userId === currentUserId);
  const isActiveMember = Boolean(currentMember && !currentMember.leftAt);
  const canManage = isActiveMember && (currentMember?.role === 'owner' || currentMember?.role === 'admin');
  const isOwner = currentMember?.role === 'owner';

  const existingIds = new Set(activeParticipants.map((participant) => participant.userId));
  const availableToAdd = useMemo(() => {
    const term = addQuery.trim().toLowerCase();
    return allUsers
      .filter((user) => !existingIds.has(user.id) && user.id !== currentUserId)
      .filter(
        (user) =>
          !term ||
          user.name.toLowerCase().includes(term) ||
          user.username.toLowerCase().includes(term),
      );
  }, [allUsers, addQuery, existingIds, currentUserId]);

  const canRemoveParticipant = (targetUserId: string, targetRole: string): boolean => {
    if (!canManage || targetUserId === currentUserId) return false;
    if (isOwner) return true;
    return targetRole === 'member';
  };

  const handleSaveDetails = async () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError('A group name is required.');
      return;
    }
    if (nextTitle.length > 100) {
      setError('Group names are limited to 100 characters.');
      return;
    }
    if (avatarUrl.trim()) {
      try {
        const url = new URL(avatarUrl.trim());
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          setError('Avatar links must use http or https.');
          return;
        }
      } catch {
        setError('Enter a valid avatar image URL, or leave it empty.');
        return;
      }
    }
    try {
      setBusy(true);
      setError('');
      await onUpdateConversation({
        title: nextTitle,
        avatarUrl: avatarUrl.trim(),
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update the group.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddParticipants = async () => {
    if (selectedToAdd.length === 0) return;
    try {
      setBusy(true);
      setError('');
      await onAddParticipants(selectedToAdd);
      setSelectedToAdd([]);
      setShowAdd(false);
      setAddQuery('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add participants.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      setBusy(true);
      setError('');
      await onRemoveParticipant(removeTarget.id);
      setRemoveTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove this participant.');
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    try {
      setBusy(true);
      setError('');
      await onLeave();
      setConfirmLeave(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to leave the group.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal isOpen onClose={onClose} title="Group information" maxWidth="max-w-lg">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col items-center text-center">
            <GroupAvatar name={conversation.title || 'Group'} src={conversation.avatarUrl} size="xl" />
            <h3 className="text-xl font-bold z-text z-display mt-3">{conversation.title}</h3>
            <p className="text-xs z-muted mt-1 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              {activeParticipants.length} active {activeParticipants.length === 1 ? 'member' : 'members'}
            </p>
            {canManage && !editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  setError('');
                }}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg z-surface-2 border z-border text-xs font-semibold z-secondary hover:z-text transition-colors z-focus"
              >
                <Edit3 className="w-3.5 h-3.5" /> Edit group
              </button>
            )}
          </div>

          {error && (
            <p className="text-xs rounded-lg z-danger-soft-bg px-3 py-2" style={{ color: 'var(--z-danger)' }} role="alert">
              {error}
            </p>
          )}

          {editing && (
            <div className="rounded-2xl border z-border z-surface-2 p-3.5 flex flex-col gap-3">
              <div>
                <label htmlFor="group-details-title" className="block text-[10px] font-semibold z-muted uppercase tracking-wide mb-1">
                  Group name
                </label>
                <input
                  id="group-details-title"
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={100}
                  className="z-input w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="group-details-avatar" className="block text-[10px] font-semibold z-muted uppercase tracking-wide mb-1">
                  Avatar URL
                </label>
                <input
                  id="group-details-avatar"
                  type="url"
                  value={avatarUrl}
                  onChange={(event) => setAvatarUrl(event.target.value)}
                  placeholder="https://…"
                  className="z-input w-full rounded-xl px-3 py-2 text-sm"
                />
                <p className="text-[10px] z-muted mt-1">Internal group avatar upload is not supported by the current storage policy.</p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setTitle(conversation.title || '');
                    setAvatarUrl(conversation.avatarUrl || '');
                    setError('');
                  }}
                  className="px-3 py-1.5 text-xs font-semibold z-secondary hover:z-text rounded-lg z-focus"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveDetails()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg z-accent-bg text-xs font-bold z-focus disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" /> Save
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider z-muted">Members</span>
              {canManage && !showAdd && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAdd(true);
                    setError('');
                  }}
                  className="text-[11px] z-accent hover:z-accent-strong flex items-center gap-1 font-semibold z-focus rounded"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Add member
                </button>
              )}
            </div>

            {showAdd && canManage && (
              <div className="rounded-xl border z-border z-surface-2 p-3 flex flex-col gap-2.5">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 z-muted pointer-events-none" />
                  <input
                    type="search"
                    value={addQuery}
                    onChange={(event) => setAddQuery(event.target.value)}
                    placeholder="Search contacts"
                    aria-label="Search contacts to add"
                    className="z-input w-full rounded-lg pl-9 pr-3 py-2 text-xs"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto z-scroll">
                  {availableToAdd.length === 0 ? (
                    <p className="text-xs z-muted py-3 text-center">No available contacts found.</p>
                  ) : (
                    availableToAdd.map((user) => {
                      const selected = selectedToAdd.includes(user.id);
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() =>
                            setSelectedToAdd((prev) =>
                              prev.includes(user.id)
                                ? prev.filter((id) => id !== user.id)
                                : [...prev, user.id],
                            )
                          }
                          aria-pressed={selected}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors z-focus ${
                            selected ? 'z-accent-soft-bg' : 'hover:z-surface-3'
                          }`}
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${selected ? 'z-accent-bg border-transparent' : 'border-[var(--z-border-strong)]'}`}>
                            {selected && <Check className="w-3 h-3" />}
                          </span>
                          <Avatar src={user.avatarUrl} name={user.name} size="xs" />
                          <span className="text-xs z-text truncate flex-1">{user.name}</span>
                          <span className="text-[10px] z-muted font-mono truncate">@{user.username}</span>
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAdd(false);
                      setSelectedToAdd([]);
                    }}
                    className="text-xs z-secondary hover:z-text px-2.5 py-1.5 rounded-lg z-focus"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={selectedToAdd.length === 0 || busy}
                    onClick={() => void handleAddParticipants()}
                    className="text-xs font-bold z-accent-bg px-3 py-1.5 rounded-lg disabled:opacity-40 z-focus"
                  >
                    {busy ? 'Adding…' : 'Add selected'}
                  </button>
                </div>
              </div>
            )}

            <ul className="rounded-xl border z-border overflow-hidden divide-y" style={{ borderColor: 'var(--z-border)' }}>
              {participants.map((participant) => {
                const user = participant.user;
                if (!user) return null;
                const isLeft = Boolean(participant.leftAt);
                const role = participant.role;
                return (
                  <li key={participant.userId} className="px-3 py-2.5 flex items-center gap-2.5">
                    <Avatar src={user.avatarUrl} name={user.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold z-text truncate">{user.name}</span>
                        <UserBadges verified={user.verified} isGold={user.isGold} size="xs" />
                        {role !== 'member' && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded z-accent-soft-bg z-accent shrink-0">
                            {role === 'owner' ? <Crown className="w-2.5 h-2.5" /> : <Shield className="w-2.5 h-2.5" />}
                            {role}
                          </span>
                        )}
                        {participant.userId === currentUserId && (
                          <span className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded z-surface-3 z-muted shrink-0">You</span>
                        )}
                      </div>
                      <p className="text-[10px] z-muted font-mono truncate mt-0.5">
                        {isLeft ? 'Left the group' : `@${user.username}`}
                      </p>
                    </div>
                    {!isLeft && canRemoveParticipant(participant.userId, role) && (
                      <button
                        type="button"
                        onClick={() => setRemoveTarget(user)}
                        aria-label={`Remove ${user.name} from group`}
                        title={`Remove ${user.name}`}
                        className="p-2 rounded-lg z-muted hover:z-danger-text hover:z-danger-soft-bg transition-colors z-focus"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="mt-5 pt-3 border-t z-border flex items-center justify-between gap-3">
          {isActiveMember ? (
            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg z-danger-text hover:z-danger-soft-bg transition-colors z-focus"
            >
              <LogOut className="w-3.5 h-3.5" /> Leave group
            </button>
          ) : (
            <span className="text-[11px] z-muted">You are no longer an active member.</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-semibold z-secondary hover:z-text rounded-lg z-focus"
          >
            Close
          </button>
        </div>
      </Modal>

      <ConfirmationDialog
        isOpen={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => void handleRemove()}
        title="Remove member?"
        description={
          removeTarget
            ? `${removeTarget.name} will lose access to new messages in this group. Historical messages remain available to them according to the backend's retention rules.`
            : ''
        }
        confirmLabel="Remove member"
        isDestructive
        isLoading={busy}
      />

      <ConfirmationDialog
        isOpen={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => void handleLeave()}
        title="Leave this group?"
        description="You will stop receiving new messages from this group. Historical messages remain available according to the backend's retention rules."
        confirmLabel="Leave group"
        isDestructive
        isLoading={busy}
      />
    </>
  );
};
