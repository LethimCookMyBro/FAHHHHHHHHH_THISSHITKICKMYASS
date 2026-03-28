import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import os from "node:os";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const rawDevProxyTarget =
    env.VITE_API_PROXY_TARGET ||
    env.API_PROXY_TARGET ||
    "http://127.0.0.1:5000";

  let devProxyTarget = rawDevProxyTarget;
  try {
    const parsed = new URL(rawDevProxyTarget);
    if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
      devProxyTarget = parsed.toString().replace(/\/$/, "");
    }
  } catch {
    // keep raw value if it is not a valid URL; Vite will surface config errors.
  }

  const defaultCacheRoot =
    os.platform() === "linux"
      ? "/tmp/panya-vite-cache"
      : path.join(os.tmpdir(), "panya-vite-cache");
  const viteCacheDir =
    env.VITE_CACHE_DIR ||
    path.join(defaultCacheRoot, mode === "production" ? "prod" : "dev");

  return {
    plugins: [react()],
    cacheDir: viteCacheDir,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;

            if (
              id.includes("react-syntax-highlighter") ||
              id.includes("refractor") ||
              id.includes("prismjs")
            ) {
              return "chat-code";
            }

            if (id.includes("recharts") || id.includes("d3-")) {
              return "ops-charts";
            }

            if (
              id.includes("react-router") ||
              id.includes(`${path.sep}react${path.sep}`) ||
              id.includes(`${path.sep}react-dom${path.sep}`) ||
              id.includes(`${path.sep}scheduler${path.sep}`)
            ) {
              return "app-core";
            }

            return undefined;
          },
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      allowedHosts: ["localhost", ".ngrok-free.dev", ".ngrok.io", ".railway.app"],
      proxy: {
        "/api": {
          target: devProxyTarget,
          changeOrigin: true,
          ws: true,
          configure: (proxy) => {
            proxy.on("error", (_err, _req, res) => {
              if (!res || res.headersSent) return;
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error: true,
                  code: "BACKEND_UNAVAILABLE",
                  message: "Backend is unavailable or still starting up",
                }),
              );
            });
          },
        },
      },
    },
  };
});
