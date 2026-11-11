<!-- nimi-docs: {"authority":["rule.nimi.runtime.remote-access.direct-transport","rule.nimi.runtime.remote-access.asset-write-stream","rule.nimi.runtime.remote-access.connection-lifetime"],"sources":["sdks/typescript/runtime/remote-data-channel.ts","runtime/internal/remoteaccess/peer.go"]} -->

# 传输与错误处理

本机原生 App 使用真实 Host 的受保护载体；远程 Web/Android 使用主 Runtime 的直接 WebRTC 数据通道。公共类型保持一致，不代表不同载体支持完全相同的操作或恢复方式。

## 连接生命周期

远程连接需要当前身份、主 Runtime 绑定、有效来源确认和可直连网络。STUN 用于候选发现，当前没有 TURN/Relay。连接、来源或身份失效时，SDK 结束相应实时调用并返回实际错误。

Kit 可以在规定的浏览器/Android 恢复场景中重新核对身份并建立新的技术连接。它不续接已结束的流，不重新提交旧消息、文件或 Job。原生载体的技术会话维护同样不能改变业务操作的幂等与权限合同。

## 错误与不确定结果

保留 Runtime 返回的 reason code、错误来源和诊断上下文。无法解码或不符合 schema 的响应应明确失败；重连不能修复合同错误。

连接断开不一定说明服务端没有接受请求。对持久 Job 请使用保存的 Job ID 查询；对支持提交标识查询的流程，请使用原提交标识调用 `lookupSubmission`。没有查询结果时应呈现不确定状态，不能盲目重发有副作用的调用。发起取消请求后，同样必须读取 owner 返回的实际状态。

## 媒体与资源边界

远程类型化媒体输入使用内联内容或 App 有权使用的资产引用，当前不接受原始 URL/URI。资产写入按 Runtime 发放的有界 credit 增量发送；断线、取消或来源失效不等于正常 EOF，不会提交半个文件，也没有断点续传。文件大小、路径、配额与最终提交仍由原存储 owner 决定。

排查登录、来源确认、主机连接与模型执行时，按[故障排查](/zh/start/troubleshooting)区分这些层次。

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`kit/core/src/app-session.ts`](https://github.com/nimiplatform/nimi/blob/main/kit/core/src/app-session.ts)
- [`sdks/typescript/runtime/remote-data-channel.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/remote-data-channel.ts)
