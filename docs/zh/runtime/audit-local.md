# 本地审计与安全日志

请求失败、访问被拒绝，或服务状态发生变化时，可以借助 Runtime 审计记录追踪原因。记录保留所属操作的结果、关联标识与时间；出现一条审计记录，本身不代表产品流程已经成功。

## 记录包含什么

Runtime 记录与安全有关的认证、授权、执行、生命周期和资源事实。诊断内容有明确范围并经过脱敏，不应包含凭据、会话证明、原始私密内容或服务商密钥。

记录在本地按条数与编码后大小限制保留。超出限制时会淘汰最早的记录，相同拒绝也可能合并为带计数的一条记录。审计存储不是 App 所有行为的永久、完整历史。

## 排查一次失败请求

1. 保留返回的原因码、操作建议，以及存在时的 Trace ID。
2. 通过可用的 Runtime 诊断入口查找对应操作，确认实际结果。
3. 对于 Job，先检查原 Job ID 的状态，再判断是否可以重新提交。没有查到审计记录，不代表外部动作一定未发生。

已授权的审计导出提供有界诊断内容，不意味着自动云端聚合或 Realm 遥测上传服务。导出后仍需按文件实际包含的信息妥善处理。

## Source Basis

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
