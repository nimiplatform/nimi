# Endpoint Security Contract

> Owner Domain: `K-SEC-*`

## K-SEC-001 校验对象

以下 endpoint 必须校验：

- `REMOTE_MANAGED` connector endpoint
- inline `x-nimi-provider-endpoint`

## K-SEC-002 Phase 1 安全基线

1. 默认仅允许 `https://`
2. `http://` 仅在满足以下全部条件时允许：
   - 目标地址为 loopback（`localhost`、`127.0.0.0/8`、`::1`）
   - 显式开启 `allow_loopback_provider_endpoint=true`
3. 无条件拒绝的高风险地址（不受任何开关影响）：
   - 链路本地：`169.254.0.0/16`、`169.254.169.254`、`fe80::/10`
   - 私网：`fc00::/7`
4. 条件拒绝的 loopback 地址（`allow_loopback_provider_endpoint=false` 时拒绝）：
   - `localhost`、`127.0.0.0/8`、`::1`
5. DNS 解析后按实际 IP 网段重新校验（解析结果可能落入上述拒绝范围）

## K-SEC-003 TOCTOU 防护

- 必须 pin 已校验 IP 作为实际拨号目标。
- TLS `ServerName` 与 HTTP `Host` 仍使用原始域名。

## K-SEC-004 执行期强制校验

endpoint 校验不允许只在 create/update 时执行；每次实际出站请求前必须执行。

## K-SEC-005 Phase 1 配置边界

Phase 1 不提供私网 allowlist（CIDR/hosts）。
