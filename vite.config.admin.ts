import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd()),
      },
    },
    optimizeDeps: {
      include: ['socket.io-client'],
    },
    build: {
      outDir: path.resolve(process.cwd(), 'dist/admin'),
      emptyOutDir: true,
      sourcemap: false,
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      allowedHosts: [
        '.trycloudflare.com',
        '.duckdns.org',
        'localhost',
        '127.0.0.1',
      ],
    },
  };
});