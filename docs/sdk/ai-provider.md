# AI Provider

`@nimiplatform/sdk/ai-provider` is the SDK sub-path that adapts
Vercel AI SDK v3 conventions onto Runtime calls. It is a
**protocol adapter**, not a route decision layer.

## What This Sub-Path Is For

Apps that already use Vercel AI SDK conventions can keep that
shape and bind into Nimi's Runtime under typed contracts. The
adapter projects between the Vercel surface and Runtime
capabilities; it does not invent route semantics.

| Property | Value |
| --- | --- |
| Adapter target | Vercel AI SDK v3 conventions |
| What it does | Surface adaptation |
| What it does not do | Route decisions, provider arbitration, capability admission |
| Authority | Runtime owns the underlying execution |

## Why A Separate Sub-Path

`sdk/runtime` is the typed Runtime client. `sdk/ai-provider` is a
specialized projection that matches Vercel AI SDK call shapes.
Apps that chose to standardize on Vercel patterns can drop in to
Nimi without rewriting their call sites; apps that want raw
Runtime semantics use `sdk/runtime` instead.

The two sub-paths cover different developer experiences. They do
not duplicate truth. Both ultimately route through Runtime.

## What The Adapter Maps

| Vercel concept | Nimi mapping |
| --- | --- |
| `streamText` style call | Runtime streaming via `sdk/runtime` |
| Provider abstraction | Runtime connector + provider catalog |
| Tool calls | Runtime delegated capability surface (where admitted) |
| Streaming chunks | Mode A / Mode B mapped to Vercel chunk shape |

The adapter never replaces Runtime authority. If Runtime says
something failed, the adapter projects that failure into the
Vercel-shaped error; it does not synthesize success.

## What The Adapter Does Not Do

- **Route decisions.** Provider selection lives in Runtime, not in
  the adapter. The adapter does not pick "the cheaper provider";
  Runtime does.
- **Capability admission.** A capability that is not admitted on
  Runtime's side does not become available through the adapter.
- **Free-form provider extension.** The adapter respects the
  provider catalog; it does not let an app pretend to use an
  unadmitted provider by tweaking adapter shape.

## Reader Scenario: An App With Existing Vercel Code

You have an app that uses Vercel AI SDK v3 patterns. You want to
move it to Nimi's Runtime.

1. **Install SDK.** `import` from `@nimiplatform/sdk/ai-provider`.
2. **Adapter init.** Plumb Runtime connection through the
   adapter.
3. **Existing call sites.** Your `streamText` style calls keep
   their shape.
4. **Adapter projects.** Calls go through `sdk/ai-provider` to
   Runtime; streaming chunks come back projected into Vercel
   shape; errors come back as typed Vercel errors.
5. **Runtime authority.** Runtime decides routing, audit lands
   in the local ledger, the workflow lifecycle is preserved.

The migration is a sub-path swap, not a rewrite.

## Reader Scenario: A Capability Not Admitted On Runtime

Suppose your existing Vercel code uses a provider extension that
Runtime has not admitted.

1. **Adapter call hits the boundary.** The adapter consults
   Runtime's provider catalog; the extension is not admitted.
2. **Fail closed.** The adapter returns a typed Vercel-shaped
   error; it does not pretend to support the extension.
3. **Remediation path.** Either admit the extension at the
   Runtime kernel level (add to provider extension registry), or
   choose a different surface.

The adapter does not improvise capability. Authority lives in
Runtime; the adapter projects.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Vercel call-site shape | `sdk/ai-provider` adapter |
| Streaming behavior | Runtime streaming contract |
| Provider routing | Runtime |
| Capability admission | Runtime kernel |
| Audit | Runtime audit |
| Tool calls | Runtime delegated capability (where admitted) |

## Source Basis

- [`.nimi/spec/sdk/ai-provider.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/ai-provider.md)
- [`.nimi/spec/sdk/kernel/ai-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/ai-provider-contract.md)
- [`.nimi/spec/sdk/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/transport-contract.md)
- [`.nimi/spec/sdk/kernel/error-projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/error-projection.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/multimodal-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/multimodal-provider-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
