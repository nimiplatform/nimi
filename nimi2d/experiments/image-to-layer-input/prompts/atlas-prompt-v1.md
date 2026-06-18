# Nimi2D Layer Atlas Prompt v1

Use case: stylized-concept
Asset type: Nimi2D machine-cut layer atlas

Primary request:
Create one single PNG atlas image for a stylized 2D agent avatar. The image is
not a final illustration; it is a machine-cut source for a layered avatar
workflow.

Atlas layout:
- Required canvas size: exactly 1536 x 1024 px.
- 3 columns x 2 rows. These are invisible coordinate regions, not visible
  panels.
- Coordinate regions:
  - column 0: x=0..511
  - column 1: x=512..1023
  - column 2: x=1024..1535
  - row 0: y=0..511
  - row 1: y=512..1023
- The final PNG must look like six isolated layer groups floating on one
  continuous uninterrupted green field.
- Every cell represents the same full avatar canvas.
- Each cell must preserve identical avatar registration and scale.
- No text, labels, numbers, watermarks, shadows, gradients, or decorative
  background.
- Do not draw visible grid lines, cell borders, separators, gutters, panel
  frames, table lines, rulers, outer strokes, or white dividing lines.
- Cell positions are layout instructions only; the boundaries must remain
  visually invisible.
- Use a perfectly flat solid #00ff00 chroma-key background in every transparent
  area.
- Every empty background pixel must be exact RGB #00ff00. Do not use near-green,
  gradients, antialiasing in empty background areas, texture, lighting falloff,
  vignette, checkerboard, or transparency preview.
- Empty space between adjacent layer groups must also be the same uninterrupted
  #00ff00 background, with no line at the row break or column breaks.
- Empty pixels at x=512, x=1024, and y=512 must be the same exact #00ff00
  background, not a separator.
- After placing the layer art, all non-character background pixels should read
  as exact #00ff00 with tolerance 0.
- Do not draw a checkerboard transparency preview; the PNG must contain real
  colored pixels for the background so local tooling can convert #00ff00 to
  alpha afterward.
- Do not use #00ff00 inside the character or outfit.

Cell contents:
- Row 0 column 0: clothed registration mannequin only: a neutral full-avatar
  alignment silhouette wearing an opaque simple base outfit, with face, hair,
  eyes, mouth, accessories, and detailed costume removed. This is a technical
  placement mask, not a character texture layer.
- Row 0 column 1: head and face base only, with only the visible face shape and
  ears needed for registration; no neck-down reconstruction.
- Row 0 column 2: hair only.
- Row 1 column 0: eyes and brows only.
- Row 1 column 1: mouth only.
- Row 1 column 2: default outfit only.

Registration:
- The character must occupy the same canvas position in every cell.
- Head, eyes, mouth, registration silhouette, and outfit must align when the
  cells are composited in draw order.
- Keep each cell fully separated from neighboring cells with no overlap across
  cell boundaries.
- Keep a small internal safety margin around each layer group, but do not mark
  the margin with any visible border or divider.

Style:
- Clean 2D anime-inspired avatar.
- Front-facing neutral pose.
- Simple readable forms.
- Crisp edges suitable for chroma-key alpha removal.

Safety:
- Every human-form cell must remain fully clothed or limited to face/hands that
  are already visible in the final dressed character.
- Do not create clothing-removed base textures, underpaint layers, or completed
  regions underneath clothing, hair, skirt, socks, scarf, or accessories.
- Row 0 column 0 must remain an opaque clothed registration silhouette or
  simple base outfit mask.
- Visible face and hands must remain ordinary PG-rated avatar details.
- The final composited display state must include the default outfit.
