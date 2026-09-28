/**
 * Colour-utility correctness for the instrument tokens.
 *
 * Why this test exists: Tailwind's opacity modifier (`/30`) compiles to
 * `<color>/<alpha-value>`. When a token is a raw `var(--fail)` that expansion
 * is `var(--fail)/0.3`, which is an INVALID colour, so the whole rule is
 * dropped and the utility silently renders nothing — no error, no border.
 * jsdom does not evaluate Tailwind, so a computed-style assertion would be a
 * lie. Instead we compile the REAL project config with the REAL Tailwind
 * pipeline and assert on the emitted CSS.
 *
 * The load-bearing assertion is that the requested alpha actually appears in
 * the emitted value. A dropped or unalpha'd rule cannot satisfy it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import tailwindConfig from '../tailwind.config.js'

const SRC = resolve(__dirname)
const WEB = resolve(__dirname, '..')

/** Every source file Tailwind scans, read as text. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|js|jsx|html)$/.test(entry) && entry !== 'colorTokens.test.ts'
      ? [full]
      : []
  })
}

const allSource = sourceFiles(SRC).map((f) => readFileSync(f, 'utf8')).join('\n')

/**
 * Opacity-modified colour utilities. Matches `bg-fail/30`, `text-accent/70`,
 * `border-hairline/50`, `hover:bg-accent-wash/40`, ... on any Tailwind colour
 * prefix. `alpha-` is excluded: it sets element opacity, not colour alpha.
 */
const OPACITY_CLASS =
  /(?<![\w-])((?:[\w-]+:)*(?:bg|text|border|ring|divide|decoration|outline|from|via|to|fill|stroke|shadow|accent|placeholder|caret)-[a-z][\w-]*\/\d{1,3})(?=[\s"'`])/g

function opacityClasses(): string[] {
  const found = new Set<string>()
  for (const m of allSource.matchAll(OPACITY_CLASS)) {
    const alpha = Number(m[1].split('/')[1])
    // Tailwind only honours 0-100 steps; ignore anything else.
    if (alpha <= 100) found.add(m[1])
  }
  return [...found].sort()
}

/** Compile `candidateClasses` through the real Tailwind pipeline. */
async function compile(candidateClasses: string[]): Promise<postcss.Root> {
  const raw = candidateClasses.map((c) => `<div class="${c}"></div>`).join('')
  const result = await postcss([
    tailwindcss({
      ...tailwindConfig,
      content: [{ raw }],
    }),
  ]).process('@tailwind utilities;', { from: undefined })
  return postcss.parse(result.css)
}

/** Escape a class for use as a CSS selector, the way Tailwind writes it. */
function escapeSelector(cls: string): string {
  return `.${cls.replace(/([:/[\]().%,#])/g, '\\$1')}`
}

/** Tailwind writes `hover:bg-ok` as `.hover\:bg-ok:hover` — compare de-escaped. */
function deescape(selector: string): string {
  return selector.replace(/\\(.)/g, '$1').replace(/^\./, '')
}

/** Find the block emitted for `cls`, or undefined if Tailwind dropped it. */
function blockFor(emitted: Map<string, string>, cls: string): string | undefined {
  const exact = emitted.get(escapeSelector(cls))
  if (exact) return exact
  for (const [sel, block] of emitted) {
    const flat = deescape(sel)
    if (flat === cls || flat.startsWith(`${cls}:`)) return block
  }
  return undefined
}

/** Map every emitted selector to its declaration block text. */
function rules(root: postcss.Root): Map<string, string> {
  const out = new Map<string, string>()
  root.walkRules((rule) => {
    for (const sel of rule.selectors) out.set(sel, rule.toString())
  })
  return out
}

// The six sites named in the bug report (two distinct utilities).
const REPORTED = [
  'border-fail/30',
  'border-ok/30',
]
// Found by sweeping web/src: the row/infra hover tints, same root cause.
const SWEPT = [
  'hover:bg-accent-wash/50',
  'hover:bg-accent-wash/40',
]
// The unvarianted base forms are not in the tree today, but the token must be
// alpha-capable for them too — not just under a variant.
const BASE_OF_SWEPT = ['bg-accent-wash/50', 'bg-accent-wash/40']
// Variant utilities on those same buttons, which must also emit.
const VARIANTS = [
  'hover:bg-ok',
  'hover:bg-fail',
  'hover:text-white',
  'focus-visible:ring-accent',
]

describe('instrument colour tokens: opacity modifiers emit real CSS', () => {
  it('finds the opacity-modified utilities in the source tree', () => {
    const found = opacityClasses()
    // Guards the sweep itself: if this regex ever stops matching, the rest of
    // the suite would pass vacuously.
    expect(found).toEqual([...REPORTED, ...SWEPT].sort())
  })

  it.each([...REPORTED, ...SWEPT, ...BASE_OF_SWEPT])(
    '%s emits a rule carrying its alpha',
    async (cls) => {
      const alpha = cls.split('/')[1]
      const emitted = rules(await compile([cls]))

      const block = blockFor(emitted, cls)
      expect(
        block,
        `${escapeSelector(cls)} was dropped by Tailwind — the raw var() colour cannot take an /alpha modifier`,
      ).toBeDefined()

      // The alpha must reach the emitted value, otherwise the utility is a lie.
      const fraction = String(Number(alpha) / 100)
      expect(block!).toMatch(
        new RegExp(`(?:0\\.${alpha}|${fraction.replace('.', '\\.')})\\b`),
      )
      // It must be a real colour: the token and the alpha inside one rgb().
      expect(block!).toMatch(/:\s*rgb\(var\(--[\w-]+\) \/ [\d.]+\)/)
      // And specifically NOT the invalid unwrapped form `var(--fail)/0.3`,
      // which is what a raw-var token used to produce.
      expect(block!).not.toMatch(/:\s*var\(--[\w-]+\)\/[\d.]/)
    },
  )

  it.each(VARIANTS)('%s emits a rule', async (cls) => {
    const emitted = rules(await compile([cls]))
    expect(
      blockFor(emitted, cls),
      `${escapeSelector(cls)} was dropped by Tailwind`,
    ).toBeDefined()
  })

  it('every opacity-modified utility in src/ emits a rule', async () => {
    const found = opacityClasses()
    const emitted = rules(await compile(found))
    const missing = found.filter((c) => !blockFor(emitted, c))
    expect(missing, 'opacity-modified utilities that Tailwind silently dropped').toEqual([])
  })
})

describe('token layer contract', () => {
  const css = readFileSync(join(WEB, 'src/index.css'), 'utf8')
  const root = css.slice(css.indexOf(':root'))
  const decls = new Map<string, string>()
  for (const m of root.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) decls.set(m[1], m[2].trim())

  const COLOUR_TOKENS = [
    'surface', 'surface-raised', 'surface-sunken',
    'border', 'border-strong',
    'text', 'text-muted', 'text-faint',
    'accent', 'accent-ink', 'accent-wash',
    'ok', 'warn', 'fail',
    'ok-wash', 'warn-wash', 'fail-wash',
  ]

  it.each(COLOUR_TOKENS)('--%s is an rgb channel triplet', (token) => {
    const value = decls.get(token)
    expect(value, `--${token} is not declared in :root`).toBeDefined()
    // Bare hex cannot accept an alpha modifier; channels can.
    expect(value, `--${token} is "${value}" — must be "R G B" channels`).toMatch(
      /^\d{1,3} \d{1,3} \d{1,3}$/,
    )
    const channels = value!.split(' ').map(Number)
    for (const c of channels) {
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(255)
    }
  })

  it('the config wraps every colour token in rgb(... / <alpha-value>)', () => {
    const configSrc = readFileSync(join(WEB, 'tailwind.config.js'), 'utf8')
    for (const m of configSrc.matchAll(/'(var\(--[\w-]+\))'/g)) {
      expect(
        m[0],
        `${m[1]} is wired raw — it will drop any /alpha utility`,
      ).not.toBe(`'${m[1]}'`)
    }
  })

  it('non-colour tokens are untouched by the triplet change', () => {
    // `overlay-w` is a width, not a colour, so it stays a raw length.
    const configSrc = readFileSync(join(WEB, 'tailwind.config.js'), 'utf8')
    expect(configSrc).toContain("'overlay-w': '600px'")
  })
})
