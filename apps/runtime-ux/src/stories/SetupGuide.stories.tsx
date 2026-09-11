import type { Meta, StoryObj } from '@storybook/react-vite';
import { SetupGuide } from '../SetupGuide';

const meta: Meta<typeof SetupGuide> = {
  title: 'Runtime/SetupGuide',
  component: SetupGuide,
  parameters: {
    docs: {
      description: {
        component:
          'First-run wizard, launchable from the Home checklist. Step 1 asks the intent question "How should Nimi answer?" with the three presets (cloud-leaning or local-leaning). Step 2 confirms the setup in plain language, step 3 picks a personality, then a done summary.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SetupGuide>;

export const Interactive: Story = {
  args: {},
};
