# Realm media delivery

`@nimiplatform/kit/features/media` exports `MediaImage`, `MediaAvatar`, and `MediaVideo`. Its `headless` entry selects only Realm-issued image candidates and validates delivery descriptors through the SDK. The Resource remains the sole identity and URL owner; no Cloudflare account, path, width or grant is assembled here.

Pass `delivery`, a declared `purpose`, and layout-specific `sizes` to images. `sizes="auto, 320px"` uses native lazy-image sizing; eager images measure their rendered width before requesting a candidate. Card selection caps at 640 pixels by default. Original downloads must be explicit actions using `originalUrl`; audio playback uses `previewUrl`.

`MediaVideo` uses native HLS where supported and dynamically loads hls.js otherwise. It preserves the playback position during one failed-load refresh, bounds buffering and does not request original bytes as playback fallback. It starts segment loading on play by default. The containing business read surface supplies `refresh`, which rechecks access; the component never calls a Resource owner-only endpoint as a substitute. Pass localized `onUnavailable` / fallback UI. Revoked content stays unavailable.

External URLs and local runtime Blob/data media keep their existing separate owners. Supplying an external URL beside a managed descriptor does not create an authorization fallback. Runtime VRM, Live2D, model textures, signed packages and inference inputs must retain exact original bytes.

An image transport failure has one recovery opportunity per input descriptor. If its authorized read returns the same descriptor (as for public content), the component retries the exact URL once. A renewed grant shares that budget; a rejected read or another failed load remains unavailable. Successful loading resets the budget. No cache-buster or original fallback is generated.
