# Meridian Web UI

React + TypeScript + Vite frontend for the Meridian LLMOps platform. Provides document upload, query, retrieval inspection, and review interfaces against the FastAPI backend.

## Setup

```sh
npm ci
```

## Development

```sh
npm run dev       # Vite dev server (HMR)
npm run build     # type-check (tsc -b) + production build
npm run preview   # preview production build
```

The dev server proxies API calls to the backend; start the backend first (`./start.sh --backend-only` from the repo root).

## Testing and lint

```sh
npm run test       # vitest (watch)
npm run test:run   # single run
npm run test:ui    # vitest UI
npm run lint       # oxlint
```

## Stack

- React 19, TypeScript, Vite 8
- Tailwind CSS 3
- Vitest + Testing Library
- Oxlint

See root [README.md](../README.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) for full project setup.
