const { defineConfig } = require('vite');
const path = require('path');

module.exports = defineConfig({
  root: 'frontend',
  build: {
    outDir: '../src/photocat/static/dist',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'frontend/index.html'),
        admin: path.resolve(__dirname, 'frontend/admin.html'),
      },
    },
  },
  server: {
    proxy: {
      // Proxy API requests to the backend during development
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Note: /admin is NOT proxied - Vite serves admin.html directly for dev
      '/tagging-admin': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Proxy OAuth and webhooks
      '/oauth': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/webhooks': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Proxy static assets
      '/static': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});