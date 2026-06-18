# Codex Image2 Layer Source Prompt v1

Use this prompt when producing a single source image for see-through or another
layer extraction backend.

```text
Image Gen Create a high-resolution anime full-character reference image for layer separation testing.

A single adult fantasy courier woman standing centered on a plain matte off-white background, fully clothed from shoulders to shoes, full character visible from hair tip to shoes, arms slightly away from torso, legs separated, front-facing 3/4 pose. The character is wholesome, non-sexualized, and designed as a production-safe avatar reference.

Character details:
- long silver-white hair with many thin semi-transparent strands, two side locks crossing in front of the shoulders, small red hair ribbon on the left side
- large expressive blue eyes with visible iris highlights, thin eyelashes, small closed smile, clearly readable mouth
- layered outfit: navy cropped jacket, white blouse, red scarf, pleated teal skirt, opaque black leggings, brown ankle boots
- one small tan leather satchel hanging at the hip with a thin strap crossing the torso
- both hands visible, fingers separated, one hand holding a small folded paper map
- subtle occlusion: hair overlaps jacket shoulders, scarf overlaps blouse, satchel strap overlaps jacket and blouse, skirt overlaps upper legs
- clean anime line art, crisp edges, high detail, no painterly blur

Image requirements:
- no text, no watermark, no border
- plain off-white background only
- full character must fit inside the image with margin around head, hands, and feet
- mouth, eyes, hands, shoes, hair strands, scarf, satchel strap, and skirt edges must be sharp and readable
- keep the character fully dressed; do not create clothing-removed base layers,
  garment-removed variants, or completed regions underneath clothing
- square or portrait PNG
```

## Export Rule

The generated image may be persisted by Codex App, Codex CLI, or local tooling.
Local `System.Drawing`, PIL, ImageMagick, or equivalent writers are acceptable
only when they persist decoded Image Gen pixels, not when they semantically
redraw the prompt from a blank canvas.

Admit one of:

- official generated-image attachment/download path
- official local generated-image path
- local persisted PNG with pixel-identity proof against Image Gen UI/output
  evidence

Reject:

- prompt reconstruction
- blank-canvas redraw
- semantic recreation
- screenshot/crop/downsample unless explicitly marked as preview-derived
