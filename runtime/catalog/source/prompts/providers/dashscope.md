# DashScope Provider Prompt

Use this prompt for `dashscope` source audits and refreshes.

## Focus

- Treat DashScope as a multi-axis provider, not just a multi-family provider.
- Classify review using all of:
  - `product_family`
    - `qwen`
    - `wan`
    - `tongyi`
    - `fun_asr`
  - `capability_family`
    - `text`
    - `vision_language`
    - `image`
    - `video`
    - `tts`
    - `realtime_tts`
    - `asr`
    - `realtime_asr`
    - `voice_workflow`
  - `lineage_or_track`
    - `max`
    - `plus`
    - `flash`
    - `vc`
    - `vd`
    - `realtime`

## Hard Rules

- Distinguish provider-native Qwen lines from third-party marketplace rows.
- Distinguish Qwen, Wan, Tongyi, and FunASR first-party lines from each other.
- Do not flatten realtime rows into non-realtime rows.
- Do not force one first-party image line to displace another just because they
  share `image.generate`; parallel active lines may coexist.
- Treat broad family names and source row ids separately; convert labels such as
  `wan2.7` into concrete source rows.
- Prefer additive catch-up before any removal of older DashScope rows.
- Review `selection_profiles` separately after text-family updates.

## Settled Review Heuristics

- Keep `wan` and `tongyi/z` image lines as parallel first-party tracks when both
  are still documented.
- Keep `qwen-vl-max-latest` until there is explicit evidence that the `max`
  track is retired or superseded in official docs.
- Keep `wan2.6-*` only as the previous-generation tail once `wan2.7-*` rows are
  fully represented.
- Drop generic pre-`qwen3` tails such as `qwen-plus-latest` after current
  `qwen3.5` and `qwen3.6` rows are landed and reviewed.
- Drop older generic TTS rows such as `qwen-tts` after `qwen3` TTS and
  realtime TTS families are fully represented.
- Drop obsolete preview-only Wan image rows such as `wan2.5-t2i-preview` once
  current Wan image lines are represented.

## Primary Evidence

- official DashScope / Model Studio model catalog pages
- official release notes / model updates pages
- official pricing and API reference pages

## Typical Pitfalls

- under-scoping to text only
- flattening Qwen, Wan, Tongyi, and FunASR into one undifferentiated model list
- assuming one capability family can only have one active first-party lineage
- treating marketplace-hosted third-party models as equivalent to provider
  first-party Qwen lines
