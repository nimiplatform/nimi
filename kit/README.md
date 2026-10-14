# @nimiplatform/kit

The shared UI design system and cross-platform component toolkit for the Nimi ecosystem.

`@nimiplatform/kit` provides shared UI primitives, glass materials, physics-based motion, accessible controls, theme tokens, and feature modules (Chat, Avatar, Model Picker, and Settings) so application authors can build beautiful, consistent Nimi desktop experiences without reinventing foundational components.

---

## 1. Installation & Peer Dependencies

```bash
pnpm add @nimiplatform/kit @nimiplatform/sdk
```

- **React**: React 19 is required (`react-dom` and `react-i18next` are supported peers).
- **Styling**: Built on Tailwind CSS v4 and CSS variables.

---

## 2. Theming & Styling Setup

Kit ships base component utilities along with dark, light, and accent overlays. Import Kit styles into your primary CSS entry point:

```css
@import 'tailwindcss';
@import '@nimiplatform/kit/ui/styles.css';

/* Choose a base theme: */
@import '@nimiplatform/kit/ui/themes/light.css';
/* or: @import '@nimiplatform/kit/ui/themes/dark.css'; */

/* Optional accent and density layers: */
@import '@nimiplatform/kit/ui/themes/nimi-accent.css';
@import '@nimiplatform/kit/ui/themes/nimi-density-compact.css';
```

---

## 3. UI Primitives & Materials

### General Components
```tsx
import {
  Button,
  IconButton,
  DataTable,
  Pagination,
  Statistic,
  cn
} from '@nimiplatform/kit/ui';
```

### Glass & Elevation
```tsx
import { Surface } from '@nimiplatform/kit/ui';

function Card() {
  return (
    <Surface material="glass-regular">
      <h3>Personal AI Workspace</h3>
    </Surface>
  );
}
```

### Motion & Reduced-Motion Handling
Kit includes a spring-physics motion substrate that automatically respects the OS reduced-motion setting:

```tsx
import {
  NimiMotionProvider,
  nimiSpring,
  nimiOverlayPanelMotion,
  usePrefersReducedMotion
} from '@nimiplatform/kit/ui/motion';
```

### Accessibility (a11y)
- `FOCUS_RING_CLASS_NAME`: Shared keyboard focus styling. Contrast and keyboard behavior still need checking in the finished screen.
- `VISUALLY_HIDDEN_CLASS_NAME`: Content hidden from sight but accessible to screen readers.
- `collectFocusableElements`: Enumerates focusable elements for focus management.

---

## 4. Prebuilt Feature Modules

Kit provides shared UI surfaces for core Nimi capabilities:

| Module Subpath | Feature Highlights |
| :--- | :--- |
| `@nimiplatform/kit/features/chat` | Conversational timeline, message bubbles, streaming tokens, and prompt composer |
| `@nimiplatform/kit/features/avatar` | Live2D and 3D VRM interactive avatar stage with gaze tracking |
| `@nimiplatform/kit/features/model-config` | Multi-model routing preferences and capability binding panels |
| `@nimiplatform/kit/features/model-picker` | Candidate discovery and selection UI; the owning feature supplies candidates and commits the choice |
| `@nimiplatform/kit/features/agent-center` | Shared Agent settings and inspection views |

---

## 5. Architectural Boundaries

- **Single SDK Contract Boundary**: All kit-internal imports of `@nimiplatform/sdk` pass through `@nimiplatform/kit/core/sdk-contract` to prevent upstream schema changes from scattering breaking changes across feature code.
- **Fail-Closed Shell Bridge**: Renderer-to-desktop calls use host-injected security bridges (`@nimiplatform/kit/shell/renderer/bridge`) that prevent unverified gRPC bypasses.

---

## Verification & Contributing

Run the verification suite locally:

```bash
# Build the kit package and token projections
pnpm --filter @nimiplatform/kit build

# Run unit tests
pnpm --filter @nimiplatform/kit test

# Verify design system token parity
pnpm check:nimi-kit
pnpm check:nimi-design-artifacts
```

---

## License

Licensed under [MIT](LICENSE).
