import assert from "node:assert/strict";

import { readResponseErrorMessage, streamApiRequest } from "./api.js";

const originalDocument = globalThis.document;
const originalFetch = globalThis.fetch;

try {
  globalThis.document = { cookie: "csrf_token=test-token" };

  let capturedRequest = null;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return new Response("event: status\ndata: {}\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  await streamApiRequest("/api/agent/action", {
    method: "POST",
    headers: { Accept: "text/event-stream" },
  });

  assert.equal(capturedRequest.options.credentials, "include");
  assert.equal(capturedRequest.options.headers.get("X-CSRF-Token"), "test-token");

  capturedRequest = null;
  await streamApiRequest("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(capturedRequest.options.headers.get("X-CSRF-Token"), null);

  const jsonResponse = new Response(
    JSON.stringify({ message: "Backend is unavailable or restarting. Wait a few seconds and retry." }),
    {
      status: 503,
      headers: { "content-type": "application/json" },
    },
  );
  assert.equal(
    await readResponseErrorMessage(jsonResponse, "fallback"),
    "Backend is unavailable or restarting. Wait a few seconds and retry.",
  );

  const htmlResponse = new Response("<html><body>proxy error</body></html>", {
    status: 502,
    headers: { "content-type": "text/html" },
  });
  assert.equal(
    await readResponseErrorMessage(htmlResponse, "fallback"),
    "API returned HTML instead of JSON. Check VITE_API_URL or /api proxy routing.",
  );

  console.log("api.security.test: all assertions passed");
} finally {
  globalThis.document = originalDocument;
  globalThis.fetch = originalFetch;
}
