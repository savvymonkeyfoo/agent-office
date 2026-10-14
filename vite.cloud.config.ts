import { defineConfig } from 'vite';

// One self-contained page for claude.ai: fonts inlined, then scripts/inline-artifact.mjs folds JS and CSS into the HTML.
export default defineConfig({
  build: {
    outDir: 'dist/cloud', emptyOutDir: true, chunkSizeWarningLimit: 1000,
    assetsInlineLimit: () => true, cssCodeSplit: false, modulePreload: false,
    rollupOptions: { input: 'cloud.html', output: { inlineDynamicImports: true } },
  },
});
