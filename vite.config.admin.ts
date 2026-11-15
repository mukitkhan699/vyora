import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  const repoRoot = process.cwd();
  const adminRoot = path.resolve(repoRoot, 'admin');

  return {
    root: adminRoot,
    base: '/admin/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(repoRoot, 'src'),
        '/src': path.resolve(repoRoot, 'src'),
      },
    },
    optimizeDeps: {
      include: ['socket.io-client'],
    },
    build: {
      outDir: path.resolve(repoRoot, 'dist/admin'),
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: {
          admin: path.resolve(adminRoot, 'index.html'),
        },
      },
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