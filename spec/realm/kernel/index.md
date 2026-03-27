---
id: SPEC-REALM-KERNEL-INDEX-001
title: Realm Kernel Index
status: active
owner: "@team"
updated: 2026-03-26
---

# Realm Kernel Index

## Contracts

- `truth-contract.md` (`R-TRUTH-*`)
- `world-state-contract.md` (`R-WSTATE-*`)
- `world-history-contract.md` (`R-WHIST-*`)
- `agent-memory-contract.md` (`R-MEM-*`)
- `chat-contract.md` (`R-CHAT-*`)
- `resource-contract.md` (`R-RSRC-*`)
- `attachment-contract.md` (`R-ATTACH-*`)
- `social-contract.md` (`R-SOC-*`)
- `economy-contract.md` (`R-ECON-*`)
- `asset-contract.md` (`R-ASSET-*`)
- `bundle-contract.md` (`R-BNDL-*`)
- `transit-contract.md` (`R-TRANSIT-*`)

`R-BIND-*` 对应的 binding contract / enums / alignment 条目当前不在本仓反推，必须等待上游权威正文后再同步；在此之前以 `tables/under-spec-registry.yaml` 记录阻塞状态。

## Blocked External Bindings

`R-BIND-*` 相关条目当前只允许以阻塞元数据形式出现在本仓表格中，用于记录缺口本身与上游 blocker；不得在本仓反推 binding 规则正文、枚举语义或写入授权事实。权威阻塞来源固定为 `tables/under-spec-registry.yaml` 中的 `U4`。

## Tables

- `tables/rule-catalog.yaml`
- `tables/rule-evidence.yaml`
- `tables/commit-authorization-matrix.yaml`
- `tables/object-write-authorization.yaml`
- `tables/truth-contract.yaml`
- `tables/world-state-contract.yaml`
- `tables/world-history-contract.yaml`
- `tables/agent-memory-contract.yaml`
- `tables/chat-contract.yaml`
- `tables/resource-contract.yaml`
- `tables/attachment-contract.yaml`
- `tables/social-contract.yaml`
- `tables/economy-contract.yaml`
- `tables/asset-contract.yaml`
- `tables/bundle-contract.yaml`
- `tables/transit-contract.yaml`
- `tables/domain-enums.yaml`
- `tables/domain-state-machines.yaml`
- `tables/open-spec-alignment-map.yaml`
- `tables/under-spec-registry.yaml`

## Generated

- `generated/index.md`
- `generated/rule-catalog.md`
- `generated/rule-evidence.md`
- `generated/commit-authorization-matrix.md`
- `generated/object-write-authorization.md`
- `generated/truth-contract.md`
- `generated/world-state-contract.md`
- `generated/world-history-contract.md`
- `generated/agent-memory-contract.md`
- `generated/chat-contract.md`
- `generated/resource-contract.md`
- `generated/attachment-contract.md`
- `generated/social-contract.md`
- `generated/economy-contract.md`
- `generated/asset-contract.md`
- `generated/bundle-contract.md`
- `generated/transit-contract.md`
- `generated/domain-enums.md`
- `generated/domain-state-machines.md`
- `generated/open-spec-alignment-map.md`
- `generated/under-spec-registry.md`
