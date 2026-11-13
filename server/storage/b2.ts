import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.ts';
import { HttpError, redactSensitiveText } from '../errors.ts';

export type MediaPurpose = 'profile-avatar' | 'profile-cover' | 'post-image' | 'message-attachment';

export interface UploadRequest {
  ownerId: string;
  filename: string;
  mimeType: string;
  size: number;
  purpose: MediaPurpose;
}

export interface MediaRecord {
  id: string;
  owner_id: string;
  object_key: string;
  filename: string;
  mime_type: string;
  byte_size: string;
  purpose: MediaPurpose;
  status: 'pending' | 'ready' | 'deleting';
  visibility: 'private' | 'public';
  created_at: string;
  expires_at: string;
  upload_expires_at: string;
}

const MAX_UPLOADS_PER_HOUR = 20;
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;
const PENDING_TTL_MS = 30 * 60 * 1000;
const SIGNED_URL_TTL_SECONDS = 300;
const allowedTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'application/pdf',
  'text/plain',
]);

let client: S3Client | undefined;

function getBucket(): string {
  const bucket = process.env.B2_BUCKET?.trim();
  if (!bucket) throw new Error('B2_BUCKET is required.');
  return bucket;
}

export function getClient(): S3Client {
  if (client) return client;
  const endpoint = process.env.B2_ENDPOINT?.trim();
  const region = process.env.B2_REGION?.trim();
  const accessKeyId = process.env.B2_KEY_ID?.trim();
  const secretAccessKey = process.env.B2_APPLICATION_KEY?.trim();
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
    throw new Error('Backblaze B2 configuration is incomplete.');
  }
  const parsedEndpoint = new URL(endpoint);
  if (parsedEndpoint.protocol !== 'https:') {
    throw new Error('B2_ENDPOINT must use HTTPS.');
  }
  client = new S3Client({
    endpoint: parsedEndpoint.origin,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return client;
}

export function sanitizeFilename(filename: string): string {
  const cleaned = filename
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new HttpError(400, 'A valid filename is required.', 'INVALID_FILENAME');
  }
  return cleaned;
}

export function matchesFileSignature(mimeType: string, bytes: Uint8Array): boolean {
  const header = Buffer.from(bytes);
  if (mimeType === 'image/jpeg') {
    return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/gif') {
    const signature = header.subarray(0, 6).toString('ascii');
    return signature === 'GIF87a' || signature === 'GIF89a';
  }
  if (mimeType === 'image/webp') {
    return header.subarray(0, 4).toString('ascii') === 'RIFF' &&
      header.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (mimeType === 'application/pdf') {
    return header.length >= 4 && header.subarray(0, 4).toString('ascii') === '%PDF';
  }
  if (mimeType === 'text/plain') {
    return true;
  }
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
    return header.length >= 4;
  }
  return false;
}

interface StorageErrorDetails {
  name: string;
  status?: number;
  code?: string;
  message?: string;
}

function describeStorageError(error: unknown): StorageErrorDetails {
  if (!(error instanceof Error)) {
    return {
      name: 'UnknownError',
      message: redactSensitiveText(String(error)),
    };
  }

  const candidate = error as Error & {
    Code?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const metadataStatus = candidate.$metadata?.httpStatusCode;
  const status =
    typeof metadataStatus === 'number'
      ? metadataStatus
      : typeof candidate.statusCode === 'number'
        ? candidate.statusCode
        : typeof candidate.status === 'number'
          ? candidate.status
          : undefined;
  const code =
    typeof candidate.Code === 'string'
      ? candidate.Code
      : typeof candidate.code === 'string'
        ? candidate.code
        : undefined;

  return {
    name: candidate.name || 'Error',
    status,
    code,
    message: redactSensitiveText(candidate.message || 'No error message was provided.'),
  };
}

export function validateStorageConfiguration(): void {
  getBucket();
  getClient();
}

export function closeStorage(): void {
  client?.destroy();
  client = undefined;
}

export async function createUploadUrl(input: UploadRequest): Promise<{
  fileId: string;
  uploadUrl: string;
  filename: string;
  mimeType: string;
  size: number;
  expiresAt: number;
}> {
  if (!allowedTypes.has(input.mimeType)) {
    throw new HttpError(415, 'Unsupported media type.', 'UNSUPPORTED_MEDIA_TYPE');
  }
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > 10 * 1024 * 1024) {
    throw new HttpError(413, 'File exceeds the 10MB upload limit.', 'UPLOAD_SIZE_LIMIT');
  }
  const filename = sanitizeFilename(input.filename);
  const fileId = `file_${randomUUID()}`;
  const objectKey = `media/${randomUUID()}`;
  const now = Date.now();
  const expiresAt = now + PENDING_TTL_MS;
  const uploadExpiresAt = now + SIGNED_URL_TTL_SECONDS * 1000;
  const windowStart = Math.floor(now / UPLOAD_WINDOW_MS) * UPLOAD_WINDOW_MS;

  const rate = await query<{ request_count: number }>(
    `INSERT INTO zunari_upload_rate_limits (user_id, window_start, request_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, window_start)
     DO UPDATE SET request_count = zunari_upload_rate_limits.request_count + 1
     RETURNING request_count`,
    [input.ownerId, windowStart],
  );
  if (rate.rows[0].request_count > MAX_UPLOADS_PER_HOUR) {
    throw new HttpError(429, 'Upload limit reached. Try again later.', 'UPLOAD_RATE_LIMITED', {
      'Retry-After': String(Math.ceil((windowStart + UPLOAD_WINDOW_MS - now) / 1000)),
    });
  }

  await query(
    `INSERT INTO zunari_media_assets
       (id, owner_id, object_key, filename, mime_type, byte_size, purpose, status,
        created_at, expires_at, upload_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)`,
    [
      fileId,
      input.ownerId,
      objectKey,
      filename,
      input.mimeType,
      input.size,
      input.purpose,
      now,
      expiresAt,
      uploadExpiresAt,
    ],
  );

  try {
    const uploadUrl = await getSignedUrl(
      getClient(),
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: objectKey,
        ContentType: input.mimeType,
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
    return {
      fileId,
      uploadUrl,
      filename,
      mimeType: input.mimeType,
      size: input.size,
      expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000,
    };
  } catch (error) {
    await query('DELETE FROM zunari_media_assets WHERE id = $1 AND owner_id = $2', [fileId, input.ownerId]);
    console.error('[B2] Presigned URL generation failed:', {
      bucket: process.env.B2_BUCKET?.trim(),
      region: process.env.B2_REGION?.trim(),
      endpoint: process.env.B2_ENDPOINT?.trim(),
      ...describeStorageError(error),
    });
    throw new HttpError(503, 'Unable to prepare the media upload.', 'STORAGE_UNAVAILABLE');
  }
}

export async function finalizeUpload(ownerId: string, fileId: string): Promise<MediaRecord> {
  const pending = await query<MediaRecord>(
    `SELECT * FROM zunari_media_assets
     WHERE id = $1 AND owner_id = $2 AND status = 'pending' AND expires_at > $3`,
    [fileId, ownerId, Date.now()],
  );
  const asset = pending.rows[0];
  if (!asset) throw new HttpError(404, 'Pending upload not found.', 'UPLOAD_NOT_FOUND');

  let head;
  try {
    head = await getClient().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: asset.object_key }),
    );
  } catch (error) {
    console.error('[B2] HeadObject verification failed:', describeStorageError(error));
    throw new HttpError(409, 'Uploaded object could not be verified.', 'UPLOAD_NOT_VERIFIED');
  }

  const actualSize = Number(head.ContentLength);
  const actualType = head.ContentType?.split(';', 1)[0].trim().toLowerCase();
  let validSignature = false;
  if (actualSize === Number(asset.byte_size) && actualType === asset.mime_type) {
    let bytes: Uint8Array | undefined;
    try {
      const sample = await getClient().send(
        new GetObjectCommand({
          Bucket: getBucket(),
          Key: asset.object_key,
          Range: 'bytes=0-1023',
        }),
      );
      bytes = await sample.Body?.transformToByteArray();
    } catch (error) {
      console.error('[B2] GetObject signature sample failed:', describeStorageError(error));
      throw new HttpError(503, 'Unable to verify the uploaded image.', 'STORAGE_UNAVAILABLE');
    }
    validSignature = Boolean(bytes && matchesFileSignature(asset.mime_type, bytes));
  }
  if (actualSize !== Number(asset.byte_size) || actualType !== asset.mime_type || !validSignature) {
    await query(
      `UPDATE zunari_media_assets
       SET status = 'deleting', expires_at = GREATEST(upload_expires_at, $1)
       WHERE id = $2 AND owner_id = $3`,
      [Date.now(), fileId, ownerId],
    );
    await deleteObject(asset.object_key);
    throw new HttpError(400, 'Uploaded file did not match its approved image type or size.', 'UPLOAD_MISMATCH');
  }

  const result = await query<MediaRecord>(
    `UPDATE zunari_media_assets SET status = 'ready'
     WHERE id = $1 AND owner_id = $2 AND status = 'pending' AND expires_at > $3
     RETURNING *`,
    [fileId, ownerId, Date.now()],
  );
  if (!result.rows[0]) throw new HttpError(409, 'Upload is no longer available.', 'UPLOAD_NOT_PENDING');
  return result.rows[0];
}

export async function createLegacyUpload(
  input: UploadRequest,
  data: Buffer,
): Promise<MediaRecord> {
  if (data.length !== input.size) {
    throw new HttpError(400, 'Uploaded file size did not match the request.', 'UPLOAD_MISMATCH');
  }
  const upload = await createUploadUrl(input);
  const record = await query<MediaRecord>(
    'SELECT * FROM zunari_media_assets WHERE id = $1 AND owner_id = $2',
    [upload.fileId, input.ownerId],
  );
  const asset = record.rows[0];
  if (!asset) throw new HttpError(500, 'Upload record was not created.', 'UPLOAD_FAILED');
  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: asset.object_key,
        Body: data,
        ContentType: input.mimeType,
        ContentLength: data.length,
      }),
    );
    return await finalizeUpload(input.ownerId, upload.fileId);
  } catch (error) {
    await query(
      `UPDATE zunari_media_assets SET expires_at = $1 WHERE id = $2 AND owner_id = $3`,
      [Date.now(), upload.fileId, input.ownerId],
    );
    throw error;
  }
}

async function deleteObject(objectKey: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: objectKey }));
}

export async function getAuthorizedDownloadUrl(
  fileId: string,
  requesterId: string | null,
): Promise<string> {
  const result = await query<MediaRecord>(
    `SELECT asset.*
     FROM zunari_media_assets AS asset
     WHERE asset.id = $1 AND asset.status = 'ready'
       AND (
         asset.owner_id = $2
         OR (
           asset.visibility = 'public'
           AND (
             EXISTS (
               SELECT 1 FROM zunari_users AS profile
               WHERE profile.avatar_url = '/api/files/' || asset.id
                  OR profile.banner_url = '/api/files/' || asset.id
             )
             OR EXISTS (
               SELECT 1 FROM zunari_posts AS post
               WHERE '/api/files/' || asset.id = ANY(post.media_urls)
             )
           )
         )
         OR (
           EXISTS (
             SELECT 1 FROM zunari_message_attachments ma
             JOIN zunari_messages_v2 m ON m.id = ma.message_id
             JOIN zunari_conversation_participants p ON p.conversation_id = m.conversation_id
             WHERE ma.media_asset_id = asset.id
               AND p.user_id = $2
               AND ma.status = 'active'
               AND (p.left_at IS NULL OR m.created_at <= p.left_at)
           )
         )
       )`,
    [fileId, requesterId],
  );
  const asset = result.rows[0];
  if (!asset) throw new HttpError(404, 'File not found.', 'FILE_NOT_FOUND');

  try {
    return await getSignedUrl(
      getClient(),
      new GetObjectCommand({
        Bucket: getBucket(),
        Key: asset.object_key,
        ResponseContentType: asset.mime_type,
        ResponseContentDisposition: `inline; filename="${asset.filename.replace(/["\\]/g, '_')}"`,
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
  } catch {
    throw new HttpError(503, 'Unable to retrieve the media file.', 'STORAGE_UNAVAILABLE');
  }
}

export async function deleteOwnedAsset(ownerId: string, fileId: string): Promise<void> {
  const asset = await withTransaction(async (connection) => {
    const result = await connection.query<MediaRecord>(
      `SELECT * FROM zunari_media_assets
       WHERE id = $1 AND owner_id = $2 AND status = 'ready'
       FOR UPDATE`,
      [fileId, ownerId],
    );
    const current = result.rows[0];
    if (!current) {
      throw new HttpError(404, 'File is unavailable or still in use.', 'FILE_NOT_DELETABLE');
    }

    const attached = await connection.query<{ used: boolean }>(
      `SELECT
         EXISTS (
           SELECT 1 FROM zunari_users
           WHERE avatar_url = '/api/files/' || $1 OR banner_url = '/api/files/' || $1
         )
         OR EXISTS (
           SELECT 1 FROM zunari_posts
           WHERE '/api/files/' || $1 = ANY(media_urls)
         ) AS used`,
      [fileId],
    );
    if (attached.rows[0].used) {
      throw new HttpError(404, 'File is unavailable or still in use.', 'FILE_NOT_DELETABLE');
    }
    await connection.query(
      `UPDATE zunari_media_assets
       SET status = 'deleting', expires_at = GREATEST(upload_expires_at, $3)
       WHERE id = $1 AND owner_id = $2`,
      [fileId, ownerId, Date.now()],
    );
    return current;
  });
  await deleteObject(asset.object_key);
}

export async function abortUpload(ownerId: string, fileId: string): Promise<void> {
  const asset = await withTransaction(async (connection) => {
    const result = await connection.query<MediaRecord>(
      `SELECT * FROM zunari_media_assets
       WHERE id = $1 AND owner_id = $2 AND status IN ('pending', 'ready')
       FOR UPDATE`,
      [fileId, ownerId],
    );
    const current = result.rows[0];
    if (!current) return null;
    const attached = await connection.query<{ used: boolean }>(
      `SELECT
         EXISTS (
           SELECT 1 FROM zunari_users
           WHERE avatar_url = '/api/files/' || $1 OR banner_url = '/api/files/' || $1
         )
         OR EXISTS (
           SELECT 1 FROM zunari_posts
           WHERE '/api/files/' || $1 = ANY(media_urls)
         ) AS used`,
      [fileId],
    );
    if (attached.rows[0].used) return null;
    await connection.query(
      `UPDATE zunari_media_assets
       SET status = 'deleting', expires_at = GREATEST(upload_expires_at, $3)
       WHERE id = $1 AND owner_id = $2`,
      [fileId, ownerId, Date.now()],
    );
    return current;
  });
  if (!asset) return;
  await deleteObject(asset.object_key);
}

export async function listOwnedAssets(ownerId: string): Promise<Array<{
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
}>> {
  const result = await query<MediaRecord>(
    `SELECT * FROM zunari_media_assets
     WHERE owner_id = $1 AND status = 'ready'
     ORDER BY created_at DESC`,
    [ownerId],
  );
  return result.rows.map((asset) => ({
    id: asset.id,
    url: `/api/files/${asset.id}`,
    filename: asset.filename,
    mimeType: asset.mime_type,
    size: Number(asset.byte_size),
    uploadedBy: asset.owner_id,
    createdAt: new Date(Number(asset.created_at)).toISOString(),
  }));
}

export async function cleanupAbandonedUploads(): Promise<void> {
  const candidates = await query<{ id: string }>(
    `SELECT id FROM zunari_media_assets
     WHERE (status = 'pending' AND expires_at <= $1)
        OR (status = 'deleting' AND expires_at <= $1)
     ORDER BY expires_at LIMIT 100`,
    [Date.now()],
  );

  for (const candidate of candidates.rows) {
    const asset = await withTransaction(async (connection) => {
      const current = await connection.query<MediaRecord>(
        `SELECT * FROM zunari_media_assets
         WHERE id = $1
           AND ((status = 'pending' AND expires_at <= $2)
             OR (status = 'deleting' AND expires_at <= $2))
         FOR UPDATE SKIP LOCKED`,
        [candidate.id, Date.now()],
      );
      const row = current.rows[0];
      if (!row) return null;
      await connection.query(
        `UPDATE zunari_media_assets SET status = 'deleting'
         WHERE id = $1`,
        [row.id],
      );
      return row;
    });
    if (!asset) continue;
    try {
      await deleteObject(asset.object_key);
      await query(
        "DELETE FROM zunari_media_assets WHERE id = $1 AND status = 'deleting'",
        [asset.id],
      );
    } catch {
      console.error('Unable to clean up an abandoned media object; it will be retried.');
    }
  }

  await query('DELETE FROM zunari_upload_rate_limits WHERE window_start < $1', [
    Date.now() - 24 * 60 * 60 * 1000,
  ]);
}

export async function makeAssetPublicIfOwned(
  connection: PoolClient,
  ownerId: string,
  url: string,
  purpose: MediaPurpose,
): Promise<void> {
  const match = /^\/api\/files\/(file_[a-f0-9-]{36})$/i.exec(url);
  if (!match) return;
  const result = await connection.query(
    `UPDATE zunari_media_assets SET visibility = 'public'
     WHERE id = $1 AND owner_id = $2 AND purpose = $3 AND status = 'ready'`,
    [match[1], ownerId, purpose],
  );
  if (!result.rowCount) {
    throw new HttpError(403, 'You can only attach your own completed uploads.', 'MEDIA_NOT_OWNED');
  }
}
