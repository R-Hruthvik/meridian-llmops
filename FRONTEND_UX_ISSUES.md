# Meridian Frontend UX Review

**Scope:** The former design preview and the real workbench on `feat/meridian-real-frontend`. Reviewed on 2026-10-14 using Browser Harness captures of the preview, code and API contract inspection, the product and design contracts, and frontend tests. The owner’s follow-up observations are included below. A fresh browser pass on the latest real-app commit could not be made because Chrome was not running and Browser Harness could not start its daemon.

## Findings and disposition

1. **Ask carried too much introductory copy.** The earlier preview stacked multiple headings and helper lines before the question task. The real Ask surface was simplified; answer and citation content stays out of the way until a query returns it.
2. **The question field showed an unwanted resize grip.** The textarea resize affordance was removed.
3. **The layout had excessive empty space.** The shell is responsive and the main area expands with the viewport; desktop, phone, intermediate, and wide widths were previously checked for overflow. Owner asked for readable density across browser zoom levels from 50% to 150%; browser zoom itself still needs a fresh visual pass.
4. **Operations and “Safety rules” were unclear.** Operations groups the real guardrail, review, and usage views. The route is now `#/operations/rules` so its name matches the Rules destination. The interface should continue to explain technical controls in task language and avoid claims of healthy status unless returned by the service.
5. **Settings showed fixed provider/model values.** The real Settings page now hydrates from the saved backend settings and reflects the configured endpoint/model, while keeping credentials masked. The backend was unavailable during this review, so live settings hydration could not be confirmed against the running service.
6. **A profile/workspace identity appeared in the sidebar footer, and profile controls competed in two corners.** The real shell has no profile footer or profile header control.
7. **The global “Search anything” control had no clear scope.** It was removed. Sources has a labeled, document-scoped search.
8. **Source search and Add Sources were awkwardly placed.** They are grouped as page-level actions above the source catalog, with filters lower in the hierarchy.
9. **Sidebar icons felt generic and the sidebar could not be adjusted.** The shell uses task-specific icons, supports collapse, and has a keyboard-adjustable resize handle on wider screens.
10. **Home/Ask had too many subtitles and introduction lines.** The task-first Ask hierarchy removes redundant introductory copy.
11. **The text area showed an unwanted expand/resize affordance.** Removed with the textarea resize grip.
12. **The top-left workspace kicker repeated context and consumed attention.** Removed from the real shell header; the current section title is sufficient.
13. **Meridian’s wordmark had weak contrast and inherited an unintended style.** The wordmark now has explicit dark pine color, Geist type, and normal style.
14. **Navigation labels need to match destinations.** The shell keeps four primary destinations—Ask, Sources, Operations, Settings—with labeled section navigation within Sources and Operations. The Operations safety destination now uses `rules` in its URL.
15. **Sources data was requested to be cleared.** Cleared the app catalog and index using the same `IngestionPipeline.clear_all()` operation called by the document DELETE route. Before: 8 metadata records, 8 chunk files, and 128 vector points. After: 0, 0, and 0. The API initially failed startup on an existing disk/Qdrant count mismatch; after clearing, it started successfully and authenticated `GET /v1/documents` returned an empty list with HTTP 200. `/health/ready` also returned HTTP 200. No repository sample files were deleted.

16. **The development UI sent protected API requests without asking for an app key.** The backend correctly returned 401, leaving Sources and Settings inaccessible in the Vite preview. The existing Unlock screen was previously production-only. The app now shows it whenever no session key is present in any build mode; the key remains in memory and unlock is covered by an App test.

## Design and review record

The adopted palette and hierarchy are documented in `DESIGN.md`; product constraints and intended users are documented in `PRODUCT.md`. The implementation preserves tenant-aware API calls, existing document and question workflows, masked credentials, lazy-loaded secondary views, and truthful service status.

Automated verification on the latest UI commit: **283 tests passed across 19 files** and `npm run build` succeeded. Browser Harness verified the live Operations route `#/operations/rules`, its section links, the simplified header, and wordmark color. After entering the local app access key, it confirmed Sources is empty and Settings reflects the live custom provider, endpoint, and model without exposing key values. Captures are saved under `.impeccable/review/`; desktop was 1536×900, and narrow layouts at 780×437 and 390×844 showed no horizontal overflow.
