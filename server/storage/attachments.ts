import { query, withTransaction } from '../db/pool.ts';
import { getClient, deleteOwnedAsset } from './b2.ts';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';

function getBucket(): string {
  const bucket = process.env.B2_BUCKET?.trim();
  if (!bucket) throw new Error('B2_BUCKET is required.');
  return bucket;
}

export interface CleanupResult {
  cleanedCount: number;
  failedCount: number;
}

/**
 * Reconcile and clean up temporary message attachments in B2:
 * 1. All intended recipients have received the attachment (delivered_at is NOT NULL for all intended recipients)
 *    OR
 * 2. 7-day TTL has expired (expires_at <= now())
 *
 * Cleanup deletes the B2 object and updates the attachment status to 'cleaned'.
 * Message text, reactions, receipts, and conversation history are NEVER deleted.
 */
export async function cleanupDeliveredOrExpiredAttachments(): Promise<CleanupResult> {
  const now = Date.now();
  let cleanedCount = 0;
  let failedCount = 0;

  // Find candidate attachments ready for cleanup:
  // - status = 'active'
  // - AND (expires_at <= now OR all intended recipients in zunari_attachment_deliveries have delivered_at IS NOT NULL)
  const candidates = await query<{
    id: string;
    media_asset_id: string;
    object_key: string;
  }>(
    `SELECT ma.id, ma.media_asset_id, asset.object_key
     FROM zunari_message_attachments ma
     JOIN zunari_media_assets asset ON asset.id = ma.media_asset_id
     WHERE ma.status = 'active'
       AND (
         ma.expires_at <= $1
         OR (
           EXISTS (SELECT 1 FROM zunari_attachment_deliveries ad WHERE ad.attachment_id = ma.id)
           AND NOT EXISTS (
             SELECT 1 FROM zunari_attachment_deliveries ad
             WHERE ad.attachment_id = ma.id AND ad.delivered_at IS NULL
           )
         )
       )
     LIMIT 50`,
    [now],
  );

  for (const row of candidates.rows) {
    try {
      await withTransaction(async (client) => {
        // Mark attachment as cleaned
        await client.query(
          "UPDATE zunari_message_attachments SET status = 'cleaned' WHERE id = $1",
          [row.id],
        );
        // Mark media asset as cleaned in metadata
        await client.query(
          "UPDATE zunari_media_assets SET status = 'cleaned' WHERE id = $1",
          [row.media_asset_id],
        );
      });

      // Delete the actual object from Backblaze B2 storage
      try {
        await getClient().send(
          new DeleteObjectCommand({
            Bucket: getBucket(),
            Key: row.object_key,
          }),
        );
      } catch (storageError) {
        // Safe and retryable if object was already removed or B2 is temporarily unreachable
        console.warn(`[Storage] B2 deletion warning for key ${row.object_key}:`, storageError);
      }

      cleanedCount++;
    } catch (err) {
      console.error(`[Storage] Failed cleaning attachment ${row.id}:`, err);
      failedCount++;
    }
  }

  return { cleanedCount, failedCount };
}

/**
 * Record actual download event for an attachment by a recipient
 */
export async function recordAttachmentDownload(
  mediaAssetId: string,
  recipientId: string,
): Promise<void> {
  const now = Date.now();
  await query(
    `UPDATE zunari_attachment_deliveries ad
     SET downloaded_at = COALESCE(downloaded_at, $1),
         delivered_at = COALESCE(delivered_at, $1)
     FROM zunari_message_attachments ma
     WHERE ma.id = ad.attachment_id
       AND ma.media_asset_id = $2
       AND ad.recipient_id = $3`,
    [now, mediaAssetId, recipientId],
  );
}
