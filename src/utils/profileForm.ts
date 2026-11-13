import type { User } from '../types/index.ts';
import { validateImageFile } from './mediaValidation.ts';

const INTERNAL_MEDIA_PATH = /^\/api\/files\/file_[a-f0-9-]{36}$/i;

export type ProfileImagePurpose = 'profile-avatar' | 'profile-cover';

export interface EditProfileFormValues {
  name: string;
  bio: string;
  location: string;
  website: string;
  avatarUrl: string;
  bannerUrl: string;
  originalAvatarUrl: string;
  originalBannerUrl: string;
  avatarRemovalRequested: boolean;
}

export interface EditProfileFieldErrors {
  name?: string;
  website?: string;
  avatarUrl?: string;
  bannerUrl?: string;
}

export interface ProfileImageUploader {
  (file: File, purpose: ProfileImagePurpose): Promise<{ url: string }>;
}

export type ProfileImageUploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export interface SubmitEditProfileResult {
  ok: boolean;
  fieldErrors?: EditProfileFieldErrors;
  errorMessage?: string;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function isValidProfileImageReference(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (INTERNAL_MEDIA_PATH.test(trimmed)) return true;
  return isValidHttpUrl(trimmed);
}

export function validateWebsiteInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return isValidHttpUrl(candidate) ? null : 'Website must be a valid HTTP or HTTPS URL.';
}

export function validateEditProfileForm(values: EditProfileFormValues): EditProfileFieldErrors {
  const errors: EditProfileFieldErrors = {};
  if (!values.name.trim()) errors.name = 'Name is required.';

  const websiteError = validateWebsiteInput(values.website);
  if (websiteError) errors.website = websiteError;

  if (!isValidProfileImageReference(values.avatarUrl)) {
    errors.avatarUrl = 'Enter a valid image URL or /api/files/file_... reference.';
  }
  if (!isValidProfileImageReference(values.bannerUrl)) {
    errors.bannerUrl = 'Enter a valid image URL or /api/files/file_... reference.';
  }
  return errors;
}

export function buildProfileUpdatePayload(values: EditProfileFormValues): Partial<User> {
  const avatarUrl = values.avatarUrl.trim();
  const bannerUrl = values.bannerUrl.trim();
  const avatarUnchanged = avatarUrl === values.originalAvatarUrl.trim();
  const bannerUnchanged = bannerUrl === values.originalBannerUrl.trim();

  return {
    name: values.name.trim(),
    bio: values.bio.trim(),
    location: values.location.trim(),
    website: values.website.trim(),
    avatarUrl: values.avatarRemovalRequested
      ? ''
      : !avatarUrl || avatarUnchanged
        ? undefined
        : avatarUrl,
    bannerUrl: !bannerUrl || bannerUnchanged ? undefined : bannerUrl,
  };
}

export function profileRequestErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export async function uploadProfileImage(
  file: File,
  purpose: ProfileImagePurpose,
  uploader: ProfileImageUploader,
): Promise<ProfileImageUploadResult> {
  const validationError = validateImageFile(file);
  if (validationError) return { ok: false, error: validationError };

  try {
    const response = await uploader(file, purpose);
    const url = typeof response?.url === 'string' ? response.url.trim() : '';
    if (!url) return { ok: false, error: 'Upload did not return a file reference.' };
    return { ok: true, url };
  } catch (error) {
    return {
      ok: false,
      error: profileRequestErrorMessage(
        error,
        purpose === 'profile-avatar' ? 'Avatar upload failed' : 'Banner upload failed',
      ),
    };
  }
}

export async function submitEditProfileForm(
  values: EditProfileFormValues,
  save: (data: Partial<User>) => Promise<void>,
): Promise<SubmitEditProfileResult> {
  const fieldErrors = validateEditProfileForm(values);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  try {
    await save(buildProfileUpdatePayload(values));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      errorMessage: profileRequestErrorMessage(error, 'Failed to update profile'),
    };
  }
}
