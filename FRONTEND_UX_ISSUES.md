# Frontend UX Review — in progress

**Scope:** Current Meridian UI preview at `/?design-preview=1`, reviewed in Browser Harness on 2026-10-14. This is a preliminary list: the owner is still adding observations, so it is not a final redesign brief.

## Observed issues

1. **Ask screen carries too much introductory copy.** It stacks an eyebrow, title, subtitle, question label, helper sentence, and a “Recently added” section. The main task does not need that many competing text levels.
2. **The question field exposes an unwanted resize affordance.** The textarea currently has `resize: vertical`, which shows a browser resize grip. Remove it and choose a deliberate fixed or responsive height.
3. **The preview leaves large unused regions.** The Ask and Sources content ends high in a tall viewport. Sources says it contains 12 documents but displays only four sample rows, making both the blank space and count feel inconsistent.
4. **Operations and its labels are unclear.** “Operations,” “Safety rules,” “Review queue,” and “Usage” do not explain what a person can do there. The preview’s overview copy (“Everything is in good shape”) also claims status for static sample data.
5. **Settings does not reflect the configured environment.** Browser Harness showed a fixed OpenAI/custom-endpoint selector and `gpt-4o-mini`. The local `.env` has a custom endpoint at `localhost:3010/v1` and model `kilo-auto/free`; an API key is configured. The actual key was not read into the report or exposed in the UI.
6. **Workspace identity is unnecessary in the sidebar footer.** It shows a workspace avatar, name, “Personal workspace,” and demo status even though the owner asked to remove the lower-left profile area. The top-right profile control has already been removed from the uncommitted preview edits.
7. **The global “Search anything” control was unexplained.** It is removed in the uncommitted preview edits. Sources now has a page-specific search field labeled “Search your documents,” beside “Add sources.”
8. **Source actions need clearer priority.** Search and add previously sat apart from each other and the document list. The current uncommitted preview groups the document search and primary “Add sources” action, then puts source filters below.
9. **Navigation still needs owner confirmation.** It currently groups Ask, Sources, Operations, and Settings. Ask and Sources are understandable; Operations may need a plain task name or to be split into the tasks the owner actually uses.
10. **Responsive density needs sign-off.** Desktop, phone-sized, and wide viewport captures were reviewed. The labeled bottom navigation appears on narrow layouts, but the owner still sees too much unused space and wants the layout to remain composed at browser zoom levels from 50% through 150%.

## Review methods and evidence

- Browser Harness opened the live preview and read the rendered page text and available controls for Ask, Sources, Operations, and Settings.
- Browser inspection confirmed the global search is absent in the current working preview, while the Sources search input is explicitly labeled.
- Rendered screenshots were checked at desktop, phone-sized, intermediate, and wide viewport widths.
- The environment check printed only non-secret configuration facts: `MODEL`, the endpoint host/path, and whether `API_KEY` is present. No credential value was displayed.
- Design research: [Linear’s sidebar and settings redesign](https://linear.app/changelog/2024-12-18-personalized-sidebar) supports making navigation customizable and settings task-grouped; [Figma’s sidebar guide](https://help.figma.com/hc/en-us/articles/14381406380183-Guide-to-the-file-browser) shows explicit destinations and clearly scoped search; [Vercel’s environment variable guide](https://vercel.com/docs/environment-variables) treats environment configuration as an explicit, sensitive settings area.

## Decisions still needed

The owner has not finished supplying feedback. Questions about the final information architecture, Operations scope, Ask content, search scope, settings source of truth, density, and typography are being gathered before more UI work starts.

## Current change state

The latest visual feedback changes are uncommitted on `feat/web-ux-redesign`. No additional UI edits or commits should be made until the owner says the issue list is complete.
