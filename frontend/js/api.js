
/*
 * Smart Transit Unified API
 *
 * Demo Mode (default):
 *   Runs entirely in the browser using demo.js.
 *   No FastAPI or PostgreSQL required.
 *
 * Backend Mode:
 *   Uses the existing FastAPI REST endpoints.
 */

const API_BASE =
  window.API_BASE ||
  "http://localhost:8000";

const TRANSIT_MODE =
  window.TRANSIT_MODE || "demo";

// --------------------------------------------------
// Backend HTTP functions
// --------------------------------------------------

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`);

  if (!response.ok) {
    throw new Error(
      `GET ${path} failed: ${response.status}`
    );
  }

  return response.json();
}

async function apiPost(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `POST ${path} failed: ${response.status} ${detail}`
    );
  }

  return response.json();
}

// --------------------------------------------------
// Existing FastAPI endpoints
// --------------------------------------------------

const BackendApi = {
  buses: () => apiGet("/buses"),

  bus: id =>
    apiGet(`/buses/${encodeURIComponent(id)}`),

  routes: () => apiGet("/routes"),

  network: () => apiGet("/network"),

  alerts: () => apiGet("/alerts"),

  incidents: () => apiGet("/incidents"),

  alternativeRoute: (src, dst) =>
    apiGet(
      `/alternative-route/${encodeURIComponent(src)}/${encodeURIComponent(dst)}`
    ),

  simulateFlood: route_id =>
    apiPost("/simulate/flood", { route_id }),

  simulateAccident: route_id =>
    apiPost("/simulate/accident", { route_id }),

  simulateNetworkFailure: link_id =>
    apiPost("/simulate/network-failure", { link_id }),

  simulateDelay: (bus_id, extra_minutes) =>
    apiPost("/simulate/delay", {
      bus_id,
      extra_minutes
    }),

  restoreNetwork: link_id =>
    apiPost("/simulate/restore-network", {
      link_id
    }),

  restoreRoute: route_id =>
    apiPost(
      `/simulate/restore-route/${encodeURIComponent(route_id)}`,
      {}
    ),

  resetSimulation: () =>
    apiPost("/simulate/reset", {})
};

// --------------------------------------------------
// Select operating mode
// --------------------------------------------------

const Api = (() => {
  if (TRANSIT_MODE === "backend") {
    console.info(
      "[Smart Transit] Backend Mode enabled"
    );

    return BackendApi;
  }

  if (!window.Demo) {
    throw new Error(
      "Demo Mode requires js/demo.js. " +
      "Check that demo.js loads before api.js."
    );
  }

  console.info(
    "[Smart Transit] Demo Mode enabled. " +
    "FastAPI and PostgreSQL are not required."
  );

  return window.Demo;
})();

// Expose current mode for diagnostics
window.SMART_TRANSIT_MODE = TRANSIT_MODE;
