# Open Source Governance

> Domain: Platform / Governance
> Status: Active
> Date: 2026-03-01

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/governance-contract.md` | P-GOV-001–020 |

## 1. 文档定位

本文件是开源治理域增量文档。开源边界与许可证矩阵见 P-GOV-001、P-GOV-002。发布门禁见 P-GOV-003。

## 2. 治理缺口模型

优先级模型见 P-GOV-010。治理任务清单见 P-GOV-020。

## 3. 8-PR 落地路线

| PR | 目标 |
|---|---|
| PR-01 | Dependabot 全覆盖 |
| PR-02 | 安全扫描与机密基线 |
| PR-03 | Runtime 发布自动化 |
| PR-04 | 全量发布流水线 |
| PR-05 | 覆盖率门禁 |
| PR-06 | CI 拓扑与并发治理 |
| PR-07 | 开发者质量工具链 |
| PR-08 | 社区治理补齐 |

## 4. Go/No-Go 发布门禁

见 P-GOV-011。

## 5. 验收命令基线

```bash
pnpm lint
pnpm check:markdown
pnpm test
pnpm proto:lint
pnpm proto:breaking
pnpm proto:drift-check
cd runtime && go test ./... && go vet ./...
cd runtime && govulncheck ./...
pnpm audit --prod --audit-level=high
```

## 6. 维护规则

新增或变更开源治理能力时，先改 spec，再改实现。执行态证据写入 `dev/report/*`。
