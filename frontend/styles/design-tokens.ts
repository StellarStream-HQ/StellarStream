/**
 * Design Tokens
 * Central source of truth for all design values in the StellarStream frontend
 * Organized by category for easy reference and maintenance
 */

export const DESIGN_TOKENS = {
  // ─────────────────────────────────────────────────────────────
  // Colors
  // ─────────────────────────────────────────────────────────────
  colors: {
    // Primary - main brand color
    primary: {
      50: '#f0f9ff',
      100: '#e0f2fe',
      200: '#bae6fd',
      300: '#7dd3fc',
      400: '#38bdf8',
      500: '#0ea5e9',
      600: '#0284c7',
      700: '#0369a1',
      800: '#075985',
      900: '#0c3d66',
    },
    // Secondary - accent color
    secondary: {
      50: '#f5f3ff',
      100: '#ede9fe',
      200: '#ddd6fe',
      300: '#c4b5fd',
      400: '#a78bfa',
      500: '#8b5cf6',
      600: '#7c3aed',
      700: '#6d28d9',
      800: '#5b21b6',
      900: '#4c1d95',
    },
    // Success
    success: {
      50: '#f0fdf4',
      100: '#dcfce7',
      200: '#bbf7d0',
      300: '#86efac',
      400: '#4ade80',
      500: '#22c55e',
      600: '#16a34a',
      700: '#15803d',
      800: '#166534',
      900: '#145231',
    },
    // Warning
    warning: {
      50: '#fffbeb',
      100: '#fef3c7',
      200: '#fde68a',
      300: '#fcd34d',
      400: '#fbbf24',
      500: '#f59e0b',
      600: '#d97706',
      700: '#b45309',
      800: '#92400e',
      900: '#78350f',
    },
    // Error
    error: {
      50: '#fef2f2',
      100: '#fee2e2',
      200: '#fecaca',
      300: '#fca5a5',
      400: '#f87171',
      500: '#ef4444',
      600: '#dc2626',
      700: '#b91c1c',
      800: '#991b1b',
      900: '#7f1d1d',
    },
    // Neutral - grays
    neutral: {
      50: '#fafafa',
      100: '#f5f5f5',
      200: '#eeeeee',
      300: '#e0e0e0',
      400: '#bdbdbd',
      500: '#9e9e9e',
      600: '#757575',
      700: '#616161',
      800: '#424242',
      900: '#212121',
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Spacing
  // ─────────────────────────────────────────────────────────────
  spacing: {
    xs: '0.25rem', // 4px
    sm: '0.5rem', // 8px
    md: '1rem', // 16px
    lg: '1.5rem', // 24px
    xl: '2rem', // 32px
    '2xl': '2.5rem', // 40px
    '3xl': '3rem', // 48px
  },

  // ─────────────────────────────────────────────────────────────
  // Typography
  // ─────────────────────────────────────────────────────────────
  typography: {
    // Headings
    h1: {
      fontSize: '2.5rem', // 40px
      fontWeight: 700,
      lineHeight: '3rem',
      letterSpacing: '-0.02em',
    },
    h2: {
      fontSize: '2rem', // 32px
      fontWeight: 700,
      lineHeight: '2.5rem',
      letterSpacing: '-0.02em',
    },
    h3: {
      fontSize: '1.5rem', // 24px
      fontWeight: 600,
      lineHeight: '2rem',
      letterSpacing: '-0.01em',
    },
    h4: {
      fontSize: '1.25rem', // 20px
      fontWeight: 600,
      lineHeight: '1.75rem',
    },
    // Body
    body: {
      lg: {
        fontSize: '1.125rem', // 18px
        fontWeight: 400,
        lineHeight: '1.75rem',
      },
      md: {
        fontSize: '1rem', // 16px
        fontWeight: 400,
        lineHeight: '1.5rem',
      },
      sm: {
        fontSize: '0.875rem', // 14px
        fontWeight: 400,
        lineHeight: '1.25rem',
      },
      xs: {
        fontSize: '0.75rem', // 12px
        fontWeight: 400,
        lineHeight: '1rem',
      },
    },
    // Caption
    caption: {
      fontSize: '0.75rem', // 12px
      fontWeight: 500,
      lineHeight: '1rem',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Border Radius
  // ─────────────────────────────────────────────────────────────
  borderRadius: {
    none: '0',
    xs: '0.25rem', // 4px
    sm: '0.375rem', // 6px
    md: '0.5rem', // 8px
    lg: '0.75rem', // 12px
    xl: '1rem', // 16px
    '2xl': '1.5rem', // 24px
    full: '9999px',
  },

  // ─────────────────────────────────────────────────────────────
  // Shadows
  // ─────────────────────────────────────────────────────────────
  shadows: {
    none: 'none',
    xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
  },

  // ─────────────────────────────────────────────────────────────
  // Z-Index Scale
  // ─────────────────────────────────────────────────────────────
  zIndex: {
    base: 0,
    dropdown: 1000,
    sticky: 1100,
    fixed: 1200,
    modalBackdrop: 1300,
    modal: 1400,
    popover: 1500,
    tooltip: 1600,
  },

  // ─────────────────────────────────────────────────────────────
  // Transitions & Animations
  // ─────────────────────────────────────────────────────────────
  transitions: {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    base: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
    slower: '500ms cubic-bezier(0.4, 0, 0.2, 1)',
  },

  // ─────────────────────────────────────────────────────────────
  // Breakpoints
  // ─────────────────────────────────────────────────────────────
  breakpoints: {
    xs: '320px',
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
  },
} as const;

// ─────────────────────────────────────────────────────────────
// CSS Variable Generators
// ─────────────────────────────────────────────────────────────
export const generateCSSVariables = () => {
  const variables: Record<string, string> = {};

  // Colors
  Object.entries(DESIGN_TOKENS.colors).forEach(([category, shades]) => {
    if (typeof shades === 'object') {
      Object.entries(shades).forEach(([shade, value]) => {
        variables[`--color-${category}-${shade}`] = value;
      });
    }
  });

  // Spacing
  Object.entries(DESIGN_TOKENS.spacing).forEach(([key, value]) => {
    variables[`--spacing-${key}`] = value;
  });

  // Border radius
  Object.entries(DESIGN_TOKENS.borderRadius).forEach(([key, value]) => {
    variables[`--radius-${key}`] = value;
  });

  // Shadows
  Object.entries(DESIGN_TOKENS.shadows).forEach(([key, value]) => {
    variables[`--shadow-${key}`] = value;
  });

  return variables;
};

// ─────────────────────────────────────────────────────────────
// Type Exports
// ─────────────────────────────────────────────────────────────
export type ColorKey = keyof typeof DESIGN_TOKENS.colors;
export type ColorShade = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
export type SpacingKey = keyof typeof DESIGN_TOKENS.spacing;
export type ZIndexKey = keyof typeof DESIGN_TOKENS.zIndex;
export type BreakpointKey = keyof typeof DESIGN_TOKENS.breakpoints;
