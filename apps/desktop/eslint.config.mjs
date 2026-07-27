import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const nodeGlobals = {
  ...globals.node,
};

const browserNodeGlobals = {
  ...globals.browser,
  ...nodeGlobals,
};

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  globalIgnores([
    '.cache/**',
    'dist/**',
    'dist-electron/**',
    'src-tauri/target/**',
    'node_modules/**',
    '.corepack-cache/**',
    'src/shell/renderer/.cache/**',
    'src/shell/renderer/public/assets/**',
    '*.config.ts',
    '*.config.mjs',
  ]),
  {
    files: ['src/runtime/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@renderer/**',
            '@shell/**',
            '**/shell/**',
          ],
        },
      ],
    },
  },
  {
    files: ['src/shell/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@runtime/chat/*'],
              message: 'Import chat APIs through @runtime/chat public entry.',
            },
            {
              group: ['@runtime/state/*'],
              message: 'Import state APIs through @runtime/state public entry.',
            },
            {
              group: ['@runtime/data-sync/*'],
              message: 'Import data-sync APIs through @runtime/data-sync public entry.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...browserNodeGlobals,
      },
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...nodeGlobals,
      },
    },
    rules: {
      'no-redeclare': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...browserNodeGlobals,
      },
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-namespace': 'off',
      'prefer-const': 'error',
      'no-console': 'error',
      'no-useless-catch': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: [
      'src/shell/renderer/bridge.ts',
      'src/runtime/telemetry/logger.ts',
      'src/shell/renderer/infra/telemetry/renderer-log.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
]);
