# Meridian Workbench Design

## Surface

Operate. Meridian is a working environment for asking questions against documents, managing sources, and checking the behavior of a retrieval service.

## Direction

An annotated reference library: a calm, readable workspace where source evidence is easy to follow and operations remain available without dominating the main task. Use the conventions of well-edited reference publishing only for type, color, reading density, and citation annotation. Keep ordinary web navigation, buttons, forms, tabs, and tables.

## Palette

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F6F3EB` | Main app ground |
| `--paper-raised` | `#FFFEFA` | Reading and form surfaces |
| `--paper-muted` | `#ECE9E0` | Secondary navigation and quiet controls |
| `--ink` | `#252D28` | Primary text |
| `--ink-muted` | `#626C65` | Supporting text |
| `--rule` | `#DED9CE` | Separators and field boundaries |
| `--pine` | `#285C4A` | Primary action and active navigation |
| `--pine-wash` | `#E5EEE8` | Selected and focused context |
| `--copper` | `#A65337` | Citation markers and source references |

Semantic green, amber, and red are reserved for real success, warning, and error states. Check text contrast against the actual rendered colors before shipping.

## Typography and density

- Use self-hosted Geist for controls, body copy, labels, and navigation; use Geist Mono only for IDs and numeric readouts.
- Use a restrained system serif for page titles and the main question prompt. Keep all interaction labels in Geist.
- Main titles: 28–32 px. Body text: 16 px with comfortable line height. Control labels: 13–14 px. Do not use uppercase as the default label style.
- Keep technical tables compact and aligned; give the question and answer generous line length and whitespace.

## Signature interaction

Answer citations use numbered copper markers. Selecting one opens the matching source and chunk in context, where the same number and a clear selected state identify the supporting passage. The markers are navigation and evidence, not decoration.

## Shell and responsive behavior

- Desktop: a persistent, labeled left navigation for Ask, Sources, Operations, and Settings; a compact header for Meridian, current tenant, and service health; a readable main content column.
- Mobile: the same four destinations remain visibly labeled in a bottom navigation. Content stacks without horizontal scrolling. Tables use a deliberate compact layout or a named horizontal scroller.
- Keep keyboard focus visible, use semantic links for locations and buttons for actions, retain 44 px minimum touch targets, and respect reduced motion.

## Component character

- Prefer spacing, type, and alignment over wrapping every section in a bordered card.
- Use flat reading surfaces, clear form boundaries, restrained separators, and consistent button shapes.
- Keep error and offline states visible and pair them with a useful next step.
- Motion is limited to brief state transitions; no decorative animation.

## Product constraints

- Preserve API behavior, tenant scoping, credential masking, status accuracy, and existing document/query workflows.
- Do not add customer claims, external imagery, or backend-dependent features.
- Load secondary studios on demand; do not eagerly mount or fetch every section at first paint.
