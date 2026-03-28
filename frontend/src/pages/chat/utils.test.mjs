import assert from "node:assert/strict";

import {
  findFallbackSessionId,
  formatAssistantText,
  getResponseSessionId,
  mapMessagesFromPayload,
} from "./utils.js";

const formatted = formatAssistantText(
  "[ACTION PLAN]\nSeverity: High\nOwner: Technician\n\nSources:\n- manual.pdf",
);
assert.equal(formatted.includes("manual.pdf"), false);
assert.equal(formatted.includes("**ACTION PLAN**"), true);
assert.equal(formatted.includes("**Severity**: High"), true);

assert.equal(
  getResponseSessionId({
    data: {
      session: {
        id: "42",
      },
    },
  }),
  42,
);

const nowIso = new Date().toISOString();
assert.equal(
  findFallbackSessionId(
    {
      items: [
        { id: 11, title: "Older session", updated_at: "2025-01-01T00:00:00Z" },
        { id: 12, title: "Reset motor fault", updated_at: nowIso },
      ],
    },
    "Reset motor fault safely",
  ),
  12,
);

const messages = mapMessagesFromPayload({
  items: [
    {
      id: 1,
      role: "assistant",
      content: "Answer body\n\nSources:\n- manual.pdf",
      metadata: {
        sources: [{ source: "manual.pdf", page: "8" }],
      },
    },
  ],
});
assert.equal(messages[0].text.includes("manual.pdf"), false);
assert.deepEqual(messages[0].sources, [{ source: "manual.pdf", page: 8 }]);

console.log("chat utils: all assertions passed");
