import React, { useState } from 'react';
import { X, Users } from 'lucide-react';
import { User } from '../../types/index.ts';
import { Avatar } from '../common/Avatar.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';

interface CreateGroupModalProps {
  contacts: User[];
  onClose: () => void;
  onCreate: (title: string, participantIds: string[]) => Promise<void>;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ contacts, onClose, onCreate }) => {
  const { accentBgClass } = useTheme();
  const [title, setTitle] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Group name is required.');
      return;
    }
    if (selectedIds.length === 0) {
      setError('Please select at least one contact.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      await onCreate(title.trim(), selectedIds);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create group.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-[#0F172A] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-cyan-400" />
            <h2 className="text-base font-bold text-white">Create Group Conversation</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-5 flex flex-col gap-4">
            {error && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1">Group Name</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Design Team, Friends..."
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                maxLength={100}
              />
            </div>

            <div className="flex flex-col flex-1 min-h-0">
              <label className="block text-xs font-medium text-neutral-400 mb-2">
                Select Members ({selectedIds.length})
              </label>
              <div className="overflow-y-auto max-h-56 divide-y divide-white/5 border border-white/10 rounded-xl bg-white/[0.02]">
                {contacts.map((u) => {
                  const isChecked = selectedIds.includes(u.id);
                  return (
                    <div
                      key={u.id}
                      onClick={() => toggleSelect(u.id)}
                      className={`p-2.5 flex items-center gap-3 cursor-pointer hover:bg-white/[0.04] transition-colors ${
                        isChecked ? 'bg-cyan-500/10' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="rounded border-white/20 text-cyan-400 focus:ring-0"
                      />
                      <Avatar src={u.avatarUrl} name={u.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white truncate">{u.name}</div>
                        <div className="text-xs text-neutral-400 font-mono">@{u.username}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-white/10 bg-[#090B10] flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim() || selectedIds.length === 0}
              className={`px-4 py-2 rounded-xl text-sm font-bold text-black ${accentBgClass} hover:brightness-110 disabled:opacity-40 transition-all`}
            >
              {loading ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
