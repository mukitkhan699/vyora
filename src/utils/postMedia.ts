export const MAX_POST_MEDIA = 4;

export const POST_MEDIA_LIMIT_MESSAGE = `A maximum of ${MAX_POST_MEDIA} images can be attached per post.`;

export type PostMediaSource = 'upload' | 'url' | 'preset';

export interface PostMediaAttachment {
  url: string;
  source: PostMediaSource;
  fileId?: string;
}

export interface PostMediaSnapshot {
  attachments: readonly PostMediaAttachment[];
  pendingCount: number;
  remainingSlots: number;
}

export interface PostMediaUpload {
  url: string;
  fileId: string;
}

export interface PostMediaUploadDependencies {
  validateFile: (file: File) => string | null;
  uploadFile: (file: File) => Promise<PostMediaUpload>;
}

export type AddPostMediaFileResult =
  | { ok: true; attachment: PostMediaAttachment }
  | { ok: false; error: string; reason: 'invalid' | 'limit' | 'upload' };

export class PostMediaAttachments {
  private attachments: PostMediaAttachment[] = [];
  private pendingReservations = new Set<string>();
  private listeners = new Set<() => void>();
  private nextReservationId = 0;
  private snapshot: PostMediaSnapshot = this.buildSnapshot();

  private buildSnapshot(): PostMediaSnapshot {
    return {
      attachments: [...this.attachments],
      pendingCount: this.pendingReservations.size,
      remainingSlots: Math.max(
        0,
        MAX_POST_MEDIA - this.attachments.length - this.pendingReservations.size,
      ),
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getSnapshot = (): PostMediaSnapshot => this.snapshot;

  public getAttachments = (): PostMediaAttachment[] => [...this.attachments];

  public reserveUpload(): string | null {
    if (this.buildSnapshot().remainingSlots === 0) return null;
    const reservationId = `media_reservation_${this.nextReservationId++}`;
    this.pendingReservations.add(reservationId);
    this.emit();
    return reservationId;
  }

  public commitUpload(reservationId: string, url: string, fileId: string): boolean {
    if (!this.pendingReservations.delete(reservationId)) return false;
    this.attachments = [...this.attachments, { url, source: 'upload', fileId }];
    this.emit();
    return true;
  }

  public releaseUpload(reservationId: string): void {
    if (this.pendingReservations.delete(reservationId)) this.emit();
  }

  public addAttachment(url: string, source: 'url' | 'preset'): boolean {
    if (this.buildSnapshot().remainingSlots === 0) return false;
    this.attachments = [...this.attachments, { url, source }];
    this.emit();
    return true;
  }

  public removeAt(index: number): PostMediaAttachment | undefined {
    const removed = this.attachments[index];
    if (!removed) return undefined;
    this.attachments = this.attachments.filter((_, currentIndex) => currentIndex !== index);
    this.emit();
    return removed;
  }

  public clear(): void {
    if (this.attachments.length === 0 && this.pendingReservations.size === 0) return;
    this.attachments = [];
    this.pendingReservations.clear();
    this.emit();
  }
}

export async function addPostMediaFile(
  controller: PostMediaAttachments,
  file: File,
  dependencies: PostMediaUploadDependencies,
): Promise<AddPostMediaFileResult> {
  if (controller.getSnapshot().remainingSlots === 0) {
    return { ok: false, error: POST_MEDIA_LIMIT_MESSAGE, reason: 'limit' };
  }

  const validationError = dependencies.validateFile(file);
  if (validationError) {
    return { ok: false, error: validationError, reason: 'invalid' };
  }

  const reservationId = controller.reserveUpload();
  if (!reservationId) {
    return { ok: false, error: POST_MEDIA_LIMIT_MESSAGE, reason: 'limit' };
  }

  try {
    const uploaded = await dependencies.uploadFile(file);
    const attachment: PostMediaAttachment = {
      url: uploaded.url,
      source: 'upload',
      fileId: uploaded.fileId,
    };
    if (!controller.commitUpload(reservationId, uploaded.url, uploaded.fileId)) {
      return {
        ok: false,
        error: 'The image finished uploading after the composer changed.',
        reason: 'upload',
      };
    }
    return { ok: true, attachment };
  } catch (error) {
    controller.releaseUpload(reservationId);
    return {
      ok: false,
      error: error instanceof Error && error.message ? error.message : 'File upload failed',
      reason: 'upload',
    };
  }
}

export async function removePostMediaAttachment(
  controller: PostMediaAttachments,
  index: number,
  deleteFile: (fileId: string) => Promise<unknown>,
): Promise<PostMediaAttachment | undefined> {
  const removed = controller.removeAt(index);
  if (removed?.source === 'upload' && removed.fileId) {
    await deleteFile(removed.fileId).catch(() => undefined);
  }
  return removed;
}
