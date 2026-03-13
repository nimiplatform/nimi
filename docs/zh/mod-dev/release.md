# Nimi Mod 发布与第三方申请处理指南（中文）

本指南是 Nimi desktop mod 发布、catalog 上架与第三方申请处理的操作手册。

若你要查看 `nimi-mods/` 中官方 mod 的 maintainer 逐步发布手册，请直接看仓库根目录下的 `nimi-mods/RELEASE.md`。

规范真相源仍在：

- [`spec/desktop/mod-hub.md`](../../../spec/desktop/mod-hub.md)
- [`spec/desktop/kernel/mod-governance-contract.md`](../../../spec/desktop/kernel/mod-governance-contract.md)
- [`apps/desktop/docs/mod-runtime-layout-contract.md`](../../../apps/desktop/docs/mod-runtime-layout-contract.md)
- [`RELEASE.md`](../../../RELEASE.md)

本指南直接对应的 Desktop kernel 规则锚点：

- `D-MOD-016`：catalog 发布真相源与可见性
- `D-MOD-017`：第三方包所有权边界
- `D-MOD-018`：trust tier 分配语义
- `D-MOD-019`：第三方更新复审与风险处置

英文版对应文档见 [`mod-release.md`](./release.md)。

## 0. 一页结论

Nimi v1 的 mod 发布遵循三层分工：

1. `nimi-mods/` 只放官方维护 mod 的源码与验证工作区。
2. GitHub Release 负责承载不可变发布资产：`.zip` 和 `release.manifest.json`。
3. 独立 catalog repo 才是 desktop 实际可见的上架真相源。

对于第三方 mod，默认原则不是“合源码到 `nimi-mods/`”，而是：

1. 作者保留自己的 source repo。
2. 作者自己发布 release 资产。
3. Nimi 通过 catalog review 决定是否上架以及授予什么 trust tier。

## 1. 关键角色与仓库分工

- `nimi-mods/`：官方 mod 源码工作区，仅用于 Nimi 官方维护的包。
- 第三方 mod source repo：第三方作者自有仓库，负责代码、构建和 release。
- mod GitHub Release：承载 `.zip` 与 `release.manifest.json`。
- catalog repo：承载 `index/v1/**`、`signers.json`、`revocations.json`、`advisories.json`。
- desktop：消费 catalog，执行校验、安装、更新、回滚。

不要把 source repo 直接当 Mod Hub，也不要让 desktop 直接扫描源码仓。

## 2. Trust tier 定义

- `official`：Nimi 官方维护、官方签名、官方发布。
- `verified`：第三方拥有包所有权，但通过了发布者身份与 signer 链校验。
- `community`：第三方可公开上架，但未经过完整 identity verification。

`verified` 只代表信任级别变化，不代表第三方源码必须迁入 `nimi-mods/`。

## 3. 每个 release 必须包含什么

每个可 catalog 化的 mod release 必须公开发布：

1. 一个预构建 `.zip`
2. 一个 sidecar `release.manifest.json`
3. 稳定可访问的下载 URL

`release.manifest.json` 至少应包含：

- `packageType=desktop-mod`
- `packageId`
- `version`
- `channel`
- `artifactUrl`
- `sha256`
- `signature`
- `signerId`
- `minDesktopVersion`
- `minHookApiVersion`
- `capabilities`
- `publisher`
- `source`
- `state`

catalog schema 允许未来出现 `packageType=nimi-app`，但 desktop v1 不安装它。

## 4. 官方 mod 发布边界

官方 first-party mod 的具体发布操作来自 `nimi-mods/` 工作区，但它们最终仍通过平台级 catalog 流程上架。

边界拆分如下：

- maintainer 操作手册：`nimi-mods/RELEASE.md`
- 平台治理与 Desktop 可见性规则：本指南

需要记住的三点平台级规则：

1. GitHub Release 资产只是不可变发布资产，不自动等于“已上架”。
2. 只有 catalog PR 合并并对外发布后，Desktop 才会把该版本视为可见/可安装目标。
3. official release automation 仍运行在主仓，因为它同时依赖 `nimi-mods/` 源码与 catalog 更新脚本。

## 5. 第三方 mod 的上架原则

第三方 mod 采用“listing 模式”，不采用“默认合入源码仓模式”。

默认规则：

1. 第三方源码保留在作者自己的 repo。
2. 作者自己发布 release 资产。
3. Nimi 通过 catalog review 决定是否上架。

处理结果可能是：

- `community`
- `verified`
- 驳回
- 暂缓，等待补资料

## 6. 第三方作者提交前 checklist

提交 catalog 申请前，作者必须准备：

1. 公开 source repository
2. 公开可访问的 `.zip` 下载地址
3. 公开可访问的 `release.manifest.json`
4. 稳定且不冲突的 `packageId`
5. capabilities 列表及用途说明
6. 已测试的 desktop 兼容性信息
7. 维护者联系方式与后续更新 owner
8. license 与归属信息

强烈建议：

1. 从 [`examples/mod-template`](../../../examples/mod-template/README.md) 起步
2. 在自己 repo 里先跑 `pnpm build`、`pnpm doctor`、`pnpm pack`
3. release 资产发布后保持不可变

## 7. 第三方申请处理流程

### 7.1 提交 intake

第三方作者通过本仓的 `Mod submission` issue 模板提交申请，至少提供：

- `packageId`
- `version`
- source repository
- `.zip` URL
- `release.manifest.json` URL
- capability 说明
- compatibility 说明
- requested trust tier
- maintainer contact

issue 只代表 intake，不代表已上架。

### 7.2 初筛 triage

maintainer 首先做快速 triage：

1. 资产 URL 是否可访问
2. `release.manifest.json` 是否能解析
3. `packageType` 是否符合当前支持范围
4. `packageId` 是否与现有 owner 冲突
5. capability 说明是否可理解
6. 是否试图引入不支持的安装语义

常见 triage 结果：

- `needs-info`
- `under-review`
- `rejected`
- `ready-for-catalog-pr`

### 7.3 技术审查

进入技术审查后，maintainer 需要核对：

1. 下载产物的 digest 是否匹配
2. signature 与 signer 字段是否自洽
3. `minDesktopVersion` / `minHookApiVersion` 是否合理
4. manifest capabilities 是否和声明行为一致
5. mod 是否绕过 `nimi-hook`
6. 是否能作为预构建 archive 安装
7. 是否存在路径穿越、错误布局或明显畸形元数据

如果申请 `verified`，还需要额外核对：

1. publisher 身份
2. signer 所有权与公钥连续性
3. 同一 `packageId` 的 ownership 连续性

### 7.4 Trust tier 决策

决策原则：

- `official`：仅限 Nimi 官方维护且来自 `nimi-mods/`
- `verified`：第三方通过身份与 signer 链审查
- `community`：第三方通过基本上架审查，但不授予 verified
- `reject`：安全、所有权、质量或治理不满足要求

### 7.5 生成 catalog 更新

批准后，catalog repo 需要：

1. 新增或更新 `packages/<packageId>.json`
2. 新增 `releases/<packageId>/<version>.json`
3. 更新 `packages.json`
4. 必要时更新 signer registry
5. 必要时检查 `revocations.json` / `advisories.json`
6. 创建 catalog PR 并通过校验

注意：

- source repo 仍是包的 owner of record
- 只是 catalog 被更新，不代表源码迁移

### 7.6 合并后生效

catalog PR 合并后：

1. package 才会通过 catalog 对 desktop 可见
2. install / update policy 才会按对应 trust tier 生效

### 7.7 后续版本更新

第三方作者后续更新不需要把源码提交到 `nimi-mods/`。

正确流程是：

1. 在自己的 repo 发布新版本 release
2. 保持 `packageId` 所有权连续
3. 更新 `release.manifest.json`
4. 再次请求 catalog 更新

以下情况需要重新重点审查：

- signer 变更
- publisher 变更
- capability 集显著扩大
- 申请提升 trust tier

## 8. Maintainer 处理 checklist

### 8.1 Intake checklist

- 链接可访问
- `release.manifest.json` 可公开访问
- zip 可公开下载
- `packageId` 未占用官方命名空间
- 包描述可理解

### 8.2 Technical checklist

- digest 匹配
- signature / signer 字段完整
- package layout 合法
- capabilities 有合理解释
- `minDesktopVersion` 没有低于支持基线
- 没有 boundary bypass

### 8.3 Governance checklist

- trust tier 明确
- publisher display name 合理
- signer registry 已存在或 PR 中补充
- 没有命中 revocation / block advisory
- 后续维护 owner 清晰

### 8.4 Merge checklist

- catalog diff 只改了目标包相关文件
- release record 保持 immutable
- channel pointer 正确
- merge 后 host 会暴露新 catalog 文件

## 9. 驳回与升级规则

以下情况应驳回或挂起：

- artifact 与 manifest 不匹配
- package ownership 不清晰
- `verified` 申请缺少 signer / identity 证明
- capability 过大且无法自圆其说
- 依赖不支持的安装期编译或源码拉取
- archive 布局不安全或不合法

以下情况应升级到安全或治理审查：

- 已上架包突然更换 signer
- package ownership 有争议
- 已上架包疑似恶意或被供应链污染
- 请求的 trust tier 与证据明显不匹配

## 10. Yank、Quarantine、Revocation、Advisory Block

不要回写历史 release 文件来“擦掉问题版本”，而应通过 catalog overlay 处理。

- `yank`：版本仍可见，但不再推荐或自动升级到该版本
- `quarantine`：视为高风险，阻断正常安装流
- `revocation`：撤销 package / release / signer 身份
- advisory `block`：desktop 必须硬阻断 install/update

当已上架第三方包出现风险时，建议流程：

1. 立刻开 catalog PR
2. 更新 `revocations.json` 和/或 `advisories.json`
3. 必要时调整 package state
4. 通过 submission issue 或 repo 联系方式通知作者

## 11. 推荐的职责拆分

建议始终保持三层职责分离：

- source repo：代码、构建、pack、GitHub Release 资产
- catalog repo：上架、trust tier、revocation、advisory、搜索索引
- desktop：校验、安装、更新、回滚

这就是 Nimi v1 的基本治理模型，不应回退成“扫描 `nimi-mods/` 源码树当商店”的模式。
