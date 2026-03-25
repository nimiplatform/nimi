---
id: SPEC-REALM-KERNEL-ATTACHMENT-001
title: Realm Attachment Kernel Contract
status: active
owner: "@team"
updated: 2026-03-25
---

# Attachment Contract

> Domain: attachment
> Rule family: R

## Scope

This contract defines `Attachment` as the generic realm-level envelope used by `Post` and `Chat` to attach typed targets without collapsing them into a resource-only contract.

## R-ATTACH-001

Realm `Attachment` is a first-class cross-surface envelope with stable `targetType + targetId` identity. It is distinct from `Resource`, `OwnableAsset`, and `Bundle`, and it does not redefine ownership or lifecycle truth of those target domains.

## R-ATTACH-002

Active attachment targets are fixed to `RESOURCE`, `ASSET`, and `BUNDLE`. Write surfaces persist target references only; read surfaces may resolve display metadata without changing canonical target identity or introducing attachment-level owner/viewer policy.

## R-ATTACH-003

Post attachment persistence uses ordered `PostAttachment` relations. Chat non-text attachment messages use `MessageType.ATTACHMENT` with canonical `payload.attachment` envelope shape.

## R-ATTACH-004

Resolved read models may expose `displayKind`, delivery URLs, thumbnails, duration, titles, subtitles, and nested `preview` attachments for card targets. Surface readability authorizes preview resolution; stable APIs must not hard-cut back to `resourceId`-only or `assetId`-only attachment contracts.
