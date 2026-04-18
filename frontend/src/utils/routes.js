export const APP_ROUTES = Object.freeze({
  root: "/",
  login: "/login",
  register: "/register",
  overview: "/overview",
  portMap: "/port-map",
  equipment: "/equipment",
  alarms: "/alarms",
  analytics: "/analytics",
  chat: "/chat",
  actions: "/actions",
});

export const APP_ROUTE_ALIASES = Object.freeze({
  portMapLegacy: "/portmap",
});

export function buildPathWithSearch(pathname, searchParams) {
  const normalizedPath = String(pathname || "");
  if (!normalizedPath) return "";

  if (!searchParams) return normalizedPath;

  const search =
    typeof searchParams === "string"
      ? searchParams.replace(/^\?/, "")
      : searchParams instanceof URLSearchParams
        ? searchParams.toString()
        : new URLSearchParams(searchParams).toString();

  return search ? `${normalizedPath}?${search}` : normalizedPath;
}

export function isChatRoute(pathname = "") {
  return String(pathname || "").startsWith(APP_ROUTES.chat);
}
