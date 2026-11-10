import React, { useEffect, useRef, useState } from 'react';
import { useCachedImage } from '../../hooks/useMediaCache.ts';
import { getBackendApiUrl } from '../../config/backendUrl.ts';

function resolveSource(source: string): string {
  return source.startsWith('/api/files/') ? `${getBackendApiUrl()}${source}` : source;
}

interface CachedImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  assetId: string;
  conversationId: string;
  src?: string | null;
  fallbackSrc?: string;
  contentType?: string;
  showSkeleton?: boolean;
}

export const CachedImage: React.FC<CachedImageProps> = ({
  assetId,
  conversationId,
  src,
  alt = '',
  className = '',
  fallbackSrc,
  contentType = 'image/*',
  showSkeleton = true,
  onError,
  onLoad,
  ...props
}) => {
  const resolvedSrc = src && src.trim() ? resolveSource(src.trim()) : null;
  const { src: cachedSrc, isLoading, hasFailed } = useCachedImage(
    assetId,
    conversationId,
    resolvedSrc || '',
    contentType
  );

  const [isLoadingFallback, setIsLoadingFallback] = useState(true);
  const [hasFailedFallback, setHasFailedFallback] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  const currentSrc = cachedSrc || fallbackSrc || null;
  const isLoadingState = cachedSrc ? isLoading : isLoadingFallback;
  const hasFailedState = cachedSrc ? hasFailed : hasFailedFallback;

  useEffect(() => {
    if (fallbackSrc) {
      setIsLoadingFallback(true);
      setHasFailedFallback(false);
    }
  }, [fallbackSrc]);

  const handleError = (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (fallbackSrc && currentSrc !== fallbackSrc) {
      setIsLoadingFallback(true);
      setHasFailedFallback(false);
    } else {
      setHasFailedFallback(true);
      setIsLoadingFallback(false);
      onError?.(event);
    }
  };

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (cachedSrc) {
      // isLoading from hook is read-only, we don't need to set it
    } else {
      setIsLoadingFallback(false);
    }
    onLoad?.(event);
  };

  if (hasFailedState || !currentSrc) {
    return (
      <div className={`bg-neutral-800 text-neutral-400 flex items-center justify-center text-xs p-2 ${className}`}>
        <span>{alt || 'Image unavailable'}</span>
      </div>
    );
  }

  return (
    <div className={`relative inline-block overflow-hidden ${className}`}>
      {isLoadingState && showSkeleton && (
        <div className={`absolute inset-0 bg-neutral-800/60 animate-pulse ${className}`} />
      )}
      <img
        ref={imageRef}
        src={currentSrc}
        alt={alt}
        className={`${className} ${isLoadingState ? 'opacity-0' : 'opacity-100'} transition-opacity duration-200`}
        onError={handleError}
        onLoad={handleLoad}
        loading="lazy"
        {...props}
      />
    </div>
  );
};