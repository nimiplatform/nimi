import type { Preview } from '@storybook/react-vite';
import '../src/tokens.css';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    backgrounds: {
      default: 'nimi-base',
      values: [{ name: 'nimi-base', value: '#f4f5f7' }],
    },
  },
};

export default preview;
