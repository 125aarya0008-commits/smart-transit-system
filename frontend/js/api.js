// Thin wrapper around the backend REST API.
// Change API_BASE if the backend runs somewhere other than localhost:8000.
const API_BASE = window.API_BASE || "http://localhost:8000";

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`POST ${path} failed: ${res.status} ${detail}`);
  }
  return res.json();
}

const Api = {
  buses: () => apiGet("/buses"),
  bus: (id) => apiGet(`/buses/${id}`),
  routes: () => apiGet("/routes"),
  network: () => apiGet("/network"),
  alerts: () => apiGet("/alerts"),
  incidents: () => apiGet("/incidents"),
  alternativeRoute: (src, dst) => apiGet(`/alternative-route/${encodeURIComponent(src)}/${encodeURIComponent(dst)}`),
  simulateFlood: (route_id) => apiPost("/simulate/flood", { route_id }),
  simulateAccident: (route_id) => apiPost("/simulate/accident", { route_id }),
  simulateNetworkFailure: (link_id) => apiPost("/simulate/network-failure", { link_id }),
  simulateDelay: (bus_id, extra_minutes) => apiPost("/simulate/delay", { bus_id, extra_minutes }),
  restoreNetwork: (link_id) => apiPost("/simulate/restore-network", { link_id }),
  restoreRoute: (route_id) => apiPost(`/simulate/restore-route/${route_id}`, {}),
  resetSimulation: () => apiPost("/simulate/reset", {}),
};
