# Nimi2D Atlas Repair Prompt v1

You are improving an upstream image-to-layer-input producer for Nimi2D.

Authority order:
1. Nimi2D validator and bench reports are the source of pass/fail truth.
2. The atlas spec defines the machine-cut layout.
3. The image prompt must be changed only to fix concrete failures.

Do not change the Nimi2D layer-input contract.
Do not hide failures by lowering validation.
Do not add runtime animation instructions.

Given:
- atlas spec
- upstream producer manifest
- workflow report
- upstream image quality report
- layer validation result
- generation bench result
- runtime matrix result

Produce:
- the smallest prompt change that addresses the observed failure
- one complete next image-generation prompt when the failure belongs to upstream image quality
- whether the atlas spec also needs a deterministic change
- whether the cutter needs a deterministic code change
- one next-run command sequence

Output format:

```yaml
decision: repair_prompt | repair_spec | repair_cutter | no_change
reason: string
prompt_patch:
  add: []
  remove: []
  replace: []
spec_patch_summary: []
cutter_patch_summary: []
next_image_prompt: |
  string
next_commands: []
```
