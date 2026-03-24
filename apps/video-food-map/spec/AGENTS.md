# Video Food Map Spec AGENTS

## Authoritative Structure

- `kernel/*.md`: app contracts (`VFM-*`)
- `kernel/tables/*.yaml`: fact sources when enumerations are introduced
- `video-food-map.md`: product/domain overview
- `INDEX.md`: reading index
- `execution-plan.md`: phased delivery plan

## Editing Rules

- Do not define the same rule twice.
- Cross-layer references to `K-*` and `S-*` are imports, not local rule IDs.
- Product/domain docs must not duplicate kernel rule prose.
- If route, feature, or capability lists become long-lived enumerations, move them into `kernel/tables/*.yaml`.

## Rule ID Namespace

- `VFM-SHELL-*` — App shell, app boundaries, phase layout
- `VFM-PIPE-*` — Video intake and extraction pipeline
- `VFM-DISC-*` — Discovery, map, creator search, review queue
- `VFM-MENU-*` — Menu capture and dining advisor
