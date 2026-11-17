import { defineConfig } from 'vitest/config';

const previewHost = process.env.BROWSER_DRIVE_PREVIEW_HOST;

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 3000),
    strictPort: false,
    // The cloud preview proxy forwards the preview hostname; allow exactly that host.
    allowedHosts: previewHost ? [previewHost, 'localhost', '127.0.0.1'] : true,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Keep the Rapier WASM as a separate cacheable asset instead of inlining
    // 3 MB of base64 into the worker bundle (load time matters on Chromebooks).
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
