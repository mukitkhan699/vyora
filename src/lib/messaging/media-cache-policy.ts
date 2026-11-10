export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  OTHER = 'other',
}

export interface MediaCachePolicy {
  maxAge: number;
  maxSize: number;
  priority: 'high' | 'medium' | 'low';
  cacheThumbnails: boolean;
  cacheFullResolution: boolean;
}

export const MEDIA_CACHE_POLICIES: Record<MediaType, MediaCachePolicy> = {
  [MediaType.IMAGE]: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    maxSize: 50 * 1024 * 1024, // 50MB for images
    priority: 'high',
    cacheThumbnails: true,
    cacheFullResolution: true,
  },
  [MediaType.VIDEO]: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    maxSize: 200 * 1024 * 1024, // 200MB for videos (metadata only, not full files)
    priority: 'medium',
    cacheThumbnails: true,
    cacheFullResolution: false,
  },
  [MediaType.AUDIO]: {
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
    maxSize: 50 * 1024 * 1024, // 50MB for audio
    priority: 'medium',
    cacheThumbnails: false,
    cacheFullResolution: true,
  },
  [MediaType.DOCUMENT]: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    maxSize: 100 * 1024 * 1024, // 100MB for documents
    priority: 'low',
    cacheThumbnails: false,
    cacheFullResolution: true,
  },
  [MediaType.OTHER]: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    maxSize: 20 * 1024 * 1024, // 20MB for other
    priority: 'low',
    cacheThumbnails: false,
    cacheFullResolution: true,
  },
};

export function getMediaType(mimeType: string): MediaType {
  if (mimeType.startsWith('image/')) return MediaType.IMAGE;
  if (mimeType.startsWith('video/')) return MediaType.VIDEO;
  if (mimeType.startsWith('audio/')) return MediaType.AUDIO;
  if (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('text/') ||
    mimeType.startsWith('application/msword') ||
    mimeType.startsWith('application/vnd.openxmlformats') ||
    mimeType.startsWith('application/vnd.ms-')
  ) {
    return MediaType.DOCUMENT;
  }
  return MediaType.OTHER;
}

export function getCachePolicy(mimeType: string): MediaCachePolicy {
  return MEDIA_CACHE_POLICIES[getMediaType(mimeType)];
}

export function shouldCacheThumbnails(mimeType: string): boolean {
  return getCachePolicy(mimeType).cacheThumbnails;
}

export function shouldCacheFullResolution(mimeType: string): boolean {
  return getCachePolicy(mimeType).cacheFullResolution;
}

export function getMaxCacheAge(mimeType: string): number {
  return getCachePolicy(mimeType).maxAge;
}

export function getMaxCacheSize(mimeType: string): number {
  return getCachePolicy(mimeType).maxSize;
}

export interface EvictionCandidate {
  assetId: string;
  conversationId: string;
  lastAccessed: number;
  fileSize: number;
  contentType: string;
  isPinned: boolean;
  priority: 'high' | 'medium' | 'low';
}

export function sortEvictionCandidates(candidates: EvictionCandidate[]): EvictionCandidate[] {
  const priorityWeight = { low: 0, medium: 1, high: 2 };
  return [...candidates].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? 1 : -1;
    const priorityDiff = priorityWeight[a.priority] - priorityWeight[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return a.lastAccessed - b.lastAccessed;
  });
}