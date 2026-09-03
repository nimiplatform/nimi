# 语音会话

> 状态：现已可用。桌面端 Agent 聊天的语音会话已上线；会话、执行器、工作流三部分合约在内核层定义（`agent-chat-voice-*-contract.md`）。

语音会话就是你开口和 Agent 聊天的界面：你说话，Agent 用语音回复，字幕同步滚动，会话进行到哪一步都看得清楚。底层合约有意分成会话、执行器、工作流三块。

## 三个合约

| 合约 | 负责 |
| --- | --- |
| 语音会话 | 聊天中出现的高级别语音会话生命周期 |
| 语音执行器 | 每轮语音执行机制 |
| 语音工作流 | 跨轮次的工作流 + 身份绑定 |

这样分，是为了把三件事分开：「你有没有开始一次语音对话」、「这一轮是怎么执行的」、「Agent 的声音身份怎么跨轮次延续」。

## 边界

| 负责 | 不负责 |
| --- | --- |
| 桌面端聊天语音界面的生命周期 + UI | 语音资产创建 (`K-VOICE-*` 运行时 — 请参阅 [语音资产生命周期](/runtime/voice-asset-lifecycle)) |
| 聊天中的每轮语音执行器 | TTS / STT 提供者语义（运行时） |
| 聊天中的工作流 + 身份绑定 | Avatar 唇形同步（Avatar） |

桌面端的语音界面，是把 Runtime 的语音能力通过带字幕的聊天窗口放出来。语音克隆和语音资产存储都不在这里做。

## 读者场景：用户语音轮次

用户在聊天中点击语音并说话。

1. **语音会话开始。** 桌面端跟踪生命周期。
2. **STT 执行。** 根据语音执行器合约；转录用户语音。
3. **轮次提交。** 根据 `RuntimeAgentService` 轮次生命周期。
4. **Agent 回复以流式传输。** 根据执行器合约执行 TTS。
5. **字幕同步。** 桌面端聊天界面保持字幕与音频对齐。
6. **Avatar 唇形同步。** 如果 Avatar 也已打开，运行时呈现流 + Avatar 音频管道驱动口型参数。

## 语音会话不做的事情

- 不创建语音资产（`K-VOICE-*` 在 Runtime）。
- 不重新定义 TTS / STT 提供者语义。
- 不绕过 `RuntimeAgentService` 的轮次生命周期。
- 不负责 Avatar 的唇形同步。

## 来源依据

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
