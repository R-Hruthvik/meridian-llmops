import { createContext, useContext } from 'react';

/**
 * §6 — the workbench is one canvas, so every secondary surface is a destination
 * an overlay can slide over rather than a neighbouring screen. `settings` is
 * part of the union because the gear and the provider readout both name it; the
 * gear currently opens the full-screen LLM studio instead of a right-hand
 * sheet.
 */
export type OverlayTarget = 'corpus' | 'index' | 'guardrails' | 'review' | 'metrics' | 'settings';

export interface OpenOverlayOptions {
  /** Where the overlay was opened from, e.g. `ASK · VERIFIED GROUNDED`. */
  breadcrumb?: string;
  /** The document the overlay should focus, e.g. an answer's cited source. */
  documentId?: string;
  /** The specific chunk within that document. */
  chunkId?: string;
}

export interface WorkbenchContextValue {
  openOverlay: (target: OverlayTarget, opts?: OpenOverlayOptions) => void;
  closeOverlay: () => void;
  activeOverlay: OverlayTarget | null;
}

/**
 * Null by default so a consumer rendered outside the shell fails loudly on
 * `activeOverlay` rather than silently rendering an empty workbench.
 */
export const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

/**
 * The contract the canvas layers code against: the Ask canvas opens an overlay
 * without knowing which surface it is, and without owning any of its state.
 */
export const useWorkbench = () => useContext(WorkbenchContext);
