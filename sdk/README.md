# sdk

This folder contains the staged SDK split for the public monorepo.

Current packages:

- `packages/sdk` (`@nimiplatform/sdk` canonical facade)
- `packages/realm` (`@nimiplatform/sdk-realm`)
- `packages/runtime` (`@nimiplatform/sdk-runtime`, runtime transport client)
- `packages/mod-sdk` (`@nimiplatform/mod-sdk`, mod/hook SDK)
- `packages/types` (`@nimiplatform/sdk-types`, shared semantic type source)
- `packages/ai-provider` (`@nimiplatform/ai-provider`, Vercel AI SDK provider + runtime media extensions)

New code should prefer `@nimiplatform/sdk/*`.
