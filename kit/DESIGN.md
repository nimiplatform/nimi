---
name: Nimi Kit Design System
version: alpha
description: Spec-derived DESIGN.md projection for Nimi Kit UI/UX agents and drift gates.
systemVersion: 1
designVersion: 2
authority:
  owner: platform
  canonical: .nimi/spec/platform/kernel/**
  projection: kit/DESIGN.md
  generatedBy: scripts/generate-nimi-design-md.mjs
  writeCommand: node scripts/generate-nimi-design-md.mjs --write
  checkCommand: node scripts/generate-nimi-design-md.mjs --check
sources:
  - .nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml
  - .nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml
  - .nimi/spec/platform/kernel/tables/nimi-ui-primitives.yaml
  - .nimi/spec/platform/kernel/tables/nimi-ui-primitives/*.yaml
  - .nimi/spec/platform/kernel/tables/nimi-ui-compositions.yaml
  - .nimi/spec/platform/kernel/tables/nimi-ui-adoption.yaml
  - .nimi/spec/platform/kernel/tables/nimi-ui-allowlists.yaml
  - .nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml
colors:
  on-primary: "#111827"
  primary: "#4ECCA3"
  primary-hover: "#3DBB96"
  secondary: "#4b5563"
  surface: "#ffffff"
  surface-panel: "#f8f9fb"
typography:
  body:
    fontFamily: '"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: 0.875rem
    lineHeight: 1.5
    fontWeight: 400
    letterSpacing: 0
  body-sm:
    fontFamily: '"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: 0.8125rem
    lineHeight: 1.45
    fontWeight: 400
    letterSpacing: 0
  caption:
    fontFamily: '"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: 0.75rem
    lineHeight: 1.3
    fontWeight: 500
    letterSpacing: 0.01em
  label:
    fontFamily: '"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: 0.9375rem
    lineHeight: 1.25
    fontWeight: 600
    letterSpacing: 0
  mono:
    fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", ui-monospace, monospace'
    fontSize: 0.8125rem
    lineHeight: 1.4
    fontWeight: 500
    letterSpacing: 0
  overline:
    fontFamily: '"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: 0.6875rem
    lineHeight: 1.2
    fontWeight: 700
    letterSpacing: 0.08em
  page-title:
    fontFamily: '"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: 1.5rem
    lineHeight: 2rem
    fontWeight: 700
    letterSpacing: -0.02em
  section-title:
    fontFamily: '"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: 1rem
    lineHeight: 1.5rem
    fontWeight: 600
    letterSpacing: -0.01em
  sidebar-label:
    fontFamily: '"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: 0.6875rem
    lineHeight: 1.2
    fontWeight: 700
    letterSpacing: 0.08em
rounded:
  action: 999px
  field: 12px
  full: 999px
  lg: 16px
  md: 12px
  sidebar-item: 12px
  sm: 8px
  xl: 24px
spacing:
  "0": 0px
  "1": 2px
  "2": 4px
  "3": 8px
  "4": 12px
  "5": 16px
  "6": 20px
  "7": 24px
  "8": 32px
  "9": 40px
  "10": 48px
  "12": 64px
  section: 24px
  stack: 16px
components:
  avatar-shape-circle:
    rounded: "{rounded.full}"
  avatar-shape-rounded:
    rounded: "{rounded.lg}"
  avatar-slot-fallback:
    textColor: "{colors.secondary}"
  avatar-tone-accent:
    backgroundColor: "{colors.primary}"
  button:
    rounded: "{rounded.action}"
  button-size-lg:
    padding: "{spacing.6}"
  button-size-md:
    padding: "{spacing.5}"
  button-size-sm:
    padding: "{spacing.4}"
  button-state-hover-primary:
    backgroundColor: "{colors.primary-hover}"
  button-tone-ghost:
    textColor: "{colors.secondary}"
  button-tone-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  overlay-shell-kind-panel-drawer:
    rounded: "{rounded.xl}"
  overlay-shell-slot-backdrop:
    padding: "{spacing.5}"
  overlay-shell-slot-content:
    padding: "{spacing.5}"
  overlay-shell-slot-footer:
    padding: "{spacing.5}"
  overlay-shell-slot-panel:
    rounded: "{rounded.xl}"
  overlay-shell-slot-sidebar:
    padding: "{spacing.5}"
  overlay-shell-slot-title:
    padding: "{spacing.5}"
  overlay-shell-slot-tooltip-bubble:
    padding: "{spacing.3}"
    rounded: "{rounded.sm}"
  sidebar-shell-affordance-badge:
    padding: "{spacing.1}"
    rounded: "{rounded.full}"
    textColor: "{colors.secondary}"
  sidebar-shell-affordance-count:
    padding: "{spacing.1}"
    rounded: "{rounded.full}"
    textColor: "{colors.secondary}"
  sidebar-shell-compound-active-description:
    textColor: "{colors.secondary}"
  sidebar-shell-compound-status-dot-inner:
    rounded: "{rounded.full}"
  sidebar-shell-slot-header:
    padding: "{spacing.5}"
  sidebar-shell-slot-item:
    padding: "{spacing.3}"
    rounded: "{rounded.sidebar-item}"
  sidebar-shell-slot-search:
    rounded: "{rounded.full}"
    textColor: "{colors.secondary}"
  sidebar-shell-slot-search-row:
    padding: "{spacing.4}"
  sidebar-shell-slot-section:
    padding: "{spacing.4}"
  sidebar-shell-slot-section-label:
    padding: "{spacing.4}"
  status-badge:
    padding: "{spacing.1}"
    rounded: "{rounded.full}"
  surface:
    rounded: "{rounded.lg}"
  surface-tone-card:
    backgroundColor: "{colors.surface}"
  surface-tone-panel:
    backgroundColor: "{colors.surface-panel}"
  text-field:
    padding: "{spacing.4}"
    rounded: "{rounded.field}"
  text-field-tone-search:
    rounded: "{rounded.full}"
  toggle:
    rounded: "{rounded.full}"
  toggle-slot-thumb:
    rounded: "{rounded.full}"
  toggle-state-on:
    backgroundColor: "{colors.primary}"
artifacts:
  designTokens: kit/design_tokens.json
  fullProjection: kit/design-projection.json
  tailwindTheme: kit/tailwind-theme.css
  runtimeCss: kit/ui/src/generated/theme-base.css
---

# Nimi Kit Design System

> AUTO-GENERATED by `scripts/generate-nimi-design-md.mjs`. Do not edit directly.
> Canonical authority remains `.nimi/spec/platform/kernel/**`; this file is the AI-readable DESIGN.md projection.

## Overview

Nimi Kit is the shared UI foundation for Nimi apps. It projects platform-owned semantic tokens, primitive contracts, and component usage rules into a compact DESIGN.md file that coding agents and design tools can read before touching UI/UX surfaces.

The product posture is industrial-grade, dense where needed, and explicit about ownership: app UI should consume Kit primitives first, extend Kit when a reusable primitive is missing, and avoid app-local design truth for shared interaction patterns.

## Colors

Colors come from `nimi-ui-tokens.yaml` and `nimi-ui-themes.yaml`. The front matter exposes Google DESIGN.md-compatible `colors` using the default foundation/accent values. `kit/design-projection.json` preserves every original Nimi token id, CSS variable, theme layer, source rule, and per-theme value.

- **danger** (#dc2626): projected from Nimi semantic UI tokens.
- **info** (#2563eb): projected from Nimi semantic UI tokens.
- **neutral** (#f5f7fa): projected from Nimi semantic UI tokens.
- **on-primary** (#111827): projected from Nimi semantic UI tokens.
- **primary** (#4ECCA3): projected from Nimi semantic UI tokens.
- **primary-hover** (#3DBB96): projected from Nimi semantic UI tokens.
- **secondary** (#4b5563): projected from Nimi semantic UI tokens.
- **success** (#16a34a): projected from Nimi semantic UI tokens.
- **surface** (#ffffff): projected from Nimi semantic UI tokens.
- **surface-panel** (#f8f9fb): projected from Nimi semantic UI tokens.
- **warning** (#d97706): projected from Nimi semantic UI tokens.

## Typography

Typography roles use semantic Nimi token ids and preserve CJK-specific line-height/tracking in the extension token map. UI agents should choose the smallest role that fits the surface and keep dense operational panels below hero-scale type.

- **body:** family `"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif`, size `0.875rem`, weight `400`, line height `1.5`, tracking `0`.
- **body-sm:** family `"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif`, size `0.8125rem`, weight `400`, line height `1.45`, tracking `0`.
- **caption:** family `"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif`, size `0.75rem`, weight `500`, line height `1.3`, tracking `0.01em`.
- **label:** family `"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif`, size `0.9375rem`, weight `600`, line height `1.25`, tracking `0`.
- **mono:** family `"JetBrains Mono", "SF Mono", "Fira Code", ui-monospace, monospace`, size `0.8125rem`, weight `500`, line height `1.4`, tracking `0`.
- **overline:** family `"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif`, size `0.6875rem`, weight `700`, line height `1.2`, tracking `0.08em`.
- **page-title:** family `"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif`, size `1.5rem`, weight `700`, line height `2rem`, tracking `-0.02em`.
- **section-title:** family `"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif`, size `1rem`, weight `600`, line height `1.5rem`, tracking `-0.01em`.
- **sidebar-label:** family `"Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif`, size `0.6875rem`, weight `700`, line height `1.2`, tracking `0.08em`.

## Layout

Layout uses the Nimi spacing scale, not ad hoc pixel values. Reusable page shells, galleries, settings panels, tables, form rows, and overlays must be composed from Kit primitives and documented compositions before app-local layout rules are added.

- `0`: `0px`
- `1`: `2px`
- `2`: `4px`
- `3`: `8px`
- `4`: `12px`
- `5`: `16px`
- `6`: `20px`
- `7`: `24px`
- `8`: `32px`
- `9`: `40px`
- `10`: `48px`
- `12`: `64px`
- `section`: `24px`
- `stack`: `16px`

## Elevation & Depth

Depth is conveyed through explicit semantic elevation and material tokens. Glass treatments are admitted only through Kit material primitives and must preserve contrast, reduced-transparency states, and stable borders.

- `elevation.base`: `0 8px 20px rgba(2,6,23,0.28)`
- `elevation.floating`: `0 18px 48px rgba(2,6,23,0.42)`
- `elevation.modal`: `0 28px 72px rgba(2,6,23,0.56)`
- `elevation.raised`: `0 14px 36px rgba(2,6,23,0.34)`

## Shapes

Shape language is tokenized through `radius.*`. Components must use the rounded scale from front matter rather than local radius literals.

- `action`: `999px`
- `field`: `12px`
- `full`: `999px`
- `lg`: `16px`
- `md`: `12px`
- `sidebar-item`: `12px`
- `sm`: `8px`
- `xl`: `24px`

## Components

Components map the Google DESIGN.md `components` object to the admitted Nimi primitive catalog. The richer `kit/design-projection.json` keeps slots, classes, variant groups, and source rules for precise implementation.

- `Button` (`primitive.action`): family `action`, source `P-DESIGN-012`; variants compound:3, modifier:1, size:3, state:7, tone:4.
- `ActionMenu` (`primitive.action_menu`): family `overlay`, source `P-DESIGN-013`; variants tone:1.
- `AmbientBackground` (`primitive.ambient_background`): family `surface`, source `P-DESIGN-023`; variants variant:3.
- `Avatar` (`primitive.avatar`): family `avatar`, source `P-DESIGN-010`; variants shape:2, size:3, tone:2.
- `Breadcrumb` (`primitive.breadcrumb`): family `navigation`, source `P-DESIGN-014`.
- `Checkbox` (`primitive.checkbox`): family `field`, source `P-DESIGN-015`.
- `ConfirmDialog` (`primitive.confirm_dialog`): family `overlay`, source `P-DESIGN-013`.
- `DataList` (`primitive.data_list`): family `data_display`, source `P-DESIGN-010`; variants state:1.
- `DataTable` (`primitive.data_table`): family `data_display`, source `P-DESIGN-010`.
- `EmptyState` (`primitive.empty_state`): family `feedback`, source `P-DESIGN-010`.
- `TextField` (`primitive.field`): family `field`, source `P-DESIGN-015`; variants modifier:1, state:4, tone:4.
- `FieldShell` (`primitive.field_shell`): family `field`, source `P-DESIGN-015`.
- `IconButton` (`primitive.icon_action`): family `action`, source `P-DESIGN-012`; variants modifier:1.
- `InlineAlert` (`primitive.inline_alert`): family `feedback`, source `P-DESIGN-010`; variants tone:5.
- `LoadingSkeleton` (`primitive.loading_skeleton`): family `feedback`, source `P-DESIGN-010`.
- `NumberStepper` (`primitive.number_stepper`): family `field`, source `P-DESIGN-015`.
- `OverlayShell` (`primitive.overlay`): family `overlay`, source `P-DESIGN-013`; variants kind_backdrop:3, kind_panel:3, size:5.
- `Pagination` (`primitive.pagination`): family `navigation`, source `P-DESIGN-014`; variants state:1.
- `ProgressIndicator` (`primitive.progress`): family `feedback`, source `P-DESIGN-010`.
- `ScrollArea` (`primitive.scroll_area`): family `scroll_area`, source `P-DESIGN-010`; variants state:1.
- `SegmentedControl` (`primitive.segmented_control`): family `action`, source `P-DESIGN-012`; variants size:2, state:1.
- `SelectField` (`primitive.select_field`): family `field`, source `P-DESIGN-015`.
- `SettingsPageShell` (`primitive.settings_shell`): family `settings`, source `P-DESIGN-010`.
- `SidebarShell` (`primitive.sidebar`): family `sidebar`, source `P-DESIGN-014`; variants affordance:4, compound:4, family:1, item_kind:3, item_state:2.
- `Slider` (`primitive.slider`): family `field`, source `P-DESIGN-015`.
- `Statistic` (`primitive.statistic`): family `data_display`, source `P-DESIGN-010`.
- `StatusBadge` (`primitive.status`): family `status`, source `P-DESIGN-010`; variants shape:3, tone:5.
- `Steps` (`primitive.steps`): family `navigation`, source `P-DESIGN-014`.
- `Surface` (`primitive.surface`): family `surface`, source `P-DESIGN-011`; variants elevation:4, material:5, state:4, tone:5.
- `NimiTabs` (`primitive.tabs`): family `navigation`, source `P-DESIGN-014`; variants state:1.
- `TextareaField` (`primitive.textarea`): family `field`, source `P-DESIGN-015`.
- `Toggle` (`primitive.toggle`): family `toggle`, source `P-DESIGN-010`; variants compound:1, state:3.
- `NimiText` (`primitive.typography`): family `typography`, source `P-DESIGN-016`; variants role:7.

Official component token aliases:

- `avatar-shape-circle`: rounded `{rounded.full}`.
- `avatar-shape-rounded`: rounded `{rounded.lg}`.
- `avatar-slot-fallback`: textColor `{colors.secondary}`.
- `avatar-tone-accent`: backgroundColor `{colors.primary}`.
- `button`: rounded `{rounded.action}`.
- `button-size-lg`: padding `{spacing.6}`.
- `button-size-md`: padding `{spacing.5}`.
- `button-size-sm`: padding `{spacing.4}`.
- `button-state-hover-primary`: backgroundColor `{colors.primary-hover}`.
- `button-tone-ghost`: textColor `{colors.secondary}`.
- `button-tone-primary`: backgroundColor `{colors.primary}`, textColor `{colors.on-primary}`.
- `overlay-shell-kind-panel-drawer`: rounded `{rounded.xl}`.
- `overlay-shell-slot-backdrop`: padding `{spacing.5}`.
- `overlay-shell-slot-content`: padding `{spacing.5}`.
- `overlay-shell-slot-footer`: padding `{spacing.5}`.
- `overlay-shell-slot-panel`: rounded `{rounded.xl}`.
- `overlay-shell-slot-sidebar`: padding `{spacing.5}`.
- `overlay-shell-slot-title`: padding `{spacing.5}`.
- `overlay-shell-slot-tooltip-bubble`: padding `{spacing.3}`, rounded `{rounded.sm}`.
- `sidebar-shell-affordance-badge`: padding `{spacing.1}`, rounded `{rounded.full}`, textColor `{colors.secondary}`.
- `sidebar-shell-affordance-count`: padding `{spacing.1}`, rounded `{rounded.full}`, textColor `{colors.secondary}`.
- `sidebar-shell-compound-active-description`: textColor `{colors.secondary}`.
- `sidebar-shell-compound-status-dot-inner`: rounded `{rounded.full}`.
- `sidebar-shell-slot-header`: padding `{spacing.5}`.
- `sidebar-shell-slot-item`: padding `{spacing.3}`, rounded `{rounded.sidebar-item}`.
- `sidebar-shell-slot-search`: rounded `{rounded.full}`, textColor `{colors.secondary}`.
- `sidebar-shell-slot-search-row`: padding `{spacing.4}`.
- `sidebar-shell-slot-section`: padding `{spacing.4}`.
- `sidebar-shell-slot-section-label`: padding `{spacing.4}`.
- `status-badge`: padding `{spacing.1}`, rounded `{rounded.full}`.
- `surface`: rounded `{rounded.lg}`.
- `surface-tone-card`: backgroundColor `{colors.surface}`.
- `surface-tone-panel`: backgroundColor `{colors.surface-panel}`.
- `text-field`: padding `{spacing.4}`, rounded `{rounded.field}`.
- `text-field-tone-search`: rounded `{rounded.full}`.
- `toggle`: rounded `{rounded.full}`.
- `toggle-slot-thumb`: rounded `{rounded.full}`.
- `toggle-state-on`: backgroundColor `{colors.primary}`.

## Do's and Don'ts

- Do consume `@nimiplatform/kit/ui` primitives before creating app-local UI chrome.
- Do update `.nimi/spec/platform/kernel/tables/nimi-ui-*.yaml` first when the design authority changes.
- Do regenerate this projection with `node scripts/generate-nimi-design-md.mjs --write` after admitted spec changes.
- Do verify drift with `node scripts/generate-nimi-design-md.mjs --check` and the relevant Kit gates.
- Do use `kit/design_tokens.json` and `kit/tailwind-theme.css` for Google-style tool interoperability adapted to Tailwind v4.
- Don't hand-edit `kit/DESIGN.md` or root `DESIGN.md`.
- Don't treat `kit/design_tokens.json` or `kit/tailwind-theme.css` as runtime authority; Nimi runtime CSS is still generated from `.nimi/spec` through `generate-nimi-ui-lib.mjs`.
- Don't create app-local token, radius, spacing, glass, or primitive truth for shared Nimi surfaces.
- Don't treat this file as stronger than `.nimi/spec/platform/kernel/**`; it is a generated projection.
