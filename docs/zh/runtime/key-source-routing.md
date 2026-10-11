# 凭据托管与密钥路由机制（Key Source Routing）

在 Nimi 中，所有涉及第三方云端 AI 模型供应商的 API 密钥与认证凭据，均由本地 Runtime 统一安全托管。应用代码仅需持有安全的连接器引用（Connector Reference），无需也不应在前端业务代码中直接硬编码或传递任何明文密钥。

## 请求链路中的凭据路由流程

1. **会话校验**：应用发起 AI 生成请求，Runtime 通过宿主会话验证应用身份与调用权限；
2. **连接器解析**：根据该应用在 AIConfig 中绑定的 `connectorRef`，从受保护的本地存储中解析出对应的目标服务商凭据；
3. **驱动封装与外发**：Runtime 的执行驱动（Driver）将用户提示词与密钥组装为符合服务商规范的安全请求并外发；
4. **结果剥离与返回**：收到云端回复后，系统将服务商专有的 Header、原始凭据及敏感路由信息彻底剥离，仅将纯净的内容数据流返回给前端应用。

这种“代客保管、透明路由”的设计模式，既彻底消除了密钥意外暴露的隐患，又使应用能够在无需重新编码的情况下无缝切换底层服务商。

## 连接器的配置与异常修复

- **配置入口**：用户在 Nimi Home 的「云服务」设置中录入或修改各个服务商的 API 密钥。在应用的 AI 设置中，只需下拉选择对应的连接器即可完成绑定。
- **故障排查**：若提示凭据失效或余额不足，直接在「云服务」中更新该连接器的密钥即可，所有依赖该连接器的应用都会自动生效，无需逐一修改应用配置。

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
