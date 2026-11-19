export function openImageViewer(
  event: { stopPropagation: () => void },
  index: number,
  open: (index: number) => void,
): void {
  event.stopPropagation();
  open(index);
}

export function handleImageViewerOverlayClick(
  event: { target: unknown; currentTarget: unknown; stopPropagation: () => void },
  close: () => void,
): void {
  event.stopPropagation();
  if (event.target === event.currentTarget) close();
}
