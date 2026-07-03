# Zhiyu Local Partner Center State Contract

## Z-STATE-001 Product States

Zhiyu uses the state machine in `tables/product-state-machine.yaml` as the
product state authority. The v1 state set is:

- local_service_unavailable
- no_partner
- partner_candidates_unselected
- model_config_not_ready
- partner_ready
- partner_responding
- recoverable_failure

## Z-STATE-002 First Screen

The first screen must be the local partner center state, not a diagnostics
dashboard, readiness checklist, capability studio, evidence wall, or disabled
card wall.

## Z-STATE-003 State Truth

Zhiyu may present state derived from admitted upstream projections and local UI
state. It must not synthesize partner readiness, model readiness, memory state,
Runtime session state, or Avatar carrier readiness.

## Z-STATE-004 Check Local Service

`检查本地服务` must run a real health reconnect action: probe Runtime/auth/SDK
bridge, refresh product state, and show owner-aware failure with diagnostics on
failure. It must not be a no-op button.
