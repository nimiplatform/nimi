# Transport And Error

> Status: Running today. The SDK transport contract and the SDK
> error projection contract are shipped under
> `.nimi/spec/sdks/client-core.authority.yaml` +
> `.nimi/spec/sdks/client-core.authority.yaml`.

The SDK Transport And Error surface covers how the SDK talks to
runtime over admitted transports + how runtime errors project into
typed SDK errors that apps can handle predictably.

## Transport

| Concern | Authority |
| --- | --- |
| Transport bindings | `.nimi/spec/sdks/client-core.authority.yaml` |
| Connection lifecycle | Per admitted transport |
| Reconnect strategy | Transport-level only (does NOT rescue contract failure) |

Transports admitted in the contract govern how SDK calls reach
runtime. The transport layer is responsible for bytes; it is not
responsible for "fixing" contract-level errors.

## Error Projection

| Concern | Authority |
| --- | --- |
| Error projection from runtime to SDK | `.nimi/spec/sdks/client-core.authority.yaml` |
| Reason code surfacing | Typed; never silently dropped |
| Decode / content-type / schema failures | Surface as typed SDK errors; not retried |
| Auth / transport failures | Surface as typed SDK errors; may retry per transport policy |

The boundary: **retry / auth refresh are transport / auth mechanisms
only**. They do not rescue decode, content-type, schema, or contract
failures. A schema-invalid response does not become valid by retrying.

## Reader Scenario: A Schema-Invalid Response

Runtime returns a response that fails schema validation at the SDK.

1. **SDK projects error.** Typed SDK error with schema-failure
   reason code.
2. **No silent retry.** Transport may retry transport failures; this
   is not one.
3. **App handles the typed error.** Surfaces user-visible reason
   without pretending success.

## Reader Scenario: A Transport Disconnect

Runtime daemon enters STOPPING; SDK transport disconnects.

1. **SDK detects.** Per `S-RUNTIME-028` `runtime.disconnected` or
   gRPC status.
2. **Transport reconnect strategy.** Per admitted transport
   policy.
3. **App receives typed transport error.** App decides whether to
   retry the call after reconnect.
4. **No spoof success.** Transport disconnect does not silently
   produce a faked response.

## What Transport And Error Do Not Do

- They do not rescue schema / content-type / decode / contract
  failures via retry.
- They do not silently drop reason codes.
- They do not let auth refresh substitute for fixing a schema error.

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
