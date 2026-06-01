import { StorybookApp } from '../../storybook/ui/storybook-app.js';

// App-owned product surface. The first screen is the actual Storybook app (a
// Play/Studio workbench over the shared Engine), not a marketing page. All
// scaffold-managed auth/shell/runtime glue lives outside this file.
export function ProductArea() {
  return <StorybookApp />;
}
