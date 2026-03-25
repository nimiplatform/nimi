---
id: SPEC-REALM-KERNEL-CHAT-001
title: Realm Chat Kernel Contract
status: active
owner: "@team"
updated: 2026-03-25
---

# Chat Contract

> Domain: chat
> Rule family: R

## Scope

This contract defines the canonical Realm chat surface for `nimi-realm`.

## R-CHAT-001

Realm owns Chat as a realm domain. Chat provides the canonical thread/message/read-sync surface for realm-managed communication.

## R-CHAT-002

Realm Chat v1 supports only `HUMAN_HUMAN` `DIRECT` chat. Group, channel, and any non-human participant chat must fail-close.

## R-CHAT-003

Social governs admission and preconditions for human chat, but canonical chat threads, messages, read state, and sync cursor semantics belong to Chat.

## R-CHAT-004

Human-agent chat, agent-agent chat, model routing, prompt assembly, session orchestration, and turn execution runtime stay outside Realm Chat v1.

## R-CHAT-005

Realm Chat canonicalizes non-text attachments as `MessageType.ATTACHMENT` with `payload.attachment` generic envelope. Stable chat APIs must not hard-cut attachment messages to `assetId`-only or `resourceId`-only message payloads.
