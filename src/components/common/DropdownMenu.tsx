import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '../../context/ThemeContext.tsx';

export interface DropdownItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}

interface DropdownMenuProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
  className?: string;
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({
  trigger,
  items,
  align = 'right',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  const menuBg = theme === 'light'
    ? 'bg-white border-slate-200 shadow-xl'
    : 'bg-[#11151D] border-white/10 shadow-2xl';

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer">
        {trigger}
      </div>

      {isOpen && (
        <div
          role="menu"
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1.5 w-52 ${menuBg} border rounded-2xl p-1.5 z-40 animate-in fade-in zoom-in-95 duration-100 backdrop-blur-xl`}
        >
          {items.map((item) => (
            <button
              key={item.id}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                item.onClick();
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-semibold cursor-pointer transition-colors ${
                item.danger
                  ? 'text-rose-400 hover:bg-rose-500/10'
                  : theme === 'light'
                  ? 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  : 'text-neutral-300 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
