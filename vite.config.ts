import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { displayDevSpacesLink, importNavbar, setDevCookies } from '@amzn/harmony-build-tools/vite-plugins';

export default defineConfig({
  plugins: [react(), displayDevSpacesLink(), importNavbar(), setDevCookies()],
  server: { port: 3000 },
  build: { outDir: process.env.BUILD_PATH || 'build' },
});
