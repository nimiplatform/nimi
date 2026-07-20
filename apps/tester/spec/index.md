# Tester App Authority

## Scope

This admitted app-local slice owns Tester product renderer composition,
production host bindings, the Tester Simulator module input, and Tester-owned
conformance fixtures. Admission is controlled only by
`.nimi/spec/platform/kernel/tables/app-slice-admissions.yaml` under
`P-APP-001..006`.

It is subordinate to `.nimi/spec/**`. It cannot redefine Platform Simulator,
Kit, SDK, Runtime, Realm, Desktop, Cognition, Avatar, Nimi App identity,
permission, admission, release, or test-topology truth.

## Rule ID Format

`T-SIM-NNN`

## Document Ownership

| Document | Rules | Ownership |
|---|---|---|
| `kernel/simulator-integration-contract.md` | `T-SIM-*` | Tester canonical renderer factory, production binding equality, App-owned Simulator Adapter, Manifest/fixture, containment, and selection evidence |

## Upstream Authority

- `P-APP-001..006`
- `P-SCAF-015`
- `P-SIM-001..024`
- `P-KIT-042`, `P-KIT-080`, `P-KIT-090`
- `S-BOUNDARY-005`, `S-BOUNDARY-006`, `S-TRANSPORT-001`, `S-ERROR-015`

Implementation and local reports are evidence only. They do not amend this
authority or any upstream contract.
