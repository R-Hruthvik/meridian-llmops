/** @type {import('tailwindcss').Config} */

/**
 * Meridian — Tailwind theme.
 *
 * Every color resolves to a CSS custom property declared in
 * `src/styles/tokens.css`, so `.dark` on <html> repaints without a rebuild.
 * RGB triplets + `<alpha-value>` enable opacity modifiers (`bg-accent/10`).
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}', './tests/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--bg-canvas-rgb) / <alpha-value>)',
        elevated: 'rgb(var(--bg-elevated-rgb) / <alpha-value>)',
        subtle: 'rgb(var(--bg-subtle-rgb) / <alpha-value>)',
        hairline: 'rgb(var(--border-hairline-rgb) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--text-primary-rgb) / <alpha-value>)',
          muted: 'rgb(var(--text-muted-rgb) / <alpha-value>)',
          faint: 'var(--text-faint)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          soft: 'var(--accent-soft)',
          hover: 'var(--accent-hover)',
          contrast: 'var(--accent-contrast)',
        },
        ok: {
          DEFAULT: 'rgb(var(--ok-rgb) / <alpha-value>)',
          soft: 'var(--ok-soft)',
          ink: 'rgb(var(--ok-ink-rgb) / <alpha-value>)',
        },
        warn: {
          DEFAULT: 'rgb(var(--warn-rgb) / <alpha-value>)',
          soft: 'var(--warn-soft)',
          ink: 'rgb(var(--warn-ink-rgb) / <alpha-value>)',
        },
        fail: {
          DEFAULT: 'rgb(var(--fail-rgb) / <alpha-value>)',
          soft: 'var(--fail-soft)',
          ink: 'rgb(var(--fail-ink-rgb) / <alpha-value>)',
        },
        neutral: {
          DEFAULT: 'rgb(var(--neutral-rgb) / <alpha-value>)',
          soft: 'var(--neutral-soft)',
          ink: 'rgb(var(--neutral-ink-rgb) / <alpha-value>)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        hairline: 'var(--shadow-hairline)',
        card: 'var(--shadow-card)',
        dock: 'var(--shadow-dock)',
        palette: 'var(--shadow-palette)',
      },
      maxWidth: {
        shell: 'var(--shell-max-width)',
      },
      fontFamily: {
        sans: [
          'Inter var',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'JetBrains Mono', 'monospace'],
      },
      backgroundImage: {
        'sheen-line':
          'linear-gradient(180deg, var(--glass-sheen) 0%, transparent 100%)',
      },
    },
  },
  plugins: [],
}
