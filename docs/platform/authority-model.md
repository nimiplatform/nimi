# Authority Model

Nimi's authority model is what lets very different participants —
end users, world creators, app developers, AI agents,
and external AI hosts — share the same platform without one
silently overriding another. This page explains the model in product
terms.

For schema-level definitions, see
[Reference → Authority Domains](/reference/authority-domains).

## Three Things The Model Defines

The authority model answers three questions every cross-participant
platform has to answer:

1. **Who is acting?** The principal model.
2. **What are they allowed to do?** Authorization presets and scopes.
3. **What kind of app is doing this?** App modes — render-only vs
   full extension.

## Principals

A principal is the entity behind any action. Nimi names them
explicitly so authorization is unambiguous.

| Principal | What it represents |
| --- | --- |
| User | A real person with an account, identity, social graph, wallet. |
| Agent | A first-class autonomous participant; not a tool, not a session. |
| App | Code running on behalf of a user (render-only or extension). |
| External Principal | An external AI host (delegated AI) granted a scoped capability domain. |

Every action carries the principal's identity through audit lineage.
This is what makes "an external AI took this action" different from
"a user took this action" different from "an agent took this action."

## Authorization Presets

Apps and external principals do not get free-form capability lists.
The platform admits a small set of preset templates that share the
same token shape and validation chain.

| Preset | Read | Write | Delegate |
| --- | --- | --- | --- |
| `readOnly` | yes | no | no |
| `full` | yes | yes | no |
| `delegate` | yes | yes | one level by default |

The `delegate` preset allows up to one level of further delegation —
this is intentional. Multi-hop delegation chains break audit
traceability; the platform refuses them by default.

## App Modes

An app declares what kind of citizen it is. The mode determines what
the app can write and how many such apps can be active in a world at
once.

| Mode | Reads world data | Writes world data | Concurrent count per world |
| --- | --- | --- | --- |
| `render-app` | yes | no | many |
| `extension-app` | yes | yes | at most one active |

A world has at most one active `extension-app` binding at any time.
Re-binding requires explicitly revoking first; the platform does not
silently transfer write authority.

## App-World Binding Lifecycle

```
(new) → active → suspended → revoked
              ↑     ↓
              └─────┘
```

- A world starts with no active app binding.
- An admitted extension-app may move to `active`.
- An active binding can be `suspended` (paused, may resume) or
  `revoked` (removed; another app may now bind).
- Suspension is reversible; revocation is not.

## External Principals

The platform admits external AI hosts (a separate AI provider, an
MCP-tooled agent, or a future A2A peer) as `ExternalPrincipal`
entities. They are first-class participants in the authorization
model — not afterthought integrations.

| Property | Value |
| --- | --- |
| Token shape | Scoped, single-use plaintext display |
| Token visibility after issue | Immutable token ledger only |
| Capability domains | `action.discover.*`, `action.dry-run.*`, `action.verify.*`, `action.commit.*` |
| Issuance UI | Desktop External Agent Access panel |

A scoped token does not grant arbitrary action. Each capability
domain has its own admitted operations. An external AI cannot send
a gift unless the token has `action.commit.gift` (or equivalent
admitted capability).

## Reader Scenario: An App Author Picking The Right Mode

You are writing a new app. Your app needs to read world state, show
it nicely, and let users compose chat messages.

- You do not need to write world truth. World state mutations are
  not part of your app.
- You can run alongside other apps — your app should not block other
  extension-apps from binding.

That is exactly the `render-app` profile. You read world data through
`@nimiplatform/sdk/realm` or root-client Realm composition, and chat
composition flows through the admitted chat APIs without your app being a write
authority on world truth.

If you later add a feature that mutates world rules, you need to
move to `extension-app` mode and bind to the world. Only one
extension-app can be active per world; you would need either
exclusivity admission or your feature would belong elsewhere.

## Reader Scenario: A User Granting An External AI Limited Access

You want an external AI host to be able to read your contacts and
suggest replies — but you do not want it to send messages without
your approval, and you do not want it to access your wallet at all.

1. You open the External Agent Access panel in Desktop.
2. You choose capability domains: `action.discover.contacts`,
   `action.dry-run.message_compose`. You exclude
   `action.commit.*` for messaging and exclude all wallet domains.
3. The panel issues a scoped token with one-time plaintext display.
4. You give the token to your external AI. From now on, the token
   ledger shows the issuance, the active scope, and any revocations
   you make. The platform does not show the token plaintext again.
5. Anything the external AI proposes outside its scope fails closed
   in the output firewall — `POLICY_BLOCKED` or `REJECTED`.
6. Anything the external AI proposes inside its scope but in a
   sensitive class still requires your approval, recorded as
   evidence in the audit ledger.

The authority model is what makes this safe. The token is not a
free-form key; the scope is admitted; the firewall enforces; the
audit records.

## Why This Shape

| Concern | Why this design responds |
| --- | --- |
| AI agents are first-class | The principal model treats agent and external-principal as real participants, not just user shortcuts. |
| Apps must be replaceable | App modes are not a privileged tier; Desktop is one extension-app peer. |
| External AI must be safe | Scoped tokens + ledger + firewall + approval are an end-to-end chain, not a single guard. |
| Audit must reconstruct | Every action carries principal lineage; tokens cannot be re-shown to fake provenance. |
| World ownership must be unambiguous | At most one active extension-app per world; binding is explicit. |

## Source Basis

- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml)
- [`.nimi/spec/platform/kernel/tables/participant-profiles.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/participant-profiles.yaml)
- [`.nimi/spec/platform/ai-agent-security-interface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-agent-security-interface.md)
- [`.nimi/spec/runtime/kernel/scoped-app-binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scoped-app-binding-contract.md)
- [`.nimi/spec/runtime/kernel/auth-service.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/auth-service.md)
- [`.nimi/spec/runtime/kernel/account-session-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/account-session-contract.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
