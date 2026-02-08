import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5174,
    open: false,
    https: false,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
  },
  worker: {
    format: 'es'
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
