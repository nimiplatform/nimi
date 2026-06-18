# Nimi2D Layer Atlas Prompt v1

Use case: stylized-concept
Asset type: Nimi2D machine-cut layer atlas

Primary request:
Create one single PNG atlas image for a stylized 2D agent avatar. The image is
not a final illustration; it is a machine-cut source for a layered avatar
workflow.

Atlas layout:
- 3 columns x 2 rows.
- Every cell represents the same full avatar canvas.
- Each cell must preserve identical avatar registration and scale.
- No text, labels, numbers, watermarks, shadows, gradients, or decorative
  background.
- Use a perfectly flat solid #00ff00 chroma-key background in every transparent
  area.
- Do not use #00ff00 inside the character or outfit.

Cell contents:
- Row 0 column 0: body and torso underpaint, anatomically informed but
  detail-neutral.
- Row 0 column 1: head and face base only.
- Row 0 column 2: hair only.
- Row 1 column 0: eyes and brows only.
- Row 1 column 1: mouth only.
- Row 1 column 2: default outfit only.

Registration:
- The character must occupy the same canvas position in every cell.
- Head, eyes, mouth, body, and outfit must align when the cells are composited
  in draw order.
- Keep each cell fully separated from neighboring cells with no overlap across
  cell boundaries.

Style:
- Clean 2D anime-inspired avatar.
- Front-facing neutral pose.
- Simple readable forms.
- Crisp edges suitable for chroma-key alpha removal.

Safety:
- The base body layer must be detail-neutral: no nipples, genitals, erotic
  details, or explicit nudity.
- The final composited display state must include the default outfit.
