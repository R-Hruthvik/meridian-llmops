/** @type {import('tailwindcss').Config} */

/**
 * Wrap an instrument token so Tailwind's opacity modifier works.
 * `<alpha-value>` is substituted with the `/NN` value, producing
 * `rgb(var(--fail) / 0.3)`. The tokens in index.css are channel triplets for
 * exactly this reason — a bare `var(--fail)` would expand to the invalid
 * `var(--fail)/0.3` and the rule would be dropped without warning.
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

// Legacy Tailwind scales that the redesign retires (§10). They are remapped onto
// the instrument neutrals so any component that has not been migrated yet reads
// grey rather than violet. Use the semantic tokens instead.
const DE_VIOLET = {
  50: token('surface-sunken'),
  100: token('surface-sunken'),
  200: token('border'),
  300: token('border-strong'),
  400: token('text-faint'),
  500: token('text-muted'),
  600: token('text-muted'),
  700: token('text'),
  800: token('text'),
  900: token('text'),
  950: token('text'),
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
          DEFAULT: token('surface'),
          raised: token('surface-raised'),
          sunken: token('surface-sunken'),
        },
        hairline: {
          DEFAULT: token('border'),
          strong: token('border-strong'),
        },
        ink: token('text'),
        muted: token('text-muted'),
        faint: token('text-faint'),
        accent: {
          DEFAULT: token('accent'),
          ink: token('accent-ink'),
          wash: token('accent-wash'),
        },
        ok: { DEFAULT: token('ok'), wash: token('ok-wash') },
        warn: { DEFAULT: token('warn'), wash: token('warn-wash') },
        fail: { DEFAULT: token('fail'), wash: token('fail-wash') },

        // §6 width band for the shared overlay shell (520–680px).
        'overlay-w': '600px',

        // Bridge: the pre-redesign `meridian` scale, repointed at the instrument
        // tokens so unmigrated components stop resolving to purple.
        meridian: {
          primary: token('accent-ink'),
          primaryHover: token('accent'),
          secondary: token('border-strong'),
          lavender: token('border-strong'),
          lavenderLight: token('surface-sunken'),
          blossom: token('accent-wash'),
          blossomLight: token('accent-wash'),
          bg: token('surface'),
          canvas: token('surface-sunken'),
          card: token('surface-raised'),
          cardHover: token('surface-sunken'),
          border: token('border'),
          borderLight: token('border'),
          text: token('text'),
          textMuted: token('text-muted'),
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
