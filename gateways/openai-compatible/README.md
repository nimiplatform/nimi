# Nimi OpenAI-Compatible Gateway

Local gateway for OpenAI-compatible clients that want to consume admitted Nimi
Runtime local model capabilities without depending on Runtime internals.

## Boundaries

- This package is a Runtime consumer, not a Runtime daemon module.
- The gateway exposes OpenAI-compatible HTTP shapes and delegates execution to an
  injected Runtime job client.
- The gateway must not call `runtime/internal/**`, managed media backend HTTP, or
  app-owned private transports.
- Model names exposed to clients are aliases projected from Runtime-supported
  image generation targets. Runtime remains the authority for model inventory,
  profile validation, leases, execution, and artifacts.
- v1 is loopback-only with numeric loopback proof (`127.0.0.1`, `::1`, or
  IPv4-mapped loopback). LAN or remote exposure belongs to a later explicit
  product slice with device grants or Realm auth.

## Supported v1 Surface

- `GET /openai/v1/models`
- `POST /openai/v1/images/generations`
- `GET /openai/v1/artifacts/:id`
- `GET /healthz`

Every route, including `/healthz`, requires verified loopback client evidence.
`/healthz` does not require a local API key after loopback has been proven.

`/openai/v1/images/generations` maps an OpenAI-style image request to a Runtime
image generation job request. Phase 1 supports `model`, `prompt`, `n=1`,
`size` as `WIDTHxHEIGHT`, `response_format`, `seed`, and `negative_prompt`.
Unsupported OpenAI fields fail closed, including `quality`, `style`,
`reference_images`, `mask`, and `n > 1`.

`response_format=url` returns a short-lived gateway artifact URL backed by
generated image bytes. `response_format=b64_json` returns base64 inline bytes.
The gateway emits artifact URLs only on numeric loopback origins and does not
trust a caller-controlled `Host` header for remote-looking origins. The gateway
never returns filesystem paths or managed-media backend URLs.

## Runtime Adapter Contract

The gateway accepts any object that implements the following Runtime adapter
shape:

- `runtime.listImageGenerationModels()`, returning Runtime-supported image
  generation target projections.
- `runtime.runImageGenerationJob(request)`, translating the gateway request into
  Runtime `SubmitScenarioJob`, waiting for terminal job state, and returning
  generated image artifacts. The public SDK helper
  `runNimiRuntimeImageGeneration` is the intended implementation seam.
- `runtime.readArtifactBytes({ artifactId })` when Runtime returns artifact ids
  without inline bytes.

`createOpenAICompatibleRuntimeAdapter()` is the intended public-SDK seam for
real integrations. It does not import Runtime internals or SDK build artifacts;
the owning process injects public SDK functions and clients:

- `runNimiRuntimeImageGeneration` from the SDK generation feature.
- `listNimiRuntimeRouteOptions` plus a route-options client for
  `image.generate` model discovery.
- `toRuntimeDurableTargetRef` from the SDK Runtime targetRef helpers when
  route-options target refs must be converted into Scenario job target refs.
- a Runtime artifact client for byte reads.

The adapter projects route-options image targets into OpenAI model ids such as
`local/z-image-turbo`, passes the gateway app identity into the Scenario job
head, forces local route policy by default, and preserves Runtime targetRef
authority instead of accepting caller-provided OpenAI model routing metadata.

The gateway package intentionally does not ship a fake Runtime transport. Runtime
grant acquisition, protected `ai.spend.meter` token custody, and Forge ledger
integration are separate follow-up seams.
