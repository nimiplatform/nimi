# Kit Feature: Generation

## What It Is
Reusable generation workflow shell for submit, status, and result-oriented runtime jobs.

## Public Surfaces
- `@nimiplatform/nimi-kit/features/generation`
- `@nimiplatform/nimi-kit/features/generation/headless`
- `@nimiplatform/nimi-kit/features/generation/ui`
- `@nimiplatform/nimi-kit/features/generation/runtime`
- Current surfaces:
  - `headless`: active
  - `ui`: active
  - `runtime`: active for local/runtime job orchestration
  - `realm`: none

## When To Use It
- Reuse generation job panels, status toasts, and submit orchestration.
- Bind runtime media jobs without rebuilding baseline workflow chrome.
- Reuse `useRuntimeGenerationPanel(...)` when the app still owns artifact persistence, buffer decoding, or store updates.
- Reuse `RuntimeGenerationPanel` when the app should provide domain-specific controls but not reimplement submit/status chrome.
- Reuse `GenerationStatusToast` and `GenerationStatusList` for lightweight job-state surfaces outside the main panel.

## Before Building Locally
- Check `generation/ui` before creating a new generation panel, generation status toast, or shared result-state shell.
- Check `generation/headless` before writing local submit orchestration, status mapping, or shared run-state handling.
- Check `generation/runtime` before wrapping runtime workflow and job APIs directly in app code.

## What Stays Outside
- App-specific artifact persistence and downstream domain actions.
- Audio/image/video artifact decoding and app-owned file persistence.
- Store writes such as take creation, media library insertion, or domain-specific job indexing.
- Realm business-service integrations.

## Current Consumers
- `overtone`
  Uses `generation/runtime` and `generation/ui` for music generate and iterate panels while keeping take creation, artifact decoding, and store updates app-local.
- `desktop`
  Uses `generation/ui` status surfaces for scenario job progress and shared runtime status display.

## Verification
- `pnpm --filter @nimiplatform/nimi-kit test`
- `pnpm --filter @nimiplatform/overtone build`
- `pnpm --filter @nimiplatform/desktop build`
- `pnpm check:nimi-kit`
