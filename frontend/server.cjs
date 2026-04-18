const express = require("express");
const path = require("path");
const compression = require("compression");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
app.use(compression());
const port = Number(process.env.PORT || 5173);

const rawApiTarget =
  process.env.API_PROXY_TARGET ||
  process.env.BACKEND_URL ||
  process.env.BACKEND_API_URL ||
  "";
const apiTarget = rawApiTarget || "http://127.0.0.1:5000";
const proxyTimeoutMs = Number(process.env.API_PROXY_TIMEOUT_MS || 180000);
const proxySocketTimeoutMs = Number(
  process.env.API_SOCKET_TIMEOUT_MS || 180000,
);

const isPlaceholder = (value) => {
  const text = String(value || "").trim();
  if (!text) return true;
  return (
    /^\$\{[^}]+\}$/.test(text) ||
    /^\$\{\{[^}]+\}\}$/.test(text) ||
    /^\{\{[^}]+\}\}$/.test(text)
  );
};

const sendJson = (res, status, payload) => {
  if (typeof res.status === "function") {
    res.status(status).json(payload);
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
};

if (rawApiTarget && isPlaceholder(rawApiTarget)) {
  console.error(
    `[frontend] invalid API proxy target '${rawApiTarget}'. Set API_PROXY_TARGET to a real backend URL.`,
  );
  process.exit(1);
}

let parsedApiTarget;
try {
  parsedApiTarget = new URL(apiTarget);
} catch {
  console.error(
    `[frontend] invalid API target URL '${apiTarget}'. Expected full URL like https://backend.up.railway.app`,
  );
  process.exit(1);
}

const targetHost = parsedApiTarget.host.toLowerCase();

const selfHost = (process.env.RAILWAY_PUBLIC_DOMAIN || "").toLowerCase();
if (targetHost && selfHost && targetHost === selfHost) {
  console.error(
    `[frontend] API proxy loop: API_PROXY_TARGET points to this frontend domain (${selfHost}). Set it to the backend service domain.`,
  );
  process.exit(1);
}

const distDir = path.join(__dirname, "dist");
const indexFile = path.join(distDir, "index.html");
const assetsDirMarker = `${path.sep}assets${path.sep}`;

const setStaticCacheHeaders = (res, filePath) => {
  if (filePath.includes(assetsDirMarker)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }

  if (path.basename(filePath) === "index.html") {
    res.setHeader("Cache-Control", "no-cache");
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=86400");
};

app.use("/api", (req, res, next) => {
  const requestHost = String(req.headers.host || "")
    .toLowerCase()
    .trim();
  if (requestHost && requestHost === targetHost) {
    sendJson(res, 500, {
      message: "Invalid API proxy configuration (self-loop detected)",
      target: apiTarget,
      host: requestHost,
      hint: "Set API_PROXY_TARGET to the backend service domain, not this frontend domain.",
    });
    return;
  }
  next();
});

app.use(
  createProxyMiddleware({
    pathFilter: "/api",
    target: apiTarget,
    changeOrigin: true,
    secure: false,
    xfwd: true,
    proxyTimeout: Number.isFinite(proxyTimeoutMs) ? proxyTimeoutMs : 180000,
    timeout: Number.isFinite(proxySocketTimeoutMs)
      ? proxySocketTimeoutMs
      : 180000,
    logger: console,
    on: {
      error(err, req, res) {
        if (res.headersSent) return;
        const detail = String(err?.message || err);
        const code = String(err?.code || "").toUpperCase();
        const isTimeout =
          code === "ETIMEDOUT" || /timed?\s*out|timeout/i.test(detail);
        sendJson(res, isTimeout ? 504 : 502, {
          message: isTimeout
            ? "API proxy timeout while waiting for backend"
            : "API proxy target is unreachable",
          detail,
          code,
          target: apiTarget,
          path: req.originalUrl,
        });
      },
    },
  }),
);

app.use(express.static(distDir, { setHeaders: setStaticCacheHeaders }));
app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(indexFile);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`[frontend] listening on 0.0.0.0:${port}`);
  console.log(`[frontend] serving: ${distDir}`);
  console.log(`[frontend] proxy /api -> ${apiTarget}`);
  console.log(`[frontend] proxy timeout -> ${proxyTimeoutMs}ms`);
  console.log(`[frontend] proxy socket timeout -> ${proxySocketTimeoutMs}ms`);
});
