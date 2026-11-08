export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export const IMAGE_ACCEPT_ATTRIBUTE = ALLOWED_IMAGE_MIME_TYPES.join(',');

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

const allowedImageMimeTypes = new Set<string>(ALLOWED_IMAGE_MIME_TYPES);

export function validateImageFile(file: File): string | null {
  if (file.size < 1) {
    return 'The selected image is empty.';
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return 'Image must be 10MB or smaller.';
  }
  if (!allowedImageMimeTypes.has(file.type.toLowerCase())) {
    return 'Choose a JPEG, PNG, GIF, or WebP image.';
  }
  return null;
}
