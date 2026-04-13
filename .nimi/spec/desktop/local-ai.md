# Local AI Domain Spec

> Normative Imports: `.nimi/spec/desktop/kernel/*`, `.nimi/spec/runtime/kernel/*`

## Scope

本地 AI 功能域 — Runtime Config 内的本地资产管理、dependency asset 管理、recommendation feed 页面、transfer/progress 展示，以及 Desktop 对 runtime 本地模型控制面的投影。

## Kernel References

### Runtime local control plane

- 本地模型 / artifact 的清单、状态、health、audit、import/install/download、orphan scaffold/adopt、transfer/progress 以 `.nimi/spec/runtime/kernel/rpc-surface.md` 的 `K-RPC-004 RuntimeLocalService` 为唯一规范真源。
- 获取/执行所有权、local chat installed-selectable 语义与 warm-on-demand 以 `.nimi/spec/runtime/kernel/local-category-capability.md`（`K-LOCAL-009`、`K-LOCAL-020a`、`K-LOCAL-028`）为准。

### Desktop bridge 投影

- Desktop renderer 必须优先消费 runtime typed local APIs；bridge 只负责把 host-native 能力与 runtime client 接起来。
- Tauri `runtime_local_*` 命令的规范边界见 `.nimi/spec/desktop/kernel/bridge-ipc-contract.md`（`D-IPC-011`、`D-IPC-012`）。它们只能承载 picker、reveal、notification 与少量 host helper，不得构成第二控制面。

### Security / Integrity

- 回环端点限制见 `D-SEC-001`。
- `verified` 与 `local_unverified` 完整性语义见 `D-SEC-006`；完整性校验/transfer 失败/健康判定的权威执行者是 runtime。

## Desktop 投影规则

- Local Model Center 的模型、artifact、transfer UI 必须全部反映 runtime 真源，不得读取或修复 Desktop host-local state。
- `Active Downloads` / `Active Imports` 必须来自 runtime transfer APIs，而不是 Tauri progress event。
- route options / resolve / health check 对 chat/text local model 的 readiness 判断必须固定使用 runtime authoritative local model list/status；host snapshot 只能补充标题、endpoint、catalog 辅助字段，不得单独决定 sendability。
- 当 host snapshot 与 runtime local state 出现 split-brain、degraded 或 missing authoritative record 时，Desktop 可以显示用户原先的本地选择，但必须 fail-close 为不可发送状态并附带诊断原因。
- Desktop host 只提供原生壳能力：
  - file picker / manifest picker
  - reveal-in-folder / reveal-root
  - notification
  - 仍未下沉到 runtime 的 host helper surface

## Product Semantics

- chat/text 本地模型以 runtime readiness 为准；`active` 表示已通过 runtime 可执行校验，`installed` 表示仍可展示/选择但请求时必须由 runtime 先 warm。
- media/image/video 本地 readiness 不在本域放宽，继续遵循 runtime kernel 的更严格规则。
- Local Model Center 是状态展示，不再是手动启停控制台；Desktop 不提供本地模型行内 start/stop toggle。
- `active` 表示模型已通过 runtime readiness 校验并可被选择，不要求常驻运行；`installed` 不再等价于 ready，只表示 runtime 已登记且允许 warm-on-demand。

## Error Families

本域引用的错误码族：

- `LOCAL_AI_IMPORT_*`
- `LOCAL_AI_MODEL_*`
- `LOCAL_AI_ENDPOINT_*`
- `LOCAL_AI_SPEECH_*`
- `LOCAL_AI_HF_DOWNLOAD_*`
- `LOCAL_AI_FILE_IMPORT_*`

权威来源：`.nimi/spec/desktop/kernel/tables/error-codes.yaml`

## CI 门禁引用

- `pnpm check:desktop-spec-kernel-consistency`
- `pnpm check:desktop-spec-kernel-docs-drift`
- `pnpm check:local-chat-e2e`

## Offline / Degradation

Realm 离线不阻断本地模型管理；Runtime 不可达时，本域所有 local model 管理、transfer 与 lifecycle 路径必须 fail-close。详细降级语义回指 `kernel/offline-degradation-contract.md`。
