# 多模态能力与资产托管架构

Nimi 平台为图像生成、视频制作、音频合成、音乐创作以及视觉多模态理解等能力提供了统一的类型化调用接口与生命周期托管机制。调用的可用性取决于当前设备已加载的本地模型或所配置的云端服务。

## 请求与资源输入规范

在发起多模态请求时，建议使用 SDK 提供的标准化客户端方法：

- **输入结构清晰**：传入所需的提示词文本、图像字节流或受保护的资产引用（Asset References），无需在应用层硬编码供应商私有参数。
- **媒体附件适配**：不同任务支持符合其操作契约的多媒体输入形式。例如文本与视觉交互接受远程 HTTP/HTTPS 图片 URL 或通过 SDK 产物上传接口获取的产物引用（`artifact-ref`，本地图片须先上传为 artifact），视觉定位操作（vision-locate）要求传入 `imageArtifactId`；语音克隆任务则接受参考音频 Buffer 与时长格式约束。系统不直接接收 `file://` 本地文件 URI 作为图片输入。

## 异步任务结果与结构化数据

多模态生成通常以异步任务的方式运行：

- **产物资产（Artifacts）**：图像与音频文件在生成完成后由 Runtime 安全托管。应用可通过返回的资产引用（如 `voiceAssetId` 或图像 ID）按需下载或展示。
- **结构化数值**：对于图像定位（Grounding）、音频转写（STT）或多模态分析等任务，接口直接返回精准的 JSON 结构化数据（如时间戳区间、目标检测边界框），便于下游业务逻辑直接消费。

## 资产托管与生命周期控制

- **完整性与访问控制**：由 Runtime 托管的生成资产包含完整的 MIME 类型、SHA-256 校验和与本地访问隔离，防止未授权跨应用越权访问。
- **持久化建议**：Runtime 对临时任务产物设有生命周期清理策略。若应用需要长期保存生成的内容，建议在任务完成后及时将其转存至应用的本地存储目录中。

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
