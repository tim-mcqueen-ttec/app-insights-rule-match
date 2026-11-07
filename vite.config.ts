import { defineConfig } from "vite";

// Accept App Insights' telemetry posts locally so the console only shows the Telnyx problem.
export default defineConfig({
  server: { port: 5173 },
  plugins: [
    {
      name: "fake-app-insights-ingestion",
      configureServer(server) {
        server.middlewares.use("/v2/track", (_req, res) => {
          res.setHeader("content-type", "application/json");
          res.end('{"itemsReceived":0,"itemsAccepted":0,"errors":[]}');
        });
      },
    },
  ],
});
