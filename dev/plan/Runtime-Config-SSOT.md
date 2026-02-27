# Runtime Config SSOT（全链路）制定方案

## 摘要
本方案定义一份新的 Runtime Config SSOT，覆盖 `runtime` 读取、`nimi-cli` 作为唯一写入口、`nimi-desktop` 通过桥接读取与调用 CLI 写入的完整流程。  
已锁定决策如下：  
1. 标准路径迁移到 `~/.nimi/config.json`。  
2. 迁移策略为“自动迁移后硬切换”。  
3. 配置变更采用“重启生效”，不做运行中热加载。  
4. 写入主权归 `nimi-cli`（desktop 不直接写文件）。  
5. 密钥只允许 env/vault 引用，不允许明文 `apiKey` 落盘。  

## 目标产物
1. 新增 SSOT 文档：[ssot/runtime/config-contract.md](/Users/snwozy/nimi-realm/nimi/ssot/runtime/config-contract.md)。  
2. 注册追溯矩阵：[ssot/_meta/traceability-matrix.md](/Users/snwozy/nimi-realm/nimi/ssot/_meta/traceability-matrix.md)。  
3. 更新 SSOT 导航：[docs/architecture/ssot.md](/Users/snwozy/nimi-realm/nimi/docs/architecture/ssot.md)。  
4. 在 Runtime 主合同增加引用：[ssot/runtime/service-contract.md](/Users/snwozy/nimi-realm/nimi/ssot/runtime/service-contract.md)。  
5. 在 runtime 文档改为引用 SSOT 规则而非散落描述：[runtime/README.md](/Users/snwozy/nimi-realm/nimi/runtime/README.md)、[docs/getting-started/README.md](/Users/snwozy/nimi-realm/nimi/docs/getting-started/README.md)。  

## 公共接口/类型变更（SSOT 约束）
1. **配置路径合同**：默认路径由 `~/.nimi/runtime/config.json` 切换为 `~/.nimi/config.json`，`NIMI_RUNTIME_CONFIG_PATH` 继续最高优先级覆盖。  
2. **配置文件 Schema**：顶层新增 `schemaVersion`（固定 `1`），保留 `runtime` 与 `ai.providers` 结构。  
3. **密钥字段合同**：`ai.providers.*.apiKey` 在 SSOT 中标记为禁止；仅允许 `apiKeyEnv`（以及未来 `secretRef` 扩展位）。  
4. **CLI 合同新增**：`nimi config init|get|set|validate|migrate`（`set` 为唯一写入口）。  
5. **Desktop 桥接合同新增**：desktop 仅通过 tauri command 调 CLI 子命令完成读写，不直接 `fs::write` 配置文件。  
6. **生效语义合同**：配置修改后必须 `restart runtime` 才生效；禁止 watch/hot-reload。  

## SSOT 文档结构（决策完成）
按模板固定 6 章书写，并在每章写 `MUST/SHOULD` 规则。

1. **Goals and Scope**  
明确“Runtime Config 是 runtime 启动与 provider 连接的唯一配置真相”，同时覆盖 runtime/cli/desktop 三方职责。

2. **Domain Boundaries**  
定义边界：  
`runtime` 负责读+校验+环境投影；  
`cli` 负责唯一写入与迁移执行；  
`desktop` 负责展示与调用 CLI，不直接写文件；  
UI 偏好状态（localStorage）不属于 Runtime Config 真相域。

3. **Contract**  
写成可实现的硬规则：  
1. 路径解析顺序：`NIMI_RUNTIME_CONFIG_PATH` -> `~/.nimi/config.json`。  
2. 自动迁移算法：当未设置 `NIMI_RUNTIME_CONFIG_PATH` 且新路径不存在且旧路径 `~/.nimi/runtime/config.json` 存在时，执行一次迁移，再只认新路径。  
3. 优先级：`CLI flags > ENV > config file > built-in defaults`。  
4. schema 字段与默认值表（grpc/http/shutdown/ai timeout/health interval/providers）。  
5. provider 命名规范与 env 绑定规范（含 alias 规则，如 gemini key fallback）。  
6. secret policy：禁止明文 `apiKey`；`apiKeyEnv` 必填。  
7. 写入策略：仅 CLI 写，原子写入+文件锁+校验后落盘。  
8. 生效策略：restart required。  

4. **Failure Semantics (`reasonCode` / `actionHint`)**  
定义统一失败码（配置域）：  
`CONFIG_PARSE_FAILED`、`CONFIG_SCHEMA_INVALID`、`CONFIG_MIGRATION_FAILED`、`CONFIG_WRITE_LOCKED`、`CONFIG_SECRET_POLICY_VIOLATION`、`CONFIG_RESTART_REQUIRED`。  
每个 reasonCode 绑定 actionHint（例如“运行 `nimi config validate`”“执行 `nimi config migrate`”“重启 runtime”）。

5. **Acceptance and Test Gates**  
明确门禁命令与场景：  
1. runtime 单测覆盖迁移、优先级、默认值、provider env 映射、secret policy。  
2. CLI 单测覆盖 init/get/set/validate/migrate。  
3. desktop tauri 单测覆盖“读取新路径+调用 CLI 写入+错误冒泡”。  
4. 集成场景覆盖“从旧路径自动迁移后启动成功并且仅新路径生效”。  

6. **Change Policy**  
定义演进规则：  
1. Schema 仅允许向后兼容加字段。  
2. 破坏性变更必须提升 `schemaVersion` 并提供 `migrate` 子命令升级路径。  
3. 新 provider 入表必须同步：schema 示例、env 绑定、默认值、测试、文档矩阵。  

## 实施顺序（文档先行）
1. 先写 `ssot/runtime/config-contract.md`，状态 `ACTIVE`，frontmatter 完整。  
2. 同步 traceability matrix 注册。  
3. 同步 SSOT map 与 runtime/getting-started 文档引用。  
4. 在 `dev/plan/` 写一份实现计划文档，将“当前实现与 SSOT 的差距”列为执行清单。  
5. 后续代码改造严格按 SSOT 合同执行，不再反向定义规则。  

## 测试场景清单（后续实现必须通过）
1. **路径迁移**：仅旧路径存在时自动迁移并启动成功。  
2. **硬切换**：迁移完成后修改旧路径不再影响 runtime。  
3. **优先级**：CLI 覆盖 ENV、ENV 覆盖文件。  
4. **密钥策略**：配置中出现 `apiKey` 明文即校验失败。  
5. **重启生效**：运行中改配置不会即时生效，重启后生效。  
6. **并发写**：两个 CLI `set` 并发，只有一个成功写入，另一个返回 `CONFIG_WRITE_LOCKED`。  
7. **desktop 路径一致性**：desktop 状态面板读到的 grpc/http 与 CLI `config get` 一致。  

## 明确假设与默认值
1. SSOT 采用中文主文档风格，与现有 runtime SSOT 一致。  
2. 默认配置文件路径固定为 `~/.nimi/config.json`。  
3. 自动迁移只在“未显式指定 `NIMI_RUNTIME_CONFIG_PATH`”时触发。  
4. 不引入长期双路径兼容。  
5. 不引入运行中热加载。  
6. CLI 是唯一写入口；desktop 不直接写文件。  
7. 密钥只允许 env/vault 引用，不允许明文落盘。  
