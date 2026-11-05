import React, { useState, useEffect, useRef } from 'react';
import { User } from '../../types/index.ts';
import { Modal } from '../common/Modal.tsx';
import { Button } from '../common/Button.tsx';
import { api } from '../../services/api.ts';
import { Upload, AlertCircle } from 'lucide-react';
import { Avatar } from '../common/Avatar.tsx';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onSave: (data: Partial<User>) => Promise<void>;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isOpen,
  onClose,
  user,
  onSave,
}) => {
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio || '');
  const [location, setLocation] = useState(user.location || '');
  const [website, setWebsite] = useState(user.website || '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || '');
  const [bannerUrl, setBannerUrl] = useState(user.bannerUrl || '');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [avatarPresets, setAvatarPresets] = useState<string[]>([]);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getMediaCatalog()
      .then((catalog) => {
        if (catalog.avatars) {
          setAvatarPresets(catalog.avatars);
        }
      })
      .catch(() => {});
  }, []);

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      setUploadingAvatar(true);
      const res = await api.uploadFile(file, 'profile-avatar');
      setAvatarUrl(api.resolveFileUrl(res.url));
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Avatar upload failed');
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleBannerFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      setUploadingBanner(true);
      const res = await api.uploadFile(file, 'profile-cover');
      setBannerUrl(api.resolveFileUrl(res.url));
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Banner upload failed');
    } finally {
      setUploadingBanner(false);
      if (bannerInputRef.current) bannerInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setErrorMsg(null);

    try {
      setSaving(true);
      await onSave({
        name: name.trim(),
        bio: bio.trim(),
        location: location.trim(),
        website: website.trim(),
        avatarUrl: avatarUrl.trim() || undefined,
        bannerUrl: bannerUrl.trim() || undefined,
      });
      onClose();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Profile" maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {errorMsg && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-neutral-400 mb-1">Name</label>
          <input
            type="text"
            value={name}
            maxLength={50}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-500"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-neutral-400 mb-1">Bio (160 chars)</label>
          <textarea
            value={bio}
            maxLength={160}
            rows={3}
            onChange={(e) => setBio(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-500 resize-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-neutral-400 mb-1">Location</label>
          <input
            type="text"
            value={location}
            maxLength={100}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-neutral-400 mb-1">Website</label>
          <input
            type="url"
            value={website}
            maxLength={100}
            onChange={(e) => setWebsite(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-500"
          />
        </div>

        {/* Avatar Upload / URL */}
        <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
          <label className="block text-xs font-semibold text-neutral-300 mb-2">Avatar Image</label>
          <div className="flex items-center gap-3 mb-2">
            <Avatar src={avatarUrl} name={name || 'Operator'} size="lg" />
            <div className="flex flex-col gap-1.5 flex-1">
              <input
                type="file"
                ref={avatarInputRef}
                onChange={handleAvatarFile}
                accept="image/*"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-cyan-950 border border-cyan-800/60 text-cyan-300 text-xs rounded-lg hover:bg-cyan-900 cursor-pointer disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                {uploadingAvatar ? 'Uploading...' : 'Upload Avatar'}
              </button>
              <input
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="Or paste image URL..."
                className="w-full bg-black border border-neutral-800 rounded-lg px-2.5 py-1 text-xs text-white outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {avatarPresets.length > 0 && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-neutral-800/60">
              <span className="text-[10px] text-neutral-500">Presets:</span>
              <div className="flex gap-1.5">
                {avatarPresets.slice(0, 5).map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setAvatarUrl(preset)}
                    className="w-6 h-6 rounded-full overflow-hidden border border-neutral-700 hover:border-cyan-400 cursor-pointer transition-colors"
                  >
                    <img src={preset} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Banner Upload / URL */}
        <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
          <label className="block text-xs font-semibold text-neutral-300 mb-2">Banner Image</label>
          <div className="flex flex-col gap-1.5">
            <input
              type="file"
              ref={bannerInputRef}
              onChange={handleBannerFile}
              accept="image/*"
              className="hidden"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => bannerInputRef.current?.click()}
                disabled={uploadingBanner}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-cyan-950 border border-cyan-800/60 text-cyan-300 text-xs rounded-lg hover:bg-cyan-900 cursor-pointer disabled:opacity-50 shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                {uploadingBanner ? 'Uploading...' : 'Upload Banner'}
              </button>
              <input
                type="url"
                value={bannerUrl}
                onChange={(e) => setBannerUrl(e.target.value)}
                placeholder="Or paste banner image URL..."
                className="flex-1 bg-black border border-neutral-800 rounded-lg px-2.5 py-1 text-xs text-white outline-none focus:border-cyan-500"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-neutral-800">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="submit"
            isLoading={saving}
            disabled={saving || uploadingAvatar || uploadingBanner}
          >
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
};
