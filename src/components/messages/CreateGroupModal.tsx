import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Search, Users } from 'lucide-react';
import type { User } from '../../types/index.ts';
import { Avatar } from '../common/Avatar.tsx';
import { UserBadges } from '../common/UserBadges.tsx';
import { Modal } from '../common/Modal.tsx';
import { GroupAvatar } from './GroupAvatar.tsx';

interface CreateGroupModalProps {
  contacts: User[];
  onClose: () => void;
  onCreate: (title: string, participantIds: string[], avatarUrl?: string) => Promise<void>;
}

type Step = 1 | 2 | 3;

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ contacts, onClose, onCreate }) => {
  const [step, setStep] = useState<Step>(1);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [loading, setLoading] = useState(false);
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

  const selectedContacts = contacts.filter((contact) => selectedIds.includes(contact.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const validateDetails = (): string => {
    if (!title.trim()) return 'A group name is required.';
    if (title.trim().length > 100) return 'Group names are limited to 100 characters.';
    if (avatarUrl.trim()) {
      try {
        const url = new URL(avatarUrl.trim());
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          return 'Avatar links must use http or https.';
        }
      } catch {
        return 'Enter a valid avatar image URL, or leave it empty.';
      }
    }
    return '';
  };

  const handleNext = () => {
    setError('');
    if (step === 1) {
      if (selectedIds.length === 0) {
        setError('Select at least one person.');
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      const message = validateDetails();
      if (message) {
        setError(message);
        return;
      }
      setStep(3);
    }
  };

  const handleCreate = async () => {
    const message = validateDetails();
    if (message) {
      setError(message);
      setStep(2);
      return;
    }
    try {
      setLoading(true);
      setError('');
      await onCreate(title.trim(), selectedIds, avatarUrl.trim() || undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the group.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="New group conversation" maxWidth="max-w-lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((value) => (
            <div key={value} className="flex items-center gap-2 flex-1">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                  value <= step ? 'z-accent-bg' : 'z-surface-3 z-muted'
                }`}
              >
                {value < step ? <Check className="w-3 h-3" /> : value}
              </span>
              <span className={`text-[11px] font-semibold truncate ${value === step ? 'z-text' : 'z-muted'}`}>
                {value === 1 ? 'People' : value === 2 ? 'Details' : 'Review'}
              </span>
              {value < 3 && <span className="h-px flex-1 bg-[var(--z-border)]" />}
            </div>
          ))}
        </div>

        {error && (
          <p className="text-xs rounded-lg z-danger-soft-bg px-3 py-2" style={{ color: 'var(--z-danger)' }} role="alert">
            {error}
          </p>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 z-muted pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search people"
                aria-label="Search people for the group"
                className="z-input w-full rounded-xl pl-10 pr-3 py-2.5 text-sm"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold z-muted uppercase tracking-wide">
                Select members
              </p>
              <p className="text-[11px] z-secondary">{selectedIds.length} selected</p>
            </div>

            <div className="max-h-[42vh] overflow-y-auto z-scroll rounded-xl border z-border">
              {filtered.length === 0 ? (
                <p className="p-6 text-center text-xs z-muted">No matching people.</p>
              ) : (
                <ul className="divide-y" style={{ borderColor: 'var(--z-border)' }}>
                  {filtered.map((contact) => {
                    const checked = selectedIds.includes(contact.id);
                    return (
                      <li key={contact.id}>
                        <button
                          type="button"
                          onClick={() => toggleSelect(contact.id)}
                          aria-pressed={checked}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors z-focus ${
                            checked ? 'z-accent-soft-bg' : 'hover:z-surface-2'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              checked
                                ? 'z-accent-bg border-transparent'
                                : 'border-[var(--z-border-strong)]'
                            }`}
                            aria-hidden="true"
                          >
                            {checked && <Check className="w-3 h-3" />}
                          </span>
                          <Avatar src={contact.avatarUrl} name={contact.name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1 text-sm font-semibold z-text truncate">
                              {contact.name}
                              <UserBadges verified={contact.verified} isGold={contact.isGold} size="xs" />
                            </span>
                            <span className="block text-[11px] z-muted font-mono truncate">@{contact.username}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <GroupAvatar name={title || 'Group'} src={avatarUrl.trim()} size="xl" />
              <div className="min-w-0">
                <p className="text-sm font-semibold z-text truncate">{title.trim() || 'Untitled group'}</p>
                <p className="text-[11px] z-muted">{selectedIds.length + 1} participants including you</p>
              </div>
            </div>

            <div>
              <label htmlFor="group-title" className="block text-[11px] font-semibold z-muted uppercase tracking-wide mb-1.5">
                Group name
              </label>
              <input
                id="group-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Design circle"
                maxLength={100}
                className="z-input w-full rounded-xl px-3 py-2.5 text-sm"
                autoFocus
              />
              <p className="text-[10px] z-muted mt-1">1–100 characters</p>
            </div>

            <div>
              <label htmlFor="group-avatar" className="block text-[11px] font-semibold z-muted uppercase tracking-wide mb-1.5">
                Group avatar URL <span className="font-normal normal-case">(optional)</span>
              </label>
              <input
                id="group-avatar"
                type="url"
                value={avatarUrl}
                onChange={(event) => setAvatarUrl(event.target.value)}
                placeholder="https://…"
                className="z-input w-full rounded-xl px-3 py-2.5 text-sm"
              />
              <p className="text-[10px] z-muted mt-1">
                Group avatar uploads are not supported by the current storage policy; an https image link is used.
              </p>
            </div>

            <div className="rounded-xl border z-border z-surface-2 p-3">
              <p className="text-[11px] font-semibold z-muted uppercase tracking-wide mb-2">Invited people</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedContacts.map((contact) => (
                  <span
                    key={contact.id}
                    className="inline-flex items-center gap-1.5 rounded-full z-surface-3 px-2 py-1 text-[11px] z-secondary"
                  >
                    <Avatar src={contact.avatarUrl} name={contact.name} size="xs" />
                    {contact.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center text-center py-3">
              <GroupAvatar name={title} src={avatarUrl.trim()} size="xl" />
              <h3 className="text-lg font-bold z-text z-display mt-3">{title.trim()}</h3>
              <p className="text-xs z-muted mt-1">
                {selectedIds.length + 1} participants · Created by you
              </p>
            </div>

            <div className="rounded-xl border z-border overflow-hidden">
              <div className="px-3 py-2 z-surface-2 flex items-center gap-2">
                <Users className="w-3.5 h-3.5 z-accent" />
                <span className="text-[11px] font-semibold z-secondary uppercase tracking-wide">Participants</span>
              </div>
              <ul className="divide-y max-h-40 overflow-y-auto z-scroll" style={{ borderColor: 'var(--z-border)' }}>
                {selectedContacts.map((contact) => (
                  <li key={contact.id} className="px-3 py-2 flex items-center gap-2.5">
                    <Avatar src={contact.avatarUrl} name={contact.name} size="xs" />
                    <span className="text-xs z-text truncate flex-1">{contact.name}</span>
                    <span className="text-[10px] z-muted font-mono truncate">@{contact.username}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-[11px] z-muted leading-relaxed">
              The group will be created immediately. You can add or remove members later if the backend grants you owner or admin permissions.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t z-border">
          {step === 1 ? (
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm font-semibold z-secondary hover:z-text rounded-xl z-focus">
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError('');
                setStep((step - 1) as Step);
              }}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold z-secondary hover:z-text rounded-xl z-focus"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl z-accent-bg text-sm font-bold z-focus"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl z-accent-bg text-sm font-bold z-focus disabled:opacity-50"
            >
              {loading ? 'Creating…' : 'Create group'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
