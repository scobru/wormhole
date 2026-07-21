---
version: alpha
name: Anthropic
website: "https://www.anthropic.com"
description: >-
  Anthropic's design system runs a monochrome marketing surface — slate ink (#141413) on a warm ivory canvas (#faf9f5) — over a dormant 8-color accent palette (clay #d97757, fig #c46686, cactus #bcd1ca, sky #6a9bcc, heather, olive, manilla, kraft) that paints only on research, news, and Economic Index sub-pages. The system rests on a three-typeface stack: Anthropic Serif for 90px section displays and 24px body prose, Anthropic Sans bold for the impact hero and nav, and Anthropic Mono uppercase for eyebrow metadata. Pages alternate cream and full-bleed true-black bands; the wordmark replaces the letter "I" with a literal backslash glyph (ANTHROP\\C). It reads as the antithesis of the cool-blue AI category — editorial, restrained, almost academic.

seo:
  title: "Anthropic Design System for React — Slate #141413, Anthropic Serif, 22 components"
  metaDescription: "Anthropic's design system as a DESIGN.md file. Slate #141413, Anthropic Serif + Sans + Mono, 21 colors, 22 components. For React, Next.js, and AI tools."
  highlights:
    - "Monochrome marketing surface — slate #141413 on cream #faf9f5 paints the homepage, with no chromatic CTA in sight"
    - "Dormant 8-color accent palette — clay #d97757, fig #c46686, cactus #bcd1ca, sky #6a9bcc and 4 more declared in :root but scoped to research and Economic Index sub-pages"
    - "Cream-and-black band rhythm — full-bleed cream sections alternate with full-bleed #000000 black sections, replacing the gradient heroes other AI brands lean on"
    - "Three-typeface stack — Anthropic Serif (90px section displays, 24px body), Anthropic Sans bold (impact hero, nav), Anthropic Mono uppercase (eyebrow metadata)"
    - "Backslash glyph wordmark — the letter I in ANTHROP\\C is a literal `\\` character, codified across the brand"
  tags:
    - "AI & LLM Platforms"
  lastUpdated: "2026-05-12"
  author:
    name: "Dov Azencot"
    url: "https://x.com/dovazencot"
  opening: |
    Anthropic's corporate site is what an AI lab's identity looks like when it refuses every category convention. The homepage paints slate ink (#141413) on ivory cream (#faf9f5) and nothing else — no gradients, no brand purple, no signature blue. Where most AI companies signal authority with cool-blue depth and saturated CTAs, Anthropic signals it with monochrome restraint and a serif body face that reads more like a printed essay than a marketing surface.

    The system itself is richer than the front door suggests. Beyond the homepage's 6 painted colors, Anthropic declares 15 more on `:root` — including 8 muted accent swatches (clay, fig, cactus, sky, heather, olive, manilla, kraft) that surface only on research entries, the Economic Index dashboards, and news sub-pages. This DESIGN.md captures both layers: 21 color tokens, 11 typography levels split across three custom typefaces (Anthropic Serif, Sans, Mono), a 4-step radius scale, 8-step spacing rhythm, and 22 component definitions covering buttons, surfaces, nav, and the cream-to-black band alternation that paces every page.

    Feed the file to Claude, Cursor, or Copilot and the agent reproduces the editorial voice — black slate CTAs, ivory canvas, serif body prose, mono uppercase labels — rather than a generic AI-startup theme. Or use it as an audit: a benchmark for how much chromatic noise your own design system carries that Anthropic deliberately holds in reserve.
  related:
    - href: "/design"
      title: "Browse all design systems"
      description: "The full directory of DESIGN.md files on shadcn.io, with live mockups for each."
    - href: "https://www.anthropic.com"
      title: "Anthropic — official site"
      description: "The live source of this design system. Visit to see the cream-to-black band rhythm in motion."
    - href: "https://github.com/google-labs-code/design.md"
      title: "The DESIGN.md specification"
      description: "Google Labs' open spec for machine-readable design system files — the format this page is built on."
  questions:
    - id: "primary-color"
      title: "What is Anthropic's primary brand color?"
      answer: "The marketing homepage's primary is slate ink #141413 on ivory cream #faf9f5 — there's no chromatic CTA in the traditional sense. But Anthropic's full design system declares 8 accent swatches on `:root` that surface on research entries, the Economic Index, and news sub-pages: clay #d97757 (warm terracotta — the strongest chromatic accent), fig #c46686 (muted rose), cactus #bcd1ca (sage), sky #6a9bcc (mid-blue for AI-safety category tiles), plus deep #c6613f, olive, heather, and coral. The accent palette reads dustier than fully-saturated brand colors — restraint is the system position, even when chroma is allowed."
    - id: "typography"
      title: "What typography does Anthropic use, and what should I substitute?"
      answer: "Anthropic ships three custom typefaces. Anthropic Serif handles the 90px section displays AND the 24px body prose — using serif for body is the system's most distinctive typographic move. Anthropic Sans (regular for nav, bold for the impact hero) handles short-form chrome. Anthropic Mono in uppercase carries eyebrow metadata and timestamps. If the proprietary faces are unavailable, Georgia or Tiempos Text substitute for Anthropic Serif, Inter for Anthropic Sans, and JetBrains Mono for Anthropic Mono."
    - id: "surface-rhythm"
      title: "Why does the page alternate between cream and black?"
      answer: "Anthropic uses two full-bleed surface modes that swap section-to-section: cream #faf9f5 carries text-driven sections (hero, body prose, research entries), and true black #000000 carries the cinematic feature bands (Project Glasswing's hexagonal mesh illustration, model showcase cards). The contrast is the page's structural device — no gradients, no shadows, no decorative dividers. Each band swap signals a topic shift. The ivory-on-black inversion is the system's only visual flourish."
    - id: "logo-glyph"
      title: "Why is there a backslash in the Anthropic wordmark?"
      answer: "The letter I in ANTHROPIC is replaced with a literal `\\` character — the wordmark renders as ANTHROP\\C across every surface. It's a typographic mark, not a logo asset, so the slash inherits the same Anthropic Sans weight and color as the surrounding letters. The choice reads as code-adjacent (the backslash is the literal escape character in most programming languages), aligning the brand identity with software craft without leaning on the gradients or geometric marks of competitor AI brands."
    - id: "use-in-project"
      title: "Can I use this DESIGN.md to build my own React app?"
      answer: "Yes — drop the file into Claude, Cursor, or Copilot and ask for a page in Anthropic's style. The agent reproduces the monochrome chrome, the three-typeface stack, the cream-to-black band rhythm, and the serif-body editorial voice rather than a generic shadcn theme. Every hex value, font name, radius, and spacing is a quoted token you can paste into Tailwind config or CSS variables. The 8px primary radius and 16px secondary radius are the only two shape values you need."
    - id: "known-gaps"
      title: "What's not in this DESIGN.md?"
      answer: "Several things, by design. Anthropic Serif, Sans, and Mono are proprietary typefaces with no public web fonts — substitutes are recommended but not exact. Motion (the subtle hover lifts on cards, the staggered fade-in of section content) is not captured. Form validation states beyond focus are out of scope. Color usage on the research detail pages and the Economic Index dashboards diverges from this landing-page spec — those surfaces add chart palettes (data-viz blues, mint accents) not present on the marketing canvas."

colors:
  # Slate ink + cloud greys — the chrome that carries the marketing homepage
  ink: "#141413"
  ink-soft: "#3d3d3a"
  text-muted: "#5e5d59"
  text-secondary: "#b0aea5"
  text-tertiary: "#87867f"
  hairline: "#d1cfc5"
  # Cream canvas + warm neutrals — the surface ladder
  canvas: "#faf9f5"
  surface-secondary: "#f0eee6"
  surface-secondary-hover: "#e8e6dc"
  surface-warm: "#e3dacc"
  surface-manilla: "#ebdbbc"
  surface-kraft: "#d4a27f"
  # Accent swatches — present in :root but scoped to research/news/economic-index sub-pages
  accent-clay: "#d97757"
  accent-coral: "#ebcece"
  accent-fig: "#c46686"
  accent-cactus: "#bcd1ca"
  accent-olive: "#788c5d"
  accent-sky: "#6a9bcc"
  accent-heather: "#cbcadb"
  accent-deep: "#c6613f"
  # Inverse — for the full-bleed black bands
  inverse: "#000000"

typography:
  display-hero:
    fontFamily: '"Anthropic Sans", Arial, sans-serif'
    fontSize: 88px
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: -1.5px
  display-section:
    fontFamily: '"Anthropic Serif", Georgia, serif'
    fontSize: 90px
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: -0.5px
  display-md:
    fontFamily: '"Anthropic Serif", Georgia, serif'
    fontSize: 48px
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: -0.3px
  heading-md:
    fontFamily: '"Anthropic Sans", Arial, sans-serif'
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  body-lg:
    fontFamily: '"Anthropic Serif", Georgia, serif'
    fontSize: 24px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  body-md:
    fontFamily: '"Anthropic Serif", Georgia, serif'
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: '"Anthropic Sans", Arial, sans-serif'
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: -0.04px
  nav-link:
    fontFamily: '"Anthropic Serif", Georgia, serif'
    fontSize: 20px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  label:
    fontFamily: '"Anthropic Sans", Arial, sans-serif'
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  eyebrow:
    fontFamily: '"Anthropic Mono", "JetBrains Mono", monospace'
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
    textTransform: uppercase
  button:
    fontFamily: '"Anthropic Serif", Georgia, serif'
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0

rounded:
  none: "0px"
  sm: "8px"
  md: "16px"
  lg: "24px"

spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "96px"

components:
  top-nav:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
    padding: "16px 32px"
    height: "72px"
  nav-link:
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
    padding: "8px 12px"
  nav-link-hover:
    textColor: "{colors.ink}"
    padding: "8px 12px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    opacity: "0.9"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
    border: "1px solid {colors.ink}"
    height: "44px"
  button-tertiary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
    border: "1px solid {colors.text-secondary}"
  card-cream:
    backgroundColor: "{colors.surface-secondary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "32px"
    border: "1px solid {colors.surface-warm}"
  card-warm:
    backgroundColor: "{colors.surface-warm}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "32px"
  hero-band-cream:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    padding: "96px 32px"
  hero-band-black:
    backgroundColor: "{colors.inverse}"
    textColor: "{colors.canvas}"
    padding: "96px 32px"
  section-eyebrow:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.eyebrow}"
    padding: "0"
  hero-heading-sans:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.display-hero}"
    padding: "0"
  hero-heading-serif:
    backgroundColor: "transparent"
    textColor: "{colors.canvas}"
    typography: "{typography.display-section}"
    padding: "0"
  body-prose:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    padding: "0"
  link-inline:
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    textDecoration: "underline"
  divider:
    backgroundColor: "{colors.text-secondary}"
    height: "1px"
    width: "100%"
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
    border: "1px solid {colors.text-secondary}"
    height: "44px"
  text-input-focus:
    backgroundColor: "{colors.canvas}"
    border: "1px solid {colors.ink}"
  footer-band:
    backgroundColor: "{colors.inverse}"
    textColor: "{colors.canvas}"
    padding: "96px 32px"
  wordmark:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.display-hero}"
    padding: "0"
---

## Overview

Anthropic's chrome runs on **monochromatic restraint with dormant chroma** — the homepage paints slate ink on cream and nothing else, but the system itself declares 8 muted accent swatches (clay, fig, cactus, sky, heather, olive, manilla, kraft) that surface only on research entries, the Economic Index dashboards, and news sub-pages. Where most AI companies signal authority through cool-blue gradients and saturated CTAs, Anthropic signals it through holding the chromatic palette in reserve. The slate `#141413` carries every marketing CTA, every link, every border, every primary text. The cream `#faf9f5` is the canvas across every text-driven section. Together they cover ~95% of the visible pixels on the front door.

The system's structural rhythm is **band alternation**: full-bleed cream sections (text, prose, research summaries) swap with full-bleed true-black sections (cinematic illustrations, feature reveals like Project Glasswing's hexagonal mesh). The cream-to-black contrast is the only visual divider — no gradients, no shadows, no decorative rules. Where conventional marketing sites lean on hero gradients to signal weight, Anthropic lets the canvas swap do the work.

The typographic move inverts the usual category convention: **serif for body, sans for hero**. The 24px body prose runs Anthropic Serif (Georgia-class), reading more like a long-form essay than marketing copy. The impact hero ("AI research and products that put safety at the frontier") runs Anthropic Sans bold at 88px. Section displays like "Project Glasswing" return to Anthropic Serif at 90px weight 400 — editorial, never bold. Mono uppercase eyebrows complete the three-typeface stack.

## Colors

Anthropic's published design system declares **21 tokens** on `:root`, but the marketing homepage only paints 6 of them. The other 15 are scoped to research entries, the Economic Index dashboards, and news pages — they exist in the system, just dormant on the front door. Both groups are documented below.

### Marketing surface (painted on the homepage)

- **Slate ink (`#141413`)** — frequency 357. Used as text (178), border (171), background (8). The system's load-bearing voltage: every CTA fill, every body text run, every divider edge, every primary border. CSS variables map it as `--swatch--slate-dark`, `--swatch--brand-text`, `--_color-theme---button-primary--background`, `--_color-theme---text`.
- **Cloud medium (`#b0aea5`)** — frequency 316. Used as text (158), border (158). The secondary text color — captions, metadata, divider hairlines. Reads warm rather than cool, derived from the cream canvas hue. Mapped as `--swatch--cloud-medium`, `--_color-theme---text-agate`.
- **Ivory canvas (`#faf9f5`)** — frequency 291. Used as text-on-dark (146), border-on-dark (141), background (4). The default page canvas and the inverse text color on black bands. Mapped as `--swatch--ivory-light`, `--_color-theme---background`.
- **Surface secondary (`#f0eee6`)** — card backgrounds. The faintly darker cream variant that lifts cards off the canvas without a shadow. Mapped as `--_color-theme---background-secondary`.
- **Surface warm (`#e3dacc`)** — accent cards, reaching toward oat. Mapped as `--swatch--oat`.
- **Inverse (`#000000`)** — full-bleed band backgrounds. True black for the cinematic feature sections. The cream-to-black swap is the page's only depth signal.

### Extended chrome (dormant on the homepage, mapped in `:root`)

- **Ink soft (`#3d3d3a`)** — primary button border-hover state. Mapped as `--_color-theme---button-primary--border-hover`, `--_button-style---background-hover`.
- **Text muted (`#5e5d59`)** — link-text hover, `--swatch--slate-light`.
- **Text tertiary (`#87867f`)** — `--swatch--cloud-dark`. Disabled-state captions.
- **Hairline (`#d1cfc5`)** — `--swatch--cloud-light`. Divider rules where the cloud-medium variant is too prominent.
- **Surface secondary hover (`#e8e6dc`)** — `--_color-theme---background-secondary-hover`. Card lift on hover.
- **Surface manilla (`#ebdbbc`)** — `--swatch--manilla`. Warm yellow-tinted alternate surface.
- **Surface kraft (`#d4a27f`)** — `--swatch--kraft`. The most saturated of the warm-paper tones.

### Accent swatches (research/news/sub-page only)

The palette below is declared on `:root` but never paints the marketing homepage. It surfaces on research entries (per-paper accent cards), the Economic Index dashboards (chart palettes), and the news section (per-article spot color). All eight read as muted, dustier than fully-saturated brand colors.

- **Clay (`#d97757`)** — `--swatch--clay`. Warm terracotta orange. The brand's strongest chromatic accent; appears on research featured-entry tiles.
- **Coral (`#ebcece`)** — `--swatch--coral`. Pale dusty pink, used as soft callout fills.
- **Fig (`#c46686`)** — `--swatch--fig`. Muted rose, used on Society & Economy research category tiles.
- **Deep (`#c6613f`)** — `--swatch--accent`. Burnt sienna, the deepest warm-orange in the system.
- **Cactus (`#bcd1ca`)** — `--swatch--cactus`. Pale sage green, on technical-research category tiles.
- **Olive (`#788c5d`)** — `--swatch--olive`. Muted olive-green for graph data points.
- **Sky (`#6a9bcc`)** — `--swatch--sky`. Soft mid-blue for AI-safety category tiles.
- **Heather (`#cbcadb`)** — `--swatch--heather`. Cool lavender-grey, the only chromatic-cool token in the system.

## Typography

Three custom typefaces, each scoped to a strict role.

**Anthropic Serif** is the system's voice. It handles 90px section displays ("Project Glasswing", "What we're working on") at weight 400 with -0.5px tracking, and 24px body prose at weight 400 across every essay-style paragraph. Setting body in serif is the system's most distinctive typographic move — it makes Anthropic's marketing surface read like a published research paper rather than a SaaS site. Substitute Georgia or Tiempos Text where the proprietary face is unavailable.

**Anthropic Sans** handles the impact hero ("AI research and products that put safety at the frontier") at 88px weight 700, plus the nav links at 20px weight 400 and 15px caption labels. Unlike the serif's editorial discipline, the sans is short-form and weight-graded. Inter or Söhne substitute cleanly.

**Anthropic Mono** carries the eyebrow metadata — uppercase timestamps, section labels, code-adjacent markers — at 16px weight 400. The mono is scoped exclusively to short, uppercase strings; it never carries body content. JetBrains Mono or Berkeley Mono substitute.

The 88-and-90 dual-display tension (sans 88 for top-of-page, serif 90 for section reveals) is the typographic signature. Most systems pick one display tier; Anthropic ships both and uses each in separate contexts.

## Layout

The system runs on an 8px scale: 4, 8, 12, 16, 24, 32, 48, 96. The 96px value handles vertical section padding — the page rhythm is generous, not dense. Cards use 32px internal padding consistently, giving content room to breathe within the structural restraint.

The container strategy alternates: text sections cap at a comfortable reading column (~640-720px), while feature illustrations span full bleed. Where Stripe or Linear use a fixed-width content grid, Anthropic lets each section pick its own width based on whether it carries prose or imagery.

## Elevation & Depth

Elevation is achieved through **surface contrast, not shadows**. The system carries zero box-shadows in the marketing surface. Cards lift off the canvas via a faint cream-to-cream value step (`#f0eee6` on `#faf9f5`) and a 1px hairline border in `#e3dacc`. Full-bleed black bands provide the page's only true depth signal — the cream-to-black swap reads as a section break, not as foreground/background.

The absence of shadows is the design move. Most AI competitor sites lean on glow-shadows and gradient atmospheres; Anthropic refuses both.

## Shapes

A two-tier radius scale: 8px for buttons, inputs, and small chips; 16px for cards and surfaces. A 24px tier exists for the rare extra-large container. Everything else is 0px — hero illustrations are flush-edged, full-bleed bands have no rounded corners, the wordmark sits flat against its canvas. The "Try Claude" CTA pill in the nav uses ~24px radius and is the visual exception, not the rule.

## Components

The component vocabulary is small and disciplined. **Three button variants** (primary slate-fill, secondary cream-with-border, tertiary transparent-with-hairline) cover every interaction. **Two card variants** distinguish cream-on-cream (`#f0eee6`) from warm-oat (`#e3dacc`) — both render at 16px radius with 32px padding and no shadow. **Two hero bands** (cream and black) handle the section alternation. The eyebrow label, the inline link with underline, the divider, and the text input round out the system.

Notable: the **wordmark itself is a typography token**, not an SVG asset. ANTHROP\C renders as a styled span using Anthropic Sans at the canvas's slate color — the backslash is a literal `\` character. Treating the logo as type rather than asset is what allows it to scale and inherit color across surfaces.

## Do's and Don'ts

- Do hold the slate ink `#141413` for every CTA, link, border, and primary text — this color is the only brand voltage the system carries.
- Don't introduce a chromatic accent. Anthropic's restraint is the brand position; a coral, teal, or indigo CTA would break the entire system identity.
- Do set body prose in Anthropic Serif at 24px. Body in sans is what every other marketing site does — the serif body is what makes Anthropic read as an essay rather than a sales page.
- Don't bold the section serif. The 90px Project-Glasswing-style display runs at weight 400, never 600 or 700. Bold serif at that size reads as commercial poster, not editorial.
- Do alternate cream and true-black full-bleed bands for section pacing. Single-color page rhythm flattens the entire system.
- Don't add box-shadows to cards. The cream-on-cream `#f0eee6` lift + 1px `#e3dacc` hairline is the depth model — shadows break the painted-on-paper aesthetic.
- Do use the backslash glyph `\` as the I in the wordmark across every surface. Anthropic uses it as a typographic mark, not an image.
- Don't substitute Times New Roman for Anthropic Serif. Use Georgia or Tiempos Text — Times has too much contrast and reads commercial.

## Known Gaps

The marketing-surface spec doesn't cover several adjacent surfaces. Anthropic Serif, Sans, and Mono are proprietary with no public web fonts — substitution recommendations are documented but exact-match isn't possible. Motion (the staggered card fade-in on scroll, the subtle wordmark hover, the band-transition timing) is not extracted. Form validation states beyond focus, hover micro-interactions on CTAs, and the chart palette used on the Economic Index dashboards are out of scope. The claude.ai product surface adds chat bubbles, model selectors, and a conversation sidebar that this corporate-marketing document does not capture — see `content/design/claude.md` for the product-side spec.
