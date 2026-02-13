const { defineConfig } = require('vite');
const path = require('path');

const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000';

module.exports = defineConfig({
  root: 'frontend',
  build: {
    outDir: '../src/zoltag/static/dist',
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
        target: proxyTarget,
        changeOrigin: true,
      },
      // Note: /admin is NOT proxied - Vite serves admin.html directly for dev
      '/tagging-admin': {
        target: proxyTarget,
        changeOrigin: true,
      },
      // Proxy OAuth and webhooks
      '/oauth': {
        target: proxyTarget,
        changeOrigin: true,
      },
      '/webhooks': {
        target: proxyTarget,
        changeOrigin: true,
      },
      // Proxy static assets
      '/static': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
});
