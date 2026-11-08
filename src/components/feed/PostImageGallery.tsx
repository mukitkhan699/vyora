import React, { useState } from 'react';
import { CdnImage } from '../common/CdnImage.tsx';
import { ImageLightbox } from './ImageLightbox.tsx';

interface PostImageGalleryProps {
  images: string[];
}

export const PostImageGallery: React.FC<PostImageGalleryProps> = ({ images }) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const validImages = images.filter((img) => img && img.trim().length > 0);
  if (validImages.length === 0) return null;

  const handleImageClick = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setLightboxIndex(index);
  };

  const count = validImages.length;

  return (
    <>
      <div className="mb-3 rounded-2xl overflow-hidden border border-white/10 select-none">
        {/* 1 Image: Full-width natural height with max-h-96 */}
        {count === 1 && (
          <div
            onClick={(e) => handleImageClick(e, 0)}
            className="w-full max-h-96 bg-neutral-900/60 overflow-hidden cursor-pointer group flex items-center justify-center"
          >
            <CdnImage
              src={validImages[0]}
              alt="Post image"
              className="w-full h-full max-h-96 object-cover group-hover:scale-[1.01] transition-transform duration-200"
            />
          </div>
        )}

        {/* 2 Images: Equal 2-column grid */}
        {count === 2 && (
          <div className="grid grid-cols-2 gap-1.5 h-64 sm:h-72">
            {validImages.map((url, i) => (
              <div
                key={i}
                onClick={(e) => handleImageClick(e, i)}
                className="relative h-full bg-neutral-900/60 overflow-hidden cursor-pointer group"
              >
                <CdnImage
                  src={url}
                  alt={`Post image ${i + 1}`}
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                />
              </div>
            ))}
          </div>
        )}

        {/* 3 Images: 1 large on left, 2 stacked on right */}
        {count === 3 && (
          <div className="grid grid-cols-2 gap-1.5 h-64 sm:h-80">
            <div
              onClick={(e) => handleImageClick(e, 0)}
              className="relative h-full bg-neutral-900/60 overflow-hidden cursor-pointer group"
            >
              <CdnImage
                src={validImages[0]}
                alt="Post image 1"
                className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
              />
            </div>
            <div className="grid grid-rows-2 gap-1.5 h-full">
              {validImages.slice(1, 3).map((url, i) => (
                <div
                  key={i + 1}
                  onClick={(e) => handleImageClick(e, i + 1)}
                  className="relative h-full bg-neutral-900/60 overflow-hidden cursor-pointer group"
                >
                  <CdnImage
                    src={url}
                    alt={`Post image ${i + 2}`}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4 Images: 2x2 grid */}
        {count === 4 && (
          <div className="grid grid-cols-2 gap-1.5 h-64 sm:h-80">
            {validImages.map((url, i) => (
              <div
                key={i}
                onClick={(e) => handleImageClick(e, i)}
                className="relative h-32 sm:h-40 bg-neutral-900/60 overflow-hidden cursor-pointer group"
              >
                <CdnImage
                  src={url}
                  alt={`Post image ${i + 1}`}
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                />
              </div>
            ))}
          </div>
        )}

        {/* More than 4 Images: 2x2 grid with +N remaining overlay on 4th image */}
        {count > 4 && (
          <div className="grid grid-cols-2 gap-1.5 h-64 sm:h-80">
            {validImages.slice(0, 3).map((url, i) => (
              <div
                key={i}
                onClick={(e) => handleImageClick(e, i)}
                className="relative h-32 sm:h-40 bg-neutral-900/60 overflow-hidden cursor-pointer group"
              >
                <CdnImage
                  src={url}
                  alt={`Post image ${i + 1}`}
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                />
              </div>
            ))}

            <div
              onClick={(e) => handleImageClick(e, 3)}
              className="relative h-32 sm:h-40 bg-neutral-900/60 overflow-hidden cursor-pointer group"
            >
              <CdnImage
                src={validImages[3]}
                alt="Post image 4"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center text-white text-2xl font-black group-hover:bg-black/50 transition-colors">
                +{count - 3}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <ImageLightbox
          images={validImages}
          initialIndex={lightboxIndex}
          isOpen={lightboxIndex !== null}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
};
