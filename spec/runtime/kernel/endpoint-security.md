# Endpoint Security Contract

> Owner Domain: `K-SEC-*`

## K-SEC-001 校验对象

以下 endpoint 必须校验：

- `REMOTE_MANAGED` connector endpoint
- inline `x-nimi-provider-endpoint`

## K-SEC-002 Phase 1 安全基线

1. 默认仅允许 `https://`
2. `http://` 仅允许 loopback 且显式开启 `allow_loopback_provider_endpoint=true`
3. 拒绝高风险地址：`localhost`、`127.0.0.0/8`、`::1`、`169.254.0.0/16`、`169.254.169.254`、`fc00::/7`、`fe80::/10`（loopback 开关仅影响 loopback）
4. DNS 解析后按 IP 网段校验

## K-SEC-003 TOCTOU 防护

- 必须 pin 已校验 IP 作为实际拨号目标。
- TLS `ServerName` 与 HTTP `Host` 仍使用原始域名。

## K-SEC-004 执行期强制校验

endpoint 校验不允许只在 create/update 时执行；每次实际出站请求前必须执行。

## K-SEC-005 Phase 1 配置边界

Phase 1 不提供私网 allowlist（CIDR/hosts）。
