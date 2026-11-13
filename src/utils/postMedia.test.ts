import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateImageFile } from './mediaValidation.ts';
import {
  MAX_POST_MEDIA,
  POST_MEDIA_LIMIT_MESSAGE,
  PostMediaAttachments,
  addPostMediaFile,
  removePostMediaAttachment,
} from './postMedia.ts';

function imageFile(name = 'image.png', type = 'image/png'): File {
  return new File([new Uint8Array(1)], name, { type });
}

function uploadResult(index: number): { url: string; fileId: string } {
  return {
    url: `/api/files/file_${index}`,
    fileId: `file_${index}`,
  };
}

test('adds one image through the shared guarded upload helper', async () => {
  const controller = new PostMediaAttachments();
  let uploadCalls = 0;

  const result = await addPostMediaFile(controller, imageFile(), {
    validateFile: validateImageFile,
    uploadFile: async () => {
      uploadCalls += 1;
      return uploadResult(1);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(uploadCalls, 1);
  assert.deepEqual(controller.getSnapshot().attachments, [
    { url: '/api/files/file_1', source: 'upload', fileId: 'file_1' },
  ]);
  assert.equal(controller.getSnapshot().remainingSlots, 3);
});

test('adds four images and rejects the fifth before upload begins', async () => {
  const controller = new PostMediaAttachments();
  let uploadCalls = 0;

  for (let index = 1; index <= MAX_POST_MEDIA; index += 1) {
    const result = await addPostMediaFile(controller, imageFile(), {
      validateFile: validateImageFile,
      uploadFile: async () => {
        uploadCalls += 1;
        return uploadResult(index);
      },
    });
    assert.equal(result.ok, true);
  }

  assert.equal(controller.getSnapshot().attachments.length, MAX_POST_MEDIA);
  assert.equal(controller.getSnapshot().remainingSlots, 0);

  const fifth = await addPostMediaFile(controller, imageFile(), {
    validateFile: validateImageFile,
    uploadFile: async () => {
      uploadCalls += 1;
      return uploadResult(5);
    },
  });

  assert.deepEqual(fifth, {
    ok: false,
    error: POST_MEDIA_LIMIT_MESSAGE,
    reason: 'limit',
  });
  assert.equal(uploadCalls, MAX_POST_MEDIA);
  assert.equal(controller.getSnapshot().attachments.length, MAX_POST_MEDIA);
});

test('three attachments plus one pending reservation consume every slot', async () => {
  const controller = new PostMediaAttachments();
  controller.addAttachment('/api/files/one', 'url');
  controller.addAttachment('/api/files/two', 'url');
  controller.addAttachment('/api/files/three', 'url');

  const reservation = controller.reserveUpload();
  assert.notEqual(reservation, null);
  assert.equal(controller.getSnapshot().pendingCount, 1);
  assert.equal(controller.getSnapshot().remainingSlots, 0);

  let uploadCalls = 0;
  const blockedUpload = await addPostMediaFile(controller, imageFile(), {
    validateFile: validateImageFile,
    uploadFile: async () => {
      uploadCalls += 1;
      return uploadResult(4);
    },
  });

  assert.equal(blockedUpload.ok, false);
  assert.equal(uploadCalls, 0);
  assert.equal(controller.addAttachment('/api/files/five', 'url'), false);
  assert.equal(controller.addAttachment('/api/files/preset', 'preset'), false);
  assert.equal(controller.getSnapshot().attachments.length, 3);

  controller.releaseUpload(reservation as string);
  assert.equal(controller.getSnapshot().remainingSlots, 1);
});

test('failed upload releases its reservation and allows another attempt', async () => {
  const controller = new PostMediaAttachments();
  let uploadCalls = 0;

  const failed = await addPostMediaFile(controller, imageFile(), {
    validateFile: validateImageFile,
    uploadFile: async () => {
      uploadCalls += 1;
      throw new Error('Storage is unavailable.');
    },
  });

  assert.deepEqual(failed, {
    ok: false,
    error: 'Storage is unavailable.',
    reason: 'upload',
  });
  assert.equal(uploadCalls, 1);
  assert.equal(controller.getSnapshot().pendingCount, 0);
  assert.equal(controller.getSnapshot().remainingSlots, MAX_POST_MEDIA);

  const retried = await addPostMediaFile(controller, imageFile(), {
    validateFile: validateImageFile,
    uploadFile: async () => {
      uploadCalls += 1;
      return uploadResult(1);
    },
  });

  assert.equal(retried.ok, true);
  assert.equal(uploadCalls, 2);
  assert.equal(controller.getSnapshot().attachments.length, 1);
});

test('removing an attachment immediately frees its slot', () => {
  const controller = new PostMediaAttachments();
  controller.addAttachment('/api/files/one', 'url');
  controller.addAttachment('/api/files/two', 'url');
  controller.addAttachment('/api/files/three', 'url');
  controller.addAttachment('/api/files/four', 'preset');

  assert.equal(controller.addAttachment('/api/files/five', 'url'), false);
  assert.equal(controller.removeAt(1)?.url, '/api/files/two');
  assert.equal(controller.getSnapshot().remainingSlots, 1);
  assert.equal(controller.addAttachment('/api/files/five', 'url'), true);
  assert.equal(controller.getSnapshot().attachments.length, MAX_POST_MEDIA);
});

test('rapid add attempts cannot reserve the same remaining slot', async () => {
  const controller = new PostMediaAttachments();
  controller.addAttachment('/api/files/one', 'url');
  controller.addAttachment('/api/files/two', 'url');
  controller.addAttachment('/api/files/three', 'url');

  let uploadCalls = 0;
  let finishUpload: ((value: { url: string; fileId: string }) => void) | undefined;
  const uploadFile = () => new Promise<{ url: string; fileId: string }>((resolve) => {
    uploadCalls += 1;
    finishUpload = resolve;
  });

  const first = addPostMediaFile(controller, imageFile(), {
    validateFile: validateImageFile,
    uploadFile,
  });
  const second = addPostMediaFile(controller, imageFile(), {
    validateFile: validateImageFile,
    uploadFile,
  });

  assert.equal((await second).ok, false);
  assert.equal(uploadCalls, 1);

  finishUpload?.(uploadResult(4));
  assert.equal((await first).ok, true);
  assert.equal(controller.getSnapshot().attachments.length, MAX_POST_MEDIA);

  for (let index = 0; index < 10; index += 1) {
    controller.addAttachment(`/api/files/rapid_${index}`, 'url');
  }
  assert.equal(controller.getSnapshot().attachments.length, MAX_POST_MEDIA);
});

test('invalid and rejected files never upload', async () => {
  const controller = new PostMediaAttachments();
  let uploadCalls = 0;

  const invalid = await addPostMediaFile(controller, imageFile('invalid.svg', 'image/svg+xml'), {
    validateFile: validateImageFile,
    uploadFile: async () => {
      uploadCalls += 1;
      return uploadResult(1);
    },
  });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid');
  assert.equal(uploadCalls, 0);

  for (let index = 1; index <= MAX_POST_MEDIA; index += 1) {
    controller.addAttachment(`/api/files/existing_${index}`, 'url');
  }

  const atLimit = await addPostMediaFile(controller, imageFile(), {
    validateFile: validateImageFile,
    uploadFile: async () => {
      uploadCalls += 1;
      return uploadResult(5);
    },
  });

  assert.equal(atLimit.ok, false);
  assert.equal(atLimit.reason, 'limit');
  assert.equal(uploadCalls, 0);
});

test('removal deletes uploaded assets but never external URLs or presets', async () => {
  const controller = new PostMediaAttachments();
  await addPostMediaFile(controller, imageFile(), {
    validateFile: validateImageFile,
    uploadFile: async () => uploadResult(1),
  });
  controller.addAttachment('https://images.example.com/photo.png', 'url');
  controller.addAttachment('/api/files/preset', 'preset');

  const deleted: string[] = [];
  const deleteFile = async (fileId: string) => {
    deleted.push(fileId);
  };

  await removePostMediaAttachment(controller, 0, deleteFile);
  await removePostMediaAttachment(controller, 0, deleteFile);
  await removePostMediaAttachment(controller, 0, deleteFile);

  assert.deepEqual(deleted, ['file_1']);
  assert.equal(controller.getSnapshot().attachments.length, 0);
});
