# External Agent Access

The External Agent Access panel is Desktop's unique UI for
managing `ExternalPrincipal` tokens. It is the human-facing
surface for "let an external AI host access my Nimi account in a
controlled, scoped, revocable way."

For the platform-level model, see
[Platform → Agents → External Agents](/platform/agents/external-agents).

## What The Panel Does

| Step | Behavior |
| --- | --- |
| Read gateway status | Show current external-agent gateway state |
| Configure | Choose principal id / account / mode / actions / TTL |
| Issue token | Submit; runtime issues a scoped token |
| Plaintext display | One-time plaintext display of the issued token |
| Token ledger | Subsequent visibility is via immutable ledger only |
| Revoke / list | Operate on the ledger (revoke, view active tokens) |

The panel is **the only place** these tokens are issued or shown
in plaintext. After issue, the token is no longer visible — only
the ledger is. This is a deliberate security choice.

## Why One-Time Plaintext Display

If the platform showed the token plaintext on every visit, a
malicious actor with momentary screen access could exfiltrate.
Showing plaintext exactly once at issue means the token's
existence in plaintext is bounded to the moment the user
explicitly created it.

After that, the user works with the **ledger** — a record of
which tokens exist, when they were issued, what scope they carry,
when they were last seen, and revocation history.

## Token Ledger

| Property | Value |
| --- | --- |
| Visibility | List of issued tokens with metadata |
| Mutability | Append-only; revocation is recorded as an event |
| Token plaintext | Not stored; not retrievable after issue |
| Scope | Visible per token entry |
| TTL | Visible per token entry |

A user reviewing the ledger sees what tokens are active, what
each can do, and revokes any that are no longer wanted.

## Reader Scenario: Issuing A Scoped Token

You want to grant an external AI host bounded access.

1. **Open External Agent Access panel.** Through Desktop runtime
   config.
2. **Configure.**
   - Principal id (the external AI's identity)
   - Account context (your account's scope)
   - Mode (typically discovered + suggested only; rarely commit)
   - Actions (admitted capability domains —
     `action.discover.*`, `action.dry-run.*`, `action.verify.*`,
     `action.commit.*`)
   - TTL (lifetime of the token)
3. **Issue.** The panel submits to runtime; runtime issues the
   scoped token.
4. **Plaintext display.** The token is shown once.
5. **You copy the token.** Paste it into the external AI host's
   configuration.
6. **Ledger entry.** The panel now shows a ledger entry with
   metadata; the plaintext is gone.

You used the panel to issue; you used the ledger to manage from
that moment onward.

## Reader Scenario: Revoking A Token

You no longer want a particular external AI host to have access.

1. **Ledger.** Open the External Agent Access panel.
2. **Find the token.** The ledger lists active tokens.
3. **Revoke.** Submit revocation.
4. **Runtime admits.** The token's revocation event is appended
   to the ledger.
5. **Effective immediately.** The next request from that token
   fails closed at runtime under admitted authorization.

Revocation is real — not a soft "asked to be removed." Once
revoked, the token no longer authorizes anything.

## Reader Scenario: A Token's Scope Was Misconfigured

You issued a token with `action.commit.gift` accidentally; you
intended discover + dry-run only.

1. **Ledger.** You spot the misconfiguration in the ledger.
2. **Revoke.** Revoke the misconfigured token.
3. **Re-issue.** Issue a new token with the correct scope.
4. **Audit.** Both events (revocation + re-issuance) are
   recorded.

The misconfiguration is recoverable because the panel + ledger
let the user see and act.

## Why This UI Is Unique

The External Agent Access panel is **the** UI for external
principal token issuance. It isn't generalized to "any token";
it is specific to external principals because they are a real,
named participant kind in the authorization model.

Creating other token kinds through this panel is not admitted.
Other token shapes (user session tokens, etc.) live elsewhere.
The panel's narrowness is what keeps its security posture clear.

## Source Basis

- [`.nimi/spec/desktop/external-agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/external-agent.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/scoped-app-binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scoped-app-binding-contract.md)
- [`.nimi/spec/platform/ai-agent-security-interface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-agent-security-interface.md)
- [`.nimi/spec/platform/ai-last-mile.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-last-mile.md)
