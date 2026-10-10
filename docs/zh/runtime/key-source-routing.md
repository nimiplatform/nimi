# 凭据托管

Runtime 根据 owner 的 AIConfig 中已保存的确切 Connector 解析云端凭据。App 可以通过已授权配置接口保存安全连接与目标引用，但不会接收或注入凭据。

## 请求路径

1. 受保护会话确定账号、App 和已准入操作。
2. Runtime 验证已保存的 Cloud Connector、实现目标、请求、权限与策略。
3. 提交时固定有效输入，并在内部把已准入凭据交给 Driver。
4. 结果和诊断保留强类型结果，不包含秘密或私有托管材料。

此路径没有模型搜索或凭据来源回退。普通 AI 请求只携带内容与受支持参数，不传 Connector 选择器、内联密钥、Provider 端点或账号覆盖。

## 配置或修复连接

通过 Nimi Home 受保护的「云服务」流程创建或更新连接，在 App AI 设置中选择它的安全引用与确切目标，再携带当前 revision 保存。App 可以查看安全配置选项，不能查看凭据存储。

可移植 Runtime 配置、`nimi config` 和独立 SDK 客户端都不是 Provider 凭据管理入口。原 Connector 缺失、禁用、归属错误或失效，会产生对应操作的强类型失败或观察问题，不会授权替换其他连接。

对已有 Job，保留原身份及固定目标。修改 AIConfig 只影响新提交，不重建已有 Job；当前账号、App 权限、策略及原 Connector 准入与固定输入分别检查。

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
