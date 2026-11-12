import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` makes the normal build the Tauri shell loads from dist/.
// `npm run build:single` makes one self-contained HTML file in dist-single/.
export default defineConfig(({ mode }) => ({
  plugins: [svelte(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}));
