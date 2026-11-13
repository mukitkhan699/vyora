import React, { useState, useEffect, useRef } from 'react';
import { User } from '../../types/index.ts';
import { Modal } from '../common/Modal.tsx';
import { Button } from '../common/Button.tsx';
import { api } from '../../services/api.ts';
import { IMAGE_ACCEPT_ATTRIBUTE } from '../../utils/mediaValidation.ts';
import {
  uploadProfileImage,
  submitEditProfileForm,
} from '../../utils/profileForm.ts';
import type { EditProfileFieldErrors } from '../../utils/profileForm.ts';
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
  const [avatarRemovalRequested, setAvatarRemovalRequested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<EditProfileFieldErrors>({});
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

  const clearFieldError = (field: keyof EditProfileFieldErrors) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setAvatarRemovalRequested(false);
    try {
      setUploadingAvatar(true);
      const result = await uploadProfileImage(file, 'profile-avatar', (selected, purpose) =>
        api.uploadFile(selected, purpose),
      );
      if (!result.ok) {
        setErrorMsg(result.error);
        return;
      }
      setAvatarUrl(api.resolveFileUrl(result.url));
      setAvatarRemovalRequested(false);
      clearFieldError('avatarUrl');
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
      const result = await uploadProfileImage(file, 'profile-cover', (selected, purpose) =>
        api.uploadFile(selected, purpose),
      );
      if (!result.ok) {
        setErrorMsg(result.error);
        return;
      }
      setBannerUrl(api.resolveFileUrl(result.url));
      clearFieldError('bannerUrl');
    } finally {
      setUploadingBanner(false);
      if (bannerInputRef.current) bannerInputRef.current.value = '';
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarUrl('');
    setAvatarRemovalRequested(true);
    clearFieldError('avatarUrl');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFieldErrors({});
    setSaving(true);

    try {
      const result = await submitEditProfileForm(
        {
          name,
          bio,
          location,
          website,
          avatarUrl,
          bannerUrl,
          originalAvatarUrl: user.avatarUrl || '',
          originalBannerUrl: user.bannerUrl || '',
          avatarRemovalRequested,
        },
        onSave,
      );

      if (!result.ok) {
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        if (result.errorMessage) setErrorMsg(result.errorMessage);
        return;
      }

      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Profile" maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
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
            onChange={(e) => {
              setName(e.target.value);
              clearFieldError('name');
            }}
            aria-invalid={Boolean(fieldErrors.name)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-500"
          />
          {fieldErrors.name && <p className="mt-1 text-[11px] text-red-400">{fieldErrors.name}</p>}
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
            type="text"
            inputMode="url"
            value={website}
            maxLength={100}
            onChange={(e) => {
              setWebsite(e.target.value);
              clearFieldError('website');
            }}
            aria-invalid={Boolean(fieldErrors.website)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-500"
          />
          {fieldErrors.website && (
            <p className="mt-1 text-[11px] text-red-400">{fieldErrors.website}</p>
          )}
        </div>

        {/* Avatar Upload / URL */}
        <div className="p-3 bg-neutral-900/60 rounded-xl border border-neutral-800">
          <label className="block text-xs font-semibold text-neutral-300 mb-2">Avatar Image</label>
          <div className="flex items-center gap-3 mb-2">
            <Avatar
              src={avatarRemovalRequested ? '' : avatarUrl}
              name={name || 'Operator'}
              size="lg"
            />
            <div className="flex flex-col gap-1.5 flex-1">
              <input
                type="file"
                ref={avatarInputRef}
                onChange={handleAvatarFile}
                accept={IMAGE_ACCEPT_ATTRIBUTE}
                className="hidden"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-cyan-950 border border-cyan-800/60 text-cyan-300 text-xs rounded-lg hover:bg-cyan-900 cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {uploadingAvatar ? 'Uploading...' : 'Upload Avatar'}
                </button>
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  disabled={
                    avatarRemovalRequested || (!avatarUrl.trim() && !user.avatarUrl)
                  }
                  className="px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 border border-rose-500/30 rounded-lg hover:bg-rose-500/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {avatarRemovalRequested ? 'Avatar will be removed' : 'Remove Avatar'}
                </button>
              </div>
              <input
                type="text"
                inputMode="url"
                value={avatarUrl}
                onChange={(e) => {
                  setAvatarUrl(e.target.value);
                  setAvatarRemovalRequested(false);
                  clearFieldError('avatarUrl');
                }}
                placeholder="Or paste image URL..."
                aria-invalid={Boolean(fieldErrors.avatarUrl)}
                className="w-full bg-black border border-neutral-800 rounded-lg px-2.5 py-1 text-xs text-white outline-none focus:border-cyan-500"
              />
              {fieldErrors.avatarUrl && (
                <p className="text-[11px] text-red-400">{fieldErrors.avatarUrl}</p>
              )}
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
                    onClick={() => {
                      setAvatarUrl(preset);
                      setAvatarRemovalRequested(false);
                      clearFieldError('avatarUrl');
                    }}
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
              accept={IMAGE_ACCEPT_ATTRIBUTE}
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
                type="text"
                inputMode="url"
                value={bannerUrl}
                onChange={(e) => {
                  setBannerUrl(e.target.value);
                  clearFieldError('bannerUrl');
                }}
                placeholder="Or paste banner image URL..."
                aria-invalid={Boolean(fieldErrors.bannerUrl)}
                className="flex-1 bg-black border border-neutral-800 rounded-lg px-2.5 py-1 text-xs text-white outline-none focus:border-cyan-500"
              />
            </div>
            {fieldErrors.bannerUrl && (
              <p className="text-[11px] text-red-400">{fieldErrors.bannerUrl}</p>
            )}
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
