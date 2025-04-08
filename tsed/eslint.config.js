import { createRequire } from 'node:module';

import globals from 'globals';

const require = createRequire(import.meta.url);
const tsedPlugin = require('@tsed/eslint-plugin');

export default [
  {
    plugins: {
      '@tsed': tsedPlugin,
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...tsedPlugin.configs.recommended.rules,
      'import/prefer-default-export': 'off',
    },
  },
];
