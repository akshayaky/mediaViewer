import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^ebml$/,
        replacement: `${process.cwd()}/node_modules/ebml/lib/ebml.esm.js`,
      },
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      '/igdb-api': {
        target: 'https://api.igdb.com/v4',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/igdb-api/, ''),
      },
      '/twitch-oauth': {
        target: 'https://id.twitch.tv/oauth2/token',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/twitch-oauth/, ''),
      },
      '/steam-search': {
        target: 'https://store.steampowered.com/api/storesearch',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/steam-search/, ''),
      },
    },
  },
}));
