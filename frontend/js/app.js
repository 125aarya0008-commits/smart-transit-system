const { useState, useEffect, useMemo, useCallback } = React;

// ---------------------------------------------------------------------------
// Small shared utilities
// ---------------------------------------------------------------------------

function statusDot(status) {
  const map = {
    operational: "ok", up: "ok", on_time: "ok", clear: "ok", none: "ok",
    warning: "warn", degraded: "warn", delayed: "warn",
    failed: "fail", down: "fail", severely_delayed: "fail", stopped: "fail",
    blocked: "fail", flooded: "fail", accident: "fail", offline: "fail",
    rerouted: "reroute",
  };
  return map[status] || "warn";
}

function statusPillClass(status) {
  return "pill " + statusDot(status);
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// Polls a fetcher function every `interval` ms. Returns [data, error, reload].
function usePolling(fetcher, deps, interval = 4000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    fetcher().then(setData).catch((e) => setError(e.message));
  }, deps); // eslint-disable-line

  useEffect(() => {
    load();
    const id = setInterval(load, interval);
    return () => clearInterval(id);
  }, [load, interval]);

  return [data, error, load];
}

// ---------------------------------------------------------------------------
// Top bar + nav
// ---------------------------------------------------------------------------

function TopBar() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-mark"></span>
        <h1>SMART TRANSIT COMMUNICATION &amp; ROUTE MANAGEMENT SYSTEM</h1>
        <span className="subtitle">NETWORK OPERATIONS CONSOLE</span>
      </div>
      <div className="clock">{now.toLocaleString()}</div>
    </div>
  );
}

const TABS = [
  ["dashboard", "Dashboard"],
  ["buses", "Live Bus Monitoring"],
  ["routes", "Route Management"],
  ["topology", "Network Topology"],
  ["incidents", "Incident Management"],
  ["alerts", "Alerts"],
  ["stats", "Network Statistics"],
  ["protocols", "Protocols"],
];

function Nav({ tab, setTab }) {
  return (
    <div className="nav">
      {TABS.map(([key, label]) => (
        <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard({ goTo }) {
  const [network] = usePolling(Api.network, []);
  const [buses] = usePolling(Api.buses, []);
  const [alerts] = usePolling(Api.alerts, []);
  const [routes] = usePolling(Api.routes, []);

  const busStats = useMemo(() => {
    if (!buses) return null;
    return {
      total: buses.length,
      active: buses.filter((b) => b.status !== "offline" && b.status !== "stopped").length,
      delayed: buses.filter((b) => b.status === "delayed" || b.status === "severely_delayed").length,
      rerouted: buses.filter((b) => b.status === "rerouted").length,
      offline: buses.filter((b) => b.status === "offline" || b.status === "stopped").length,
    };
  }, [buses]);

  return (
    <div>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="panel stat ok">
          <div className="label">NETWORK HEALTH</div>
          <div className="value">
            {network ? `${100 - Math.round(network.summary.avg_packet_loss_pct)}%` : "—"}
          </div>
          <div className="label muted">{network ? `${network.summary.failed_links} link(s) down` : ""}</div>
        </div>
        <div className="panel stat">
          <div className="label">CONNECTED BUSES</div>
          <div className="value">{busStats ? `${busStats.active}/${busStats.total}` : "—"}</div>
          <div className="label muted">active of fleet</div>
        </div>
        <div className="panel stat warn">
          <div className="label">DELAYED / REROUTED</div>
          <div className="value">{busStats ? busStats.delayed + busStats.rerouted : "—"}</div>
          <div className="label muted">buses affected</div>
        </div>
        <div className="panel stat fail">
          <div className="label">ACTIVE ALERTS</div>
          <div className="value">{alerts ? alerts.length : "—"}</div>
          <div className="label muted" onClick={() => goTo("alerts")} style={{ cursor: "pointer" }}>
            view all →
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <h2>Live Route Map</h2>
          {routes ? <RouteMapSVG routes={routes} /> : <div className="empty-state">Loading…</div>}
        </div>
        <div className="panel">
          <h2>Recent Alerts</h2>
          <AlertList alerts={(alerts || []).slice(0, 8)} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route map (simplified linear/branching diagram of zones, SVG)
// ---------------------------------------------------------------------------

const ZONE_POS = {
  "Zone 1": [70, 200], "Zone 2": [260, 100], "Zone 3": [450, 200], "Zone 4": [640, 100],
};

function routeStrokeClass(r) {
  if (!r.available) return "down";
  if (r.network_status === "degraded") return "degraded";
  return "up";
}

function RouteMapSVG({ routes, highlightPath }) {
  const zones = Object.keys(ZONE_POS);
  const hp = highlightPath || [];
  const inHighlight = (a, b) => {
    for (let i = 0; i < hp.length - 1; i++) {
      if ((hp[i] === a && hp[i + 1] === b) || (hp[i] === b && hp[i + 1] === a)) return true;
    }
    return false;
  };
  return (
    <svg className="topology-svg" viewBox="0 0 720 260">
      {routes.map((r) => {
        const a = ZONE_POS[r.source], b = ZONE_POS[r.destination];
        if (!a || !b) return null;
        const cls = inHighlight(r.source, r.destination) ? "reroute" : routeStrokeClass(r);
        const midX = (a[0] + b[0]) / 2, midY = (a[1] + b[1]) / 2;
        return (
          <g key={r.route_id}>
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              className={`link-line ${cls === "reroute" ? "" : cls}`}
              stroke={cls === "reroute" ? "#2563eb" : undefined}
              strokeWidth={cls === "reroute" ? 5 : 3} />
            <rect x={midX - 34} y={midY - 18} width="68" height="16" rx="8" fill="#ffffff" stroke="#e3e8f0" />
            <text x={midX} y={midY - 6} className="node-label" textAnchor="middle" fontWeight="600">
              {r.route_id} · {r.available ? `${r.base_travel_time_min}m` : "BLOCKED"}
            </text>
          </g>
        );
      })}
      {zones.map((z) => (
        <g key={z}>
          <circle cx={ZONE_POS[z][0]} cy={ZONE_POS[z][1]} r={26} fill="#ffffff" stroke="#2563eb" strokeWidth="2.5" />
          <circle cx={ZONE_POS[z][0]} cy={ZONE_POS[z][1]} r={26} fill="#2563eb" opacity="0.08" />
          <text x={ZONE_POS[z][0]} y={ZONE_POS[z][1] + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#16202e" fontFamily="var(--sans)">
            {z}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Alerts list (shared)
// ---------------------------------------------------------------------------

function AlertList({ alerts }) {
  if (!alerts || alerts.length === 0) return <div className="empty-state">No alerts.</div>;
  return (
    <div>
      {alerts.map((a, i) => (
        <div className="alert-item" key={i}>
          <span className={`dot ${statusDot(a.severity === "critical" ? "failed" : a.severity === "warning" ? "warning" : "operational")}`}></span>
          <div style={{ flex: 1 }}>
            <div>{a.message}</div>
          </div>
          <div className="alert-time">{timeAgo(a.created_at)}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Bus Monitoring
// ---------------------------------------------------------------------------

function BusMonitoring() {
  const [buses, , reload] = usePolling(Api.buses, []);
  const [selected, setSelected] = useState(null);

  const selectedBus = useMemo(
    () => (buses || []).find((b) => b.bus_id === selected) || null,
    [buses, selected]
  );

  return (
    <div className="grid grid-2">
      <div className="panel">
        <h2>Fleet ({buses ? buses.length : 0})</h2>
        <table>
          <thead>
            <tr><th>Bus</th><th>Route</th><th>Zone</th><th>Delay</th><th>Status</th><th>Link</th></tr>
          </thead>
          <tbody>
            {(buses || []).map((b) => (
              <tr key={b.bus_id} className="clickable" onClick={() => setSelected(b.bus_id)}>
                <td>{b.bus_id}</td>
                <td>{b.route_label}</td>
                <td>{b.current_zone}</td>
                <td>{b.delay_minutes}m</td>
                <td><span className={statusPillClass(b.status)}>{b.status.replace("_", " ")}</span></td>
                <td><span className={statusPillClass(b.network_connection_status === "connected" ? "operational" : "failed")}>
                  {b.network_connection_status}
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h2>Bus Detail</h2>
        {!selectedBus && <div className="empty-state">Select a bus to view details.</div>}
        {selectedBus && (
          <div>
            <div className="detail-row"><span className="k">Bus ID</span><span className="v">{selectedBus.bus_id}</span></div>
            <div className="detail-row"><span className="k">Current location</span><span className="v">{selectedBus.current_zone}</span></div>
            <div className="detail-row"><span className="k">Source → Destination</span><span className="v">{selectedBus.source} → {selectedBus.destination}</span></div>
            <div className="detail-row"><span className="k">Current route</span><span className="v">{selectedBus.route_label}</span></div>
            <div className="detail-row"><span className="k">Scheduled arrival</span><span className="v">{fmtTime(selectedBus.scheduled_arrival)}</span></div>
            <div className="detail-row"><span className="k">Estimated arrival</span><span className="v">{fmtTime(selectedBus.estimated_arrival)}</span></div>
            <div className="detail-row"><span className="k">Delay</span><span className="v">{selectedBus.delay_minutes} min</span></div>
            <div className="detail-row"><span className="k">Network status</span><span className="v">{selectedBus.network_connection_status}</span></div>
            <div className="detail-row"><span className="k">Current incident</span><span className="v">{selectedBus.current_incident || "—"}</span></div>
            <div className="detail-row"><span className="k">Alternative route</span><span className="v">{selectedBus.alternative_route || "—"}</span></div>
            <div className="controls-row" style={{ marginTop: 14 }}>
              <button className="btn" onClick={async () => { await Api.simulateDelay(selectedBus.bus_id, 15); reload(); }}>
                Simulate +15m delay
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route Management
// ---------------------------------------------------------------------------

function RouteManagement() {
  const [routes, , reload] = usePolling(Api.routes, []);
  const [altResult, setAltResult] = useState(null);
  const [busy, setBusy] = useState(null);

  async function act(fn, routeId) {
    setBusy(routeId);
    try {
      const result = await fn(routeId);
      if (result.alternative_path) setAltResult(result);
    } finally {
      setBusy(null);
      reload();
    }
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Route Map</h2>
        <RouteMapSVG routes={routes || []} highlightPath={altResult ? altResult.alternative_path.path : null} />
      </div>
      <div className="grid grid-2">
        <div className="panel">
          <h2>Routes</h2>
          <table>
            <thead>
              <tr><th>Route</th><th>Dist</th><th>Time</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {(routes || []).map((r) => (
                <tr key={r.route_id}>
                  <td>{r.route_id}</td>
                  <td>{r.distance_km} km</td>
                  <td>{r.base_travel_time_min}m</td>
                  <td>
                    <span className={statusPillClass(r.available ? "operational" : "failed")}>
                      {r.available ? "clear" : (r.flood_status !== "none" ? "flooded" : r.accident_status !== "none" ? "accident" : "blocked")}
                    </span>
                  </td>
                  <td>
                    <div className="controls-row">
                      <button className="btn" disabled={busy === r.route_id || !r.available}
                        onClick={() => act(Api.simulateFlood, r.route_id)}>Flood</button>
                      <button className="btn" disabled={busy === r.route_id || !r.available}
                        onClick={() => act(Api.simulateAccident, r.route_id)}>Accident</button>
                      <button className="btn" disabled={busy === r.route_id || r.available}
                        onClick={async () => { setBusy(r.route_id); await Api.restoreRoute(r.route_id); setBusy(null); reload(); }}>
                        Restore
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Alternative Route Result</h2>
          {!altResult && <div className="empty-state">Trigger a flood or accident to see rerouting here.</div>}
          {altResult && (
            <div>
              <div className="detail-row"><span className="k">Route</span><span className="v">{altResult.route_id}</span></div>
              <div className="detail-row"><span className="k">Status</span><span className="v">{altResult.status}</span></div>
              <div className="detail-row"><span className="k">New path</span>
                <span className="v">{altResult.alternative_path.path ? altResult.alternative_path.path.join(" → ") : "No path available"}</span>
              </div>
              <div className="detail-row"><span className="k">ETA (new path)</span><span className="v">{altResult.alternative_path.minutes} min</span></div>
              <h2 style={{ marginTop: 16 }}>Affected Buses</h2>
              {altResult.affected_buses.length === 0 && <div className="empty-state">No buses were on this segment.</div>}
              {altResult.affected_buses.map((b) => (
                <div className="detail-row" key={b.bus_id}>
                  <span className="k">{b.bus_id}</span>
                  <span className="v">{b.old_route} → {b.new_route} (+{b.added_delay_min}m)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Network Topology
// ---------------------------------------------------------------------------

function NetworkTopology() {
  const [network, , reload] = usePolling(Api.network, []);
  const [selectedLink, setSelectedLink] = useState("");
  const [busy, setBusy] = useState(false);

  if (!network) return <div className="empty-state">Loading topology…</div>;
  const { nodes, links, summary } = network;
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.node_id, n]));

  function nodeColor(status) {
    return status === "operational" ? "#2563eb" : status === "warning" ? "#e05d44" : "#c81e3a";
  }

  return (
    <div>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="panel stat ok"><div className="label">ACTIVE ROUTERS</div><div className="value">{summary.active_routers}</div></div>
        <div className="panel stat ok"><div className="label">ACTIVE SWITCHES</div><div className="value">{summary.active_switches}</div></div>
        <div className="panel stat fail"><div className="label">FAILED LINKS</div><div className="value">{summary.failed_links}</div></div>
        <div className="panel stat warn"><div className="label">AVG PACKET LOSS</div><div className="value">{summary.avg_packet_loss_pct}%</div></div>
      </div>
      <div className="grid grid-2">
        <div className="panel">
          <h2>Cisco Packet Tracer Topology (simulated)</h2>
          <svg className="topology-svg" viewBox="0 0 800 440">
            {links.map((l) => {
              const a = nodeMap[l.source_node_id], b = nodeMap[l.dest_node_id];
              if (!a || !b) return null;
              const cls = l.status === "up" ? "up" : l.status === "degraded" ? "degraded" : "down";
              return (
                <line key={l.link_id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`link-line ${cls}`} />
              );
            })}
            {nodes.map((n) => (
              <g key={n.node_id}>
                <rect x={n.x - 28} y={n.y - 17} width="56" height="34" rx="6"
                  fill="#ffffff" stroke={nodeColor(n.status)} strokeWidth="2" />
                <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#16202e" fontFamily="var(--sans)">{n.node_id}</text>
                <text x={n.x} y={n.y + 31} textAnchor="middle" className="node-label" fontSize="9">{n.zone}</text>
              </g>
            ))}
          </svg>
          <div className="controls-row" style={{ marginTop: 10 }}>
            <span className="pill ok">● operational</span>
            <span className="pill warn">● warning</span>
            <span className="pill fail">● failed</span>
          </div>
        </div>
        <div className="panel">
          <h2>Links</h2>
          <table>
            <thead><tr><th>Link</th><th>Protocol</th><th>Status</th><th>Loss</th></tr></thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.link_id}>
                  <td>{l.link_id}</td>
                  <td>{l.protocol}</td>
                  <td><span className={statusPillClass(l.status === "up" ? "operational" : l.status === "degraded" ? "warning" : "failed")}>{l.status}</span></td>
                  <td>{l.packet_loss_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 style={{ marginTop: 18 }}>Simulation Controls</h2>
          <div className="controls-row">
            <select value={selectedLink} onChange={(e) => setSelectedLink(e.target.value)}>
              <option value="">Select a link…</option>
              {links.map((l) => <option key={l.link_id} value={l.link_id}>{l.link_id}</option>)}
            </select>
            <button className="btn danger" disabled={!selectedLink || busy}
              onClick={async () => { setBusy(true); await Api.simulateNetworkFailure(selectedLink); setBusy(false); reload(); }}>
              Simulate Network Failure
            </button>
            <button className="btn" disabled={!selectedLink || busy}
              onClick={async () => { setBusy(true); await Api.restoreNetwork(selectedLink); setBusy(false); reload(); }}>
              Restore Link
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            In the Cisco Packet Tracer model, OSPF detects a topology change on
            the failed link and recalculates the shortest path through a
            redundant link. This panel mirrors that recalculation for the
            simulated network layer.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Incident Management
// ---------------------------------------------------------------------------

function IncidentManagement() {
  const [incidents, , reload] = usePolling(Api.incidents, []);
  const [resetting, setResetting] = useState(false);

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Simulation Mode</h2>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Use Route Management to simulate a flood or accident on a road
          segment, and Network Topology to simulate a network link failure.
          Reset restores the full sample dataset.
        </p>
        <div className="controls-row">
          <button className="btn danger" disabled={resetting}
            onClick={async () => { setResetting(true); await Api.resetSimulation(); setResetting(false); reload(); }}>
            Reset Simulation
          </button>
        </div>
      </div>
      <div className="panel">
        <h2>Incident Log</h2>
        <table>
          <thead><tr><th>Type</th><th>Route/Link</th><th>Description</th><th>Status</th><th>Reported</th></tr></thead>
          <tbody>
            {(incidents || []).map((inc, i) => (
              <tr key={i}>
                <td>{inc.incident_type.replace("_", " ")}</td>
                <td>{inc.route_id || inc.link_id || "—"}</td>
                <td style={{ fontFamily: "var(--sans)" }}>{inc.description}</td>
                <td><span className={statusPillClass(inc.status === "active" ? "warning" : "operational")}>{inc.status}</span></td>
                <td>{timeAgo(inc.created_at)}</td>
              </tr>
            ))}
            {(!incidents || incidents.length === 0) && (
              <tr><td colSpan="5" className="empty-state">No incidents logged.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts page
// ---------------------------------------------------------------------------

function AlertsPage() {
  const [alerts] = usePolling(Api.alerts, []);
  return (
    <div className="panel">
      <h2>All Alerts</h2>
      <AlertList alerts={alerts} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Network Statistics (charts)
// ---------------------------------------------------------------------------

// Chart.js instances are created ONCE per mounted canvas and then updated
// in place on every data change. The previous approach destroyed and
// re-created the chart on every poll tick (any time the JSON-stringified
// config changed), which under Chart.js's async teardown could throw
// "Canvas is already in use" and crash the React tree — which is what
// produced the blank/black Network Statistics page. Creating once and
// calling chart.update() avoids that entirely.
function BarChart({ labels, values, label, color }) {
  const canvasRef = React.useRef(null);
  const chartRef = React.useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    chartRef.current = new Chart(canvasRef.current, {
      type: "bar",
      data: { labels, datasets: [{ label, data: values, backgroundColor: color, borderRadius: 4, maxBarThickness: 36 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#6b7789" }, grid: { display: false } },
          y: { ticks: { color: "#6b7789" }, grid: { color: "#e3e8f0" }, beginAtZero: true },
        },
      },
    });
    return () => {
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, []); // create exactly once for the life of this canvas

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].backgroundColor = color;
    chart.update();
  }, [JSON.stringify(labels), JSON.stringify(values), color]);

  return <div style={{ position: "relative", height: 200 }}><canvas ref={canvasRef}></canvas></div>;
}

function DoughnutChart({ labels, values, colors }) {
  const canvasRef = React.useRef(null);
  const chartRef = React.useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    chartRef.current = new Chart(canvasRef.current, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: "#ffffff", borderWidth: 2 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { color: "#16202e", boxWidth: 12, font: { size: 11 } } } },
      },
    });
    return () => {
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].backgroundColor = colors;
    chart.update();
  }, [JSON.stringify(labels), JSON.stringify(values), JSON.stringify(colors)]);

  return <div style={{ position: "relative", height: 200 }}><canvas ref={canvasRef}></canvas></div>;
}

function NetworkStatistics() {
  const [buses] = usePolling(Api.buses, []);
  const [routes] = usePolling(Api.routes, []);
  const [network] = usePolling(Api.network, []);
  const [incidents] = usePolling(Api.incidents, []);

  if (!buses || !routes || !network || !incidents) return <div className="empty-state">Loading statistics…</div>;

  const busLabels = buses.map((b) => b.bus_id);
  const busDelays = buses.map((b) => b.delay_minutes);

  const routeStatusCounts = {
    Available: routes.filter((r) => r.available).length,
    Blocked: routes.filter((r) => !r.available).length,
  };

  const linkStatusCounts = {
    Up: network.links.filter((l) => l.status === "up").length,
    Degraded: network.links.filter((l) => l.status === "degraded").length,
    Down: network.links.filter((l) => l.status === "down").length,
  };

  const incidentTypeCounts = {};
  incidents.forEach((i) => { incidentTypeCounts[i.incident_type] = (incidentTypeCounts[i.incident_type] || 0) + 1; });

  return (
    <div className="grid grid-2">
      <div className="panel">
        <h2>Bus Delays (minutes)</h2>
        <BarChart labels={busLabels} values={busDelays} label="Delay (min)" color="#2563eb" />
      </div>
      <div className="panel">
        <h2>Route Availability</h2>
        <DoughnutChart labels={Object.keys(routeStatusCounts)} values={Object.values(routeStatusCounts)} colors={["#2563eb", "#c81e3a"]} />
      </div>
      <div className="panel">
        <h2>Network Link Status</h2>
        <DoughnutChart labels={Object.keys(linkStatusCounts)} values={Object.values(linkStatusCounts)} colors={["#2563eb", "#e05d44", "#c81e3a"]} />
      </div>
      <div className="panel">
        <h2>Incidents by Type</h2>
        {Object.keys(incidentTypeCounts).length === 0
          ? <div className="empty-state">No incidents yet.</div>
          : <BarChart labels={Object.keys(incidentTypeCounts)} values={Object.values(incidentTypeCounts)} label="Count" color="#e05d44" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Protocol reference page
// ---------------------------------------------------------------------------

const PROTOCOL_ROWS = [
  ["Application", "HTTP/HTTPS", "Dashboard ↔ backend REST API traffic"],
  ["Application", "MQTT", "Lightweight bus status & emergency-message pushes"],
  ["Application", "DNS", "Resolves the dashboard/server hostname"],
  ["Application", "SNMP", "Conceptual polling of router/switch health"],
  ["Transport", "TCP", "Reliable delivery for dashboard/API traffic"],
  ["Transport", "UDP", "Low-latency bus telemetry pings"],
  ["Network", "IPv4", "Addressing for every node in the topology"],
  ["Network", "ICMP", "Connectivity/reachability checks between zones"],
  ["Network", "OSPF", "Dynamic route recalculation between routers"],
  ["Data Link", "Ethernet", "Router–switch and switch–host links"],
  ["Data Link", "Wi-Fi", "Bus-to-roadside-access-point connectivity"],
];

function ProtocolsPage() {
  return (
    <div className="panel">
      <h2>Communication Protocol Stack</h2>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
        Every simulated feature in this system maps to a concrete layer of the
        network stack modelled in the Cisco Packet Tracer topology.
      </p>
      <table>
        <thead><tr><th>Layer</th><th>Protocol</th><th>Purpose in this system</th></tr></thead>
        <tbody>
          {PROTOCOL_ROWS.map(([layer, proto, purpose], i) => (
            <tr key={i}>
              <td>{layer}</td>
              <td>{proto}</td>
              <td style={{ fontFamily: "var(--sans)" }}>{purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root app
// ---------------------------------------------------------------------------

function App() {
  const [tab, setTab] = useState("dashboard");
  return (
    <React.Fragment>
      <TopBar />
      <div className="layout">
        <Nav tab={tab} setTab={setTab} />
        <div className="main">
          {tab === "dashboard" && <Dashboard goTo={setTab} />}
          {tab === "buses" && <BusMonitoring />}
          {tab === "routes" && <RouteManagement />}
          {tab === "topology" && <NetworkTopology />}
          {tab === "incidents" && <IncidentManagement />}
          {tab === "alerts" && <AlertsPage />}
          {tab === "stats" && <NetworkStatistics />}
          {tab === "protocols" && <ProtocolsPage />}
        </div>
      </div>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
