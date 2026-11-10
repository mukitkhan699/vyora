import { useState, useEffect } from 'react';

export function useKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      const viewport = window.visualViewport;
      if (!viewport) {
        setKeyboardHeight(0);
        return;
      }
      const height = window.innerHeight - viewport.height;
      setKeyboardHeight(Math.max(0, height));
    };

    const viewport = window.visualViewport;
    if (viewport) {
      viewport.addEventListener('resize', handleResize);
      viewport.addEventListener('scroll', handleResize);
      handleResize();
    } else {
      window.addEventListener('resize', handleResize);
      handleResize();
    }

    return () => {
      if (viewport) {
        viewport.removeEventListener('resize', handleResize);
        viewport.removeEventListener('scroll', handleResize);
      } else {
        window.removeEventListener('resize', handleResize);
      }
    };
  }, []);

  return keyboardHeight;
}

export function useKeyboardOpen(threshold = 150): boolean {
  const height = useKeyboardHeight();
  return height > threshold;
}