<!-- nimi-docs: {"authority":["rule.nimi.runtime.remote-access.operation-carrier","rule.nimi.runtime.remote-access.asset-write-stream"],"sources":["runtime/internal/grpcserver/remote_transport.go","sdks/typescript/runtime/remote-data-channel.ts"]} -->

# 多模态能力与资产托管架构

Nimi 为图像生成、视频渲染、语音合成、音乐创作以及视觉推理等能力提供了统一的类型安全 API 与生命周期托管机制。具体支持的能力会根据本地已加载的模型和已配置的云端连接器动态调整。

## 请求与资源输入规范

分发多模态请求时，请使用标准 SDK 客户端接口：

- **结构化输入**：直接传入结构化提示词文本、媒体字节流或安全的资产引用，无需在应用逻辑中注入供应商私有请求头。
- **媒体适配器**：不同任务接受符合具体操作契约的专门多媒体载荷。例如，在允许 URL 输入的载体上，文本与视觉对话接受 HTTP/HTTPS 图片 URL 或已上传的产物引用（通过 SDK 产物上传 API 获取的 `artifact-ref`）；而视觉定位（vision-locate）等操作要求传入 `imageArtifactId`；语音克隆任务则接受满足时长与格式约束的参考音频 Buffer。系统不接收本地 `file://` URI 作为图片输入。

## 异步任务结果与结构化数据

多模态操作通常作为异步场景作业（Scenario Jobs）运行：

- **托管产物（Managed Artifacts）**：生成的图像、视频片段和音频文件由 Runtime 进行托管。应用可通过返回的产物 ID 读取或接收文件；`voiceAssetId` 用于引用音色，不是通用文件下载句柄。
- **结构化数据**：对于视觉定位（visual grounding）、语音转写（STT）等已准入操作，接口直接返回结构化 JSON 记录（如边界框、对齐时间戳、分类标签），方便程序直接解析使用。

## 资产托管与保留策略

- **完整性与访问控制**：由 Runtime 托管的媒体资产具备经过验证的 MIME 类型与 SHA-256 完整性哈希，并在应用之间实行严格隔离。
- **持久化建议**：Runtime 对生成的产物采用临时缓存策略。若应用需要在项目中长期保存资源，应在作业完成后将最终资产复制到应用的本地存储中。

## 远程 Web/Android 媒体

当前远程载体不接受类型化媒体字段中的原始 URL/URI；使用内联字节或 App 有权限读取的 artifact/asset 引用。不要让 PC 代取客户端任意指定的地址。能力合同存在不代表远程载体已支持该操作；原生文件定位和未实现的双向实时会话应明确显示不可用。

App 资产写入采用有界 credit 下的增量输入，原 owner 管理总量、配额和原子提交。取消或断线不会发布部分文件，也不自动续传。已提交的持久 Job 按现有标识查询，不以断线为由重提。

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
