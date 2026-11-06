import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The public website (site/): a static page for GitHub Pages that reads the market API (cloud/).
// VITE_BASE is the path it's served under ("/tli-build-planner/" on a project Pages site);
// VITE_API_BASE the market's URL.
export default defineConfig({
  root: fileURLToPath(new URL('./site', import.meta.url)),
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
