// @ts-check
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'release/**', 'coverage/**', 'node_modules/**', '**/*.out.mjs'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Unused things fail the typecheck already; an underscore marks a deliberate one.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }
      ]
    }
  },

  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  },

  // Test doubles describe TFS's JSON loosely on purpose; the code under test is still strict.
  {
    files: ['src/**/__tests__/**', 'test/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' }
  },

  // The layering the whole design rests on: domain logic in src/shared runs in Node, in
  // Electron's main process and in the browser, so it may depend on none of them.
  {
    files: ['src/shared/**/*.ts'],
    ignores: ['src/shared/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*'],
              message: 'src/shared must not depend on React.'
            },
            { group: ['electron'], message: 'src/shared must not depend on Electron.' },
            {
              group: ['zustand', 'zustand/*'],
              message: 'src/shared must not depend on the store.'
            },
            {
              group: ['**/renderer/**', '**/main/**', '@/*'],
              message: 'src/shared must not import app code.'
            },
            {
              group: ['node:*', 'fs', 'path', 'os'],
              message: 'src/shared must not touch Node APIs.'
            }
          ]
        }
      ]
    }
  },

  // The renderer reaches disk and network only through window.api.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: ['src/renderer/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['electron'], message: 'Use window.api (src/preload) instead.' },
            {
              group: ['**/main/**', 'node:*'],
              message: 'The renderer cannot use main-process code.'
            }
          ]
        }
      ]
    }
  },

  prettier
)
