import assert from "node:assert/strict";
import {
  APP_ROUTES,
  APP_ROUTE_ALIASES,
  buildPathWithSearch,
  isChatRoute,
} from "./routes.js";

assert.equal(APP_ROUTES.root, "/");
assert.equal(APP_ROUTES.overview, "/overview");
assert.equal(APP_ROUTES.portMap, "/port-map");
assert.equal(APP_ROUTE_ALIASES.portMapLegacy, "/portmap");
assert.notEqual(APP_ROUTES.overview, APP_ROUTES.portMap);

assert.equal(buildPathWithSearch(APP_ROUTES.actions, ""), APP_ROUTES.actions);
assert.equal(
  buildPathWithSearch(
    APP_ROUTES.chat,
    new URLSearchParams({ chatId: "42", machineId: "plc-7" }),
  ),
  "/chat?chatId=42&machineId=plc-7",
);

assert.equal(isChatRoute(APP_ROUTES.chat), true);
assert.equal(isChatRoute("/chat/session"), true);
assert.equal(isChatRoute(APP_ROUTES.overview), false);

console.log("routes.test: all assertions passed");
