# Use Nimi Lab

`apps/lab/` is Nimi's local capability workbench. Built as a fully functional Nimi App, it integrates the latest SDK, Kit, Runtime, Realm, and App Tools capabilities so developers can evaluate and test new features before they are broadly exposed through project templates.

Nimi Lab serves as a reference implementation for capability integration. Core responsibilities—such as permissions, session tokens, model scheduling, and data persistence—remain strictly governed by standard platform boundaries and security invariants.

## Running and Debugging

Run the following command from the repository root:

```bash
pnpm dev:lab
```

Key development scripts provided in `apps/lab/`:

```bash
pnpm run init       # Initialize project configurations
pnpm dev:shell      # Start the app in the official Electron host
pnpm run validate   # Validate the App manifest and access declarations
pnpm run typecheck  # Check TypeScript types
pnpm run test       # Execute unit and integration tests
```

On Windows and macOS, Nimi Lab runs inside Desktop's supervised Electron development environment. Register local development builds through Developer Mode in Nimi Home and check their Nimi Access session status.

## Key Code and Architectural References

| Area of Interest | Source Path |
| --- | --- |
| Scaffold configuration & local checks | `apps/lab/package.json` |
| Protected shell host routing and communication | `apps/lab/README.md` and shell route modules |
| AIConfig storage and application data isolation | `apps/lab/src/lab/lab-ai-config-store.ts` |
| Capability Intent-driven Runtime AI dispatch | `apps/lab/src/lab/lab-runtime.ts` |
| Structured error handling & state mapping | `apps/lab/src/lab/lab-non-success.ts` |
| AI configuration UI component design | `apps/lab/src/lab/workbench/lab-ai-config-settings-panel.tsx` |
| Contract compliance test suites | `apps/lab/test/lab-contract/` |

## Integration Principles

- **Independent Application Identity**: The app ID `nimi.lab` belongs specifically to Nimi Lab; custom applications must declare their own unique App IDs.
- **Data and Fixture Isolation**: Test fixtures, mock datasets, and diagnostics in Lab are for exploration and testing; design dedicated models for your own product logic.
- **Progressive Adoption**: Evaluate new capabilities in Lab first, then adapt relevant patterns into your custom application based on your product needs.
- **Actionable User Guidance**: Surface structured states to users (such as prompting service startup or checking access readiness) to provide clear next steps when an action cannot proceed.

## Common State Codes

| State Code | Meaning | User Feedback Strategy |
| --- | --- | --- |
| `runtime-unavailable` | Local Runtime service is not responding. | Check that local Runtime and Nimi Home are running. |
| `principal-unauthorized` | The current session or caller is not authorized for this operation. | Check sign-in and this app’s Nimi Access status in Nimi Home, then verify the required access declarations in `nimi.app.yaml`; AI calls require `runtime.consume`. |
| `input-invalid` | Prompt or required parameters are missing or malformed. | Prompt the user to verify required parameters and input format. |
| `sdk-method-unavailable` | Capability is not exposed in the current build. | Prompt the user to update the SDK package. |
| `runtime-call-failed` | An error occurred during request processing. | Display a descriptive error message and retain diagnostic logs. |

## Source Basis

- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`apps/lab/src/lab/lab-runtime.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-runtime.ts)
- [`apps/lab/src/lab/lab-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-ai-config-store.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)
