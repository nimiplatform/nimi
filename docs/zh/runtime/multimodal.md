# 多模态能力

Nimi 为已准入的图像、视频、音频、语音、音乐和视觉操作提供强类型请求，以及完整强类型结果或托管 artifact。支持范围取决于确切配置实现、功能和执行模式，不能从 Provider 家族或模型已安装推断。

## 请求输入

使用受保护 App 客户端中具体操作的请求形状，提交内容、已准入资源引用及受支持参数，不注入 Provider context、凭据、端点、Local Loadout 或请求级路由覆盖。

资源输入规则按操作区分。例如文本生成的媒体附件使用对应 content-part 和托管 artifact 契约，语音 Job 有自己的 bytes/URI、MIME、时长与功能限制。依据强类型 API 和 Runtime 支持信息，不能把全部媒体都转换为通用 URL。

## 异步结果

只提交一次并保留原 Job 身份。持续 Get 观察并可能核对原生异步任务，订阅事件只是可选提示。完成 Job 必须具备全部已验证结果，包括必要的多个 artifact 或专属字段。Provider 私有任务阶段不会形成另一套公共状态机。

部分输出是强类型值，不是 artifact：文本标注、转写和视觉定位各有结果形状；音色创建通过完整终态 Get 返回 VoiceAsset 与 VoiceReference。定位结果为空等合法空结果，与缺少必要结果不同。

## Artifact 托管

Runtime 负责已接收 artifact 的字节、完整性、MIME、访问范围、生命周期和授权读取。Artifact ID 是限定于某 Runtime 的不透明身份，不是公开下载 URL，也不代表访问权限。通过已准入 App artifact 操作读取，并保留元数据。

在 Runtime 有限保留期结束前，把项目需要的全部结果保存到 App 存储。只保存 Job 或 artifact ID 不是持久项目存储。音乐编辑、字幕组装、分块、试听审校及业务完成判断仍归 App。

## 失败与取消

输入非法、功能不可用、输出不完整、获取失败或权限丢失时，返回强类型失败或观察问题。不能伪造 artifact、丢弃必要多输出中的一项、切换实现，或重新生成来恢复结果。明确 Cancel 与结束观察效果不同，需要保留 submission 和 stop outcome。

另见 [Job 观察](/zh/runtime/streaming)、[AIConfig](/zh/sdk/ai-config-surface) 与 [SDK 能力说明](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/README.md)。

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`config/runtime-voice-enums.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-voice-enums.yaml)
- [`config/runtime-tts-provider-capability-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-tts-provider-capability-matrix.yaml)

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
