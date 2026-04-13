# SDK Scope Contract

> Owner Domain: `S-SCOPE-*`

## S-SCOPE-001 Catalog Surface

scope 子路径最小稳定面是 in-memory catalog 的 publish/revoke/query。

## S-SCOPE-002 Authorization Boundary

scope 仅表达授权前置数据，不定义服务端授权执行规则。

## S-SCOPE-003 Transport Consistency

scope 的订阅/重建行为遵循 transport 合同，不得隐式重连。

## S-SCOPE-004 Error Family

scope 本地错误必须统一投影到 sdk-error-codes 受控 family。

## S-SCOPE-005 Cross-Package Boundary

scope 实现不得跨包调用 runtime/realm 私有客户端。
