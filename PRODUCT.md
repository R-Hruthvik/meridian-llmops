# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Working assumption, pending owner confirmation:** developers and technical operators who configure a document question-answering workspace, add source material, and investigate answer quality. The app should also make its primary question-and-answer flow understandable to someone who is not configuring retrieval internals.

## Product Purpose

Meridian lets teams ingest documents and ask questions grounded in those documents. Success means a user can get a useful answer, see the passages and sources behind it, and understand when the system could not answer reliably.

## Positioning

Meridian combines dense and lexical retrieval, checks retrieved context, and presents source evidence and serving status alongside generated answers. These capabilities are documented in `README.md` and represented in the current API and frontend.

## Operating Context

Users work with a document library, provider/model configuration, retrieval controls, guardrails, review items, and service-health information. The app is a web workbench; question answering is the main task, with configuration and operations supporting it.

## Capabilities and Constraints

- Preserve existing API contracts, tenant handling, API-key behavior, masked provider credentials, and truthful status reporting.
- Preserve document upload, search, inspection, retrieval, citation, guardrail, review, metrics, and provider-configuration behavior.
- Keep secondary surfaces lazy-loaded so first paint does not load every studio.
- The frontend uses React, TypeScript, and Vite. No new routing or UI dependency is required by this redesign.
- Audience and deployment topology are not fully specified in the repository; do not invent deployment guarantees.

## Brand Commitments

- Product name: Meridian.
- No confirmed logo or existing visual brand system was found.
- The owner asked for a simpler, more comfortable interface and approved a warm, task-first visual direction for this redesign. This is a surface design decision, not a permanent corporate identity claim.

## Evidence on Hand

- Product and capability descriptions: `README.md`, `docs/RUNBOOK.md`, and the API/types in `web/src`.
- No customer testimonials, external trust marks, or product photography are established in the repository. Do not fabricate them.

## Product Principles

1. Make asking a question the clearest first action.
2. Keep source evidence close to the answer it supports.
3. Make system status honest and pair failure with a useful next step.
4. Keep technical controls available without making them a prerequisite for basic use.
5. Preserve tenant and credential boundaries while making navigation easier to understand.

## Accessibility & Inclusion

The redesigned web workbench must keep visible labels on primary navigation, support keyboard access and visible focus, provide usable touch targets, and keep text and status colors legible across desktop and mobile layouts.
