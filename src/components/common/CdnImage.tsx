import React, { useState, useEffect } from 'react';
import { cdnManager } from '../../utils/cdnManager.ts';

interface CdnImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  fallbackSrc?: string;
  showSkeleton?: boolean;
}

export const CdnImage: React.FC<CdnImageProps> = ({
  src,
  alt = '',
  className = '',
  fallbackSrc,
  showSkeleton = true,
  ...props
}) => {
  const [currentSrc, setCurrentSrc] = useState<string | null>(() => {
    if (src && src.trim()) {
      return cdnManager.resolveAssetUrl(src.trim(), 0);
    }
    return fallbackSrc || null;
  });
  const [attempt, setAttempt] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasFailed, setHasFailed] = useState<boolean>(false);

  useEffect(() => {
    if (src && src.trim()) {
      setAttempt(0);
      setHasFailed(false);
      setIsLoading(true);
      setCurrentSrc(cdnManager.resolveAssetUrl(src.trim(), 0));
    } else if (fallbackSrc) {
      setAttempt(0);
      setHasFailed(false);
      setIsLoading(true);
      setCurrentSrc(fallbackSrc);
    } else {
      setCurrentSrc(null);
      setIsLoading(false);
    }
  }, [src, fallbackSrc]);

  const handleError = () => {
    const nextAttempt = attempt + 1;
    const cdns = cdnManager.getCdns();

    // If we have alternative CDNs, try the next one
    if (src && nextAttempt < cdns.length) {
      setAttempt(nextAttempt);
      const fallbackUrl = cdnManager.recordAssetFailure(currentSrc || '') || cdnManager.resolveAssetUrl(src, nextAttempt);
      if (fallbackUrl) {
        setCurrentSrc(fallbackUrl);
        return;
      }
    }
    
    if (fallbackSrc && currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc);
    } else {
      setHasFailed(true);
      setIsLoading(false);
    }
  };

  const handleLoad = () => {
    setIsLoading(false);
  };

  if (hasFailed || !currentSrc) {
    return (
      <div className={`bg-neutral-800 text-neutral-400 flex items-center justify-center text-xs p-2 ${className}`}>
        <span>{alt || 'Image unavailable'}</span>
      </div>
    );
  }

  return (
    <div className="relative inline-block overflow-hidden">
      {isLoading && showSkeleton && (
        <div className={`absolute inset-0 bg-neutral-800/60 animate-pulse ${className}`} />
      )}
      <img
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
