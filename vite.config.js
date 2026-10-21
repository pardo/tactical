import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  build: { target: 'es2022' },
  server: { host: true },
});
