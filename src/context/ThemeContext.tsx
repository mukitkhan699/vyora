import React, { createContext, useContext, useState, useEffect } from 'react';

export type ThemeMode = 'dark' | 'dim' | 'light';
export type AccentColor = 'cyan' | 'violet' | 'amber' | 'emerald' | 'coral' | 'blue';

interface ThemeContextType {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
  accentHex: string;
  accentBgClass: string;
  accentTextClass: string;
  accentBorderClass: string;
  accentGlowClass: string;
  isDark: boolean;
}

const ACCENT_MAP: Record<AccentColor, { hex: string; bg: string; text: string; border: string; glow: string }> = {
  cyan: { 
    hex: '#48D8E8',
    bg: 'bg-[#48D8E8]',
    text: 'text-[#48D8E8]',
    border: 'border-[#48D8E8]',
    glow: 'shadow-[0_0_16px_rgba(72,216,232,0.35)]'
  },
  violet: { 
    hex: '#8B75FF',
    bg: 'bg-[#8B75FF]',
    text: 'text-[#8B75FF]',
    border: 'border-[#8B75FF]',
    glow: 'shadow-[0_0_16px_rgba(139,117,255,0.35)]'
  },
  emerald: { 
    hex: '#10B981',
    bg: 'bg-[#10B981]',
    text: 'text-[#10B981]',
    border: 'border-[#10B981]',
    glow: 'shadow-[0_0_16px_rgba(16,185,129,0.35)]'
  },
  amber: { 
    hex: '#F59E0B',
    bg: 'bg-[#F59E0B]',
    text: 'text-[#F59E0B]',
    border: 'border-[#F59E0B]',
    glow: 'shadow-[0_0_16px_rgba(245,158,11,0.35)]'
  },
  coral: { 
    hex: '#F43F5E',
    bg: 'bg-[#F43F5E]',
    text: 'text-[#F43F5E]',
    border: 'border-[#F43F5E]',
    glow: 'shadow-[0_0_16px_rgba(244,63,94,0.35)]'
  },
  blue: { 
    hex: '#3B82F6',
    bg: 'bg-[#3B82F6]',
    text: 'text-[#3B82F6]',
    border: 'border-[#3B82F6]',
    glow: 'shadow-[0_0_16px_rgba(59,130,246,0.35)]'
  },
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem('vyora_theme') as ThemeMode) ||
           (localStorage.getItem('telex_theme') as ThemeMode) ||
           'dark';
  });
  const [accent, setAccent] = useState<AccentColor>(() => {
    return (localStorage.getItem('vyora_accent') as AccentColor) ||
           (localStorage.getItem('telex_accent') as AccentColor) ||
           'cyan';
  });

  useEffect(() => {
    localStorage.setItem('vyora_theme', theme);
    const root = document.documentElement;
    const body = document.body;

    root.classList.remove('theme-dark', 'theme-dim', 'theme-light');
    root.classList.add(`theme-${theme}`);

    if (theme === 'dark') {
      body.style.backgroundColor = '#090B10';
      body.style.color = '#F4F6FA';
    } else if (theme === 'dim') {
      body.style.backgroundColor = '#0F172A';
      body.style.color = '#F8FAFC';
    } else {
      body.style.backgroundColor = '#F8FAFC';
      body.style.color = '#0F172A';
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('vyora_accent', accent);
  }, [accent]);

  const accentInfo = ACCENT_MAP[accent] || ACCENT_MAP.cyan;
  const isDark = theme === 'dark' || theme === 'dim';

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        accent,
        setAccent,
        accentHex: accentInfo.hex,
        accentBgClass: accentInfo.bg,
        accentTextClass: accentInfo.text,
        accentBorderClass: accentInfo.border,
        accentGlowClass: accentInfo.glow,
        isDark,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};
