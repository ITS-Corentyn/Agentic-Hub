import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      // Permet d'appeler l'API sans CORS en dev si VITE_API_BASE n'est pas défini.
      '/api': { target: process.env.VITE_API_BASE ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
});
