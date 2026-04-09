# Desktop Mod Codegen Playbook

## 1. 入口与治理链
Anchors: D-CODEGEN-001, D-CODEGEN-060

codegen 入口必须进入统一治理链；`source_type=codegen` 只使用最小权限 allowlist。

## 2. 产物结构与预检
Anchors: D-CODEGEN-010, D-CODEGEN-040

先保证 manifest 与 entry 结构合法，再执行 capability tier 与静态扫描预检。

## 3. 能力分级与授权
Anchors: D-CODEGEN-020

T0 自动、T1 明确授权、T2 硬拒绝。授权结果通过 runtime grant 路径实时判定。

## 4. Reload 与回滚
Anchors: D-CODEGEN-050, D-CODEGEN-070

reload 必须事务化，失败必须回滚且不污染已启用状态。

## 5. 门禁与证据
Anchors: D-CODEGEN-060, D-CODEGEN-070

门禁结果写入 `nimi-coding/.local/report/*`，spec 不写运行快照。
