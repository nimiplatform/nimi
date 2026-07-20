# Zhiyu Local Persistence Boundary Contract

## Z-PERSIST-001 Allowed Local State

Zhiyu may persist limited product-local state such as current partner reference,
UI preferences, and diagnostics projection cache if that state is explicitly
listed in `tables/local-persistence-boundary.yaml`.

## Z-PERSIST-002 Forbidden Local Truth

Zhiyu must not persist canonical transcript, turn, session recovery, memory
truth, agent state, provider/model route, Runtime AI config truth, Avatar
resource/config truth, voice artifact truth, image artifact truth, or Runtime
snapshot truth.

Simulator scenario snapshots, module/instance/epoch ids, replay records,
logical-clock state, mock partner/conversation projections, and Simulator
operation results are also forbidden persistence inputs. They exist only in
the Simulator session and are erased by `resetScenario`.

## Z-PERSIST-003 Recovery Source

Conversation recovery and snapshot replay must come from Runtime/SDK admitted
surfaces such as public chat session snapshot, not Zhiyu local storage.

Simulator replay is Platform release/debug evidence and never a Zhiyu recovery
source. A Simulator Adapter recreates its projection from the new scenario
epoch; it does not hydrate Zhiyu storage or invoke production recovery.
