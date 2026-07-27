# 语音会话

> 状态：运行中 (Running)。桌面端聊天语音会话、语音执行器和语音工作流合约已在内核层面 (`agent-chat-voice-*-contract.md`) 发布。

桌面语音会话是用户与 Agent 进行语音对话的界面：用户输入语音，Agent 回复语音，字幕同步呈现，生命周期状态明确。合约按职责划分为会话、执行器和工作流三部分。

## 三个合约

| 合约 | 负责 |
| --- | --- |
| 语音会话 | 聊天中出现的高级别语音会话生命周期 |
| 语音执行器 | 每轮语音执行机制 |
| 语音工作流 | 跨轮次的工作流 + 身份绑定 |

这种划分把“用户是否开始了一次语音对话”、“一轮如何执行”以及“Agent 的语音身份如何在轮次间绑定”分开处理。

## 边界

| 负责 | 不负责 |
| --- | --- |
| 桌面端聊天语音界面的生命周期 + UI | 语音资产创建 (`K-VOICE-*` 运行时 — 请参阅 [语音资产生命周期](/runtime/voice-asset-lifecycle)) |
| 聊天中的每轮语音执行器 | TTS / STT 提供者语义（运行时） |
| 聊天中的工作流 + 身份绑定 | Avatar 唇形同步（Avatar） |

桌面语音界面通过带字幕的聊天 UI 消费运行时语音能力。它不涉及语音克隆或资产存储。

## 读者场景：用户语音轮次

用户在聊天中点击语音并说话。

1. **语音会话开始。** 桌面端跟踪生命周期。
2. **STT 执行。** 根据语音执行器合约；转录用户语音。
3. **轮次提交。** 根据 `RuntimeAgentService` 轮次生命周期。
4. **Agent 回复以流式传输。** 根据执行器合约执行 TTS。
5. **字幕同步。** 桌面端聊天界面保持字幕与音频对齐。
6. **Avatar 唇形同步。** 如果 Avatar 也已打开，运行时呈现流 + Avatar 音频管道驱动口型参数。

## 语音会话不做的事情

- 它不负责语音资产创建 (`K-VOICE-*` 运行时)。
- 它不重新定义 TTS / STT 提供者语义。
- 它不绕过 `RuntimeAgentService` 轮次生命周期。
- 它不负责 Avatar 唇形同步。

## 来源依据

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)