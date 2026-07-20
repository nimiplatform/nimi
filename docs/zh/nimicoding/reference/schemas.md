# Nimi Coding 契约参考

Nimi Coding 0.3.x 的契约只描述规范构建、权威放置、受管文件和确定性校验，不定义
AI 宿主的任务或执行记录。

## 表面分类

路径：`.nimi/contracts/surface-taxonomy.schema.yaml`

每个候选文件必须得到唯一分类，并明确 owner、权威级别、跟踪规则、可变性和
fail-closed 条件。产品权威、薄引导、生成视图、本地证据、包方法论和受管文件不能
混成同一类。

## 放置契约

路径：`.nimi/contracts/placement-contract.schema.yaml`

每个受治理目录都要绑定允许的分类、owner、跟踪规则、准入条件和校验范围。未知
目录，以及放进 `.nimi/spec/**` 的非产品状态，都会被拒绝。

## Domain 准入

路径：`.nimi/contracts/domain-admission.schema.yaml`

每个产品 domain 都要声明根目录、权威类别、owner、允许和禁止的分类、校验命令，
以及未准入时的迁移处置。只有目录存在，不代表已经获得产品权威。

## Table Family

路径：`.nimi/contracts/table-family.schema.yaml`

每张 kernel table 都要声明受支持的语义家族。产品权威表和 support registry 使用
不同结构，两者都不能携带运行进度或审计覆盖状态。

## 单向映射

路径：`.nimi/contracts/projection-edge.schema.yaml`

每条单向映射都要声明来源与目标分类、双方 owner、允许和禁止的字段，以及确定性
漂移检查。目标文件不会因为映射关系获得高于来源的权威。

## 宿主规范布局

路径：`.nimi/contracts/spec-layout.schema.yaml`

宿主可以声明指令文件、受管生成目录和 table family 扩展，但这些布局数据本身不
具备产品权威。

## 规范生成输入与审计

路径：

- `.nimi/contracts/spec-generation-inputs.schema.yaml`
- `.nimi/contracts/spec-generation-audit.schema.yaml`

输入必须先完成分类，再进入规范构建。本地生成审计逐文件记录来源、依据强度、覆盖
状态和未解决事项；它只能放在 `.nimi/local/state/spec-generation/**`，不能进入
`.nimi/spec/**`。

## 迁移清单

路径：`.nimi/contracts/migration-inventory.schema.yaml`

迁移分组只描述现状和处置，不修改源文件，也不调度工作。语义分叉、owner 歧义、
包边界歧义和破坏性删除都必须保留为显式确认项。

## 来源依据

- [`.nimi/contracts/surface-taxonomy.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/surface-taxonomy.schema.yaml)
- [`.nimi/contracts/placement-contract.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/placement-contract.schema.yaml)
- [`.nimi/contracts/domain-admission.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/domain-admission.schema.yaml)
- [`.nimi/contracts/table-family.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/table-family.schema.yaml)
- [`.nimi/contracts/projection-edge.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/projection-edge.schema.yaml)
- [`.nimi/contracts/spec-layout.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-layout.schema.yaml)
- [`.nimi/contracts/spec-generation-inputs.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-inputs.schema.yaml)
- [`.nimi/contracts/spec-generation-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-audit.schema.yaml)
