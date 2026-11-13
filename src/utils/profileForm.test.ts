import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { User } from '../types/index.ts';
import {
  buildProfileUpdatePayload,
  submitEditProfileForm,
  uploadProfileImage,
  validateEditProfileForm,
  type EditProfileFormValues,
} from './profileForm.ts';

const AVATAR_PATH = '/api/files/file_00000000-0000-4000-8000-000000000000';
const BANNER_PATH = '/api/files/file_11111111-1111-4111-8111-111111111111';

function formValues(overrides: Partial<EditProfileFormValues> = {}): EditProfileFormValues {
  return {
    name: 'Mukit',
    bio: '',
    location: '',
    website: '',
    avatarUrl: '',
    bannerUrl: '',
    originalAvatarUrl: '',
    originalBannerUrl: '',
    avatarRemovalRequested: false,
    ...overrides,
  };
}

function imageFile(): File {
  return new File([new Uint8Array(1)], 'avatar.png', { type: 'image/png' });
}

test('edit profile accepts existing internal avatar and banner references', () => {
  const errors = validateEditProfileForm(
    formValues({ avatarUrl: AVATAR_PATH, bannerUrl: BANNER_PATH }),
  );
  assert.deepEqual(errors, {});
});

test('edit profile accepts absolute HTTP avatar references', () => {
  const errors = validateEditProfileForm(
    formValues({ avatarUrl: 'https://cdn.example.com/avatar.png' }),
  );
  assert.deepEqual(errors, {});
});

test('edit profile still rejects invalid website URLs', () => {
  const errors = validateEditProfileForm(formValues({ website: 'javascript:alert(1)' }));
  assert.equal(errors.website, 'Website must be a valid HTTP or HTTPS URL.');
});

test('name and bio edits preserve the existing avatar when it is unchanged or omitted', () => {
  const unchanged = buildProfileUpdatePayload(
    formValues({
      name: 'Renamed',
      avatarUrl: AVATAR_PATH,
      originalAvatarUrl: AVATAR_PATH,
    }),
  );
  assert.equal(unchanged.avatarUrl, undefined);

  const clearedText = buildProfileUpdatePayload(
    formValues({ name: 'Renamed', avatarUrl: '', originalAvatarUrl: AVATAR_PATH }),
  );
  assert.equal(clearedText.avatarUrl, undefined);

  const bioOnly = buildProfileUpdatePayload(
    formValues({ bio: 'Updated bio', avatarUrl: AVATAR_PATH, originalAvatarUrl: AVATAR_PATH }),
  );
  assert.equal(bioOnly.avatarUrl, undefined);
});

test('a new avatar reference replaces the existing avatar', () => {
  const replacement = buildProfileUpdatePayload(
    formValues({
      avatarUrl: 'https://cdn.example.com/new-avatar.png',
      originalAvatarUrl: AVATAR_PATH,
    }),
  );
  assert.equal(replacement.avatarUrl, 'https://cdn.example.com/new-avatar.png');
});

test('explicit avatar removal clears the avatar while ordinary edits do not', () => {
  const removed = buildProfileUpdatePayload(
    formValues({ avatarUrl: '', avatarRemovalRequested: true }),
  );
  assert.equal(removed.avatarUrl, '');

  const ordinary = buildProfileUpdatePayload(formValues({ bio: 'Updated bio' }));
  assert.equal(ordinary.avatarUrl, undefined);
});

test('uploaded avatar reference is included in the profile save payload', async () => {
  const upload = await uploadProfileImage(imageFile(), 'profile-avatar', async () => ({
    url: AVATAR_PATH,
  }));
  assert.deepEqual(upload, { ok: true, url: AVATAR_PATH });

  let saved: Partial<User> = {};
  const result = await submitEditProfileForm(
    formValues({
      avatarUrl: upload.ok ? upload.url : '',
      originalAvatarUrl: '',
    }),
    async (data) => {
      saved = data;
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(saved.avatarUrl, AVATAR_PATH);
});

test('upload failures return a visible error instead of success', async () => {
  const result = await uploadProfileImage(imageFile(), 'profile-avatar', async () => {
    throw new Error('Storage is unavailable.');
  });
  assert.deepEqual(result, { ok: false, error: 'Storage is unavailable.' });
});

test('profile update failures return a visible error instead of success', async () => {
  const result = await submitEditProfileForm(formValues({ name: 'Renamed' }), async () => {
    throw new Error('Failed to update profile');
  });
  assert.deepEqual(result, { ok: false, errorMessage: 'Failed to update profile' });
});

test('form validation errors prevent the profile save request', async () => {
  let saveCalled = false;
  const result = await submitEditProfileForm(
    formValues({ avatarUrl: 'not a valid image reference' }),
    async () => {
      saveCalled = true;
    },
  );

  assert.equal(saveCalled, false);
  assert.equal(result.ok, false);
  assert.match(result.fieldErrors?.avatarUrl || '', /valid image URL/);
});
