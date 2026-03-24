import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(process.cwd(), "../../"), "");
  const allowedHosts = env.VITE_ALLOWED_HOSTS
    ? env.VITE_ALLOWED_HOSTS.split(",")
      .map((host) => host.trim())
      .filter(Boolean)
    : undefined;

  return {
    envDir: "../../",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(process.cwd(), "src"),
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      exclude: ["dist/**"],
    },
    server: {
      allowedHosts,
      proxy: {
        "/api": {
          target: "http://localhost:4000",
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("error", (err, _req, res) => {
              // Suppress ECONNREFUSED during dev startup — the API may not be ready yet
              // and EventSource clients will auto-reconnect once it is.
              if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") return;
              console.error("[proxy]", err.message);
              // Send a clean error response for non-streaming requests still open
              if (res && "writeHead" in res && typeof (res as import("node:http").ServerResponse).writeHead === "function") {
                try {
                  (res as import("node:http").ServerResponse).writeHead(502, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ message: "API unavailable" }));
                } catch {
                  /* response already closed */
                }
              }
            });
          },
        },
        "/assets": {
          target: "http://localhost:4000",
          changeOrigin: true,
        },
        "/mcp": {
          target: "http://localhost:4000",
          changeOrigin: true,
        },
      },
    },
  };
});
