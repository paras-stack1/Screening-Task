/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { contentSecurityPolicy } from './src/security/contentSecurityPolicy';
import { parseApiBaseUrl } from './src/apiBaseUrl';

/**
 * The shared contracts are published as CommonJS for the API. The portal uses their TypeScript
 * source directly, so the browser bundle needs no CommonJS interop.
 */
const contractsSource = fileURLToPath(
  new URL('../../packages/shared-contracts/src/index.ts', import.meta.url),
);

/** Adds the Content-Security-Policy <meta> to the built index.html only (security review PE-1). */
function cspPlugin(apiBaseUrl: string | null): Plugin {
  return {
    name: 'balswasthya-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(apiBaseUrl) },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const apiBaseUrl = parseApiBaseUrl(env.VITE_API_BASE_URL, mode === 'production');
  return {
    plugins: [react(), cspPlugin(apiBaseUrl)],
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
  };
});
