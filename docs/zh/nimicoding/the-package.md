# Nimi Coding 包 (The Package)

`@nimiplatform/nimi-coding` 是一个**独立且宿主无关的边界包（Standalone host-agnostic boundary package）**，全权承载了 Nimi Coding 这套方法论。本页将详细拆解这个包里面究竟装了什么，有哪些功能是被刻意剔除在外的，以及为什么要采用这种极其克制的产品形态。

## 这个包到底是什么？

| 属性 | 值 |
| --- | --- |
| 包名 | `@nimiplatform/nimi-coding` |
| 仓库阶段 | Bootstrap（引导阶段） |
| 自托管 (Self-hosting) | 否（将运行时的执行权委派给外部的 AI 宿主） |
| 厂商中立 | 是 |
| 宿主类别 (Host class) | `ai_native_coding_host` |
| 许可协议 | MIT |
| CLI 入口 | `nimicoding` |

这个包的产品愿景是：让随便哪个项目，都能通过 npm 安装这套可复用的 AI 编程治理工具箱，快速在项目本地引导出 `/.nimi/**` 治理层，从而用一套极其严苛、AI 原生的“权威 / 工作包 / 验收”纪律来降伏高风险的开发任务。

## 包里面装了什么？

| 路径 | 用途 |
| --- | --- |
| `methodology/` | 方法论的源文件（各项治理策略 Policies） |
| `contracts/` | 各种 Schema 的源文件（极其严格的类型化契约） |
| `config/` | 引导阶段所需的配置（包含 Manifest、宿主属性配置文件等） |
| `spec/` | 引导阶段所需的规范种子（例如 `bootstrap-state`、`product-scope`） |
| `cli/` | 命令行工具的具体实现代码 |
| `bin/nimicoding.mjs` | 二进制执行文件的入口 |
| `adapters/` | 外部宿主的适配器覆盖层（比如 `oh-my-codex`） |

当你在一个项目里敲下 `nimicoding start` 时，这套包就会把它的源文件投影进你项目的 `.nimi/**` 目录里：

| 源头 | 投影至 |
| --- | --- |
| `methodology/` | `.nimi/methodology/` |
| `contracts/` | `.nimi/contracts/` |
| `config/` | `.nimi/config/` |
| `spec/` (bootstrap) | `.nimi/spec/` (只投影 bootstrap 所需的文件) |

## 这个包“刻意不装”什么？

| 功能面 | 状态 | 为什么推迟引入？ |
| --- | --- | --- |
| 工作包约定的运行内核 | 已推迟 | 方法论只管定规矩，不亲自下场跑代码 |
| 供应商后端的实际执行 | 已推迟 | 这个包本身不调用任何大模型的 API |
| 调度器 (Scheduler) | 已推迟 | 什么时候跑代码，那是宿主该操心的事 |
| 消息通知 (Notification) | 已推迟 | 用户体验交互（UX）统统归宿主管 |
| 自动化后端 | 已推迟 | 自动化这活儿也是宿主干的 |
| 自托管的方法论运行时 | 已推迟 | 运行时的所有权坚定地留在外部不收回 |

以上这些，全部是**被显式推迟（Explicitly deferred）**的功能面。这个包的终极产品形态叫做“在其独立的适用范围内，保持边界绝对完整（Boundary-complete for its intended standalone scope）”——意思就是，它把方法论、硬核的类型契约、引导程序和死板的机械校验器全都打包交给了你，但它就是不亲自帮你跑代码。

## 为什么追求“边界完整”而不是“执行完整”？

一个仅仅把“治理边界”打包完整的工具，可以被世界上任何一个项目毫不费力地采纳。但如果这个包夹带私货，连带着自己的运行时引擎一起发布，那它就会不可救药地和某一套具体的执行模型死死绑定（比如死绑在某一家 AI 宿主、某一个调度器或某个通知系统上）。

我们之所以如此克制地切分开，是因为：

- 方法论是**可自由移植的（Portable）**—— 不管用哪家 AI，这套规矩都通用。
- 运行时则是**因宿主而异的（Host-specific）**—— 同一份代码执行，你可以今天丢给 Claude 跑，明天丢给 Codex，后天丢给 Gemini，或者任何愿意遵守这套契约的 AI 宿主。
- 如果强行把这俩绑在一起，那些想用这套方法论的团队，就不得不连带着买下你强塞给他的底层执行引擎。

这个包向你做出的是这样的承诺：“你大可以今天就引入这套开发纪律；哪怕明天你换了一家 AI 宿主，你也不用改这套规矩的任何一行字。”

## 目前已经覆盖的功能表面

在目前的独立发行版中，它已经在以下领域实现了坚固的边界闭合：

- 极具辨识度的包身份（Package identity）。
- 为代码仓库打下坚实的地基。
- 植入一套原生的 AI 编程治理方法论种子。
- 由包管控的引导阶段源码投影机制。
- 提供机器可读的、包含“规范重建、文档规范审计、高风险执行产出”的严苛契约。
- 提供由包管控的、唯一的、高风险准入 Schema 契约。
- 提供各类高风险执行环节的 Schema 种子（包含了 Packet、调度编排状态、提示词 Prompt、工作者输出、验收标准）。
- 提供厂商中立的、外部宿主属性配置的种子。
- 提供由包管控的、用于评判外部宿主是否兼容的契约种子。
- 为受限的外部执行宿主互操作，提供适配器种子。
- 专门为 `oh_my_codex` 提供一份获准入的宿主配置覆盖层种子。
- 附带一个克制且独立的 CLI 工具，囊括了分段启动 `start`、深度校验、任务交接分派、本地收尾工件投影、显式准入流程，以及对执行产物极其死板的机械化验证。
- 为所有外部 AI 宿主划定了一道宿主无关的语义及交互互操作的铁壁。

## 引导姿态 (Bootstrap Posture)

包内的 `config/bootstrap.yaml` 清晰地声明了引导阶段的底牌：

| 字段 | 值 |
| --- | --- |
| `bootstrap_contract` | `nimicoding.bootstrap` |
| `bootstrap_contract_version` | 1 |
| `profile` | `default` |

只要在一个项目里敲下 `nimicoding start`，宿主项目就会将这些引导配置收入囊中。一旦完成，这个项目就正式宣告成为“采用了 Nimi Coding 方法论的项目”。

## 技能清单 (Skill Manifest)

在 `config/skills.yaml` 中，赫然列出了四大关键技能的接口定义（具体说明请见 [技能页](/zh/nimicoding/skills)）：

| 技能名称 | 是否强制要求 |
| --- | --- |
| `spec_reconstruction` (规范重建) | 是 |
| `doc_spec_audit` (文档规范审计) | 是 |
| `audit_sweep` (审计扫描) | 否 |
| `high_risk_execution` (高风险执行) | 否 |

引导状态中明确标注了 `runtime_installed: false` 以及 `installation_mode: deferred`。这表明该包根本不奢望本地有什么运行时；这四大技能，注定要交给外部的宿主去实现。

## 宿主属性档案 (Host Profile)

`config/host-profile.yaml` 立下了对厂商中立宿主的所有硬性要求：

| 属性 | 值 |
| --- | --- |
| `host_class` | `ai_native_coding_host` |
| `runtime_contract_ref` | `.nimi/methodology/skill-runtime.yaml` |
| `compatibility_contract_ref` | `.nimi/contracts/external-host-compatibility.yaml` |
| `ownership_mode` | `external` (外部拥有) |
| `execution_mode` | `delegated` (委派执行) |
| `install_state` | `not_installed` (不负责安装) |
| `self_hosted` | `false` (非自托管) |

想要被准入，宿主必须具备这些极简的能力底线：
- `read_project_local_nimi_truth` (必须能去项目本地的 .nimi 目录读取事实真相)
- `route_declared_external_skills` (必须能正确路由那四个声明过的核心技能)
- `fail_closed_on_missing_authority` (缺失关键权威源时，必须死脑筋地报错退出，严禁自行脑补)

以及不可跨越的刚性约束：
- `vendor_neutral_profile_only` (必须保持厂商中立)
- `do_not_assume_local_runtime_install` (禁止假设本地装了运行时)
- `do_not_claim_packet_orchestration_ownership` (禁止越权宣称自己能管理 Packet 的调度编排)

## 场景案例：一个项目第一次采纳这个包

一个项目眼馋 Nimi Coding 的治理纪律，决定引入它。

1. **获取包**：参考 [安装指南](/zh/nimicoding/installation)，从 npm 把 `@nimiplatform/nimi-coding` 拉下来。
2. **跑引导**：运行 `nimicoding start`，在项目根目录滋生出 `.nimi/**` 结构。
3. **源码投影完毕**：包里的方法论、各种契约 Schema、配置和 Spec 种子，已经全须全尾地投影进了项目里。
4. **激活规范重建**：该项目现在可以名正言顺地把活儿甩给它准入的外部 AI 宿主，让它帮忙重建出唯一的权威规范真相。
5. **正式启用纪律**：自此，这个项目就可以走“准入 Topic、冻结 Packet、跑预检、通过宿主分派给 Worker、记录死板的审计、为 Wave 闭合收尾”这套正规军流程了。

项目采纳这个包之后，就获得了一层可复用的方法论。

## 场景案例：果断更换 AI 宿主

之前用着某家 AI 宿主跑这套纪律的项目，突然想换另外一家宿主试试。

1. **规矩一个字都不用改**：`.nimi/methodology/` 和 `.nimi/contracts/` 稳如泰山。
2. **拔插头，换个适配器**：唯一要动手的，就是换掉那个和宿主绑定的覆盖层（`adapters/<host-name>/profile.yaml`）。
3. **之前的活儿照样认账**：以前存下来的 Topic、Wave 和 Packet 工件，依然是这项目最权威的真相记录，没人能赖账。
4. **相同的验收标准**：那套折磨人的“四个闭合维度”的框架，将对新来的宿主一视同仁。

方法论死死地扎根在项目里；宿主？想换随时换。

## 这个包现在还没本事干什么事？

如果你指望 Nimi Coding 包办一切，以下是它被设计为“暂时不管”的盲区：

- **它不会全自动帮你跑 Packet**：CLI 顶多帮你做做引导、验验合同，绝不会自作主张替你跑完整个流程。
- **它不自带日程调度器**：排期的事儿，请找包外面的工具。
- **它自己不调模型 API**：这个包才不干跑 AI 模型这种脏活累活，那是宿主的差事。
- **它没有自托管的方法论运行时引擎**：运行时的所有权，被它坚决地拒之门外。

这些不是被彻底抛弃了，只是被有意延后了。它们不属于这套“在其独立的适用范围内保持边界绝对完整”的系统。

## 来源依据

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/package.json)
- [`nimi-coding/AGENTS.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/AGENTS.md)
- [`nimi-coding/config/bootstrap.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/bootstrap.yaml)
- [`nimi-coding/config/skills.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skills.yaml)
- [`nimi-coding/config/host-profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-profile.yaml)
- [`nimi-coding/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/spec/bootstrap-state.yaml)
- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/spec/product-scope.yaml)
