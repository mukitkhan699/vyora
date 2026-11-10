import React, { useMemo, useState } from 'react';
import { Search, UserRound, Users } from 'lucide-react';
import type { User } from '../../types/index.ts';
import { Avatar } from '../common/Avatar.tsx';
import { UserBadges } from '../common/UserBadges.tsx';
import { Modal } from '../common/Modal.tsx';

interface NewMessageModalProps {
  contacts: User[];
  isOpen: boolean;
  onClose: () => void;
  onSelectUser: (user: User) => Promise<void>;
  onCreateGroup: () => void;
}

export const NewMessageModal: React.FC<NewMessageModalProps> = ({
  contacts,
  isOpen,
  onClose,
  onSelectUser,
  onCreateGroup,
}) => {
  const [query, setQuery] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return contacts;
    return contacts.filter(
      (contact) =>
        contact.name.toLowerCase().includes(term) ||
        contact.username.toLowerCase().includes(term),
    );
  }, [contacts, query]);

  const handleSelect = async (user: User) => {
    try {
      setLoadingId(user.id);
      setError('');
      await onSelectUser(user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start this conversation.');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New message" maxWidth="max-w-md">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 z-muted pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people by name or username"
            aria-label="Search people"
            className="z-input w-full rounded-xl pl-10 pr-3 py-2.5 text-sm"
            autoFocus
          />
        </div>

        <button
          type="button"
          onClick={() => {
            onClose();
            onCreateGroup();
          }}
          className="w-full flex items-center gap-3 rounded-xl border z-border z-surface-2 px-3 py-2.5 text-left hover:z-surface-3 transition-colors z-focus"
        >
          <span className="w-9 h-9 rounded-full z-accent-soft-bg z-accent flex items-center justify-center shrink-0">
            <Users className="w-4.5 h-4.5" />
          </span>
          <span>
            <span className="block text-sm font-semibold z-text">New group</span>
            <span className="block text-[11px] z-muted">Select several people and name the conversation</span>
          </span>
        </button>

        {error && (
          <p className="text-xs rounded-lg z-danger-soft-bg px-3 py-2" style={{ color: 'var(--z-danger)' }} role="alert">
            {error}
          </p>
        )}

        <div className="max-h-[46vh] overflow-y-auto z-scroll -mx-1 px-1">
          {filtered.length === 0 ? (
            <div className="py-10 text-center">
              <UserRound className="w-6 h-6 z-muted mx-auto mb-2" />
              <p className="text-sm font-semibold z-text">No people found</p>
              <p className="text-xs z-muted mt-1">Try a different name or username.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {filtered.map((contact) => (
                <li key={contact.id}>
                  <button
                    type="button"
                    onClick={() => void handleSelect(contact)}
                    disabled={loadingId !== null}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left hover:z-surface-2 transition-colors z-focus disabled:opacity-60"
                  >
                    <Avatar src={contact.avatarUrl} name={contact.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-sm font-semibold z-text truncate">
                        {contact.name}
                        <UserBadges verified={contact.verified} isGold={contact.isGold} size="xs" />
                      </span>
                      <span className="block text-[11px] z-muted font-mono truncate">@{contact.username}</span>
                    </span>
                    {loadingId === contact.id && (
                      <span className="text-[11px] z-muted">Opening…</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
};
