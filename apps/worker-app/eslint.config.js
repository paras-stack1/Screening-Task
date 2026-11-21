// ESLint flat config for the Expo app (https://docs.expo.dev/guides/using-eslint/).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettier,
  {
    ignores: ['dist/*', '.expo/*'],
  },
  {
    // Security: app code must never log (tokens, passwords and personal data could leak into
    // device logs). Tests may use console.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    rules: { 'no-console': 'error' },
  },
]);
