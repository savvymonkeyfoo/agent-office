import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    outDir: 'dist/client', emptyOutDir: true, chunkSizeWarningLimit: 1000, // three.js is one big chunk
    // The office, and the desktop pet's page (shown by the Mac app in mac/).
    rollupOptions: { input: { main: 'index.html', pet: 'pet.html' } },
  },
  server: { proxy: { '/api': 'http://127.0.0.1:4321' } },
  test: { include: ['test/**/*.test.ts'] },
});
