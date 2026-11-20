import React, { useLayoutEffect, useRef, useState } from 'react';

interface ExpandablePostTextProps {
  text: string;
  children: React.ReactNode;
  lineCount?: number;
  className?: string;
}

export const ExpandablePostText: React.FC<ExpandablePostTextProps> = ({
  text,
  children,
  lineCount = 5,
  className = '',
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const previousText = useRef(text);
  const [expanded, setExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const textChanged = previousText.current !== text;
    if (textChanged) {
      previousText.current = text;
      setExpanded(false);
      setHasOverflow(false);
    }

    const measureOverflow = () => {
      const overflows = content.scrollHeight > content.clientHeight + 1;
      setHasOverflow((previous) => !textChanged && expanded ? previous || overflows : overflows);
    };

    measureOverflow();
    if (typeof ResizeObserver === 'undefined') return;
    const resizeObserver = new ResizeObserver(measureOverflow);
    resizeObserver.observe(content);
    return () => resizeObserver.disconnect();
  }, [expanded, lineCount, text]);

  return (
    <div className={`min-w-0 ${className}`}>
      <div
        ref={contentRef}
        data-preview-lines={lineCount}
        className={`post-text-preview${expanded ? '' : ' is-collapsed'}`}
      >
        {children}
      </div>
      {hasOverflow && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
          className="mt-1 text-sm font-medium text-cyan-400 hover:text-cyan-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  );
};
