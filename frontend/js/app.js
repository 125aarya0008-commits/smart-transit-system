var { useState, useEffect, useMemo, useCallback } = React;

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
  ["buses", "BEST Service Monitoring"],
  ["routes", "Route Management"],
  ["best", "Mumbai BEST Explorer"],
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
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [bestRoutes, setBestRoutes] = React.useState([]);
  const [bestStops, setBestStops] = React.useState([]);
  const [bestTrips, setBestTrips] = React.useState([]);
  const [search, setSearch] = React.useState("");

  const mapContainerRef = React.useRef(null);
  const mapRef = React.useRef(null);

  // Load actual recorded Mumbai BEST data.
 
  // Load actual recorded Mumbai BEST data.
  React.useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      setError("");

      try {
        if (!window.BestData) {
          throw new Error("BEST data library is unavailable.");
        }

        await window.BestData.load();

        const [routes, stops, trips] = await Promise.all([
          window.BestData.getRoutes(),
          window.BestData.getStops(),
          window.BestData.getTrips()
        ]);

        if (cancelled) return;

        setBestRoutes(Array.isArray(routes) ? routes : []);
        setBestStops(Array.isArray(stops) ? stops : []);
        setBestTrips(Array.isArray(trips) ? trips : []);

      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Unable to load BEST data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  // Create the map once, then draw the BEST stop locations.
  React.useEffect(() => {
    if (
      loading ||
      !mapContainerRef.current ||
      !window.L ||
      !bestStops.length
    ) {
      return;
    }

    if (mapRef.current) return;

    const map = window.L.map(mapContainerRef.current, {
      center: [19.076, 72.8777],
      zoom: 11,
      preferCanvas: true
    });

    mapRef.current = map;

    window.L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      }
    ).addTo(map);

    const stopLayer = window.L.layerGroup().addTo(map);

    const bounds = [];

    bestStops.forEach((stop) => {
      const lat = Number(stop.stop_lat);
      const lon = Number(stop.stop_lon);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180 ||
        (lat === 0 && lon === 0)
      ) {
        return;
      }

      bounds.push([lat, lon]);

      const marker = window.L.circleMarker([lat, lon], {
        radius: 3,
        color: "#2563eb",
        weight: 1,
        fillColor: "#3b82f6",
        fillOpacity: 0.55
      });

      const popup = document.createElement("div");

      const title = document.createElement("strong");
      title.textContent = stop.stop_name || "BEST Stop";

      const id = document.createElement("div");
      id.textContent = `Stop ID: ${stop.stop_id}`;

      popup.appendChild(title);
      popup.appendChild(id);

      marker.bindPopup(popup);
      marker.addTo(stopLayer);
    });

    if (bounds.length) {
      map.fitBounds(bounds, {
        padding: [20, 20],
        maxZoom: 12
      });
    }

    map.invalidateSize();

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [loading, bestStops]);

  const filteredRoutes = React.useMemo(() => {
    const q = search.trim().toLowerCase();

    if (!q) return bestRoutes.slice(0, 12);

    return bestRoutes
      .filter((route) => {
        return (
          String(route.route_short_name || "")
            .toLowerCase()
            .includes(q) ||
          String(route.route_long_name || "")
            .toLowerCase()
            .includes(q) ||
          String(route.route_id || "")
            .toLowerCase()
            .includes(q)
        );
      })
      .slice(0, 30);
  }, [bestRoutes, search]);

  const statCard = (label, value, note, extraClass = "") => (
    <div className={`panel stat ${extraClass}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="label muted">{note}</div>
    </div>
  );

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Mumbai BEST Transit Network</h2>

        <p className="muted">
          Explore recorded BEST routes, stops and trip patterns.
          Route disruptions and rerouting are simulated for
          educational network analysis.
        </p>

        <button
          className="btn primary"
          onClick={() => goTo("routes")}
          style={{ marginTop: 10 }}
        >
          Open Route Management →
        </button>
      </div>

      {error && (
        <div
          className="panel"
          style={{
            color: "#b91c1c",
            marginBottom: 16
          }}
        >
          {error}
        </div>
      )}

      <div
        className="grid grid-4"
        style={{ marginBottom: 16 }}
      >
        {statCard(
          "BEST ROUTES",
          loading ? "—" : bestRoutes.length.toLocaleString(),
          "Recorded route entries",
          "ok"
        )}

        {statCard(
          "RECORDED STOPS",
          loading ? "—" : bestStops.length.toLocaleString(),
          "Stop locations in dataset"
        )}

        {statCard(
          "TRIP PATTERNS",
          loading ? "—" : bestTrips.length.toLocaleString(),
          "Recorded journey patterns"
        )}

        {statCard(
          "DATA SOURCE",
          loading ? "Loading" : error ? "Error" : "BEST",
          "Static transit dataset",
          "ok"
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Mumbai BEST Stop Network Map</h2>

        <p className="muted">
          Interactive geographic overview of recorded bus
          stops. Click a marker to view its stop name and ID.
        </p>

        {loading ? (
          <div className="empty-state">
            Loading Mumbai BEST stop data…
          </div>
        ) : !bestStops.length ? (
          <div className="empty-state">
            No BEST stop locations available.
          </div>
        ) : (
          <div
            ref={mapContainerRef}
            style={{
              width: "100%",
              height: 460,
              marginTop: 14,
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              overflow: "hidden",
              zIndex: 0
            }}
          />
        )}

        <p
          className="muted"
          style={{ fontSize: 12, marginTop: 10 }}
        >
          Markers represent recorded stop coordinates, not
          live bus positions. This map does not provide
          real-time vehicle tracking or arrival predictions.
        </p>
      </div>

      <div className="panel">
        <h2>Explore BEST Routes</h2>

        <p className="muted">
          Search by BEST route number, route name or route ID.
        </p>

        <input
          type="text"
          placeholder="Search routes, e.g. 45 AS"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            margin: "12px 0",
            border: "1px solid #d1d5db",
            borderRadius: 8,
            boxSizing: "border-box"
          }}
        />

        {loading ? (
          <div className="empty-state">
            Loading routes…
          </div>
        ) : filteredRoutes.length === 0 ? (
          <div className="empty-state">
            No matching BEST routes found.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left"
              }}
            >
              <thead>
                <tr>
                  <th style={{ padding: 10 }}>Route</th>
                  <th style={{ padding: 10 }}>Description</th>
                  <th style={{ padding: 10 }}>Stops</th>
                  <th style={{ padding: 10 }}>Patterns</th>
                </tr>
              </thead>

              <tbody>
                {filteredRoutes.map((route) => (
                  <tr key={route.route_id}>
                    <td style={{ padding: 10 }}>
                      <strong>
                        {route.route_short_name ||
                          route.route_id}
                      </strong>
                    </td>

                    <td style={{ padding: 10 }}>
                      {route.route_long_name || "—"}
                    </td>

                    <td style={{ padding: 10 }}>
                      {route.stop_count ?? "—"}
                    </td>

                    <td style={{ padding: 10 }}>
                      {route.trip_pattern_count ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Route map (simplified linear/branching diagram of zones, SVG)
// ---------------------------------------------------------------------------

// Laid out as a square: the 4 direct/primary routes form the sides (no
// overlap), and the 2 "redundant path" routes from seed.py (Zone1-Zone3,
// Zone2-Zone4) are the diagonals — drawn as curves bowed to opposite
// corners so they don't overlap each other or the straight sides.
const ZONE_POS = {
  "Zone 1": [160, 90], "Zone 2": [590, 90], "Zone 3": [590, 350], "Zone 4": [160, 350],
};
const DIAGONAL_BOW = {
  "Zone 1|Zone 3": [95, -75],
  "Zone 3|Zone 1": [95, -75],
  "Zone 2|Zone 4": [-95, 75],
  "Zone 4|Zone 2": [-95, 75],
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
    <svg className="topology-svg" viewBox="0 0 750 440">
      {routes.map((r) => {
        const a = ZONE_POS[r.source], b = ZONE_POS[r.destination];
        if (!a || !b) return null;
        const cls = inHighlight(r.source, r.destination) ? "reroute" : routeStrokeClass(r);
        const strokeColor = cls === "reroute" ? "#2563eb" : undefined;
        const strokeW = cls === "reroute" ? 5 : 3;
        const lineClass = `link-line ${cls === "reroute" ? "" : cls}`;
        const bow = DIAGONAL_BOW[`${r.source}|${r.destination}`];
        const midX = (a[0] + b[0]) / 2, midY = (a[1] + b[1]) / 2;

        if (bow) {
          const cx = midX + bow[0], cy = midY + bow[1];
          return (
            <g key={r.route_id}>
              <path d={`M ${a[0]} ${a[1]} Q ${cx} ${cy} ${b[0]} ${b[1]}`}
                fill="none" className={lineClass} stroke={strokeColor} strokeWidth={strokeW} />
              <rect x={cx - 36} y={cy - 9} width="72" height="16" rx="8" fill="#ffffff" stroke="#e3e8f0" />
              <text x={cx} y={cy + 3} className="node-label" textAnchor="middle" fontWeight="600">
                {r.route_id} · {r.available ? `${r.base_travel_time_min}m` : "BLOCKED"}
              </text>
            </g>
          );
        }
        // Straight "side" route — offset the label outward from the square
        // so it never sits on top of the line itself.
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        const ox = (-dy / len) * 16, oy = (dx / len) * 16;
        const labelX = midX + ox, labelY = midY + oy;
        return (
          <g key={r.route_id}>
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              className={lineClass} stroke={strokeColor} strokeWidth={strokeW} />
            <rect x={labelX - 36} y={labelY - 9} width="72" height="16" rx="8" fill="#ffffff" stroke="#e3e8f0" />
            <text x={labelX} y={labelY + 3} className="node-label" textAnchor="middle" fontWeight="600">
              {r.route_id} · {r.available ? `${r.base_travel_time_min}m` : "BLOCKED"}
            </text>
          </g>
        );
      })}
      {zones.map((z) => (
        <g key={z}>
          <circle cx={ZONE_POS[z][0]} cy={ZONE_POS[z][1]} r={28} fill="#ffffff" stroke="#2563eb" strokeWidth="2.5" />
          <circle cx={ZONE_POS[z][0]} cy={ZONE_POS[z][1]} r={28} fill="#2563eb" opacity="0.08" />
          <text x={ZONE_POS[z][0]} y={ZONE_POS[z][1] + 5} textAnchor="middle" fontSize="12" fontWeight="700" fill="#16202e" fontFamily="var(--sans)">
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
  const [routes, setRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const PAGE_SIZE = 30;

  useEffect(() => {
    let active = true;

    BestData.getRoutes()
      .then(data => {
        if (!active) return;
        setRoutes(data);
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return routes;

    return routes.filter(route =>
      String(route.route_short_name || "")
        .toLowerCase().includes(query) ||
      String(route.route_long_name || "")
        .toLowerCase().includes(query) ||
      String(route.route_id || "")
        .toLowerCase().includes(query)
    );
  }, [routes, search]);

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / PAGE_SIZE)
  );

  const visibleRoutes = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  async function selectRoute(routeId) {
    setSelectedRoute(null);

    try {
      const details =
        await BestData.getRouteDetails(routeId);

      setSelectedRoute(details);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return (
      <div className="panel">
        <h2>Loading Mumbai BEST services...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <h2>BEST Data Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Mumbai BEST Service Monitoring</h2>

        <p className="muted" style={{ fontSize: 12 }}>
          Actual BEST route and stop-pattern records.
          This is not live vehicle tracking.
        </p>

        <div className="grid grid-4"
          style={{ marginTop: 16 }}>

          <div className="panel stat ok">
            <div className="label">BEST ROUTES</div>
            <div className="value">{routes.length}</div>
          </div>

          <div className="panel stat">
            <div className="label">MATCHING ROUTES</div>
            <div className="value">{filtered.length}</div>
          </div>

          <div className="panel stat">
            <div className="label">RECORDED PATTERNS</div>
            <div className="value">
              {routes.reduce(
                (sum, r) => sum + r.trip_pattern_count,
                0
              )}
            </div>
          </div>

          <div className="panel stat">
            <div className="label">DATA SOURCE</div>
            <div className="value"
              style={{ fontSize: 18 }}>
              BEST GTFS
            </div>
          </div>
        </div>

        <input
          type="text"
          placeholder="Search BEST route number or destination..."
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setPage(1);
          }}
          style={{
            width: "100%",
            padding: 12,
            marginTop: 16,
            border: "1px solid #dce3eb",
            borderRadius: 8
          }}
        />
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <h2>BEST Routes ({filtered.length})</h2>

          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>ROUTE</th>
                  <th>ROUTE NAME</th>
                  <th>PATTERNS</th>
                  <th>STOPS</th>
                </tr>
              </thead>

              <tbody>
                {visibleRoutes.map(route => (
                  <tr
                    key={route.route_id}
                    className="clickable"
                    onClick={() =>
                      selectRoute(route.route_id)
                    }
                  >
                    <td>
                      <strong>
                        {route.route_short_name}
                      </strong>
                    </td>

                    <td style={{
                      fontFamily: "var(--sans)",
                      fontSize: 12
                    }}>
                      {route.route_long_name}
                    </td>

                    <td>
                      {route.trip_pattern_count}
                    </td>

                    <td>
                      {route.stop_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="controls-row"
            style={{
              marginTop: 16,
              justifyContent: "space-between"
            }}>

            <button
              className="btn"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </button>

            <span className="muted">
              Page {page} of {totalPages}
            </span>

            <button
              className="btn"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </button>
          </div>
        </div>

        <div className="panel">
          <h2>BEST Route Details</h2>

          {!selectedRoute && (
            <div className="empty-state">
              Select a BEST route to view its stops.
            </div>
          )}

          {selectedRoute && (
            <div>
              <h2>
                Route {selectedRoute.route_short_name}
              </h2>

              <p className="muted">
                {selectedRoute.route_long_name}
              </p>

              {selectedRoute.patterns.length === 0 && (
                <div className="empty-state">
                  No stop pattern is available for
                  this route in the dataset.
                </div>
              )}

              {selectedRoute.patterns.map(
                (pattern, index) => (
                  <div
                    key={pattern.trip_id || index}
                    style={{ marginTop: 18 }}
                  >
                    <h2>
                      Pattern {index + 1}
                      {" · "}
                      {pattern.stops.length} stops
                    </h2>

                    <p className="muted"
                      style={{ fontSize: 12 }}>
                      Direction: {pattern.direction_id}
                    </p>

                    <div style={{
                      maxHeight: 460,
                      overflowY: "auto"
                    }}>
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>STOP NAME</th>
                            <th>STOP ID</th>
                          </tr>
                        </thead>

                        <tbody>
                          {pattern.stops.map(
                            (stop, i) => (
                              <tr key={`${stop.stop_id}-${i}`}>
                                <td>{i + 1}</td>

                                <td style={{
                                  fontFamily: "var(--sans)"
                                }}>
                                  {stop.stop_name}
                                </td>

                                <td>{stop.stop_id}</td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Route Management
// ---------------------------------------------------------------------------


function RouteManagement() {
  const [routes, setRoutes] = useState([]);
  const [routeId, setRouteId] = useState("");
  const [details, setDetails] = useState(null);
  const [patternIndex, setPatternIndex] = useState(0);
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [blockedId, setBlockedId] = useState("");
  const [incidentType, setIncidentType] = useState("flood");
  const [incident, setIncident] = useState(null);
  const [original, setOriginal] = useState(null);
  const [alternative, setAlternative] = useState(null);
  
const routeComparison = useMemo(() => {
  if (!original || !alternative) return null;

  const originalIds = original.stops.map(s => s.stop_id);
  const alternativeIds = alternative.stops.map(s => s.stop_id);

  const originalSet = new Set(originalIds);
  const alternativeSet = new Set(alternativeIds);

  const skippedStops = original.stops.filter(
    s => !alternativeSet.has(s.stop_id)
  );

  const newStops = alternative.stops.filter(
    s => !originalSet.has(s.stop_id)
  );

  const sameSequence =
    originalIds.length === alternativeIds.length &&
    originalIds.every(
      (id, i) => id === alternativeIds[i]
    );

  return {
    changed: !sameSequence,
    skippedStops,
    newStops,
    distanceDifference:
      alternative.distance_km - original.distance_km
  };
}, [original, alternative]);


  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    BestData.getRoutes()
      .then(data => {
        const available = data.filter(
          r => r.trip_pattern_count > 0
        );
        setRoutes(available);
        if (available.length) {
          setRouteId(available[0].route_id);
        }
      })
      .catch(e => setError(e.message));

    return () => BestRouting.reset();
  }, []);

  useEffect(() => {
    let active = true;

    setDetails(null);
    setIncident(null);
    setOriginal(null);
    setAlternative(null);
    setPatternIndex(0);
    BestRouting.reset();

    if (routeId) {
      BestData.getRouteDetails(routeId)
        .then(data => {
          if (active) setDetails(data);
        })
        .catch(e => {
          if (active) setError(e.message);
        });
    }

    return () => { active = false; };
  }, [routeId]);

  const patterns = details?.patterns || [];
  const pattern = patterns[patternIndex];
  const stops = pattern?.stops || [];

  useEffect(() => {
    if (!stops.length) {
      setSourceId("");
      setDestinationId("");
      setBlockedId("");
      return;
    }

    setSourceId(stops[0].stop_id);
    setDestinationId(stops[stops.length - 1].stop_id);
    setBlockedId(
      stops[Math.floor(stops.length / 2)].stop_id
    );
    setIncident(null);
    setOriginal(null);
    setAlternative(null);
    BestRouting.reset();
  }, [details, patternIndex]);

  const matchingRoutes = routes.filter(r => {
    const q = search.toLowerCase();
    return (
      String(r.route_short_name || "")
        .toLowerCase().includes(q) ||
      String(r.route_long_name || "")
        .toLowerCase().includes(q)
    );
  });

  async function calculateOriginal() {
    if (!sourceId || !destinationId) return;

    setBusy(true);
    setError("");

    try {
      BestRouting.reset();
      setBlockedId("");
      setIncident(null);
      setAlternative(null);

      const result = await BestRouting.findRoute(
        sourceId,
        destinationId
      );

      setOriginal(result);

      if (!result) {
        setError(
          "No connected path found between these stops."
        );
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function simulateIncident() {
    if (!sourceId || !destinationId || !blockedId) {
      setError("Select the required stops.");
      return;
    }

    if (
      blockedId === sourceId ||
      blockedId === destinationId
    ) {
      setError(
        "Choose a disrupted stop different from " +
        "the starting and destination stops."
      );
      return;
    }

    setBusy(true);
    setError("");

    try {
      BestRouting.reset();

      const before = await BestRouting.findRoute(
        sourceId,
        destinationId
      );

      if (!before) {
        throw new Error(
          "No original path exists between these stops."
        );
      }

      if (!before.stops.some(
        s => s.stop_id === blockedId
      )) {
        throw new Error(
          "The selected stop is not on the original " +
          "shortest path. Choose a stop from that path."
        );
      }

      const disruption = await BestRouting.blockStop(
        blockedId
      );

      const after = await BestRouting.findRoute(
        sourceId,
        destinationId
      );

      setOriginal(before);
      setAlternative(after);

      setIncident({
        ...disruption,
        type: incidentType,
        stop_name:
          stops.find(s => s.stop_id === blockedId)
            ?.stop_name || blockedId
      });
    } catch (e) {
      BestRouting.reset();
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function restore() {
    BestRouting.reset();
    setIncident(null);
    setAlternative(null);
    setOriginal(null);
    setError("");
  }

  
function RouteVisualization() {
  const mapContainerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const layersRef = React.useRef(null);

  React.useEffect(() => {
    if (!mapContainerRef.current || !window.L) return;

    // Create the map only once for this component instance.
    if (!mapRef.current) {
      const map = window.L.map(mapContainerRef.current, {
        center: [19.076, 72.8777],
        zoom: 11,
        zoomControl: true
      });

      window.L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19
        }
      ).addTo(map);

      mapRef.current = map;
      layersRef.current = window.L.layerGroup().addTo(map);
    }

    const map = mapRef.current;
    const layers = layersRef.current;

    layers.clearLayers();

    const originalStops = original?.stops || [];
    const alternativeStops = alternative?.stops || [];

    const coordinates = [];

    function validCoordinates(stops) {
      return stops
        .filter(s =>
          Number.isFinite(Number(s.lat)) &&
          Number.isFinite(Number(s.lon))
        )
        .map(s => [Number(s.lat), Number(s.lon)]);
    }

    const originalCoords = validCoordinates(originalStops);
    const alternativeCoords = validCoordinates(alternativeStops);

    if (originalCoords.length > 1) {
      window.L.polyline(originalCoords, {
        color: "#2563eb",
        weight: 5,
        opacity: 0.9,
        dashArray: incident ? "8, 7" : null
      }).addTo(layers);

      coordinates.push(...originalCoords);
    }

    if (alternativeCoords.length > 1) {
      window.L.polyline(alternativeCoords, {
        color: "#16a34a",
        weight: 5,
        opacity: 0.95
      }).addTo(layers);

      coordinates.push(...alternativeCoords);
    }

    // Show recorded BEST stops along the original journey.
    originalStops.forEach((stop, index) => {
      const lat = Number(stop.lat);
      const lon = Number(stop.lon);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return;
      }

      const marker = window.L.circleMarker([lat, lon], {
        radius: 4,
        color: "#1d4ed8",
        fillColor: "#ffffff",
        fillOpacity: 1,
        weight: 2
      });

      // Use a DOM text node rather than inserting stop names
      // directly as HTML.
      const popup = document.createElement("div");
      const heading = document.createElement("strong");
      heading.textContent = `Original Stop ${index + 1}`;
      const name = document.createElement("p");
      name.textContent = stop.stop_name;

      popup.appendChild(heading);
      popup.appendChild(name);

      marker.bindPopup(popup).addTo(layers);
    });

    // Highlight the starting and destination stops.
    if (originalStops.length) {
      const endpoints = [
        {
          stop: originalStops[0],
          label: "Journey Start",
          color: "#16a34a"
        },
        {
          stop: originalStops[originalStops.length - 1],
          label: "Destination",
          color: "#7c3aed"
        }
      ];

      endpoints.forEach(({ stop, label, color }) => {
        const lat = Number(stop.lat);
        const lon = Number(stop.lon);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          return;
        }

        window.L.circleMarker([lat, lon], {
          radius: 9,
          color: "#ffffff",
          weight: 2,
          fillColor: color,
          fillOpacity: 1
        })
          .bindTooltip(label, { direction: "top" })
          .addTo(layers);
      });
    }

    // Mark the simulated flooded or accident-affected stop.
    if (incident) {
      const blockedStop = originalStops.find(
        s => s.stop_id === incident.stop_id
      );

      if (blockedStop) {
        const lat = Number(blockedStop.lat);
        const lon = Number(blockedStop.lon);

        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          window.L.circleMarker([lat, lon], {
            radius: 12,
            color: "#dc2626",
            weight: 3,
            fillColor: "#fecaca",
            fillOpacity: 0.9
          })
            .bindTooltip(
              `Simulated ${incident.type} disruption`,
              { permanent: false, direction: "top" }
            )
            .addTo(layers);
        }
      }
    }

    if (coordinates.length) {
      map.fitBounds(window.L.latLngBounds(coordinates), {
        padding: [35, 35],
        maxZoom: 15
      });
    } else {
      map.setView([19.076, 72.8777], 11);
    }

    // Refresh map dimensions after React layout.
    map.invalidateSize();

  }, [original, alternative, incident]);

  React.useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layersRef.current = null;
      }
    };
  }, []);

  return (
    <div>
      <div
      className="controls-row"
        style={{
          marginBottom: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 16
        }}
      >
        <span style={{ color: "#2563eb" }}>
          ● Original BEST journey
        </span>

        <span style={{ color: "#16a34a" }}>
          ● Alternative journey
        </span>

        <span style={{ color: "#dc2626" }}>
          ● Simulated disruption
        </span>
      </div>

      <div
        ref={mapContainerRef}
        style={{
          width: "100%",
          height: 480,
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
          zIndex: 0
        }}
      />

      <p className="muted" style={{
        fontSize: 12,
        marginTop: 10
      }}>
        Mumbai BEST route visualization using actual
        recorded stop coordinates. Blue indicates the
        original calculated path; green indicates the
        alternative. Red indicates a simulated disruption.
        Lines connect stop locations and do not represent
        verified road geometry or live bus positions.
      </p>
    </div>
  );
}

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Mumbai BEST Route Management</h2>
        <p className="muted">
          Real BEST stop patterns · Simulated disruptions ·
          Graph-based rerouting
        </p>

        <div className="grid grid-4"
          style={{ marginTop: 16 }}>
          <div className="panel stat ok">
            <div className="label">BEST ROUTES</div>
            <div className="value">{routes.length}</div>
          </div>

          <div className="panel stat">
            <div className="label">SELECTED STOPS</div>
            <div className="value">{stops.length}</div>
          </div>

          <div className="panel stat">
            <div className="label">AFFECTED ROUTES</div>
            <div className="value">
              {incident?.affected_routes.length || 0}
            </div>
          </div>

          <div className="panel stat">
            <div className="label">DISRUPTIONS</div>
            <div className="value">{incident ? 1 : 0}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <h2>1. Select BEST Service</h2>

          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search route number or destination"
            style={{
              width: "100%",
              padding: 10,
              marginBottom: 10
            }}
          />

          <select
            value={routeId}
            onChange={e => setRouteId(e.target.value)}
            style={{ width: "100%", padding: 10 }}
          >
            {routes
              .filter(r =>
                r.route_id === routeId ||
                matchingRoutes.some(
                  m => m.route_id === r.route_id
                )
              )
              .map(r => (
                <option key={r.route_id}
                  value={r.route_id}>
                  {r.route_short_name} — {r.route_long_name}
                </option>
              ))}
          </select>

          {patterns.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <p>Trip Pattern</p>
              <select
                value={patternIndex}
                onChange={e =>
                  setPatternIndex(Number(e.target.value))
                }
                style={{ width: "100%", padding: 10 }}
              >
                {patterns.map((p, i) => (
                  <option key={p.trip_id || i} value={i}>
                    Pattern {i + 1} — {p.stops.length} stops
                  </option>
                ))}
              </select>
            </div>
          )}

          <h2 style={{ marginTop: 22 }}>
            2. Select Journey
          </h2>

          <p>Starting Stop</p>
          <select
            value={sourceId}
            onChange={e => setSourceId(e.target.value)}
            style={{ width: "100%", padding: 10 }}
          >
            {stops.map((s, i) => (
              <option key={`${s.stop_id}-${i}`}
                value={s.stop_id}>
                {i + 1}. {s.stop_name}
              </option>
            ))}
          </select>

          <p style={{ marginTop: 12 }}>Destination Stop</p>
          <select
            value={destinationId}
            onChange={e =>
              setDestinationId(e.target.value)
            }
            style={{ width: "100%", padding: 10 }}
          >
            {stops.map((s, i) => (
              <option key={`${s.stop_id}-${i}`}
                value={s.stop_id}>
                {i + 1}. {s.stop_name}
              </option>
            ))}
          </select>

          <button
            className="btn"
            style={{ marginTop: 14 }}
            disabled={busy || !stops.length}
            onClick={calculateOriginal}
          >
            Calculate Original Journey
          </button>

          <h2 style={{ marginTop: 24 }}>
            3. Simulate Disruption
          </h2>


<p>Disrupted Stop</p>
<select
  value={
    original?.stops
      .slice(1, -1)
      .some(s => s.stop_id === blockedId)
        ? blockedId
        : ""
  }
  onChange={e => setBlockedId(e.target.value)}
  style={{ width: "100%", padding: 10 }}
  disabled={!original}
>
  <option value="">
    {original
      ? "Select a stop on the original journey"
      : "Calculate original journey first"}
  </option>

  {(original?.stops.slice(1, -1) || []).map(
    (s, i) => (
      <option
        key={`${s.stop_id}-${i}`}
        value={s.stop_id}
      >
        {i + 2}. {s.stop_name}
      </option>
    )
  )}
</select>


          <p style={{ marginTop: 12 }}>Incident Type</p>
          <select
            value={incidentType}
            onChange={e => setIncidentType(e.target.value)}
            style={{ width: "100%", padding: 10 }}
          >
            <option value="flood">Flood</option>
            <option value="accident">Road Accident</option>
          </select>

          <div className="controls-row"
            style={{ marginTop: 16 }}>
            <button
              className="btn"
              disabled={busy || !stops.length}
              onClick={simulateIncident}
            >
              {busy ? "Calculating..." : "Simulate & Reroute"}
            </button>

            <button className="btn" onClick={restore}>
              Restore Network
            </button>
          </div>

          {error && (
            <p style={{
              color: "#dc2626",
              marginTop: 12
            }}>
              {error}
            </p>
          )}
        </div>

        <div className="panel">
          <h2>4. Rerouting Results</h2>

          {!original && (
            <div className="empty-state">
              Calculate an original journey or simulate
              an incident to see the results.
            </div>
          )}

          {original && (
            <div>
              <div className="detail-row">
                <span className="k">Original Distance</span>
                <span className="v">
                  {original.distance_km} km
                </span>
              </div>

              <div className="detail-row">
                <span className="k">Original Stops</span>
                <span className="v">
                  {original.stops.length}
                </span>
              </div>
            </div>
          )}

          {incident && (
            <div style={{ marginTop: 18 }}>
              <h2 style={{ color: "#dc2626" }}>
                {incident.type === "flood"
                  ? "Flood Alert"
                  : "Accident Alert"}
              </h2>

              <p>
                Disrupted stop: <strong>
                  {incident.stop_name}
                </strong>
              </p>

              <div className="detail-row">
                <span className="k">Affected Routes</span>
                <span className="v">
                  {incident.affected_routes.length}
                </span>
              </div>

              <h2 style={{ marginTop: 16 }}>
                Alternative Journey
              </h2>

{routeComparison && (
  <div style={{
    padding: 14,
    marginTop: 12,
    marginBottom: 16,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 10
  }}>
    <h3>Original vs Alternative Comparison</h3>

    <p style={{
      color: routeComparison.changed
        ? "#15803d"
        : "#b45309",
      fontWeight: 600
    }}>
      {routeComparison.changed
        ? "Different stop sequence found"
        : "No change in stop sequence"}
    </p>

    <div className="detail-row">
      <span className="k">Original Stops</span>
      <span className="v">{original.stops.length}</span>
    </div>

    <div className="detail-row">
      <span className="k">Alternative Stops</span>
      <span className="v">{alternative.stops.length}</span>
    </div>

    <div className="detail-row">
      <span className="k">Skipped Stops</span>
      <span className="v">
        {routeComparison.skippedStops.length}
      </span>
    </div>

    <div className="detail-row">
      <span className="k">New Stops</span>
      <span className="v">
        {routeComparison.newStops.length}
      </span>
    </div>

    <div className="detail-row">
      <span className="k">Distance Difference</span>
      <span className="v">
        {routeComparison.distanceDifference.toFixed(2)} km
      </span>
    </div>

    <h3 style={{ marginTop: 14 }}>Skipped Stops</h3>

    {routeComparison.skippedStops.length === 0 ? (
      <p className="muted">None</p>
    ) : (
      <ul>
        {routeComparison.skippedStops.map(s => (
          <li key={s.stop_id}>{s.stop_name}</li>
        ))}
      </ul>
    )}

    <h3 style={{ marginTop: 14 }}>Newly Used Stops</h3>

    {routeComparison.newStops.length === 0 ? (
      <p className="muted">None</p>
    ) : (
      <ul>
        {routeComparison.newStops.map(s => (
          <li key={s.stop_id}>{s.stop_name}</li>
        ))}
      </ul>
    )}
  </div>
)}


              {alternative ? (
                <>
                  <div className="detail-row">
                    <span className="k">Distance</span>
                    <span className="v">
                      {alternative.distance_km} km
                    </span>
                  </div>

                  <div className="detail-row">
                    <span className="k">Distance Difference</span>
                    <span className="v">
                      {(alternative.distance_km -
                        original.distance_km
                      ).toFixed(2)} km
                    </span>
                  </div>

                  <div className="detail-row">
                    <span className="k">Stops</span>
                    <span className="v">
                      {alternative.stops.length}
                    </span>
                  </div>

                  <h2 style={{ marginTop: 16 }}>
                    Alternative Stop Sequence
                  </h2>

                  <div style={{
                    maxHeight: 260,
                    overflowY: "auto"
                  }}>
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>BEST Stop</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alternative.stops.map((s, i) => (
                          <tr key={`${s.stop_id}-${i}`}>
                            <td>{i + 1}</td>
                            <td>{s.stop_name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <h2 style={{ marginTop: 16 }}>
                    Recorded Route Connections
                  </h2>

                  <p className="muted">
                    {[
                      ...new Set(
                        alternative.segments.map(
                          s => s.route_short_name
                        )
                      )
                    ].join(" · ")}
                  </p>
                </>
              ) : (
                <div className="empty-state">
                  No alternative path found using the
                  available recorded connections.
                </div>
              )}

              <h2 style={{ marginTop: 18 }}>
                Affected BEST Routes
              </h2>

              <div style={{
                maxHeight: 170,
                overflowY: "auto"
              }}>
                {incident.affected_routes.map(id => {
                  const r = routes.find(
                    item => item.route_id === id
                  );

                  return (
                    <div className="detail-row" key={id}>
                      <span className="k">
                        {r?.route_short_name || id}
                      </span>
                      <span className="v">
                        Stop affected
                      </span>
                    </div>
                  );
                })}
              </div>

              <h2 style={{ marginTop: 18 }}>
                Passenger Advisory
              </h2>

              <p>
                Simulated {incident.type} disruption
                near {incident.stop_name}.
                {alternative
                  ? " An alternative stop-network path has been calculated."
                  : " No alternative connected path was found."}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h2>5. BEST Route Visualization</h2>
        <RouteVisualization />
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Network Topology
// ---------------------------------------------------------------------------


function NetworkTopology() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const [routes, setRoutes] = React.useState([]);
  const [stops, setStops] = React.useState([]);
  const [trips, setTrips] = React.useState([]);

  const [selectedRouteId, setSelectedRouteId] = React.useState("");
  const [selectedTripId, setSelectedTripId] = React.useState("");
  const [selectedStopId, setSelectedStopId] = React.useState("");

  const [blockedStopId, setBlockedStopId] = React.useState("");
  const [affectedRoutes, setAffectedRoutes] = React.useState([]);

  const mapContainerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const layerRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;

    async function loadTopology() {
      try {
        setLoading(true);
        setError("");

        if (!window.BestData || !window.BestRouting) {
          throw new Error("BEST data or routing library is unavailable.");
        }

        await window.BestData.load();
        await window.BestRouting.load();

        const [routeData, stopData, tripData] = await Promise.all([
          window.BestData.getRoutes(),
          window.BestData.getStops(),
          window.BestData.getTrips()
        ]);

        if (cancelled) return;

        const validRoutes = Array.isArray(routeData) ? routeData : [];
        const validStops = Array.isArray(stopData) ? stopData : [];
        const validTrips = Array.isArray(tripData) ? tripData : [];

        setRoutes(validRoutes);
        setStops(validStops);
        setTrips(validTrips);

        if (validRoutes.length) {
          setSelectedRouteId(String(validRoutes[0].route_id));
        }

      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Unable to load network topology.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadTopology();

    return () => {
      cancelled = true;
    };
  }, []);

  const stopLookup = React.useMemo(() => {
    return new Map(stops.map(stop => [String(stop.stop_id), stop]));
  }, [stops]);

  const routeLookup = React.useMemo(() => {
    return new Map(routes.map(route => [String(route.route_id), route]));
  }, [routes]);

  const routeTrips = React.useMemo(() => {
    return trips.filter(
      trip => String(trip.route_id) === selectedRouteId
    );
  }, [trips, selectedRouteId]);

  React.useEffect(() => {
    setSelectedTripId(
      routeTrips.length ? String(routeTrips[0].trip_id) : ""
    );
    setSelectedStopId("");
  }, [routeTrips]);

  const selectedTrip = React.useMemo(() => {
    return routeTrips.find(
      trip => String(trip.trip_id) === selectedTripId
    ) || null;
  }, [routeTrips, selectedTripId]);

  const tripStops = React.useMemo(() => {
    if (!selectedTrip || !Array.isArray(selectedTrip.stop_ids)) {
      return [];
    }

    return selectedTrip.stop_ids
      .map(id => stopLookup.get(String(id)))
      .filter(Boolean);
  }, [selectedTrip, stopLookup]);

  const selectedRoute = routeLookup.get(selectedRouteId);

  React.useEffect(() => {
    if (loading || !mapContainerRef.current || !window.L) {
      return;
    }

    if (!mapRef.current) {
      const map = window.L.map(mapContainerRef.current, {
        center: [19.076, 72.8777],
        zoom: 11,
        preferCanvas: true
      });

      window.L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19
        }
      ).addTo(map);

      mapRef.current = map;
      layerRef.current = window.L.layerGroup().addTo(map);
    }

    const map = mapRef.current;
    const layer = layerRef.current;

    layer.clearLayers();

    const coordinates = [];

    tripStops.forEach((stop, index) => {
      const lat = Number(stop.stop_lat);
      const lon = Number(stop.stop_lon);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        (lat === 0 && lon === 0)
      ) {
        return;
      }

      coordinates.push([lat, lon]);

      const isBlocked = String(stop.stop_id) === blockedStopId;

      const marker = window.L.circleMarker([lat, lon], {
        radius: isBlocked ? 10 : 5,
        color: isBlocked ? "#dc2626" : "#2563eb",
        weight: 2,
        fillColor: isBlocked ? "#fecaca" : "#ffffff",
        fillOpacity: 1
      });

      const popup = document.createElement("div");

      const title = document.createElement("strong");
      title.textContent = stop.stop_name || "BEST Stop";

      const detail = document.createElement("p");
      detail.textContent = `Stop ${index + 1} · ID: ${stop.stop_id}`;

      popup.appendChild(title);
      popup.appendChild(detail);

      marker.bindPopup(popup).addTo(layer);
    });

    if (coordinates.length > 1) {
      window.L.polyline(coordinates, {
        color: "#2563eb",
        weight: 4,
        opacity: 0.85
      }).addTo(layer);

      map.fitBounds(window.L.latLngBounds(coordinates), {
        padding: [35, 35],
        maxZoom: 14
      });
    } else if (coordinates.length === 1) {
      map.setView(coordinates[0], 14);
    }

    map.invalidateSize();

  }, [loading, tripStops, blockedStopId]);

  React.useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  function simulateFailure() {
    if (!selectedStopId) return;

    try {
      // Reset the routing simulation before applying a new failure.
      window.BestRouting.reset();

      const result = window.BestRouting.blockStop(selectedStopId);

      setBlockedStopId(selectedStopId);
      setAffectedRoutes(
        Array.isArray(result?.affected_routes)
          ? result.affected_routes
          : []
      );

      setError("");
    } catch (err) {
      setError(err.message || "Could not simulate stop failure.");
    }
  }

  function restoreNetwork() {
    window.BestRouting.reset();

    setBlockedStopId("");
    setAffectedRoutes([]);
    setError("");
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Mumbai BEST Transport Network Topology</h2>

        <p className="muted">
          Explore actual recorded BEST stop sequences and
          simulate a stop becoming unavailable.
          This is a transport-network simulation, not
          live bus tracking or physical router monitoring.
        </p>
      </div>

      {error && (
        <div className="panel" style={{
          marginBottom: 16,
          color: "#b91c1c"
        }}>
          {error}
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="panel stat ok">
          <div className="label">BEST ROUTES</div>
          <div className="value">
            {loading ? "—" : routes.length.toLocaleString()}
          </div>
        </div>

        <div className="panel stat">
          <div className="label">RECORDED STOPS</div>
          <div className="value">
            {loading ? "—" : stops.length.toLocaleString()}
          </div>
        </div>

        <div className="panel stat">
          <div className="label">TRIP PATTERNS</div>
          <div className="value">
            {loading ? "—" : trips.length.toLocaleString()}
          </div>
        </div>

        <div className="panel stat warn">
          <div className="label">SIMULATED BLOCKED STOPS</div>
          <div className="value">{blockedStopId ? 1 : 0}</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Select BEST Service</h2>

        <div className="controls-row" style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12
        }}>
          <select
            value={selectedRouteId}
            onChange={e => {
              setSelectedRouteId(e.target.value);
              restoreNetwork();
            }}
            disabled={loading}
          >
            <option value="">Select BEST route</option>
            {routes.map(route => (
              <option key={route.route_id} value={route.route_id}>
                {route.route_short_name || route.route_id}
                {" — "}
                {route.route_long_name || ""}
              </option>
            ))}
          </select>

          <select
            value={selectedTripId}
            onChange={e => {
              setSelectedTripId(e.target.value);
              setSelectedStopId("");
            }}
            disabled={!routeTrips.length}
          >
            <option value="">Select trip pattern</option>
            {routeTrips.map((trip, index) => (
              <option key={trip.trip_id} value={trip.trip_id}>
                Pattern {index + 1}
                {" — Direction "}
                {trip.direction_id ?? "N/A"}
              </option>
            ))}
          </select>
        </div>

        {selectedRoute && (
          <p className="muted" style={{ marginTop: 12 }}>
            Selected: {selectedRoute.route_short_name}
            {" — "}
            {selectedRoute.route_long_name}
          </p>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Recorded BEST Stop Connections</h2>

        <p className="muted">
          Blue lines join consecutive stops in the selected
          trip pattern. These are geographic connections
          between stops, not surveyed road alignments.
        </p>

        {loading ? (
          <div className="empty-state">
            Loading BEST network…
          </div>
        ) : (
          <div
            ref={mapContainerRef}
            style={{
              width: "100%",
              height: 480,
              marginTop: 12,
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              overflow: "hidden",
              zIndex: 0
            }}
          />
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Simulated Stop Failure</h2>

        <p className="muted">
          Select a recorded stop to simulate flooding,
          an accident or another temporary closure.
        </p>

        <div className="controls-row" style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12
        }}>
          <select
            value={selectedStopId}
            onChange={e => setSelectedStopId(e.target.value)}
            disabled={!tripStops.length}
          >
            <option value="">Select affected stop</option>
            {tripStops.map((stop, index) => (
              <option
                key={`${stop.stop_id}-${index}`}
                value={stop.stop_id}
              >
                {index + 1}. {stop.stop_name}
              </option>
            ))}
          </select>

          <button
            className="btn danger"
            disabled={!selectedStopId || loading}
            onClick={simulateFailure}
          >
            Simulate Stop Failure
          </button>

          <button
            className="btn"
            disabled={!blockedStopId}
            onClick={restoreNetwork}
          >
            Restore Stop
          </button>
        </div>

        {blockedStopId && (
          <div style={{ marginTop: 18 }}>
            <span className="pill fail">
              ● Simulated stop unavailable
            </span>

            <p style={{ marginTop: 12 }}>
              <strong>Affected stop:</strong>{" "}
              {stopLookup.get(String(blockedStopId))?.stop_name ||
                blockedStopId}
            </p>

            <p>
              <strong>Affected BEST routes:</strong>{" "}
              {affectedRoutes.length}
            </p>

            <div style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8
            }}>
              {affectedRoutes.slice(0, 20).map(routeId => (
                <span key={routeId} className="pill warn">
                  {routeLookup.get(String(routeId))
                    ?.route_short_name || routeId}
                </span>
              ))}
            </div>

            {affectedRoutes.length > 20 && (
              <p className="muted">
                Showing the first 20 affected routes.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Network Analysis</h2>

        <p>
          <strong>Selected trip stops:</strong>{" "}
          {tripStops.length}
        </p>

        <p>
          <strong>Recorded consecutive connections:</strong>{" "}
          {Math.max(0, tripStops.length - 1)}
        </p>

        <p>
          <strong>Simulation status:</strong>{" "}
          {blockedStopId
            ? "One stop blocked in the routing model"
            : "No stop blocked in this view"}
        </p>

        <p className="muted" style={{
          marginTop: 12,
          fontSize: 12
        }}>
          Stop failures are simulated locally. The map
          shows recorded stop sequences; it does not
          prove that vehicles can physically divert
          along an alternative road.
        </p>
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
// Dependency-free charts: no Chart.js canvas lifecycle or CDN requirement.
function BarChart({ labels, values, label, color }) {
  const nums = values.map(v => Number(v) || 0);
  const max = Math.max(1, ...nums);
  if (!labels.length) return <div className="empty-state">No data available.</div>;
  return <div style={{display:"grid",gap:12,padding:"12px 0"}} aria-label={label}>
    {labels.map((name,i) => <div key={i} style={{display:"grid",gridTemplateColumns:"minmax(85px, 1fr) 3fr 38px",alignItems:"center",gap:10,fontSize:12}}>
      <span style={{overflowWrap:"anywhere"}}>{name}</span>
      <div style={{height:16,background:"#e3e8f0",borderRadius:5,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.max(0,nums[i])/max*100}%`,background:color,borderRadius:5}} /></div>
      <strong>{nums[i]}</strong>
    </div>)}
  </div>;
}
function DoughnutChart({ labels, values, colors }) {
  const nums = values.map(v => Math.max(0, Number(v) || 0));
  const total = nums.reduce((a,b)=>a+b,0);
  return <div style={{display:"grid",gap:12,padding:"12px 0"}}>
    {labels.map((name,i) => <div key={i} style={{display:"flex",alignItems:"center",gap:10,fontSize:13}}>
      <span style={{width:12,height:12,borderRadius:3,background:colors[i%colors.length],flexShrink:0}} />
      <span style={{flex:1}}>{name}</span><strong>{nums[i]}</strong><span style={{color:"#6b7789",minWidth:42,textAlign:"right"}}>{total ? Math.round(nums[i]/total*100) : 0}%</span>
    </div>)}
  </div>;
}

function NetworkStatistics() {
  const [buses, busesError, reloadBuses] = usePolling(Api.buses, []);
  const [routes, routesError, reloadRoutes] = usePolling(Api.routes, []);
  const [network, networkError, reloadNetwork] = usePolling(Api.network, []);
  const [incidents, incidentsError, reloadIncidents] = usePolling(Api.incidents, []);
  const error = busesError || routesError || networkError || incidentsError;
  if (error) return <div className="panel"><h2>Network Statistics unavailable</h2><p>Cannot load simulation data from the Render API: {error}</p><p>The original network statistics require the FastAPI backend. The Mumbai BEST Explorer can run without it.</p><button className="btn" onClick={() => {reloadBuses();reloadRoutes();reloadNetwork();reloadIncidents();}}>Retry</button></div>;
  if (!buses || !routes || !network || !incidents) return <div className="empty-state">Loading statistics from simulation backend…</div>;

  const busLabels = buses.map((b) => b.bus_id);
  const busDelays = buses.map((b) => b.delay_minutes);

  const routeStatusCounts = {
    Available: routes.filter((r) => r.available).length,
    Blocked: routes.filter((r) => !r.available).length,
  };

  const linkStatusCounts = {
    Up: (network.links || []).filter((l) => l.status === "up").length,
    Degraded: (network.links || []).filter((l) => l.status === "degraded").length,
    Down: (network.links || []).filter((l) => l.status === "down").length,
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

function BestExplorerPage() {
  return <div className="panel" style={{padding:0,overflow:"hidden"}}>
    <iframe title="Mumbai BEST route and stop explorer" src="best-explorer.html" style={{width:"100%",height:"min(1100px, 82vh)",minHeight:650,border:0,display:"block"}} />
  </div>;
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
          {tab === "best" && <BestExplorerPage />}
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
