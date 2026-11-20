import React, { useEffect, useRef } from 'react';

interface QelariViewProps {
  accountId: string;
  onExit: () => void;
}

export const QelariView: React.FC<QelariViewProps> = ({ accountId, onExit }) => {
  const iframe = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.source === iframe.current?.contentWindow &&
        event.data?.type === 'qelari:exit'
      ) onExit();
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onExit]);

  return (
    <iframe
      ref={iframe}
      key={accountId}
      title="Qelari AI workspace"
      src="/qelari/index.html"
      className="block h-[100dvh] w-full border-0 bg-[#08090c]"
      referrerPolicy="same-origin"
    />
  );
};
