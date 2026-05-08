# 附录：oh-my-codex 适配器 (oh-my-codex Adapter)

`oh-my-codex` 是 Nimi Coding 包内置的一个**已准入的外部执行宿主适配器层（Adapter Overlay）**。它展示了一个特定的 AI 宿主如何作为“受控桥接器（Constrained Bridge）”被准入治理体系，而不会反向夺取方法论的语义所有权。

**特别说明**：本页属于**附录**性质，并非方法论的一等公民。Nimi Coding 始终保持宿主无关性；`oh-my-codex` 仅作为适配器模式的一个参考实现。

## 适配器提供了什么？

该适配器通过 `adapters/oh-my-codex/profile.yaml` 文件定义了以下内容：
- 确认 `oh-my-codex` 作为受控桥接器的准入身份。
- 声明该宿主满足哪些核心能力等级（Host-class Capabilities）。
- 定义了包所允许的特定宿主路由细节。

**关键点**：该适配器**严禁**宣称拥有语义所有权；方法论的核心始终保持厂商中立。

---

## 适用场景

在以下情况下，建议使用 `oh-my-codex` 适配器：
- 你的项目选择 `oh-my-codex` 作为分派 AI 技能的具体执行环境。
- 你希望在运行 `nimicoding doctor` 时，看到具名的适配器元数据，而非通用的外部宿主描述。

## 不适用场景

在以下情况下，应使用通用的外部宿主配置：
- 你的项目直接与已准入的模型（如 Claude, Gemini 等）对接，无需中间层。
- 你不需要超出“厂商中立配置文件”之外的特定路由逻辑。

Nimi Coding 的设计承诺是：任何遵循契约的宿主均可使用；具名适配器仅为提供便利，而非强制要求。

---

## 场景模拟

### 1. 从 oh-my-codex 切换到其他宿主
假设你的项目之前一直使用 `oh-my-codex`，现在决定直接使用 Claude。
- **方法论层面**：无需任何改动，`.nimi/` 下的核心规则保持不变。
- **配置层面**：移除 `oh-my-codex` 的适配器引用，切换为通用外部宿主配置。
- **历史证据**：此前在 `oh-my-codex` 下产出的所有 Topic、Wave 和审计记录**依然有效**。

**结论**：方法论的可携带性确保了工具的更换不会导致过去的工作证据失效。

### 2. 添加全新的宿主适配器
如果你想为一个名为 `host-x` 的新工具编写适配器：
1. 参考 `oh-my-codex` 的形状创建 `adapters/host-x/profile.yaml`。
2. 声明该宿主所满足的必需能力。
3. 声明其符合刚性约束（厂商中立、不强制本地 Runtime 等）。
4. 通过 `nimicoding doctor` 进行兼容性校验。
**准入后，新适配器将与内置适配器并列可用，供项目根据上下文自由选择。**

---

## 设计边界

本页仅讨论 Nimi Coding 的适配器模式，并不作为 `oh-my-codex` 工具本身的使用说明文档。关于该工具的具体功能，请参阅其官方上游文档。

---

## 来源依据

- [`nimi-coding/adapters/oh-my-codex/profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/adapters/oh-my-codex/profile.yaml)
- [`nimi-coding/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-adapter.yaml)
- [`nimi-coding/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/external-host-compatibility.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
