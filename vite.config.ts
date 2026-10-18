import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "FC_");
  return {
    plugins: [react()],
    server: {
      proxy: env.FC_BACKEND_ORIGIN
        ? {
            "/_server_islands/operations": {
              target: env.FC_BACKEND_ORIGIN,
              changeOrigin: true,
              secure: true,
            },
          }
        : undefined,
    },
    build: {
      rollupOptions: { output: { manualChunks: { maps: ["maplibre-gl"] } } },
    },
  };
});
