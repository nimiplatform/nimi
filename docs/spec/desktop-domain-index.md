# Desktop 迁移域索引

Desktop 的 canonical product authority 已迁至 `.nimi/spec/desktop/**`。本页只提供迁移后的定位清单，不定义规则，也不把 `config/**` 或 `docs/authority/**` 提升为 authority。

## Canonical authority 容器

- `.nimi/spec/desktop/agent-projection.authority.yaml`
- `.nimi/spec/desktop/ai-consumption.authority.yaml`
- `.nimi/spec/desktop/bridge-ipc.authority.yaml`
- `.nimi/spec/desktop/command-execution.authority.yaml`
- `.nimi/spec/desktop/product-surfaces.authority.yaml`
- `.nimi/spec/desktop/shell-runtime.authority.yaml`
- `.nimi/spec/desktop/shell-ui.authority.yaml`

## Non-authoritative machine config

- `config/desktop-agent-projection-avatar-surface.yaml`
- `config/desktop-agent-projection-conversation-capabilities.yaml`
- `config/desktop-agent-projection-delegation.yaml`
- `config/desktop-agent-projection-participation.yaml`
- `config/desktop-ai-consumption-llm-adapter.yaml`
- `config/desktop-ai-consumption-streaming.yaml`
- `config/desktop-command-execution-classification.yaml`
- `config/desktop-ipc-commands.yaml`
- `config/desktop-local-app-control-surfaces.yaml`
- `config/desktop-local-app-launch-hosts.yaml`
- `config/desktop-open-targets.yaml`
- `config/desktop-product-surfaces-explore-sections.yaml`
- `config/desktop-product-surfaces-home-feed-scopes.yaml`
- `config/desktop-product-surfaces-relationship-categories.yaml`
- `config/desktop-product-surfaces-relationship-friend-request-states.yaml`
- `config/desktop-realm-source-materialization-actions.yaml`
- `config/desktop-shell-runtime-bootstrap-phases.yaml`
- `config/desktop-shell-runtime-data-sync-flows.yaml`
- `config/desktop-shell-runtime-feature-flags.yaml`
- `config/desktop-shell-runtime-retry-status-codes.yaml`
- `config/desktop-shell-runtime-store-slices.yaml`
- `config/desktop-shell-ui-app-tabs.yaml`
- `config/desktop-shell-ui-build-chunks.yaml`
- `config/desktop-shell-ui-error-codes.yaml`
- `config/desktop-shell-ui-home-surfaces.yaml`
- `config/desktop-shell-ui-kit-adoption.yaml`
- `config/desktop-shell-ui-kit-allowlists.yaml`
- `config/desktop-shell-ui-kit-compositions.yaml`
- `config/desktop-shell-ui-log-areas.yaml`
- `config/desktop-shell-ui-renderer-design-allowlists.yaml`
- `config/desktop-shell-ui-renderer-design-overlays.yaml`
- `config/desktop-shell-ui-renderer-design-sidebars.yaml`
- `config/desktop-shell-ui-renderer-design-surfaces.yaml`
- `config/desktop-shell-ui-renderer-design-tokens.yaml`

## Non-authoritative rationale

- `docs/authority/desktop-agent-projection-rationale.md`
- `docs/authority/desktop-ai-consumption-rationale.md`
- `docs/authority/desktop-bridge-ipc-rationale.md`
- `docs/authority/desktop-command-execution-rationale.md`
- `docs/authority/desktop-product-surfaces-rationale.md`
- `docs/authority/desktop-shell-runtime-rationale.md`
- `docs/authority/desktop-shell-ui-rationale.md`
- `docs/authority/desktop-testing-gates-rationale.md`

## 迁移边界

`.nimi/spec/desktop/**` 不再承载 Desktop product authority 或 machine config。除本迁移索引外，本目录中的任何余件均为待迁素材，不得作为 canonical authority、并行事实源或配置消费入口。
