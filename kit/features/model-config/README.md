# Kit Feature: Model Config

## What It Is
Reusable AI model configuration surface for capability-scoped binding, profile apply UX, capability-local params editors, and optional diagnostics or scheduling sections.

## Public Surfaces
- `@nimiplatform/nimi-kit/features/model-config`
- `@nimiplatform/nimi-kit/features/model-config/headless`
- `@nimiplatform/nimi-kit/features/model-config/ui`

## Canonical Ownership
- This module is a shared consumer UI surface.
- It does not own `AIConfig`, `AIProfile`, `AISnapshot`, runtime route probing, scheduling evaluation, or app navigation.
- Consumers must provide controlled bindings, params, assets, projection-derived status, and profile apply callbacks.

## When To Use It
- Reuse it when an app or module needs the same model configuration shell across chat, tester, runtime config, or future AI workspaces.
- Use it when capability-level config must stay visually and behaviorally aligned while each consumer decides which sections are enabled.
- Prefer it over app-local settings cards when the requirement is “same model config semantics, different scope or capability subset”.

## Before Building Locally
- Check `@nimiplatform/nimi-kit/features/model-config` before adding another app-local model settings shell.
- Keep bindings, params, assets, projection status, and profile apply callbacks consumer-owned; do not move `AIConfig` or runtime authority into kit.
- Reuse `features/model-picker` providers and triggers before introducing a second route-selection primitive.

## What Stays Outside
- Scope selection and `AIScopeRef` ownership.
- `AIProfile` catalog loading and apply semantics.
- Runtime route provider creation and health/projection logic.
- Capability execution semantics and submit-time snapshot capture.

## Current Consumers
- `desktop`
  Uses the shared panel for Chat Settings and AI Tester Settings, with desktop-owned AIConfig/profile adapters.

## Verification
- `pnpm --filter @nimiplatform/nimi-kit build`
- `pnpm --filter @nimiplatform/nimi-kit test`
- `pnpm check:nimi-kit`
