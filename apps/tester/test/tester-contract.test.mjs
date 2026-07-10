// Aggregator coverage index consumed by Kit cross-app adoption checks:
// - tester kit gallery showcases real kit components
// - tester auth and runtime bootstrap consume Kit shell bridge primitives
// - tester product-local preferences use Kit storage while AIConfig persistence is standard-shell owned
// - Runtime account projection without account control
// - emitRuntimeLog
import './tester-contract/boundary.mjs';
import './tester-contract/history-ui.mjs';
import './tester-contract/no-input-composer.mjs';
import './tester-contract/ai-config.mjs';
import './tester-contract/runtime-invokers.mjs';
