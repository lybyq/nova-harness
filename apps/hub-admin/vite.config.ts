import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()], dts: false }),
    Components({ resolvers: [ElementPlusResolver()], dts: false }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 3210,
    proxy: { '/api': { target: process.env.NOVA_HUB_PROXY ?? 'http://localhost:3200' } },
  },
  preview: {
    port: 3210,
    host: '0.0.0.0',
    proxy: { '/api': { target: process.env.NOVA_HUB_PROXY ?? 'http://localhost:3200' } },
  },
});
