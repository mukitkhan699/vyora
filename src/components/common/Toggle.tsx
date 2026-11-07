import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  className = '',
  label,
}) => {
  return (
    <label className={`inline-flex items-center gap-3 cursor-pointer ${className}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-white/20 bg-black/40 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-[#060910] disabled:opacity-50 disabled:cursor-not-allowed ${checked ? 'bg-cyan-500 border-cyan-500' : ''}`}
      >
        <span className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform translate-x-0 ${checked ? 'translate-x-5' : ''}" />
      </button>
      {label && <span className="text-sm text-neutral-300">{label}</span>}
    </label>
  );
};