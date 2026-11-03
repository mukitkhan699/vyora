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
}

const ACCENT_MAP: Record<AccentColor, { hex: string; bg: string; text: string; border: string; glow: string }> = {
  cyan: { 
    hex: '#00f2fe', 
    bg: 'bg-[#00f2fe]', 
    text: 'text-[#00f2fe]', 
    border: 'border-[#00f2fe]',
    glow: 'shadow-[0_0_15px_rgba(0,242,254,0.4)]'
  },
  violet: { 
    hex: '#8b5cf6', 
    bg: 'bg-[#8b5cf6]', 
    text: 'text-[#8b5cf6]', 
    border: 'border-[#8b5cf6]',
    glow: 'shadow-[0_0_15px_rgba(139,92,246,0.4)]'
  },
  emerald: { 
    hex: '#00ff88', 
    bg: 'bg-[#00ff88]', 
    text: 'text-[#00ff88]', 
    border: 'border-[#00ff88]',
    glow: 'shadow-[0_0_15px_rgba(0,255,136,0.4)]'
  },
  amber: { 
    hex: '#ffb300', 
    bg: 'bg-[#ffb300]', 
    text: 'text-[#ffb300]', 
    border: 'border-[#ffb300]',
    glow: 'shadow-[0_0_15px_rgba(255,179,0,0.4)]'
  },
  coral: { 
    hex: '#ff3366', 
    bg: 'bg-[#ff3366]', 
    text: 'text-[#ff3366]', 
    border: 'border-[#ff3366]',
    glow: 'shadow-[0_0_15px_rgba(255,51,102,0.4)]'
  },
  blue: { 
    hex: '#1d9bf0', 
    bg: 'bg-[#1d9bf0]', 
    text: 'text-[#1d9bf0]', 
    border: 'border-[#1d9bf0]',
    glow: 'shadow-[0_0_15px_rgba(29,155,240,0.4)]'
  },
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem('telex_theme') as ThemeMode) || 'dark';
  });
  const [accent, setAccent] = useState<AccentColor>(() => {
    return (localStorage.getItem('telex_accent') as AccentColor) || 'cyan';
  });

  useEffect(() => {
    localStorage.setItem('telex_theme', theme);
    const root = document.documentElement;
    const body = document.body;

    root.classList.remove('theme-dark', 'theme-dim', 'theme-light');
    root.classList.add(`theme-${theme}`);

    if (theme === 'dark') {
      body.style.backgroundColor = '#080b11';
      body.style.color = '#e1e7ec';
    } else if (theme === 'dim') {
      body.style.backgroundColor = '#0f172a';
      body.style.color = '#f1f5f9';
    } else {
      body.style.backgroundColor = '#f8fafc';
      body.style.color = '#0f172a';
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('telex_accent', accent);
  }, [accent]);

  const accentInfo = ACCENT_MAP[accent] || ACCENT_MAP.cyan;

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
