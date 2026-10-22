import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  build: { target: 'es2022' },
  // allowedHosts: accept requests through an ngrok tunnel (npm run tunnel).
  server: { host: true, allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev'] },
});
