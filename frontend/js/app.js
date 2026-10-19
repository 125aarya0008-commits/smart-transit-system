
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

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
      originalIds.every((id, i) => id === alternativeIds[i]);

    return {
      changed: !sameSequence,
      skippedStops,
      newStops,
      distanceDifference:
        alternative.distance_km - original.distance_km
    };
  }, [original, alternative]);

  useEffect(() => {
    let active = true;

    BestData.getRoutes()
      .then(data => {
        if (!active) return;
        const available = data.filter(
          r => r.trip_pattern_count > 0
        );
        setRoutes(available);
        if (available.length) {
          setRouteId(available[0].route_id);
        }
      })
      .catch(e => {
        if (active) setError(e.message);
      });

    return () => {
      active = false;
      BestRouting.reset();
    };
  }, []);

  useEffect(() => {
    let active = true;

    setDetails(null);
    setIncident(null);
    setOriginal(null);
    setAlternative(null);
    setBlockedId("");
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

    return () => {
      active = false;
    };
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
    setBlockedId("");
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
    if (!original) {
      setError("Calculate the original journey first.");
      return;
    }

    if (!blockedId) {
      setError("Select a disrupted stop.");
      return;
    }

    if (
      blockedId === sourceId ||
      blockedId === destinationId
    ) {
      setError(
        "The disrupted stop must be an intermediate stop."
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
        throw new Error("No original journey found.");
      }

      if (!before.stops.some(s => s.stop_id === blockedId)) {
        throw new Error(
          "The selected stop is not on the original path."
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

      const disruptedStop = before.stops.find(
        s => s.stop_id === blockedId
      );

      setIncident({
        ...disruption,
        type: incidentType,
        stop_name: disruptedStop?.stop_name || blockedId
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
    setBlockedId("");
    setError("");
  }

  function RouteVisualization() {
    const originalStops = original?.stops || [];
    const alternativeStops = alternative?.stops || [];
    const all = [...originalStops, ...alternativeStops];

    if (!all.length) {
      return (
        <div className="empty-state">
          Calculate a journey to view its route map.
        </div>
      );
    }

    const minLat = Math.min(...all.map(s => s.lat));
    const maxLat = Math.max(...all.map(s => s.lat));
    const minLon = Math.min(...all.map(s => s.lon));
    const maxLon = Math.max(...all.map(s => s.lon));

    const width = 800;
    const height = 440;
    const pad = 35;

    const latRange = Math.max(maxLat - minLat, 0.0001);
    const lonRange = Math.max(maxLon - minLon, 0.0001);
    const centerLat = (minLat + maxLat) / 2;

    const longitudeScale = Math.max(
      0.1,
      Math.cos(centerLat * Math.PI / 180)
    );

    const xRange = lonRange * longitudeScale;
    const yRange = latRange;

    const scale = Math.min(
      (width - pad * 2) / xRange,
      (height - pad * 2) / yRange
    );

    const usedWidth = xRange * scale;
    const usedHeight = yRange * scale;
    const offsetX = (width - usedWidth) / 2;
    const offsetY = (height - usedHeight) / 2;

    const point = s => ({
      x: offsetX +
        (s.lon - minLon) * longitudeScale * scale,
      y: height - offsetY -
        (s.lat - minLat) * scale
    });

    const line = items =>
      items.map(s => {
        const p = point(s);
        return `${p.x},${p.y}`;
      }).join(" ");

    const start = point(originalStops[0]);
    const end = point(
      originalStops[originalStops.length - 1]
    );

    const blockedStop = incident
      ? originalStops.find(
          s => s.stop_id === incident.stop_id
        )
      : null;

    return (
      <div>
        <div
          className="controls-row"
          style={{ marginBottom: 10 }}
        >
          <span style={{ color: "#2563eb" }}>
            ● Original journey
          </span>

          {incident && (
            <span style={{ color: "#16a34a" }}>
              ● Alternative journey
            </span>
          )}

          {incident && (
            <span style={{ color: "#dc2626" }}>
              ✕ Disrupted stop
            </span>
          )}
        </div>

        <svg
          viewBox="0 0 800 440"
          style={{
            width: "100%",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 12
          }}
        >
          <polyline
            points={line(originalStops)}
            fill="none"
            stroke="#2563eb"
            strokeWidth="3"
            strokeDasharray={incident ? "6 5" : "none"}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {alternativeStops.length > 0 && (
            <polyline
              points={line(alternativeStops)}
              fill="none"
              stroke="#16a34a"
              strokeWidth="4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {originalStops.map((s, i) => {
            const p = point(s);
            return (
              <circle
                key={`original-${i}`}
                cx={p.x}
                cy={p.y}
                r="2.5"
                fill="#2563eb"
              >
                <title>{s.stop_name}</title>
              </circle>
            );
          })}

          {blockedStop && (() => {
            const p = point(blockedStop);
            return (
              <g>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="10"
                  fill="#fee2e2"
                  stroke="#dc2626"
                  strokeWidth="2"
                />
                <text
                  x={p.x}
                  y={p.y + 4}
                  textAnchor="middle"
                  fontSize="13"
                  fill="#dc2626"
                  fontWeight="bold"
                >
                  ×
                </text>
              </g>
            );
          })()}

          <circle
            cx={start.x}
            cy={start.y}
            r="7"
            fill="#16a34a"
            stroke="white"
            strokeWidth="2"
          />

          <circle
            cx={end.x}
            cy={end.y}
            r="7"
            fill="#dc2626"
            stroke="white"
            strokeWidth="2"
          />
        </svg>

        <p className="muted" style={{ fontSize: 11 }}>
          Geographic visualization of recorded BEST stop
          connections. Lines are straight between stops,
          not surveyed road geometry.
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

        <div
          className="grid grid-4"
          style={{ marginTop: 16 }}
        >
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
              {incident ? 1 : 0}
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
                <option
                  key={r.route_id}
                  value={r.route_id}
                >
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
                  <option
                    key={p.trip_id || i}
                    value={i}
                  >
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
            onChange={e => {
              setSourceId(e.target.value);
              setOriginal(null);
              setAlternative(null);
              setIncident(null);
              setBlockedId("");
              BestRouting.reset();
            }}
            style={{ width: "100%", padding: 10 }}
          >
            {stops.map((s, i) => (
              <option
                key={`${s.stop_id}-${i}`}
                value={s.stop_id}
              >
                {i + 1}. {s.stop_name}
              </option>
            ))}
          </select>

          <p style={{ marginTop: 12 }}>
            Destination Stop
          </p>

          <select
            value={destinationId}
            onChange={e => {
              setDestinationId(e.target.value);
              setOriginal(null);
              setAlternative(null);
              setIncident(null);
              setBlockedId("");
              BestRouting.reset();
            }}
            style={{ width: "100%", padding: 10 }}
          >
            {stops.map((s, i) => (
              <option
                key={`${s.stop_id}-${i}`}
                value={s.stop_id}
              >
                {i + 1}. {s.stop_name}
              </option>
            ))}
          </select>

          <button
            className="btn"
            style={{ marginTop: 14 }}
            disabled={
              busy ||
              !stops.length ||
              sourceId === destinationId
            }
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

          <p style={{ marginTop: 12 }}>
            Incident Type
          </p>

          <select
            value={incidentType}
            onChange={e =>
              setIncidentType(e.target.value)
            }
            style={{ width: "100%", padding: 10 }}
          >
            <option value="flood">Flood</option>
            <option value="accident">Road Accident</option>
          </select>

          <div
            className="controls-row"
            style={{ marginTop: 16 }}
          >
            <button
              className="btn"
              disabled={busy || !original || !blockedId}
              onClick={simulateIncident}
            >
              {busy
                ? "Calculating..."
                : "Simulate & Reroute"}
            </button>

            <button
              className="btn"
              disabled={busy}
              onClick={restore}
            >
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
                <span className="k">
                  Original Distance
                </span>
                <span className="v">
                  {original.distance_km} km
                </span>
              </div>

              <div className="detail-row">
                <span className="k">
                  Original Stops
                </span>
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
                Disrupted stop:{" "}
                <strong>{incident.stop_name}</strong>
              </p>

              <div className="detail-row">
                <span className="k">
                  Affected Routes
                </span>
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
                  <h3>
                    Original vs Alternative Comparison
                  </h3>

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
                    <span className="k">
                      Original Stops
                    </span>
                    <span className="v">
                      {original.stops.length}
                    </span>
                  </div>

                  <div className="detail-row">
                    <span className="k">
                      Alternative Stops
                    </span>
                    <span className="v">
                      {alternative.stops.length}
                    </span>
                  </div>

                  <div className="detail-row">
                    <span className="k">
                      Skipped Stops
                    </span>
                    <span className="v">
                      {routeComparison.skippedStops.length}
                    </span>
                  </div>

                  <div className="detail-row">
                    <span className="k">
                      New Stops
                    </span>
                    <span className="v">
                      {routeComparison.newStops.length}
                    </span>
                  </div>

                  <div className="detail-row">
                    <span className="k">
                      Distance Difference
                    </span>
                    <span className="v">
                      {routeComparison.distanceDifference.toFixed(2)} km
                    </span>
                  </div>

                  <h3 style={{ marginTop: 14 }}>
                    Skipped Stops
                  </h3>

                  {routeComparison.skippedStops.length === 0 ? (
                    <p className="muted">None</p>
                  ) : (
                    <ul>
                      {routeComparison.skippedStops.map(s => (
                        <li key={s.stop_id}>
                          {s.stop_name}
                        </li>
                      ))}
                    </ul>
                  )}

                  <h3 style={{ marginTop: 14 }}>
                    Newly Used Stops
                  </h3>

                  {routeComparison.newStops.length === 0 ? (
                    <p className="muted">None</p>
                  ) : (
                    <ul>
                      {routeComparison.newStops.map(s => (
                        <li key={s.stop_id}>
                          {s.stop_name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {alternative ? (
                <>
                  <div className="detail-row">
                    <span className="k">
                      Alternative Distance
                    </span>
                    <span className="v">
                      {alternative.distance_km} km
                    </span>
                  </div>

                  <div className="detail-row">
                    <span className="k">
                      Distance Difference
                    </span>
                    <span className="v">
                      {(
                        alternative.distance_km -
                        original.distance_km
                      ).toFixed(2)} km
                    </span>
                  </div>

                  <div className="detail-row">
                    <span className="k">
                      Alternative Stops
                    </span>
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
                    <div
                      className="detail-row"
                      key={id}
                    >
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

      <div
        className="panel"
        style={{ marginTop: 16 }}
      >
        <h2>5. BEST Route Visualization</h2>
        <RouteVisualization />
      </div>
    </div>
  );
}
