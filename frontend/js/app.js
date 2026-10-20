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
  }, []);

  useEffect(() => {
    let active = true;

    setDetails(null);
    setIncident(null);
    setOriginal(null);
    setAlternative(null);
    setPatternIndex(0);

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

  if (blockedId === sourceId || blockedId === destinationId) {
    setError("Choose a stop other than the start or destination.");
    return;
  }

  setBusy(true);
  setError("");

  try {
    const existing = BestRouting.getDisruptions();
    const blocked = existing.blocked_stops || [];

    if (blocked.includes(blockedId)) {
      throw new Error(
        "This stop is already blocked. Select a different stop."
      );
    }

    // Calculate the current route with existing blockages.
    const before = await BestRouting.findRoute(
      sourceId,
      destinationId
    );

    if (!before) {
      throw new Error(
        "No connected journey is available with the existing disruptions."
      );
    }

    if (!before.stops.some(s => s.stop_id === blockedId)) {
      throw new Error(
        "Choose a stop on the current available journey."
      );
    }

    // Add another blockage without clearing previous incidents.
    const disruption = await BestRouting.blockStop(blockedId);

    const after = await BestRouting.findRoute(
      sourceId,
      destinationId
    );

    setOriginal(before);
    setAlternative(after);
    setBlockedId("");

    setIncident({
      ...disruption,
      type: incidentType,
      stop_name:
        before.stops.find(s => s.stop_id === blockedId)
          ?.stop_name || blockedId
    });

  } catch (e) {
    // Preserve earlier disruptions if a new simulation fails.
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
<div className="value">
  {window.BestRouting.getDisruptions().blocked_stops.length +
   window.BestRouting.getDisruptions().blocked_connections.length}
</div>
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
  value={blockedId}
  onChange={e => setBlockedId(e.target.value)}
  style={{ width: "100%", padding: 10 }}
  disabled={!original}
>
  <option value="">
    Select a stop to disrupt
  </option>

  {(alternative?.stops || original?.stops || [])
    .slice(1, -1)
    .filter(s =>
      !BestRouting.getDisruptions()
        .blocked_stops.includes(s.stop_id)
    )
    .map((s, i) => (
      <option
        key={`${s.stop_id}-${i}`}
        value={s.stop_id}
      >
        {s.stop_name}
      </option>
    ))}
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
  const nodes = [
    { id: "BUS", name: "BEST Bus Gateway", x: 90, y: 200, type: "bus" },
    { id: "R1", name: "Primary Router", x: 290, y: 85, type: "router" },
    { id: "R2", name: "Backup Router", x: 290, y: 315, type: "router" },
    { id: "R3", name: "Core Router", x: 490, y: 200, type: "router" },
    { id: "SW1", name: "Control Center Switch", x: 660, y: 200, type: "switch" },
    { id: "SRV", name: "Transit Server", x: 830, y: 125, type: "server" },
    { id: "DASH", name: "Monitoring Dashboard", x: 830, y: 275, type: "dashboard" }
  ];

  const links = [
    { id: "L1", from: "BUS", to: "R1", cost: 10, protocol: "IP" },
    { id: "L2", from: "BUS", to: "R2", cost: 20, protocol: "IP" },
    { id: "L3", from: "R1", to: "R3", cost: 10, protocol: "OSPF" },
    { id: "L4", from: "R2", to: "R3", cost: 10, protocol: "OSPF" },
    { id: "L5", from: "R1", to: "R2", cost: 30, protocol: "OSPF" },
    { id: "L6", from: "R3", to: "SW1", cost: 5, protocol: "Ethernet" },
    { id: "L7", from: "SW1", to: "SRV", cost: 5, protocol: "TCP/IP" },
    { id: "L8", from: "SW1", to: "DASH", cost: 5, protocol: "HTTPS" }
  ];

  const [failedLinks, setFailedLinks] = React.useState([]);
  const [selectedLink, setSelectedLink] = React.useState("L3");
  const [logs, setLogs] = React.useState([
    "Network initialized. All communication links operational."
  ]);

  const nodeLookup = React.useMemo(() => {
    return Object.fromEntries(nodes.map(n => [n.id, n]));
  }, []);

  const calculatePath = React.useCallback((start, destination) => {
    const distances = {};
    const previous = {};
    const visited = new Set();

    nodes.forEach(n => {
      distances[n.id] = Infinity;
      previous[n.id] = null;
    });

    distances[start] = 0;

    while (true) {
      let current = null;
      let bestDistance = Infinity;

      nodes.forEach(n => {
        if (!visited.has(n.id) && distances[n.id] < bestDistance) {
          current = n.id;
          bestDistance = distances[n.id];
        }
      });

      if (current === null) break;
      if (current === destination) break;

      visited.add(current);

      links.forEach(link => {
        if (failedLinks.includes(link.id)) return;

        let neighbor = null;

        if (link.from === current) neighbor = link.to;
        if (link.to === current) neighbor = link.from;

        if (!neighbor || visited.has(neighbor)) return;

        const candidate = distances[current] + link.cost;

        if (candidate < distances[neighbor]) {
          distances[neighbor] = candidate;
          previous[neighbor] = current;
        }
      });
    }

    if (!Number.isFinite(distances[destination])) {
      return { path: [], cost: Infinity };
    }

    const path = [];
    let current = destination;

    while (current !== null) {
      path.unshift(current);
      current = previous[current];
    }

    return { path, cost: distances[destination] };
  }, [failedLinks]);

  const routeToServer = React.useMemo(() => {
    return calculatePath("BUS", "SRV");
  }, [calculatePath]);

  const routeToDashboard = React.useMemo(() => {
    return calculatePath("BUS", "DASH");
  }, [calculatePath]);

  const activeLinkIds = React.useMemo(() => {
    const active = new Set();

    [routeToServer.path, routeToDashboard.path].forEach(path => {
      for (let i = 0; i < path.length - 1; i++) {
        const link = links.find(l =>
          (l.from === path[i] && l.to === path[i + 1]) ||
          (l.to === path[i] && l.from === path[i + 1])
        );

        if (link) active.add(link.id);
      }
    });

    return active;
  }, [routeToServer, routeToDashboard]);

  const addLog = message => {
    setLogs(prev => [
      `${new Date().toLocaleTimeString()} — ${message}`,
      ...prev
    ].slice(0, 12));
  };

  function simulateFailure() {
    if (!selectedLink || failedLinks.includes(selectedLink)) return;

    setFailedLinks(prev => [...prev, selectedLink]);
    addLog(
      `Link ${selectedLink} failed. Recalculating available paths.`
    );
  }

  function restoreLink() {
    if (!selectedLink) return;

    setFailedLinks(prev => prev.filter(id => id !== selectedLink));
    addLog(
      `Link ${selectedLink} restored. Recalculating available paths.`
    );
  }

  function restoreAll() {
    setFailedLinks([]);
    addLog("All communication links restored.");
  }

  const protocols = [
    ["IP", "Logical addressing and packet forwarding"],
    ["TCP", "Reliable communication for control messages"],
    ["UDP", "Lightweight transmission of simulated bus telemetry"],
    ["HTTP/HTTPS", "Communication between dashboard and application server"],
    ["OSPF", "Proposed dynamic routing protocol for the router network"],
    ["ICMP", "Connectivity and reachability testing"],
    ["ARP", "IPv4-to-MAC resolution on local Ethernet segments"],
    ["Ethernet", "Wired communication between local network devices"]
  ];

  const operationalLinks = links.length - failedLinks.length;
  const connected = routeToServer.path.length > 0;

  function nodeFill(type) {
    if (type === "bus") return "#dbeafe";
    if (type === "router") return "#e0f2fe";
    if (type === "switch") return "#fef3c7";
    if (type === "server") return "#dcfce7";
    return "#ede9fe";
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Smart Transit Communication Network Topology</h2>
        <p className="muted">
          Hybrid star and partial-mesh architecture with
          redundant communication paths, simulated link
          failures and automatic shortest-path recalculation.
        </p>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="panel stat ok">
          <div className="label">NETWORK DEVICES</div>
          <div className="value">{nodes.length}</div>
          <div className="label muted">Logical simulation nodes</div>
        </div>

        <div className="panel stat">
          <div className="label">OPERATIONAL LINKS</div>
          <div className="value">
            {operationalLinks}/{links.length}
          </div>
          <div className="label muted">Available connections</div>
        </div>

        <div className="panel stat fail">
          <div className="label">FAILED LINKS</div>
          <div className="value">{failedLinks.length}</div>
          <div className="label muted">Simulated failures</div>
        </div>

        <div className="panel stat warn">
          <div className="label">SERVER CONNECTIVITY</div>
          <div className="value" style={{ fontSize: 22 }}>
            {connected ? "CONNECTED" : "OFFLINE"}
          </div>
          <div className="label muted">
            Based on calculated path
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Cisco-Style Network Topology</h2>
        <p className="muted">
          Green: selected communication path · Grey:
          available standby link · Red dashed: failed link
        </p>

        <div style={{ overflowX: "auto" }}>
          <svg
            viewBox="0 0 940 410"
            style={{ width: "100%", minWidth: 650 }}
          >
            {links.map(link => {
              const a = nodeLookup[link.from];
              const b = nodeLookup[link.to];

              const failed = failedLinks.includes(link.id);
              const active = activeLinkIds.has(link.id);

              const color = failed
                ? "#dc2626"
                : active
                  ? "#16a34a"
                  : "#94a3b8";

              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;

              return (
                <g key={link.id}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={color}
                    strokeWidth={active ? 5 : 3}
                    strokeDasharray={failed ? "8 6" : "none"}
                    opacity={failed ? 0.75 : 1}
                  />

                  <rect
                    x={mx - 25}
                    y={my - 12}
                    width="50"
                    height="22"
                    rx="6"
                    fill="#ffffff"
                    stroke="#e2e8f0"
                  />

                  <text
                    x={mx}
                    y={my + 3}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="600"
                    fill={color}
                  >
                    {link.id}
                  </text>
                </g>
              );
            })}

            {nodes.map(node => (
              <g key={node.id}>
                <rect
                  x={node.x - 55}
                  y={node.y - 24}
                  width="110"
                  height="48"
                  rx="9"
                  fill={nodeFill(node.type)}
                  stroke="#2563eb"
                  strokeWidth="2"
                />

                <text
                  x={node.x}
                  y={node.y - 3}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="700"
                  fill="#1e3a8a"
                >
                  {node.id}
                </text>

                <text
                  x={node.x}
                  y={node.y + 11}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#334155"
                >
                  {node.name}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="panel">
          <h2>Automatic Rerouting Simulation</h2>

          <p className="muted">
            Select a communication link and simulate its
            failure. The network automatically calculates
            another available path using Dijkstra's
            shortest-path algorithm.
          </p>

          <div className="controls-row" style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 14
          }}>
            <select
              value={selectedLink}
              onChange={e => setSelectedLink(e.target.value)}
            >
              {links.map(link => (
                <option key={link.id} value={link.id}>
                  {link.id}: {link.from} ↔ {link.to}
                </option>
              ))}
            </select>

            <button
              className="btn danger"
              disabled={failedLinks.includes(selectedLink)}
              onClick={simulateFailure}
            >
              Simulate Link Failure
            </button>

            <button
              className="btn"
              disabled={!failedLinks.includes(selectedLink)}
              onClick={restoreLink}
            >
              Restore Link
            </button>

            <button className="btn" onClick={restoreAll}>
              Restore All
            </button>
          </div>

          <div style={{ marginTop: 20 }}>
            <h3>Current Communication Path</h3>

            <p>
              <strong>Bus → Server:</strong>{" "}
              {routeToServer.path.length
                ? routeToServer.path.join(" → ")
                : "No available path"}
            </p>

            <p>
              <strong>Total routing cost:</strong>{" "}
              {Number.isFinite(routeToServer.cost)
                ? routeToServer.cost
                : "∞"}
            </p>

            <p>
              <strong>Bus → Dashboard:</strong>{" "}
              {routeToDashboard.path.length
                ? routeToDashboard.path.join(" → ")
                : "No available path"}
            </p>
          </div>
        </div>

        <div className="panel">
          <h2>Communication Link Status</h2>

          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Link</th>
                  <th>Connection</th>
                  <th>Cost</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {links.map(link => {
                  const failed = failedLinks.includes(link.id);

                  return (
                    <tr key={link.id}>
                      <td>{link.id}</td>
                      <td>{link.from} ↔ {link.to}</td>
                      <td>{link.cost}</td>
                      <td>
                        <span className={
                          failed ? "pill fail" : "pill ok"
                        }>
                          {failed ? "FAILED" : "UP"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="panel">
          <h2>Routing Event Log</h2>

          {logs.map((log, index) => (
            <p
              key={index}
              style={{
                padding: "9px 0",
                borderBottom: "1px solid #e2e8f0",
                fontSize: 12
              }}
            >
              {log}
            </p>
          ))}
        </div>

        <div className="panel">
          <h2>Network Routing Explanation</h2>

          <p>
            <strong>Normal operation:</strong> Communication
            follows the lowest-cost available path.
          </p>

          <p>
            <strong>Link failure:</strong> The failed link is
            removed from the simulated network graph.
          </p>

          <p>
            <strong>Automatic rerouting:</strong> Dijkstra's
            algorithm recalculates the shortest available
            communication path.
          </p>

          <p>
            <strong>Restoration:</strong> When the link becomes
            available again, the preferred path is recalculated.
          </p>

          <p className="muted" style={{ fontSize: 12 }}>
            This browser simulation illustrates a
            shortest-path routing concept. Real OSPF
            requires router configuration and exchanges
            routing information between network devices.
          </p>
        </div>
      </div>

      <div className="panel">
        <h2>Communication Protocols Used / Proposed</h2>
              
<div className="panel" style={{ marginTop: 16 }}>
  <h2>Cisco Packet Tracer — Verified OSPF Results</h2>

  <p className="muted">
    The communication topology was implemented and tested
    in Cisco Packet Tracer using four Cisco 2911 routers,
    two switches, two PCs, and one server.
  </p>

  <div className="grid grid-4" style={{ marginTop: 16 }}>
    <div className="panel stat ok">
      <div className="label">PACKETS SENT</div>
      <div className="value">4</div>
    </div>

    <div className="panel stat ok">
      <div className="label">PACKETS RECEIVED</div>
      <div className="value">4</div>
    </div>

    <div className="panel stat ok">
      <div className="label">PACKET LOSS</div>
      <div className="value">0%</div>
    </div>

    <div className="panel stat ok">
      <div className="label">OSPF FAILOVER</div>
      <div className="value" style={{ fontSize: 22 }}>
        VERIFIED
      </div>
    </div>
  </div>
          
<div className="panel" style={{ marginTop: 16 }}>
  <h2>Cisco Packet Tracer — Experiment Evidence Gallery</h2>

  <p className="muted">
    Actual simulation screenshots demonstrating network
    topology, OSPF routing, automatic failover and
    routing-table verification.
  </p>

  <div
    className="grid grid-2"
    style={{ marginTop: 18, gap: 18 }}
  >
    {[
      {
        title: "1. Network Topology",
        image: "assets/packet-tracer/01-network-topology.png",
        description:
          "Complete hybrid star and partial-mesh topology with four Cisco 2911 routers, two switches, two PCs and one server."
      },
      {
        title: "2. Primary Communication Route",
        image: "assets/packet-tracer/02-primary-route.png",
        description:
          "Traceroute confirming the primary OSPF path: GTW1 → PE → CORE → Server."
      },
      {
        title: "3. Automatic OSPF Rerouting",
        image: "assets/packet-tracer/03-automatic-rerouting.png",
        description:
          "After primary link failure, OSPF automatically selects GTW1 → GTW2 → CORE → Server."
      },
      {
        title: "4. OSPF Routing Verification",
        image: "assets/packet-tracer/04-ospf-verification.png",
        description:
          "OSPF neighbor relationships and routing table verification in Cisco Packet Tracer."
      }
    ].map((item, index) => (
      <div
        key={index}
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 14,
          background: "#ffffff"
        }}
      >
        <h3 style={{ marginBottom: 12 }}>
          {item.title}
        </h3>

        <a
          href={item.image}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src={item.image}
            alt={item.title}
            loading="lazy"
            style={{
              width: "100%",
              height: 240,
              objectFit: "contain",
              background: "#f8fafc",
              borderRadius: 8,
              border: "1px solid #e2e8f0"
            }}
          />
        </a>

        <p
          className="muted"
          style={{
            marginTop: 12,
            fontSize: 13,
            lineHeight: 1.6
          }}
        >
          {item.description}
        </p>
      </div>
    ))}
  </div>

  <p className="muted" style={{
    marginTop: 16,
    fontSize: 12
  }}>
    Click any screenshot to view the full-size
    Cisco Packet Tracer experiment evidence.
  </p>
</div>

  <h3 style={{ marginTop: 20 }}>Routing Test Results</h3>

  <div style={{ overflowX: "auto" }}>
    <table>
      <thead>
        <tr>
          <th>Test</th>
          <th>Communication Path</th>
          <th>Result</th>
        </tr>
      </thead>

      <tbody>
        <tr>
          <td>Normal operation</td>
          <td>GTW1 → PE → CORE → Server</td>
          <td><span className="pill ok">SUCCESS</span></td>
        </tr>

        <tr>
          <td>Primary link failure</td>
          <td>GTW1 → GTW2 → CORE → Server</td>
          <td><span className="pill ok">REROUTED</span></td>
        </tr>

        <tr>
          <td>Primary link restored</td>
          <td>GTW1 → PE → CORE → Server</td>
          <td><span className="pill ok">RESTORED</span></td>
        </tr>
      </tbody>
    </table>
  </div>

  <h3 style={{ marginTop: 20 }}>Packet Tracer Observations</h3>

  <p>
    <strong>Primary path:</strong> Traceroute confirmed
    communication through 192.168.10.1, 10.0.1.2,
    and 10.0.4.2.
  </p>

  <p>
    <strong>Backup path:</strong> After disabling the
    primary link, OSPF selected the alternative route
    through 192.168.10.1, 10.0.2.2, and 10.0.3.2.
  </p>

  <p>
    <strong>Recovery:</strong> After restoring the
    primary connection, OSPF returned traffic to
    the preferred route through PE.
  </p>

  <p className="muted" style={{ fontSize: 12 }}>
    Results obtained from Cisco Packet Tracer testing.
    This evidence is separate from the browser-based
    network simulation shown above.
  </p>
</div>


        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Protocol</th>
                <th>Purpose in Smart Transit System</th>
              </tr>
            </thead>

            <tbody>
              {protocols.map(([name, purpose]) => (
                <tr key={name}>
                  <td><strong>{name}</strong></td>
                  <td>{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="muted" style={{
          marginTop: 12,
          fontSize: 12
        }}>
          Protocol roles describe the proposed system
          architecture. The browser demo does not run
          actual OSPF, ICMP, ARP or router hardware.
        </p>
      </div>
    </div>
  );
}



// ---------------------------------------------------------------------------
// Incident Management
// ---------------------------------------------------------------------------


function IncidentManagement() {
  const [disruptions, setDisruptions] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [refreshCount, setRefreshCount] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;

    async function loadIncidents() {
      try {
        setLoading(true);
        setError("");

        if (!window.BestRouting) {
          throw new Error("BEST routing engine is unavailable.");
        }

        await window.BestRouting.load();

        const result = window.BestRouting.getDisruptions();

        if (!cancelled) {
        
const items = [
  ...(result.blocked_stops || []).map((stopId) => ({
    stopId: String(stopId),
    disruptionKind: "stop"
  })),
  ...(result.blocked_connections || []).map((edge) => ({
    edge,
    disruptionKind: "connection"
  }))
];


          setDisruptions(items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Unable to load incidents.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadIncidents();

    return () => {
      cancelled = true;
    };
  }, [refreshCount]);

  const refresh = () => {
    setRefreshCount((value) => value + 1);
  };

  const resetIncidents = async () => {
    if (!window.confirm(
      "Clear all simulated BEST route disruptions?"
    )) {
      return;
    }

    try {
      setBusy(true);
      window.BestRouting.reset();
      refresh();
    } catch (err) {
      setError(err.message || "Unable to reset disruptions.");
    } finally {
      setBusy(false);
    }
  };

 
const restoreIncident = async (item) => {
  try {
    setBusy(true);
    setError("");

    if (item.disruptionKind === "stop") {
      window.BestRouting.restoreStop(item.stopId);
    } else if (item.disruptionKind === "connection") {
      const edge = item.edge;

      if (typeof edge !== "string") {
        throw new Error(
          "Unsupported connection identifier format."
        );
      }

      throw new Error(
        "Connection restoration requires the edge-key format to be confirmed."
      );
    } else {
      throw new Error("Unknown disruption type.");
    }

    refresh();
  } catch (err) {
    setError(err.message || "Unable to resolve incident.");
  } finally {
    setBusy(false);
  }
};


  const stopIncidents = disruptions.filter(
    (item) => item.disruptionKind === "stop"
  );

  const connectionIncidents = disruptions.filter(
    (item) => item.disruptionKind === "connection"
  );

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>BEST Incident Management</h2>

        <p className="muted">
          Monitor and resolve simulated road disruptions
          affecting Mumbai BEST route calculations.
          Incidents shown here are simulation events,
          not live reports from BEST authorities.
        </p>
      </div>

      <div
        className="grid grid-4"
        style={{ marginBottom: 16 }}
      >
        <div className="panel stat">
          <div className="label">ACTIVE INCIDENTS</div>
          <div className="value">{disruptions.length}</div>
        </div>

        <div className="panel stat">
          <div className="label">BLOCKED STOPS</div>
          <div className="value">{stopIncidents.length}</div>
        </div>

        <div className="panel stat">
          <div className="label">BLOCKED CONNECTIONS</div>
          <div className="value">{connectionIncidents.length}</div>
        </div>

        <div className="panel stat ok">
          <div className="label">MODE</div>
          <div
            className="value"
            style={{ fontSize: 22 }}
          >
            SIMULATION
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Simulation Controls</h2>

        <p className="muted">
          Use Route Management to block a BEST stop
          or connection. Return here to inspect
          active disruptions and restore them.
        </p>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 14
          }}
        >
          <button
            className="btn"
            onClick={refresh}
            disabled={busy}
          >
            Refresh Incidents
          </button>

          <button
            className="btn danger"
            onClick={resetIncidents}
            disabled={busy || disruptions.length === 0}
          >
            Reset All Disruptions
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Active Incident Log</h2>

        {error && (
          <p style={{ color: "#b91c1c" }}>
            {error}
          </p>
        )}

        {loading ? (
          <div className="empty-state">
            Loading simulated disruptions…
          </div>
        ) : disruptions.length === 0 ? (
          <div className="empty-state">
            No active BEST route disruptions.

            <p>
              Simulate an accident, flood or blocked
              stop in Route Management, then return
              here and click Refresh Incidents.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Affected Stop / Connection</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {disruptions.map((item, index) => {
                  const isStop =
                    item.disruptionKind === "stop";

                  const description = isStop
                    ? (
                        item.stop_name ||
                        item.stop_id ||
                        item.stopId ||
                        item.id ||
                        "Blocked stop"
                      )
                    : (
                        String(
                          item.from_stop_id ||
                          item.from ||
                          "?"
                        ) +
                        " → " +
                        String(
                          item.to_stop_id ||
                          item.to ||
                          "?"
                        )
                      );

                  return (
                    <tr key={index}>
                      <td>
                        {isStop
                          ? "Blocked Stop"
                          : "Blocked Connection"}
                      </td>

                      <td>{description}</td>

                      <td>
                        <span
                          style={{
                            background: "#fef3c7",
                            color: "#92400e",
                            padding: "5px 10px",
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 600
                          }}
                        >
                          ACTIVE
                        </span>
                      </td>

                      <td>
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() =>
                            restoreIncident(item)
                          }
                        >
                          Resolve
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [routes, setRoutes] = React.useState([]);
  const [stops, setStops] = React.useState([]);
  const [trips, setTrips] = React.useState([]);
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;

    async function loadStatistics() {
      try {
        setLoading(true);
        setError("");

        if (!window.BestData) {
          throw new Error("BEST data library is unavailable.");
        }

        await window.BestData.load();

        const [routeData, stopData, tripData] =
          await Promise.all([
            window.BestData.getRoutes(),
            window.BestData.getStops(),
            window.BestData.getTrips()
          ]);

        if (cancelled) return;

        setRoutes(Array.isArray(routeData) ? routeData : []);
        setStops(Array.isArray(stopData) ? stopData : []);
        setTrips(Array.isArray(tripData) ? tripData : []);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Unable to load BEST data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadStatistics();

    return () => {
      cancelled = true;
    };
  }, []);

  const routeStatistics = React.useMemo(() => {
    return routes.map((route) => ({
      ...route,
      patternCount: Number(route.trip_pattern_count || 0),
      stopCount: Number(route.stop_count || 0)
    }));
  }, [routes]);

  const topRoutes = React.useMemo(() => {
    return [...routeStatistics]
      .sort((a, b) => b.stopCount - a.stopCount)
      .slice(0, 10);
  }, [routeStatistics]);

  const filteredRoutes = React.useMemo(() => {
    const query = search.trim().toLowerCase();

    return routeStatistics
      .filter((route) =>
        String(route.route_short_name || "")
          .toLowerCase()
          .includes(query) ||
        String(route.route_long_name || "")
          .toLowerCase()
          .includes(query)
      )
      .slice(0, 20);
  }, [routeStatistics, search]);

  const routesWithPatterns =
    routeStatistics.filter((route) => route.patternCount > 0).length;

  const totalPatterns = trips.length;

  if (loading) {
    return (
      <div className="empty-state">
        Loading Mumbai BEST network statistics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <h2>Unable to load network statistics</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Mumbai BEST — Network Statistics</h2>
        <p className="muted">
          Statistics calculated from the integrated Mumbai
          BEST route, stop and trip-pattern dataset.
          These are static transport-network records,
          not live vehicle telemetry.
        </p>
      </div>

      <div
        className="grid grid-4"
        style={{ marginBottom: 16 }}
      >
        <div className="panel stat ok">
          <div className="label">BEST ROUTES</div>
          <div className="value">{routes.length}</div>
        </div>

        <div className="panel stat ok">
          <div className="label">BUS STOPS</div>
          <div className="value">
            {stops.length.toLocaleString()}
          </div>
        </div>

        <div className="panel stat ok">
          <div className="label">TRIP PATTERNS</div>
          <div className="value">{totalPatterns}</div>
        </div>

        <div className="panel stat ok">
          <div className="label">ROUTES WITH PATTERNS</div>
          <div className="value">{routesWithPatterns}</div>
        </div>
      </div>

      <div
        className="grid grid-2"
        style={{ marginBottom: 16 }}
      >
        <div className="panel">
          <h2>Routes With Most Stops</h2>

          <p className="muted">
            Top 10 BEST routes by the stop count
            provided in the dataset.
          </p>

          {topRoutes.length > 0 ? (
            <BarChart
              labels={topRoutes.map(
                (r) => r.route_short_name
              )}
              values={topRoutes.map(
                (r) => r.stopCount
              )}
              label="Stops"
              color="#2563eb"
            />
          ) : (
            <div className="empty-state">
              No route statistics available.
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Trip Pattern Coverage</h2>

          <DoughnutChart
            labels={[
              "Routes with trip patterns",
              "Routes without trip patterns"
            ]}
            values={[
              routesWithPatterns,
              routes.length - routesWithPatterns
            ]}
            colors={["#2563eb", "#cbd5e1"]}
          />

          <p
            className="muted"
            style={{ fontSize: 12, marginTop: 12 }}
          >
            This chart shows dataset coverage,
            not live bus availability.
          </p>
        </div>
      </div>

      <div
        className="panel"
        style={{ marginBottom: 16 }}
      >
        <h2>BEST Route Statistics Explorer</h2>

        <p className="muted">
          Search actual BEST route records and compare
          their stop counts and trip-pattern coverage.
        </p>

        <input
          type="text"
          placeholder="Search BEST route number or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: 12,
            marginBottom: 16,
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            boxSizing: "border-box"
          }}
        />

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Route</th>
                <th>Route Description</th>
                <th>Stops</th>
                <th>Trip Patterns</th>
              </tr>
            </thead>

            <tbody>
              {filteredRoutes.map((route) => (
                <tr key={route.route_id}>
                  <td>
                    <strong>
                      {route.route_short_name}
                    </strong>
                  </td>

                  <td>
                    {route.route_long_name || "—"}
                  </td>

                  <td>{route.stopCount}</td>
                  <td>{route.patternCount}</td>
                </tr>
              ))}

              {filteredRoutes.length === 0 && (
                <tr>
                  <td colSpan="4">
                    No matching BEST routes found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p
          className="muted"
          style={{ marginTop: 12, fontSize: 12 }}
        >
          Showing up to 20 matching routes.
          Stop and trip-pattern counts come from
          the integrated BEST dataset.
        </p>
      </div>

      <div className="panel">
        <h2>Cisco Packet Tracer — Verified Network Results</h2>

        <p className="muted">
          These results were verified separately
          using the Cisco Packet Tracer OSPF experiment.
          They do not represent live BEST network health.
        </p>

        <div
          className="grid grid-4"
          style={{ marginTop: 16 }}
        >
          <div className="panel stat ok">
            <div className="label">ROUTERS</div>
            <div className="value">4</div>
          </div>

          <div className="panel stat ok">
            <div className="label">SWITCHES</div>
            <div className="value">2</div>
          </div>

          <div className="panel stat ok">
            <div className="label">PACKET LOSS</div>
            <div className="value">0%</div>
          </div>

          <div className="panel stat ok">
            <div className="label">OSPF FAILOVER</div>
            <div
              className="value"
              style={{ fontSize: 22 }}
            >
              VERIFIED
            </div>
          </div>
        </div>

        <h3 style={{ marginTop: 20 }}>
          Automatic Rerouting Verification
        </h3>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Network Condition</th>
                <th>Selected Communication Path</th>
                <th>Result</th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td>Normal operation</td>
                <td>GTW1 → PE → CORE → Server</td>
                <td>
                  <span className="pill ok">
                    SUCCESS
                  </span>
                </td>
              </tr>

              <tr>
                <td>Primary link failure</td>
                <td>GTW1 → GTW2 → CORE → Server</td>
                <td>
                  <span className="pill ok">
                    REROUTED
                  </span>
                </td>
              </tr>

              <tr>
                <td>Primary link restored</td>
                <td>GTW1 → PE → CORE → Server</td>
                <td>
                  <span className="pill ok">
                    RESTORED
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p
          className="muted"
          style={{ fontSize: 12, marginTop: 14 }}
        >
          Packet loss: 0% in the recorded
          four-packet connectivity tests.
          OSPF failover and restoration were
          confirmed through traceroute.
        </p>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Protocol reference page
// ---------------------------------------------------------------------------


const PROTOCOL_ROWS = [
  {
    layer: "Application",
    protocol: "HTTP / HTTPS",
    purpose: "Transfers dashboard pages, JavaScript, BEST data and API requests.",
    status: "Website",
    demonstration: "Access the deployed Smart Transit website through a browser."
  },
  {
    layer: "Application",
    protocol: "DNS",
    purpose: "Resolves the deployed website hostname to a network address.",
    status: "Website",
    demonstration: "Open the Render website using its domain name."
  },
  {
    layer: "Application",
    protocol: "MQTT",
    purpose: "Proposed lightweight messaging for bus location updates, emergency alerts and sensor telemetry.",
    status: "Proposed",
    demonstration: "Future integration with ESP32 or IoT bus devices and an MQTT broker."
  },
  {
    layer: "Application",
    protocol: "SNMP",
    purpose: "Proposed monitoring of router availability, interface status and network performance.",
    status: "Proposed",
    demonstration: "Future integration with network-management tools."
  },
  {
    layer: "Transport",
    protocol: "TCP",
    purpose: "Provides reliable transport for HTTP/HTTPS connections where TCP is used.",
    status: "Website",
    demonstration: "Can be inspected using browser network tools or Wireshark."
  },
  {
    layer: "Transport",
    protocol: "UDP",
    purpose: "Supports low-overhead datagram communication and DNS queries in applicable configurations.",
    status: "Reference",
    demonstration: "Can be studied through Wireshark or an additional Packet Tracer experiment."
  },
  {
    layer: "Network",
    protocol: "IPv4",
    purpose: "Provides logical addressing and packet forwarding between simulated network devices.",
    status: "Verified",
    demonstration: "Configured 192.168.x.x and 10.0.x.x networks in Cisco Packet Tracer."
  },
  {
    layer: "Network",
    protocol: "ICMP",
    purpose: "Tests connectivity between simulated buses, network gateways and the central server.",
    status: "Verified",
    demonstration: "Successful ping tests with 4/4 replies and 0% packet loss."
  },
  {
    layer: "Network",
    protocol: "OSPF",
    purpose: "Automatically recalculates router paths when the primary communication link fails.",
    status: "Verified",
    demonstration: "Primary route failed over to GTW2 and returned after restoration."
  },
  {
    layer: "Network / Data Link",
    protocol: "ARP",
    purpose: "Resolves IPv4 addresses to MAC addresses on local Ethernet networks.",
    status: "Implemented",
    demonstration: "Used by the IPv4 Ethernet topology; ARP packet capture has not been separately documented."
  },
  {
    layer: "Data Link",
    protocol: "Ethernet",
    purpose: "Connects routers, switches, PCs and the central server in the Packet Tracer topology.",
    status: "Verified",
    demonstration: "Four routers, two switches, two PCs and one server connected through wired interfaces."
  },
  {
    layer: "Data Link",
    protocol: "Wi-Fi",
    purpose: "Proposed wireless communication between buses and roadside access points.",
    status: "Proposed",
    demonstration: "Future Packet Tracer wireless-access-point extension."
  }
];

function ProtocolsPage() {
  const [filter, setFilter] = React.useState("All");

  const statusColors = {
    Verified: {
      background: "#dcfce7",
      color: "#166534"
    },
    Implemented: {
      background: "#dbeafe",
      color: "#1d4ed8"
    },
    Website: {
      background: "#dbeafe",
      color: "#1d4ed8"
    },
    Proposed: {
      background: "#fef3c7",
      color: "#92400e"
    },
    Reference: {
      background: "#f1f5f9",
      color: "#475569"
    }
  };

  const filteredProtocols = PROTOCOL_ROWS.filter(
    (item) => filter === "All" || item.status === filter
  );

  const verifiedCount = PROTOCOL_ROWS.filter(
    (item) => item.status === "Verified"
  ).length;

  const proposedCount = PROTOCOL_ROWS.filter(
    (item) => item.status === "Proposed"
  ).length;

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Smart Transit — Communication Protocol Stack</h2>

        <p className="muted">
          This section explains the communication protocols
          used in the Smart Transit system, the Cisco Packet
          Tracer experiment and proposed future extensions.
        </p>
      </div>

      <div
        className="grid grid-4"
        style={{ marginBottom: 16 }}
      >
        <div className="panel stat ok">
          <div className="label">PROTOCOLS DOCUMENTED</div>
          <div className="value">{PROTOCOL_ROWS.length}</div>
        </div>

        <div className="panel stat ok">
          <div className="label">EXPERIMENTALLY VERIFIED</div>
          <div className="value">{verifiedCount}</div>
        </div>

        <div className="panel stat">
          <div className="label">FUTURE INTEGRATIONS</div>
          <div className="value">{proposedCount}</div>
        </div>

        <div className="panel stat ok">
          <div className="label">OSPF FAILOVER</div>
          <div
            className="value"
            style={{ fontSize: 22 }}
          >
            VERIFIED
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Protocol Implementation Status</h2>

        <p className="muted" style={{ marginBottom: 16 }}>
          Verified means demonstrated in Packet Tracer.
          Website means used by the deployed web application.
          Implemented means present in the network configuration
          but not separately captured as evidence.
          Proposed means planned for future development.
          Reference means included for technical explanation.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 16
          }}
        >
          {[
            "All",
            "Verified",
            "Implemented",
            "Website",
            "Proposed",
            "Reference"
          ].map((option) => (
            <button
              key={option}
              className="btn"
              onClick={() => setFilter(option)}
              style={{
                background:
                  filter === option ? "#2563eb" : "#f1f5f9",
                color:
                  filter === option ? "#ffffff" : "#334155"
              }}
            >
              {option}
            </button>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>OSI / TCP-IP Layer</th>
                <th>Protocol</th>
                <th>Purpose in Smart Transit</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {filteredProtocols.map((item) => (
                <tr key={item.protocol}>
                  <td>{item.layer}</td>

                  <td>
                    <strong>{item.protocol}</strong>
                  </td>

                  <td style={{ fontFamily: "var(--sans)" }}>
                    {item.purpose}
                  </td>

                  <td>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "5px 10px",
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        ...(statusColors[item.status] || {})
                      }}
                    >
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}

              {filteredProtocols.length === 0 && (
                <tr>
                  <td colSpan="4">
                    No protocols in this category.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Protocol Demonstration and Evidence</h2>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Protocol</th>
                <th>Demonstration / Evidence</th>
              </tr>
            </thead>

            <tbody>
              {PROTOCOL_ROWS.map((item) => (
                <tr key={item.protocol}>
                  <td>
                    <strong>{item.protocol}</strong>
                  </td>

                  <td>{item.demonstration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>Verified OSPF Communication Scenario</h2>

        <p className="muted">
          The Cisco Packet Tracer experiment demonstrates
          automatic communication-path recovery after
          a simulated primary link failure.
        </p>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Packet Route</th>
                <th>Observation</th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td>Normal</td>
                <td>GTW1 → PE → CORE → Server</td>
                <td>Primary OSPF path selected</td>
              </tr>

              <tr>
                <td>Link failure</td>
                <td>GTW1 → GTW2 → CORE → Server</td>
                <td>Automatic backup path selected</td>
              </tr>

              <tr>
                <td>Recovery</td>
                <td>GTW1 → PE → CORE → Server</td>
                <td>Primary path restored</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p
          className="muted"
          style={{ marginTop: 12, fontSize: 12 }}
        >
          Connectivity tests showed 4 successful
          replies out of 4 packets during the
          recorded tests, with 0% packet loss.
          Traceroute confirmed the selected paths.
        </p>
      </div>
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
          {tab === "dashboard" && (
            <Dashboard goTo={setTab} />
          )}

          {tab === "buses" && <BusMonitoring />}

          {/* Keep Route Management mounted to preserve its state */}
          <div
            style={{
              display: tab === "routes" ? "block" : "none"
            }}
          >
            <RouteManagement />
          </div>

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

ReactDOM.createRoot(
  document.getElementById("root")
).render(<App />);
