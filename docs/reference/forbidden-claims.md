# Forbidden Claims

Reference for the public docs forbidden claim list, with detection
patterns. The list defines what cannot appear in reader-facing prose
unless the matching evidence has been admitted under the appropriate
authority contract.

## Forbidden Marker Strings

| Marker | Pattern | Reason |
| --- | --- | --- |
| `TODO` | `\bTODO\b` | Indicates unfinished work; should be tracked in topic, not in docs |
| `TBD` | `\bTBD\b` | Same as above |
| `FIXME` | `\bFIXME\b` | Same as above |
| `lorem` | `\blorem\b` (case-insensitive) | Placeholder text |
| `placeholder` | `\bplaceholder\b` (case-insensitive) | Placeholder text |
| `coming soon` | `\bcoming soon\b` | Future-promise leak |

## Forbidden Install / Distribution CTAs

These patterns must not appear as call-to-action commands in public
docs unless distribution evidence has been admitted under the relevant
release contract:

| Pattern | Forbidden form | Negative posture allowed |
| --- | --- | --- |
| `curl ` (followed by URL) | Install one-liner | Discussing why curl install is gated |
| `npm install` | Install command | Discussing why pkg install is gated |
| `pnpm install` | Install command | Discussing why pkg install is gated |
| `brew install` | Install command | Discussing why brew install is gated |
| `apt-get install` | Install command | Discussing why apt install is gated |
| `yarn add` | Install command | Discussing why yarn install is gated |
| `early access` | Sign-up CTA | — |
| `early-access` | Sign-up CTA | — |
| `download` (as CTA verb) | Download link | Discussing distribution posture |
| `release notes` | Public release announcement | Discussing release posture |
| `version 1.0` / `v1.0` | Concrete version claim | — |
| `launching` / `launches` | Launch announcement | "Pre-launch" prose is allowed |
| `ships` / `shipped` / `shipping` (as availability claim) | Shipping claim | "Not yet shipped" / "publicly shipped" prose is allowed |

## Forbidden Concrete Provider / Model Names

Public docs do not name specific providers or models unless the
provider catalog and the matching capability evidence have been
admitted under the runtime model-catalog contract:

| Forbidden | Pattern |
| --- | --- |
| `OpenAI` | word-bounded |
| `Anthropic` | word-bounded |
| `Claude` (as provider/model) | word-bounded; allowed only in walkthrough context as "an external AI host" |
| `Gemini` | word-bounded |
| `GPT-` (with version) | regex |
| `Llama` | word-bounded |
| `DeepSeek` | word-bounded |
| `Mistral` | word-bounded |
| `Qwen` | word-bounded |
| `Ollama` | word-bounded |
| `vLLM` | word-bounded |
| `Cohere` | word-bounded |
| `Groq` | word-bounded |
| `Bedrock` | word-bounded |
| `Azure` (as AI provider) | word-bounded |

## Forbidden Forward-Promise Claims

| Claim | Permitted alternative |
| --- | --- |
| "X is available now" (where X is a defined-but-not-shipped surface) | "X is admitted at the contract level" |
| "X is GA" | "X has admitted contract evidence" |
| "X is stable" | "X is a defined surface" |
| "Use X for production today" | "X is admitted; production posture is gated on evidence" |

## Methodology-Side Forbidden Shortcuts

The Nimi Coding methodology refuses these named anti-patterns. Public
docs that describe Nimi Coding must not claim any of these are used:

| Key | Refused pattern |
| --- | --- |
| `mvp_subset_contract` | Cutting canonical contract truth into a temporary minimum subset |
| `legacy_alias` | Keeping obsolete semantics alive via soft alias |
| `compat_shim` | Hiding owner-cut gaps behind temporary compatibility code |
| `dual_read` | Two parallel truth read paths without explicit admission |
| `dual_write` | Two parallel truth write paths without explicit admission |
| `placeholder_success` | Faking success or closure when required truth is missing |
| `happy_path_only_closure` | Claiming closure when only the happy path is closed |
| `time_phased_layering` | Replacing semantic layering with time-sliced (v1/v2/v3) layering |
| `app_local_shadow_truth` | App-local convenience state becoming hidden canonical truth |
| `silent_owner_cut_reopen` | Reopening owner-domain truth inside a downstream execution wave |

## Detection

Wave-level grep used to verify public docs:

```bash
grep -rEn 'TODO|TBD|FIXME|coming soon|lorem|placeholder' \
  README.md docs/*.md docs/**/*.md

grep -rEni '^[^>]*\b(curl |npm install|pnpm install|brew install|apt-get install|yarn add|early.?access)' \
  README.md docs/*.md docs/**/*.md

grep -rEni '\b(OpenAI|Anthropic|Claude|Gemini|GPT-[0-9]|Llama|DeepSeek|Mistral|Qwen|Ollama|vLLM|Cohere|Groq|Bedrock|Azure)\b' \
  README.md docs/*.md docs/**/*.md
```

A non-empty match (excluding negative-posture phrasing inside
quoted/refusal contexts) indicates a forbidden claim has been
introduced.

## Source Basis

- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/runtime/kernel/model-catalog-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/model-catalog-contract.md)
- [`.nimi/spec/runtime/kernel/provider-health-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/provider-health-contract.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/product-scope.yaml)
- [`nimi-coding/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/bootstrap-state.yaml)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
