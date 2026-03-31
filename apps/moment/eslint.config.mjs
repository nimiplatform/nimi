import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const browserGlobals = {
  ...globals.browser,
  ...globals.node,
};

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  globalIgnores([
    'dist/**',
    'src-tauri/target/**',
    'node_modules/**',
    '*.config.ts',
    '*.config.mjs',
  ]),
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: browserGlobals,
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'error',
      'prefer-const': 'error',
      'no-useless-catch': 'off',
    },
  },
  {
    files: ['src/shell/renderer/bridge/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },
]);
