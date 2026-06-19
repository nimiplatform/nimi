# Nimi2D Codex Image2 Provider Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D Codex Image2 provider authority
> **Owner**: Nimi2D image resource provider surface
> **Parents**:
> - [Authority boundary contract](authority-boundary-contract.md)
> - [Layer input contract](layer-input-contract.md)
> - [Wardrobe and slot contract](wardrobe-slot-contract.md)
> - [Generation Bench contract](generation-bench-contract.md)

## 0. Purpose

This contract admits Codex Image2 as the standard first-party provider for
Nimi2D image resource generation.

The provider produces upstream image resources and evidence. It does not make a
raw image a Nimi2D package input, and it does not replace layer-input,
atlas-quality, package, Generation Bench, or runtime proof gates.

## 1. Provider Boundary

### N2D-IMG2-001 - Standard Provider

All new first-party Nimi2D image resource generation must route through the
Codex Image2 provider command surface.

Admitted standard commands are:

- `nimi2d image2-provider-plan`
- `nimi2d image2-provider-run`
- `nimi2d image2-register-output`
- `nimi2d image2-compare-pixels`
- `nimi2d image2-postprocess`
- `nimi2d image2-layer-workflow`
- `nimi2d image2-distribution-report`
- `nimi2d image2-demo-suite`

Ad hoc session-only prompts, manually pasted image paths without artifact
registration, and unrecorded Codex CLI invocations are not admitted provider
evidence.

`image2-demo-suite` is admitted only as local deterministic fixture evidence for
workflow validation and distribution-gate regression tests. It must label
artifacts as `demo_fixture`, and it must not be represented as live Codex Image2
generation evidence.

### N2D-IMG2-002 - Provider Output Is Evidence

Codex Image2 provider output is upstream image resource evidence.

It may be consumed by:

- source-image quality review
- image repair and enhancement review
- atlas generation and normalization
- companion asset source workflows
- future segmentation or layer extraction providers

It must not be consumed directly by Nimi2D package generation, package
admission, or Generation Bench.

### N2D-IMG2-003 - Fail Closed

The provider must fail closed when:

- no PNG artifact exists
- the artifact cannot decode as PNG/RGBA
- persistence route is not recorded
- pixel-identity evidence is required but mismatches
- Codex CLI execution fails
- a provider response claims success without a real file path
- workflow kind, target kind, companion kind, or slot kind is not admitted

The provider must not fabricate image paths, semantic success, policy
admission, or downstream Nimi2D admission.

## 2. Workflow Families

### N2D-IMG2-010 - Prompt To Source Image

`prompt_to_image` turns a description into a Nimi2D source image for later layer
or atlas work.

Required properties:

- SFW fully clothed character when human-form content is requested
- full subject visible with margin
- plain removable background
- crisp eyes, mouth, hands, hair, shoes, and outfit boundaries
- no text, watermark, border, labels, or transparency-preview checkerboard

Output is an image resource artifact only.

### N2D-IMG2-011 - Image Plus Prompt To Improved Source Image

`image_prompt_to_image` uses an input image and description to repair or improve
a Nimi2D source image.

It must preserve identity and design intent from the source image while
improving downstream layer extraction quality. It may not silently change the
character, age posture, outfit coverage, or content-admission posture.

Output is an image resource artifact only.

### N2D-IMG2-012 - Image To Layer Atlas

`image_to_layer_atlas` uses a high-quality generated source image to produce a
Nimi2D machine-cut layer atlas.

The admitted default atlas contract is:

- `1536 x 1024` PNG
- `3 columns x 2 rows`
- one continuous exact `#00ff00` chroma-key background
- no visible grid, gutter, border, label, or separator
- cells: registration body, head/face, hair, eyes/brows, mouth, default outfit
- identical registration and scale in every cell

The atlas must still pass:

- atlas spec validation
- upstream raw atlas quality recording as diagnostic and failure-attribution
  evidence
- deterministic normalization
- transparent atlas conversion
- atlas quality gate
- layer-input validation
- image-input workflow bench

Raw atlas quality is not the release-facing source-to-layer gate by itself.
Codex/Image Gen output is expected to need deterministic repair and
normalization. The repair path is admitted when provenance, repair artifacts,
and downstream gates are recorded instead of hidden.

### N2D-IMG2-013 - Companion Asset Image

`companion_asset` turns a description and optional image into a source image for
a wardrobe, accessory, hair variant, held prop, or scene companion asset.

The request must name:

- target input kind
- companion kind
- slot kind when slot-bound

Companion assets must not redefine the main rig or satisfy outfit requirements
unless admitted as `default_outfit` or `outfit` through wardrobe/package gates.

## 3. Artifact Protocol

### N2D-IMG2-020 - Provider Request Manifest

Every provider run starts from:

```yaml
manifest_kind: "nimi.nimi2d.codex-image2.request"
schema_version: 1
```

The request records workflow kind, target kind, optional contained source image
ref, source image hash, prompt ref, output schema ref, expected image ref, and
authority boundary.

All artifact refs in the request manifest (`prompt_ref`, `output_schema_ref`,
`expected_image_ref`, `response_ref`, and `artifact_manifest_ref`) must be
relative refs contained by the provider request directory. A provider run must
reject absolute artifact refs and parent-directory escape refs before invoking
Codex or consuming any response.

When a workflow needs a source image, the source image must be copied into the
provider request directory and referenced through a contained relative
`inputs.source_image_ref`. Absolute refs and parent-directory escapes are not
admitted. The request must record `inputs.source_image_sha256`.

### N2D-IMG2-021 - Provider Artifact Manifest

Every admitted provider image artifact is recorded as:

```yaml
manifest_kind: "nimi.nimi2d.codex-image2.artifact"
schema_version: 1
```

The artifact manifest records producer family, model hint, actual selected
model only when known, execution surface, request/prompt refs, PNG facts,
decoded pixel hash, and pixel-identity evidence.

`model_hint` is not an actual producer fact. If a provider run supplies a
concrete model selection such as `--model`, that value must be recorded as
selected model evidence separately from the hint. Unknown model selection must
remain unknown.

Producer admission requires decoded pixel identity evidence. Artifacts without
pixel identity evidence are recorded-only trace evidence and must not be counted
as admitted producer evidence for formal Nimi2D admission.

### N2D-IMG2-022 - Codex CLI Execution

Automation must call Codex through the provider command surface, not by
session-local manual commands.

Experiment scripts must not call `@openai/codex-sdk` or any other direct SDK
path as a parallel live execution route. Repair prompt construction may remain
as a dry planning helper, but live execution must flow through the provider
command surface.

The provider may call:

```text
codex exec --output-schema <schema> -o <response> -
```

The provider response must identify the generated PNG path, and that path must
match the request manifest `artifacts.expected_image_ref` after path
resolution. `evidence_image_path` may point to separate official output
evidence, but `image_path` is the provider-owned persisted artifact path.

The response file must conform to the provider output schema even when supplied
through `--response-file` for local evidence replay. Invalid response status,
missing summary, malformed image path fields, or malformed failure reason must
fail closed before artifact registration.

If Codex cannot generate or persist the image at the expected path, it must
return failure instead of a guessed path.

## 4. Admission Boundary

### N2D-IMG2-030 - Raw Plus Repaired Source-To-Layer Admission

Successful provider output does not imply Nimi2D package admission.

Codex Image2 source-to-layer admission may be reported only under the
`raw_plus_repaired_evidence` model. That model requires:

- admitted producer evidence with decoded pixel identity for the raw provider
  artifact
- immutable raw artifact refs and content hashes
- deterministic repair/normalization artifacts with input and output hashes
- upstream raw Image2 atlas quality recorded as diagnostic evidence
- deterministic normalization pass
- transparent atlas conversion pass
- atlas quality gate pass on the repaired layer source
- image-input workflow bench pass, including layer input validation for
  `manifest_kind: "nimi.nimi2d.layer-input"`

The raw provider artifact must never be treated as a raw package input.
Package manifest validation, Generation Bench, reference-player proof, and any
Avatar runtime proof remain separate downstream gates.

`raw_provider_atlas_admission` may be reported as a strict diagnostic gate for
raw-only prompt quality. It is not the default live provider distribution gate,
because AI image generation is not expected to produce contract-ready atlas
pixels without repair in every case.

`repaired_workflow` success alone is not sufficient for source-to-layer
admission. It must be paired with admitted producer evidence and the downstream
quality/workflow gates listed above. Artifacts without pixel identity remain
recorded-only evidence and must not satisfy source-to-layer admission.

Missing formal admission fields in older local manifests must not be inferred
from a generic workflow verdict.

### N2D-IMG2-031 - Distribution Evidence

Provider stability is measured by distribution reports over unique source image
hashes. The report must keep atlas/source artifact uniqueness separate from
underlying source character/image uniqueness. Duplicate source samples do not
count as distribution coverage.

When provider request evidence records `inputs.source_image_sha256`, release
audits may require a minimum count of unique underlying source images. Multiple
unique atlas outputs derived from the same underlying source image must remain
visible as duplicate underlying-source coverage, not silently counted as full
source diversity.

Live Codex Image2 distribution reports must filter to `source_surface:
"codex_cli"` or an explicitly admitted live provider surface. Runs marked
`demo_fixture` must not count toward live distribution coverage.

The release-facing provider distribution gate is `source_to_layer_pipeline`.
It counts unique live provider samples that pass admitted producer evidence,
deterministic repair, atlas quality, and layer-input workflow gates. Diagnostic
reports may still request `raw_provider_atlas` to measure raw prompt quality.

Distribution reports may additionally require layer-input full-chain package
proof for release audits. That stricter gate is separate from source-to-layer
admission: package validation, visual proof, reference-player proof, and Avatar
runtime readiness must not be silently folded into provider admission semantics.

Distribution pass does not replace case-level package, Generation Bench,
reference-player proof, or Avatar-owned runtime gates.

## 5. Validation Floor

Provider closure is valid only if:

- all four workflow families can produce provider request plans
- provider run automation exposes the exact Codex CLI command and fails closed
  without a response or image file
- provider artifact registration inspects real PNG bytes
- pixel comparison works on decoded RGBA pixels
- atlas workflow still reaches layer-input and bench gates before success
- documentation and AGENTS.md tell AI agents to use provider commands instead
  of manual session prompts
- the local demo suite can exercise all four workflow families and fail closed
  on insufficient unique source hashes
- distribution reports can fail closed on insufficient unique underlying source
  image hashes when that strict release-audit gate is requested
- distribution reports can fail closed when layer-input full-chain package proof
  is missing or failing and that strict release-audit gate is requested
