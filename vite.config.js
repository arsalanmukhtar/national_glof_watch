import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  server: {
    port: 5174,
    host: true,
    strictPort: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
});
