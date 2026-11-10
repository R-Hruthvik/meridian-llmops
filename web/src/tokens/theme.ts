/**
 * Meridian design tokens.
 *
 * All colour values are RGB channel triplets (no `#`) so Tailwind's opacity
 * modifier expands to `rgb(var(--x) / <alpha-value>)`. Named presets map the
 * same token keys to alternate palettes.
 */

export type ThemeName =
  | 'default'
  | 'ceramic-concrete'
  | 'cold-titanium'
  | 'analog-soot';

export interface ThemeTokens {
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentInk: string;
  accentWash: string;
}

// Default palette
const rawPaper = '247 245 240';      // #F7F5F0
const deepCarbonInk = '20 22 24';    // #141618
const warmStone = '214 208 196';     // #D6D0C4
const slateMineral = '123 130 122';  // #7B827A
const cobaltFlow = '37 99 235';      // #2563EB

export const DEFAULT_THEME: ThemeTokens = {
  surface: rawPaper,
  surfaceRaised: '255 254 250',
  surfaceSunken: '237 233 224',
  border: warmStone,
  borderStrong: '193 188 176',
  text: deepCarbonInk,
  textMuted: '98 108 101',
  textFaint: slateMineral,
  accent: cobaltFlow,
  accentInk: '30 77 190',
  accentWash: '229 238 252',
};

export const PRESETS: Record<ThemeName, ThemeTokens> = {
  default: DEFAULT_THEME,
  'ceramic-concrete': {
    surface: '240 238 234',
    surfaceRaised: '250 249 247',
    surfaceSunken: '230 228 224',
    border: '190 186 180',
    borderStrong: '150 146 140',
    text: '45 42 38',
    textMuted: '110 105 100',
    textFaint: '160 155 150',
    accent: '120 120 120',
    accentInk: '80 80 80',
    accentWash: '232 230 227',
  },
  'cold-titanium': {
    surface: '236 240 243',
    surfaceRaised: '248 251 253',
    surfaceSunken: '226 231 234',
    border: '185 193 198',
    borderStrong: '140 150 156',
    text: '28 36 42',
    textMuted: '90 100 108',
    textFaint: '145 155 162',
    accent: cobaltFlow,
    accentInk: '30 77 190',
    accentWash: '224 235 250',
  },
  'analog-soot': {
    surface: '14 16 18',
    surfaceRaised: '20 22 24',
    surfaceSunken: '24 27 30',
    border: '70 72 74',
    borderStrong: '110 112 114',
    text: rawPaper,
    textMuted: '190 185 180',
    textFaint: '115 112 110',
    accent: cobaltFlow,
    accentInk: '100 150 240',
    accentWash: '30 35 40',
  },
};

export function theme(name: ThemeName = 'default'): ThemeTokens {
  return PRESETS[name];
}
