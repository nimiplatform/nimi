# Nimi Coding 安装

这一页讲怎么看 Nimi Coding 在本仓库里的可用性。它不给一份对外的包分发承诺。

## 当前用法

在本仓库内部，Nimi Coding 命令通过本地 workspace 工具就能用。Topic 工作流、校验、packet 处理、runner 步骤、closeout 操作，都作为仓库内部的治理命令在跑。

对公开用户而言，安装说明需要准入过的分发证据。在那份证据公开之前，这一页讲的是仓库内部的用法，而不是一条通用的 release 渠道。

## 阅读场景：为什么这里还没有公开安装页

读者来这里如果是想要一行能在仓库之外装上 Nimi Coding 工具的命令，跟平台安装那边相同的逻辑也适用：

- 一行公开安装命令意味着背后有一条已打好包的分发。
- 一行公开安装命令意味着背后有一份认证或配置故事。
- 一行公开安装命令意味着背后有一条校验路径。
- 一行公开安装命令意味着背后有一条出问题之后的恢复路径。

只要以上任一项还没准入，公开安装文档就会变成一份项目兑现不了的乐观 onboarding 承诺。

## 一份完整的公开安装页要写什么

一份完整的公开页要包含：

- 支持的包或 binary 来源；
- 支持的宿主环境；
- 认证或配置要求；
- 第一条命令与预期输出；
- 校验命令；
- 失败恢复路径。

这些细节只有项目能核实它们的时候，才能写出来公开。

## 阅读场景：在本仓库里使用 Nimi Coding

某 contributor 在本仓库里要做一次高风险改动，想用 Nimi Coding。本地 workspace 用法在这种场景下够用：

- 本地工具通过 in-repo 命令面调用。
- Topic 工件写在 `.nimi/topics/<state>/<topic-id>/` 下。
- 校验、审计、closeout 操作走 repo 本地的合同文件（`.nimi/contracts/`）与方法论文件（`.nimi/methodology/`）。
- CLI 的概念性介绍见 [CLI Reference](/zh/nimicoding/cli-reference)；具体命令来自本地工具，不来自这套文档。

这种用法有意比公开 release 窄。它让方法论可以在仓库里被真正用起来，而不至于做出仓库外兑现不了的承诺。

## 来源

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
