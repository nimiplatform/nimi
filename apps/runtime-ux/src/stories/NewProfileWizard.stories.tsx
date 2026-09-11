import type { Meta, StoryObj } from '@storybook/react-vite';
import { NewProfileWizard } from '../NewProfileWizard';

const meta: Meta<typeof NewProfileWizard> = {
  title: 'Runtime/NewProfileWizard',
  component: NewProfileWizard,
  parameters: {
    docs: {
      description: {
        component:
          'Profile creation wizard opened from the single "New profile" button on the Profiles page. Step 1 offers three paths — From template, From current setup, Author manually — instead of the old four-tab creation UI.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof NewProfileWizard>;

export const Interactive: Story = {
  args: {},
};
