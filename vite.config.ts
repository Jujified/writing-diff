import { defineConfig, type Plugin } from 'vitest/config';

/**
 * GitHub Pages serves a project site from https://<user>.github.io/<repo>/,
 * so every asset URL needs the repo name as a prefix.
 *
 * To deploy under a different name, change REPO_NAME, or set VITE_BASE
 * (the deploy workflow sets it from the repository name automatically).
 * Use VITE_BASE=/ for a custom domain or a <user>.github.io repository.
 */
const REPO_NAME = 'writing-diff';
const base = process.env.VITE_BASE ?? `/${REPO_NAME}/`;

/**
 * index.html ships the strict production Content-Security-Policy.
 * The dev server needs a websocket for HMR and injects inline <style> tags,
 * so relax the policy only while serving locally.
 */
function devCsp(): Plugin {
  return {
    name: 'redline:dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replaceAll("connect-src 'none'", "connect-src 'self' ws: wss:")
        .replaceAll("style-src 'self'", "style-src 'self' 'unsafe-inline'");
    },
  };
}

export default defineConfig({
  base,
  plugins: [devCsp()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // pdf.js and mammoth are large but lazy-loaded only when a file needs them.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
