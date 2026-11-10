import { useCallback, useRef, useState } from 'react';

interface UseLongPressOptions {
  delay?: number;
  threshold?: number;
  onLongPress?: () => void;
  onCancel?: () => void;
}

export function useLongPress({
  delay = 450,
  threshold = 8,
  onLongPress,
  onCancel,
}: UseLongPressOptions = {}) {
  const [isPressed, setIsPressed] = useState(false);
  const [isLongPressTriggered, setIsLongPressTriggered] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const startCoordsRef = useRef<{ x: number; y: number } | null>(null);
  const cancelledRef = useRef(false);

  const clear = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clear();
    if (isPressed && !isLongPressTriggered) {
      setIsPressed(false);
      cancelledRef.current = true;
      onCancel?.();
    }
    setIsLongPressTriggered(false);
  }, [clear, isPressed, isLongPressTriggered, onCancel]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0 && event.type !== 'touchstart') return;

      cancelledRef.current = false;
      startCoordsRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
      setIsPressed(true);
      setIsLongPressTriggered(false);

      timeoutRef.current = window.setTimeout(() => {
        if (!cancelledRef.current) {
          setIsLongPressTriggered(true);
          setIsPressed(false);
          onLongPress?.();
        }
      }, delay);
    },
    [delay, onLongPress]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!isPressed || isLongPressTriggered || cancelledRef.current) return;
      if (!startCoordsRef.current) return;

      const dx = Math.abs(event.clientX - startCoordsRef.current.x);
      const dy = Math.abs(event.clientY - startCoordsRef.current.y);
      if (dx > threshold || dy > threshold) {
        cancel();
      }
    },
    [isPressed, isLongPressTriggered, cancel, threshold]
  );

  const handlePointerUp = useCallback(() => {
    if (isPressed && !isLongPressTriggered) {
      setIsPressed(false);
    }
    clear();
  }, [isPressed, isLongPressTriggered, clear]);

  const handlePointerLeave = useCallback(() => {
    cancel();
  }, [cancel]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (isLongPressTriggered) {
        event.preventDefault();
      }
    },
    [isLongPressTriggered]
  );

  return {
    isPressed,
    isLongPressTriggered,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerLeave: handlePointerLeave,
      onPointerCancel: handlePointerLeave,
      onContextMenu: handleContextMenu,
    },
  };
}