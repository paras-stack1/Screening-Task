/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The shared contracts are published as CommonJS for the API. The portal uses their TypeScript
 * source directly, so the browser bundle needs no CommonJS interop.
 */
const contractsSource = fileURLToPath(
  new URL('../../packages/shared-contracts/src/index.ts', import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@balswasthya/shared-contracts': contractsSource },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
