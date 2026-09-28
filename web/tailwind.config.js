/** @type {import('tailwindcss').Config} */

// Legacy Tailwind scales that the redesign retires (§10). They are remapped onto
// the instrument neutrals so any component that has not been migrated yet reads
// grey rather than violet. Use the semantic tokens instead.
const DE_VIOLET = {
  50: 'var(--surface-sunken)',
  100: 'var(--surface-sunken)',
  200: 'var(--border)',
  300: 'var(--border-strong)',
  400: 'var(--text-faint)',
  500: 'var(--text-muted)',
  600: 'var(--text-muted)',
  700: 'var(--text)',
  800: 'var(--text)',
  900: 'var(--text)',
  950: 'var(--text)',
}

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // §4 palette
        surface: {
          DEFAULT: 'var(--surface)',
          raised: 'var(--surface-raised)',
          sunken: 'var(--surface-sunken)',
        },
        hairline: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        ink: 'var(--text)',
        muted: 'var(--text-muted)',
        faint: 'var(--text-faint)',
        accent: {
          DEFAULT: 'var(--accent)',
          ink: 'var(--accent-ink)',
          wash: 'var(--accent-wash)',
        },
        ok: { DEFAULT: 'var(--ok)', wash: 'var(--ok-wash)' },
        warn: { DEFAULT: 'var(--warn)', wash: 'var(--warn-wash)' },
        fail: { DEFAULT: 'var(--fail)', wash: 'var(--fail-wash)' },

        // §6 width band for the shared overlay shell (520–680px).
        'overlay-w': '600px',

        // Bridge: the pre-redesign `meridian` scale, repointed at the instrument
        // tokens so unmigrated components stop resolving to purple.
        meridian: {
          primary: 'var(--accent-ink)',
          primaryHover: 'var(--accent)',
          secondary: 'var(--border-strong)',
          lavender: 'var(--border-strong)',
          lavenderLight: 'var(--surface-sunken)',
          blossom: 'var(--accent-wash)',
          blossomLight: 'var(--accent-wash)',
          bg: 'var(--surface)',
          canvas: 'var(--surface-sunken)',
          card: 'var(--surface-raised)',
          cardHover: 'var(--surface-sunken)',
          border: 'var(--border)',
          borderLight: 'var(--border)',
          text: 'var(--text)',
          textMuted: 'var(--text-muted)',
        },

        // Retired hue scales (§10) — flattened to instrument neutrals.
        purple: DE_VIOLET,
        indigo: DE_VIOLET,
        rose: DE_VIOLET,
        violet: DE_VIOLET,
        fuchsia: DE_VIOLET,
        lavender: DE_VIOLET,
        blossom: DE_VIOLET,
      },
      fontFamily: {
        sans: [
          'Geist',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'Geist Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        // §5 type scale
        micro: ['11px', { lineHeight: '1.45' }],
        label: ['11px', { lineHeight: '1.3' }],
        id: ['12px', { lineHeight: '1.5' }],
        body: ['14px', { lineHeight: '1.65' }],
        verdict: ['13px', { lineHeight: '1.3' }],
        readout: ['15px', { lineHeight: '1.4' }],
        display: ['28px', { lineHeight: '1.15' }],
      },
      borderRadius: {
        // §9 6px flat, 4px for inputs and wells, full-pill for status chips.
        DEFAULT: '6px',
        sm: '4px',
        pill: '9999px',
      },
      boxShadow: {
        // §9 shadows removed except overlays.
        overlay: '0 12px 32px rgba(22,21,15,.10)',
      },
    },
  },
  plugins: [],
}
