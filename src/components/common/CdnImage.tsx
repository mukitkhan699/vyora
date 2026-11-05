import React, { useState, useEffect, useRef } from 'react';
import { getBackendApiUrl } from '../../config/backendUrl.ts';

interface CdnImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  fallbackSrc?: string;
  showSkeleton?: boolean;
}

function resolveSource(source: string): string {
  return source.startsWith('/api/files/') ? `${getBackendApiUrl()}${source}` : source;
}

export const CdnImage: React.FC<CdnImageProps> = ({
  src,
  alt = '',
  className = '',
  fallbackSrc,
  showSkeleton = true,
  onError,
  onLoad,
  ...props
}) => {
  const [currentSrc, setCurrentSrc] = useState<string | null>(() => {
    if (src && src.trim()) {
      return resolveSource(src.trim());
    }
    return fallbackSrc || null;
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasFailed, setHasFailed] = useState<boolean>(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (src && src.trim()) {
      setHasFailed(false);
      setIsLoading(true);
      setCurrentSrc(resolveSource(src.trim()));
    } else if (fallbackSrc) {
      setHasFailed(false);
      setIsLoading(true);
      setCurrentSrc(fallbackSrc);
    } else {
      setCurrentSrc(null);
      setIsLoading(false);
    }
  }, [src, fallbackSrc]);

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      setIsLoading(false);
    }
  }, [currentSrc]);

  const handleError = (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (fallbackSrc && currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc);
    } else {
      setHasFailed(true);
      setIsLoading(false);
      onError?.(event);
    }
  };

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setIsLoading(false);
    onLoad?.(event);
  };

  if (hasFailed || !currentSrc) {
    return (
      <div className={`bg-neutral-800 text-neutral-400 flex items-center justify-center text-xs p-2 ${className}`}>
        <span>{alt || 'Image unavailable'}</span>
      </div>
    );
  }

  return (
    <div className={`relative inline-block overflow-hidden ${className}`}>
      {isLoading && showSkeleton && (
        <div className={`absolute inset-0 bg-neutral-800/60 animate-pulse ${className}`} />
      )}
      <img
        ref={imageRef}
        src={currentSrc}
        alt={alt}
        className={`${className} ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-200`}
        onError={handleError}
        onLoad={handleLoad}
        loading="lazy"
        {...props}
      />
    </div>
  );
};
