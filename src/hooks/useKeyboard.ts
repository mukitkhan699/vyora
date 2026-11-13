import { useState, useEffect } from 'react';

export function useKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const viewport = window.visualViewport;
    let baselineHeight = viewport?.height ?? window.innerHeight;
    let baselineWidth = window.innerWidth;
    let orientationFrame = 0;
    let orientationResizePending = false;

    const handleResize = () => {
      const currentViewport = window.visualViewport;
      const currentHeight = currentViewport?.height ?? window.innerHeight;

      if (Math.abs(window.innerWidth - baselineWidth) > 1) {
        baselineWidth = window.innerWidth;
        orientationResizePending = true;
        setKeyboardHeight(0);
        if (orientationFrame) window.cancelAnimationFrame(orientationFrame);
        orientationFrame = window.requestAnimationFrame(() => {
          baselineHeight = window.visualViewport?.height ?? window.innerHeight;
          orientationResizePending = false;
          orientationFrame = 0;
          setKeyboardHeight(0);
        });
        return;
      }
      if (orientationResizePending) return;

      baselineHeight = Math.max(baselineHeight, currentHeight);
      setKeyboardHeight(
        Math.max(0, baselineHeight - currentHeight, window.innerHeight - currentHeight),
      );
    };

    window.addEventListener('resize', handleResize);
    if (viewport) {
      viewport.addEventListener('resize', handleResize);
      viewport.addEventListener('scroll', handleResize);
    }
    handleResize();

    return () => {
      if (orientationFrame) window.cancelAnimationFrame(orientationFrame);
      window.removeEventListener('resize', handleResize);
      if (viewport) {
        viewport.removeEventListener('resize', handleResize);
        viewport.removeEventListener('scroll', handleResize);
      }
    };
  }, []);

  return keyboardHeight;
}

export function useKeyboardOpen(threshold = 150): boolean {
  const height = useKeyboardHeight();
  return height > threshold;
}