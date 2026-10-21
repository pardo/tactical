import { defineConfig } from 'vite';

export default defineConfig({
  // cssMinify off: lightningcss has no native binding usable under Termux node; CSS is tiny.
  build: { target: 'es2022', cssMinify: false },
  server: { host: true },
});
