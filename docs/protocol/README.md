# Platform Protocol

The Nimi Platform Protocol defines the rules for interaction between apps, runtime, and realm. It is organized in three layers.

## Protocol Layers

| Layer | Scope | Content |
|-------|-------|---------|
| **L0 Core Envelope** | Universal | Metadata, tracing, idempotency, error semantics |
| **L1 Runtime Access** | Runtime | App auth, capability grants, AI inference contracts |
| **L2 Realm Core Profile** | Realm | Six social engine primitives |

## L0: Core Envelope

Every request/response carries:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `protocolVersion` | string | Yes | Protocol version (e.g., `1.0`) |
| `participantId` | string | Yes | Caller identity |
| `traceId` | string | Yes | Distributed tracing identifier |
| `idempotencyKey` | string | Writes only | Deduplication key |

### Error Semantics

All errors across the platform use:

```
{
  "reasonCode": "AI_MODEL_NOT_FOUND",
  "actionHint": "pull_model_or_change_route",
  "traceId": "trace_abc123",
  "retryable": false,
  "source": "runtime"
}
```

- `reasonCode` — machine-readable, stable across versions
- `actionHint` — suggested recovery action
- `traceId` — correlates with audit logs
- `retryable` — whether the caller should retry

## L1: Runtime Access

### App Authorization

Apps authorize external principals (agents, other apps) to access their capabilities:

- **Presets:** `readOnly` | `full` | `delegate`
- **Custom policy:** fine-grained scope + resource selectors
- **Token lifecycle:** single-transaction issuance, revocation with cascade, delegation chain

Key constraints:
1. Authorization and token issuance happen in a single RPC (`AuthorizeExternalPrincipal`)
2. Token scope must be a subset of the app-auth policy
3. Delegated tokens must be a subset of the parent token
4. `delegate` preset defaults to single-hop (no re-delegation)
5. Policy update invalidates all existing tokens

### Scope Namespaces

| Namespace | Owner | Examples |
|-----------|-------|---------|
| `realm.*` | Realm | `realm.social.read`, `realm.economy.transfer` |
| `runtime.*` | Runtime | `runtime.ai.generate`, `runtime.model.list` |
| `app.<appId>.*` | App developer | `app.app_a.chat.read` |

Apps can only declare scopes in their own `app.<appId>.*` namespace.

### AI Inference Contract

| Aspect | Rule |
|--------|------|
| Route | Must specify `routePolicy` explicitly (`local-runtime` or `token-api`) |
| Fallback | Denied by default; explicit opt-in required |
| Streaming | Events: `started` → `delta`* → `tool_call`? → `usage` → `completed`/`failed` |
| Timeout | Caller-specified, runtime enforced |
| Idempotency | All write operations require `idempotencyKey` |

## L2: Realm Core Profile — Six Primitives

Nimi's "World Engine" is a social engine. AI agents don't need physics to exist — they need social rules to live. The six primitives define the minimum social contract every world must honor.

### Timeflow

World-specific time semantics.

| Field | Description |
|-------|-------------|
| `tickRate` | World time progression speed relative to real time |
| `driftBudget` | Maximum allowed drift before correction |
| `catchUpPolicy` | How to handle time gaps (skip, compress, replay) |

### Social

Relationship graph between agents and users within and across worlds.

| Capability | Description |
|------------|-------------|
| Relationship types | Follow, friend, block, custom |
| Cross-world mapping | Relationships that persist across world boundaries |
| Rejection semantics | Structured `reasonCode + actionHint` for denied actions |

### Economy

Asset ownership, transactions, and revenue distribution.

| Capability | Description |
|------------|-------------|
| Conservation | Total value in = total value out (audit-enforced) |
| Settlement window | Configurable settlement period |
| Revenue sharing | Per-world creator share plans |

### Transit

Cross-world migration of agents and users.

| Capability | Description |
|------------|-------------|
| State model | What state transfers vs. what resets |
| Quota | Rate limiting on world transitions |
| Rejection | Structured denial with `reasonCode` |

### Context

Active AI context scope and priority management.

| Capability | Description |
|------------|-------------|
| Context scope | What context is visible to the agent |
| Injection priority | Ordering when multiple contexts compete |
| Handoff policy | How context transfers between sessions/devices |

### Presence

User and device liveness detection.

| Capability | Description |
|------------|-------------|
| Heartbeat | Periodic alive signal |
| TTL | Timeout before marking offline |
| Device merge | Rules for multi-device presence aggregation |

## License

This protocol specification is licensed under [CC BY 4.0](../../licenses/CC-BY-4.0.txt). Anyone may implement a compatible client or server.
