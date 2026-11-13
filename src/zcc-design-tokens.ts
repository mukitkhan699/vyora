// ZUNARI CONTROL CENTER — COMPLETE DESIGN TOKENS
// Faithful restoration of original MiniMax prototype design tokens
// Layer 1: Framework-agnostic design tokens for the admin interface

export const zccDesignTokens = {
  // Colors (matching original prototype naming convention)
  colors: {
    // Cyan ramp — matches the existing Zunari admin accent (#48D8E8)
    cyan: {
      50: '#ECFCFF',
      100: '#CFF8FE',
      200: '#A5F0FA',
      300: '#74E4F4',
      400: '#48D8E8',
      500: '#1FB6C9',
      600: '#0E8FA4',
      700: '#0B6E82',
      800: '#0A5567',
      900: '#083F4D',
    },

    // Violet ramp — secondary brand / AI Intelligence identity
    violet: {
      50: '#F4F1FF',
      100: '#EAE4FF',
      200: '#D6CBFF',
      300: '#BBA6FF',
      400: '#A085FA',
      500: '#8B75FF',
      600: '#6D4AFF',
      700: '#5433D6',
      800: '#3F26A3',
      900: '#2B1980',
    },

    // Status colors
    green: {
      400: '#34D399',
      600: '#059669',
    },
    amber: {
      400: '#FBBF24',
      600: '#D97706',
    },
    red: {
      400: '#F87171',
      600: '#DC2626',
    },
    blue: {
      400: '#60A5FA',
      600: '#2563EB',
    },
    pink: {
      400: '#F472B6',
    },
    teal: {
      400: '#2DD4BF',
    },

    // Neutral colors
    neutral: {
      50: '#F9FAFB',
      100: '#F3F4F6',
      200: '#E5E7EB',
      300: '#D1D5DB',
      400: '#9CA3AF',
      500: '#6B7280',
      600: '#4B5563',
      700: '#374151',
      800: '#1F2937',
      900: '#111827',
      950: '#030712',
    },
  },

  // Semantic tokens derived from the prototype
  semantic: {
    // Dark theme (default for ZCC)
    dark: {
      // Surfaces
      bg: {
        primary: '#060910',
        secondary: '#0B1018',
        tertiary: '#080C14',
        elevated: '#111823',
        inverse: '#F4F6FA',
      },

      // Text
      text: {
        primary: '#F4F6FA',
        secondary: '#A7AFBD',
        muted: '#6C7787',
        faint: '#4A5361',
        accent: '#48D8E8',
        accent2: '#8B75FF',
        inverse: '#0B1220',
      },

      // Borders
      border: {
        subtle: 'rgba(255, 1255, 255, 0.08)',
        default: 'rgba(255, 255, 255, 0.11)',
        strong: 'rgba(255, 255, 255, 0.18)',
        accent: 'rgba(72, 216, 232, 0.42)',
      },

      // Brand accents
      accent: '#48D8E8',
      accentHover: '#74E4F4',
      accentActive: '#1FB6C9',
      accentContrast: '#04161A',
      accentSoft: 'rgba(72, 216, 232, 0.12)',
      accentSoftStrong: 'rgba(72, 216, 232, 0.20)',
      accentBorder: 'rgba(72, 216, 232, 0.34)',
      accentGlow: 'rgba(72, 216, 232, 0.28)',

      accent2: '#8B75FF',
      accent2Hover: '#A085FA',
      accent2Contrast: '#12082E',
      accent2Soft: 'rgba(139, 117, 255, 0.14)',
      accent2Border: 'rgba(139, 117, 255, 0.34)',

      // Status colors
      success: '#34D399',
      successText: '#6EE7B7',
      successSoft: 'rgba(52, 211, 153, 0.12)',
      successBorder: 'rgba(52, 211, 153, 0.30)',
      successFg: '#052E20',

      warning: '#FBBF24',
      warningText: '#FCD34D',
      warningSoft: 'rgba(251, 191, 36, 0.12)',
      warningBorder: 'rgba(251, 191, 36,18)',
      warningFg: '#2A1C02',

      danger: '#F87171',
      dangerText: '#FCA5A5',
      dangerSoft: 'rgba(248, 113, 113, 0.12)',
      dangerBorder: 'rgba(248, 113, 113, 0.32)',
      dangerFg: '#2E0808',

      info: '#60A5FA',
      infoText: '#93C5FD',
      infoSoft: 'rgba(96, 165, 250, 0.12)',
      infoBorder: 'rgba(96, 165, 250, 0.30)',
      infoFg: '#06182F',

      neutralText: '#A7AFBD',
      neutralSoft: 'rgba(255, 255, 255, 0.07)',
      neutralBorder: 'rgba(255, 255, 255, 0.12)',
    },

    // Charts (for ZCC charts)
    chart: {
      grid: 'rgba(255, 255, 255, 0.06)',
      axis: 'rgba(255, 255, 255, 0.22)',
      series1: '#48D8E8',
      series2: '#8B75FF',
      series3: '#2DD4BF',
      series4: '#FBBF24',
      series5: '#F472B6',
      series6: '#60A5FA',
      area1: 'rgba(72, 216, 232, 0.22)',
      area2: 'rgba(139, 117, 255, 0.22)',
    },

    // Shadows
    shadow: {
      xs: '0 1px 2px rgba(0, 0, 0, 0.40)',
      sm: '0 1px 3px rgba(0, 0, 0, 0.44), 0 1px 2px rgba(0, 0, 0, 0.30)',
      md: '0 6px 16px -6px rgba(0, 0, 0, 0.58), 0 2px 6px -2px rgba(0, 0, 0, 0.40)',
    },

    // Sidebar
    sidebar: {
      width: '264px',
      collapsedWidth: '76px',
    },

    // Header
    header: {
      height: '60px',
    },

    // Content max width
    contentMax: '1560px',
  },

  // Font families (matching original prototype)
  font: {
    family: {
      sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    },
    size: {
      xs: '10px',
      sm: '12px',
      base: '14px',
      lg: '16px',
      xl: '18px',
      '2xl': '20px',
      '3xl': '24px',
      '4xl': '32px',
      '5xl': '40px',
    },
    weight: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
    lineHeight: {
      tight: '1.25',
      normal: '1.5',
      relaxed: '1.75',
    },
  },

  // Border radius (matching original prototype)
  radius: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    '2xl': '20px',
    pill: '999px',
  },

  // Spacing scale (matching original prototype)
  spacing: {
    '0': '0px',
    '1': '2px',
    '2': '4px',
    '3': '6px',
    '4': '8px',
    '5': '10px',
    '6': '12px',
    '7': '16px',
    '8': '20px',
    '9': '24px',
    '10': '32px',
    '11': '40px',
    '12': '48px',
    '13': '64px',
  },

  // Motion system (matching original prototype)
  motion: {
    fast: '120ms',
    base: '160ms',
    slow: '240ms',
    slower: '320ms',
    ease: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    emphasized: 'cubic-bezier(0.22, 0.8, 0.24, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
  },

  // Z-index system (matching original prototype)
  zIndex: {
    base: '1',
    sticky: '20',
    drawer: '40',
    modal: '60',
    toast: '80',
    tooltip: '90',
  },
};

export type ZCCColors = typeof zccDesignTokens.colors;
export type ZCCSpacing = typeof zccDesignTokens.spacing;
export type ZCCFont = typeof zccDesignTokens.font;
export type ZCCMotion = typeof zccDesignTokens.motion;
export type ZCCZIndex = typeof zccDesignTokens.zIndex;
export type ZCCSidebar = typeof zccDesignTokens.sidebar;
export type ZCCHeader = typeof zccDesignTokens.header;
export type ZCCContentMax = typeof zccDesignTokens.contentMax;
export type ZCCChart = typeof zccDesignTokens.chart;
export type ZCCShadow = typeof zccDesignTokens.shadow;
