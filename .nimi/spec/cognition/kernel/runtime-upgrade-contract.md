# Cognition Runtime Upgrade Contract

> Owner Domain: `C-COG-*`

## C-COG-037 Runtime Capability Upgrade Matrix

The authoritative runtime-to-cognition upgrade matrix is
`tables/runtime-capability-upgrade-matrix.yaml`.

Fixed rules:

- every overlap concern inherited from runtime memory or runtime knowledge must
  appear exactly once in the upgrade matrix
- every matrix row must declare runtime source contract, runtime capability,
  cognition owner surface, parity mode, required floor, admitted shape, and
  forbidden downgrade
- runtime source contracts may point either to the absorbed
  `RuntimeCognitionService` authority now recorded under `K-MEM-*` / `K-KNOW-*`
  or to explicit retained runtime-private depth when that deeper floor remains
  outside the public replacement topology
- upgrade-matrix rows govern capability closure, not package similarity or
  terminology reuse
- if a runtime overlap concern is missing from the matrix, cognition must not
  claim completion for that capability family

## C-COG-038 Capability Parity Interpretation

Standalone cognition uses capability parity, not method-name parity, when
upgrading runtime memory and runtime knowledge.

Fixed rules:

- standalone-native API naming is admitted only when each overlapping runtime
  concern remains explicitly mapped to an equal-or-stronger cognition surface
- runtime topology replacement does not permit the matrix to hide retained
  runtime-private depth behind a vague "future cleanup" story
- `parity` means cognition preserves runtime semantic floor without weakening
  fail-closed behavior
- `upgrade` means cognition strengthens the runtime concern while still making
  the overlap mapping explicit
- `explicitly_out_of_scope` is admitted only when the matrix declares why the
  omitted runtime concern does not damage standalone cognition completeness
- a smaller or vaguer cognition surface must not claim parity solely because the
  overall project is “standalone”
