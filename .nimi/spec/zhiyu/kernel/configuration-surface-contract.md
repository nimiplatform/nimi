# Zhiyu Configuration Surface Contract

## Z-CONFIG-001 AI Model Config Operation

Zhiyu must provide a user-facing surface to view and operate the AI model
configuration used by Runtime execution for the current partner. Zhiyu does not
own `runtime_ai_config`, provider routing, execution, credential custody,
prompt assembly, or spend truth.

## Z-CONFIG-002 AI Config Persistence

AI config changes initiated from Zhiyu must be submitted through admitted
Runtime/SDK/Kit or Platform public facades. Zhiyu must not persist a local
Runtime AI config store or hardcode provider/model constants.

## Z-CONFIG-003 Avatar Config Operation

Zhiyu must provide Avatar config operations required by the local partner
center: import Live2D/VRM resources through admitted facades, select
Live2D/VRM, and launch Avatar. Zhiyu does not own Avatar resource truth, config
truth, carrier lifecycle, or runtime truth.

## Z-CONFIG-004 Config Boundary

Configuration surfaces must fail closed on missing upstream facade, permission,
binding, validation, or owner admission. A local UI control is not proof that
the config change is admitted or persisted.
