# ParentOS (成长底稿) Product Guide

This file is guide-only. Normative ParentOS authority lives in [kernel/index.md](kernel/index.md).

## Product Positioning

ParentOS is a local-first desktop app for child growth records, reminders, journaling, and AI-assisted summaries. The current implementation baseline is a Tauri desktop shell with local SQLite storage, React renderer surfaces, spec-backed reminder and observation knowledge bases, and bounded runtime-assisted AI surfaces.

Current public surfaces include:

- timeline and reminders
- child profile plus health subpages
- journal with text, photo, voice, and closed-set AI tag suggestion
- advisor chat with prompt-strategy routing over a local runtime path
- reports with structured-local and narrative report payloads
- settings for children, nurture mode, reminder frequency, and AI model/runtime preferences

## Non-Goals

ParentOS does not currently target:

- social/community features
- e-commerce or product recommendation
- online diagnosis or treatment guidance
- comparative child ranking
- cloud-first storage as a prerequisite for use

## AI Surface Summary

The authority details live in [kernel/profile-contract.md](kernel/profile-contract.md), [kernel/advisor-contract.md](kernel/advisor-contract.md), and [kernel/journal-contract.md](kernel/journal-contract.md).

At a product level:

- profile sub-pages may use bounded runtime summaries from current local records, and admitted OCR surfaces may extract structured candidates from one selected local image
- advisor chat always uses the local runtime when available, but switches between generic-chat, reviewed-advice, needs-review-descriptive, and unknown-clarifier strategies
- reports may generate narrative content from local child records, but must stay descriptive and pass safety filtering
- journal AI tagging is a closed-set extraction surface only
- diagnosis, treatment, ranking, and alarmist wording remain outside scope

## Reading Path

Use [INDEX.md](INDEX.md) first, then [kernel/index.md](kernel/index.md), then the relevant contract and tables.

Recommended authority path by task:

- shell or settings work: [kernel/app-shell-contract.md](kernel/app-shell-contract.md)
- reminders or timeline work: [kernel/timeline-contract.md](kernel/timeline-contract.md)
- profile and health record work: [kernel/profile-contract.md](kernel/profile-contract.md)
- journal work: [kernel/journal-contract.md](kernel/journal-contract.md)
- advisor, reports, or AI boundary work: [kernel/advisor-contract.md](kernel/advisor-contract.md)

## Known Defects Outside Authority

The following are current implementation defects or backlog items. They are intentionally not admitted as product authority:

- vaccine reminder placeholders that write future vaccine rows as a reminder surrogate
- silent error swallowing and other fail-open bootstrap/runtime behavior
- typed bridge coercion that invents empty-string defaults or field aliases
- `vision-batch-form.tsx` silently ignores OCR failures instead of surfacing a fail-close error
- orphan or unrouted surfaces that do not have kernel authority
- `report-history-page.tsx` remains an orphan surface and still queries unsupported `ocr-upload` report types
- stale or incomplete drift checks that fail to detect extra implementation surfaces
