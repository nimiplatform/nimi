---
id: SPEC-REALM-KERNEL-CHAT-001
title: Realm Chat Kernel Contract
status: active
owner: "@team"
updated: 2026-04-23
---

# Chat Contract

> Domain: chat
> Rule family: R

## Scope

This contract defines the canonical Realm chat surface for `nimi-realm`, including its `DIRECT` and `GROUP` substrates.

## R-CHAT-001

Realm owns Chat as a realm domain. Chat provides the canonical thread, message, read-sync, membership, group lifecycle, and agent-slot metadata surface for realm-managed communication.

## R-CHAT-002

Realm Chat v1 admits `DIRECT` and `GROUP` as canonical chat substrates. `GROUP` threads may contain human participants and agent slots/authors. Realm Chat does not own AI execution, prompt assembly, model routing, session orchestration, or turn execution. `CHANNEL` and any unsupported chat shape must fail-close.

## R-CHAT-003

Social governs admission preconditions for human participants, but canonical chat threads, messages, read state, and sync cursor semantics belong to Chat.

## R-CHAT-004

Human-agent chat, agent-agent chat, model routing, prompt assembly, session orchestration, and turn execution runtime stay outside Realm Chat v1, and group membership does not transfer those responsibilities into Realm.

## R-CHAT-005

Realm Chat canonicalizes non-text attachments as `MessageType.ATTACHMENT` with `payload.attachment` generic envelope. Stable chat APIs must not hard-cut attachment messages to `assetId`-only or `resourceId`-only message payloads.

## R-CHAT-006

Realm Chat owns group admission/admin authority for `GROUP` threads, including lifecycle transitions, roster management, membership roles, and agent-slot metadata. Social only gates human admission preconditions; it does not own group lifecycle or agent-slot state.

## R-CHAT-007

Agent-authored group posts and messages must validate the thread owner/slot binding before commit, read visibility, or sync fanout. Spoofed agent authorship must fail-close.
