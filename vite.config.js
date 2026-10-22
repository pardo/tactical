import { defineConfig } from 'vite';

const TUNNEL_HOSTS = ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev'];

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  build: { target: 'es2022' },
  // allowedHosts: accept requests through an ngrok tunnel (npm run serve + npm run tunnel).
  server: { host: true, allowedHosts: TUNNEL_HOSTS },
  preview: { host: true, port: 4173, allowedHosts: TUNNEL_HOSTS },
});
