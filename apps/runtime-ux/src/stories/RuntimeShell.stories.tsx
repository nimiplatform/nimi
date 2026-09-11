import type { Meta, StoryObj } from '@storybook/react-vite';
import { RuntimeShell } from '../RuntimeShell';

const meta: Meta<typeof RuntimeShell> = {
  title: 'Runtime/RuntimeShell',
  component: RuntimeShell,
  parameters: {
    docs: {
      description: {
        component:
          'Intent-driven Runtime settings shell: five sidebar entries named by the user\'s question (Home / Answers / Personality / Usage & Access / Status). Engineering objects (services, models, routing) only appear as progressive-disclosure sections inside Answers. The sidebar is interactive inside each story.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof RuntimeShell>;

export const Home: Story = {
  args: { initialPage: 'home' },
};

export const HomeFirstRun: Story = {
  name: 'Home (first run — checklist)',
  args: { initialPage: 'home', setupIncomplete: true },
};

export const Answers: Story = {
  args: { initialPage: 'answers' },
};

export const AnswersEmpty: Story = {
  name: 'Answers (nothing configured — first run)',
  args: { initialPage: 'answers', answersEmpty: true },
};

export const AnswersPresetApplied: Story = {
  name: 'Answers (preset applied)',
  args: { initialPage: 'answers', presetApplied: true },
};

export const AnswersModelInstalled: Story = {
  name: 'Answers (model just installed)',
  args: { initialPage: 'answers', justInstalled: true },
  parameters: {
    docs: {
      description: {
        story:
          'After an install completes, the Model library opens with an inline prompt: "Installed. Use it for Chat now?" — fixing the "install ≠ select" confusion at the point of action.',
      },
    },
  },
};

export const Personality: Story = {
  args: { initialPage: 'personality' },
};

export const UsageAndAccess: Story = {
  name: 'Usage & Access',
  args: { initialPage: 'usage' },
};

export const Status: Story = {
  args: { initialPage: 'status' },
};
