# Kit Feature: Commerce

## What It Is
Reusable commerce capability module for gifting and lightweight transactional dialogs.

## Public Surfaces
- `@nimiplatform/nimi-kit/features/commerce`
- `@nimiplatform/nimi-kit/features/commerce/headless`
- `@nimiplatform/nimi-kit/features/commerce/ui`
- `@nimiplatform/nimi-kit/features/commerce/realm`
- Current surfaces:
  - `headless`: active
  - `ui`: active
  - `runtime`: none
  - `realm`: active for logged-in economy and gifting services

## When To Use It
- Reuse send-gift and gift-inbox UX without rebuilding baseline interaction logic.
- Bind Nimi economy services through `commerce/realm`.
- Reuse `useRealmSendGiftDialog(...)` and `useRealmGiftInbox(...)` when the app should keep avatars, navigation, or banners but not dialog/inbox state orchestration.
- Reuse `GiftInboxList` and `GiftInboxDetail` when the app only needs to inject app-specific avatar or surrounding shell.

## Before Building Locally
- Check `commerce/ui` before creating a new send-gift dialog, gift inbox list, gift status badge, or gift detail shell.
- Check `commerce/headless` before writing local gift dialog state, inbox state, accept/reject orchestration, or lightweight transaction flows.
- Check `commerce/realm` before wrapping realm economy and gifting services directly in app code.

## What Stays Outside
- Local AI/runtime engine features.
- App-specific wallet pages, payout flows, and back-office tools.
- Any integration that is not backed by realm business services.
- App-owned banners, navigation, wallet entrypoints, and other product-specific side effects.

## Current Consumers
- `desktop`
  Uses `commerce/headless`, `commerce/ui`, and `commerce/realm` for send-gift and gift-inbox flows while keeping avatar rendering, wallet navigation, and status banners app-local.
- `web`
  Planned consumer only. No active web surface is implemented in this iteration.

## Verification
- `pnpm --filter @nimiplatform/nimi-kit test`
- `pnpm --filter @nimiplatform/desktop build`
- `pnpm check:nimi-kit`
