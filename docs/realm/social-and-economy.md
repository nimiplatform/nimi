# Social And Economy

Social and Economy are the two canonical Realm surfaces for who
relates to whom and how value moves. Both are append-only at
their authoritative layer; both are platform truth.

## Social

Friendship is the canonical admission graph. Ordered-pair
uniqueness — one friendship between Alice and Bob, recorded
canonically.

| Property | Value |
| --- | --- |
| Storage | Realm `R-SOC-*` |
| Shape | Ordered-pair uniqueness graph |
| Cross-world visibility | yes — same friendship in every world |
| Cross-app visibility | yes — same friendship in every Nimi app |
| Mutation | Through admitted Realm contracts |

### What Social Does

- Tracks friendship and admission graph.
- Gates human-chat preconditions — chat between two users may
  require an admitted social state.
- Does **not** own the chat thread itself; chat is owned by Realm
  Chat.

### Why Friendship Is Canonical

If friendship were per-app or per-world, two apps could disagree
about whether two users are friends. Apps would need to sync;
syncs would conflict; user experience would fragment.

Canonical friendship is one truth across the platform. Apps read;
Realm is authoritative.

## Economy

The canonical platform economy is **append-only**: every currency
transaction, revenue attribution, and settlement event has explicit
typed semantics.

| Property | Value |
| --- | --- |
| Storage | Realm `R-ECON-*` |
| Shape | Append-only event stream |
| Event types | Explicit; admitted at kernel level |
| Settlement | Typed events |
| AI compute cost | Not modeled as Realm core truth (separate concern) |

### What Economy Owns

- Currency transaction history.
- Revenue attribution and splits for creator content.
- Settlement events.
- Wallet balance projections.

### What Economy Does Not Own

- AI compute cost (separate runtime concern).
- World-internal currencies (a world may have its own ticket
  stubs; those are not platform canonical economy).
- Subscription / payment processor internals (those live in their
  own admitted surfaces).

### Append-Only Posture

The economy stream is append-only at the canonical layer. A
mistaken settlement event does not get deleted; it gets superseded
by a correction event. The full chain is reconstructible.

This matters because economic correctness is auditable. A creator
who wants to know exactly how their revenue settled can read the
event stream end-to-end without ambiguity.

## Reader Scenario: A Friendship That Crosses Worlds

Alice and Bob become friends in World A, where they were both
visiting.

1. **Friend request.** Alice sends; Realm admits the request.
2. **Bob accepts.** Realm admits; ordered-pair record created
   in `R-SOC-*`.
3. **Visible everywhere.** When Alice visits World B, the
   friendship with Bob is visible. World B's local social rules
   may apply (perhaps "friend" grants different privileges in
   World B), but the canonical friendship is the same one
   record.
4. **Cross-app.** Any Nimi app reading social state sees the
   same friendship.

A new app launching does not need to re-admit the friendship.

## Reader Scenario: A Revenue Settlement

An admitted revenue source is attributed to a creator's content.

1. **Source attribution.** Realm resolves the typed source origin.
2. **Settlement event.** Per the active share plan, a typed
   settlement event is committed.
3. **Wallet projection updates.** The creator's resulting balance
   is derived from the canonical ledger.
4. **Audit lineage.** Source origin, settlement event, and share
   plan remain linked.
5. **Withdrawal.** The creator can withdraw through the admitted
   withdrawal flow.

The revenue chain is reconstructible end-to-end. Nothing is silent.

## Reader Scenario: A World With Internal Currency

A creator's world uses ticket stubs for in-world transactions.

1. **In-world tickets.** The creator's world rules describe
   ticket stub semantics — local economy, local rules.
2. **Not Realm canonical.** Ticket stubs are world-local; they
   do not appear in `R-ECON-*` event stream.
3. **Conversion if admitted.** If the world admits a conversion
   event between ticket stubs and platform currency, that
   conversion appears as a typed canonical economy event.
4. **Cross-world standing unchanged.** Tickets in World A do
   not affect Bob's canonical wallet balance unless an admitted
   conversion event records it.

The split is intentional. Worlds get internal economic creativity;
the platform-canonical economy stays one auditable truth.

## How Social And Economy Connect

Some events involve both:

| Event | Touches |
| --- | --- |
| Creator revenue settlement | Economy events may reference an admitted source owner |
| Becoming friends | Social event; may unlock social-gated economic features |

When an event touches both, the platform does not collapse them
into one record. Each surface gets its typed event; the full
chain links them through audit lineage.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
