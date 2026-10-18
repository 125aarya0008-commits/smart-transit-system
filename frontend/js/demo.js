
/* Smart Transit standalone four-zone simulation.
   Works without FastAPI or PostgreSQL. */

(function () {
  "use strict";

  const KEY = "smart-transit-demo-v1";
  const copy = x => JSON.parse(JSON.stringify(x));
  const now = () => new Date().toISOString();
  const plusMinutes = n =>
    new Date(Date.now() + n * 60000).toISOString();
  const Z = n => `Zone ${n}`;

  const routeSpecs = [
    [1, 2, 8.5, 16],
    [2, 3, 10.2, 19],
    [3, 4, 7.1, 14],
    [1, 3, 15.4, 27],
    [2, 4, 14.8, 26],
    [1, 4, 22, 38]
  ];

  const nodeSpecs = [
    ["R1", "Core", "core_router", 400, 60],
    ["R2", Z(1), "zone_router", 120, 220],
    ["R3", Z(2), "zone_router", 320, 220],
    ["R4", Z(3), "zone_router", 520, 220],
    ["R5", Z(4), "zone_router", 700, 220],
    ["SW1", Z(1), "switch", 120, 340],
    ["SW2", Z(2), "switch", 320, 340],
    ["SW3", Z(3), "switch", 520, 340],
    ["SW4", Z(4), "switch", 700, 340],
    ["SRV1", "Core", "server", 400, 400]
  ];

  const linkSpecs = [
    ["R1", "R2", "OSPF"],
    ["R1", "R3", "OSPF"],
    ["R1", "R4", "OSPF"],
    ["R1", "R5", "OSPF"],
    ["R2", "R3", "OSPF"],
    ["R3", "R5", "OSPF"],
    ["R4", "R5", "OSPF"],
    ["R2", "R4", "OSPF"],
    ["R2", "SW1", "Ethernet"],
    ["R3", "SW2", "Ethernet"],
    ["R4", "SW3", "Ethernet"],
    ["R5", "SW4", "Ethernet"],
    ["R1", "SRV1", "Ethernet"]
  ];

  const busSpecs = [
    ["BUS-101", "Zone1-Zone2", 1, 1, 2, 10, 10],
    ["BUS-205", "Zone2-Zone3-Zone4", 3, 2, 4, -2, 16],
    ["BUS-310", "Zone3-Zone4", 3, 3, 4, 20, 20],
    ["BUS-402", "Zone1-Zone3", 1, 1, 3, 35, 35],
    ["BUS-518", "Zone4-Zone3", 4, 4, 3, 5, 5],
    ["BUS-627", "Zone2-Zone1", 2, 2, 1, -8, 4]
  ];

  function initialState() {
    return {
      routes: routeSpecs.map(
        ([a, b, distance_km, base_travel_time_min]) => ({
          route_id: `${Z(a)}-${Z(b)}`,
          source: Z(a),
          destination: Z(b),
          distance_km,
          base_travel_time_min,
          available: true,
          road_status: "clear",
          network_status: "up",
          flood_status: "none",
          accident_status: "none"
        })
      ),

      nodes: nodeSpecs.map(
        ([node_id, zone, node_type, x, y]) => ({
          node_id,
          name: node_id,
          zone,
          node_type,
          x,
          y,
          status: "operational"
        })
      ),

      links: linkSpecs.map(
        ([source_node_id, dest_node_id, protocol]) => ({
          link_id: `${source_node_id}-${dest_node_id}`,
          source_node_id,
          dest_node_id,
          protocol,
          status: "up",
          packet_loss_pct: 0,
          bandwidth_mbps: protocol === "OSPF" ? 100 : 1000
        })
      ),

      buses: busSpecs.map(
        ([bus_id, route_label, zone, a, b, scheduled, estimated]) => ({
          bus_id,
          route_label,
          original_route: route_label,
          current_zone: Z(zone),
          source: Z(a),
          destination: Z(b),
          scheduled_arrival: plusMinutes(scheduled),
          estimated_arrival: plusMinutes(estimated),
          delay_minutes: Math.max(0, estimated - scheduled),
          status: estimated > scheduled ? "delayed" : "on_time",
          network_connection_status: "connected",
          current_incident: null,
          alternative_route: null
        })
      ),

      incidents: [],
      alerts: []
    };
  }

  let state;

  try {
    const saved = JSON.parse(localStorage.getItem(KEY));

    state =
      saved &&
      Array.isArray(saved.routes) &&
      Array.isArray(saved.links) &&
      Array.isArray(saved.buses)
        ? saved
        : initialState();
  } catch (_) {
    state = initialState();
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function alert(message, severity = "warning") {
    state.alerts.unshift({
      message,
      severity,
      created_at: now()
    });
  }

  function incident(
    incident_type,
    description,
    route_id = null,
    link_id = null
  ) {
    state.incidents.unshift({
      incident_type,
      description,
      route_id,
      link_id,
      status: "active",
      created_at: now()
    });
  }

  function resolve(type, id) {
    state.incidents.forEach(i => {
      if (i.status === "active" && i[type] === id) {
        i.status = "resolved";
      }
    });
  }

  // Dijkstra shortest-path algorithm
  function shortestPath(src, dst) {
    const nodes = [
      ...new Set(
        state.routes.flatMap(r => [r.source, r.destination])
      )
    ];

    if (!nodes.includes(src) || !nodes.includes(dst)) {
      return { path: null, minutes: null };
    }

    const dist = Object.fromEntries(
      nodes.map(n => [n, Infinity])
    );

    const prev = {};
    const remaining = new Set(nodes);

    dist[src] = 0;

    while (remaining.size) {
      const u = [...remaining].reduce(
        (a, b) => dist[a] <= dist[b] ? a : b
      );

      if (dist[u] === Infinity || u === dst) break;

      remaining.delete(u);

      for (const r of state.routes) {
        if (!r.available) continue;

        const v =
          r.source === u
            ? r.destination
            : r.destination === u
              ? r.source
              : null;

        if (!v || !remaining.has(v)) continue;

        const alt = dist[u] + r.base_travel_time_min;

        if (alt < dist[v]) {
          dist[v] = alt;
          prev[v] = u;
        }
      }
    }

    if (!Number.isFinite(dist[dst])) {
      return { path: null, minutes: null };
    }

    const path = [dst];

    while (path[0] !== src) {
      path.unshift(prev[path[0]]);
    }

    return { path, minutes: dist[dst] };
  }

  function busesAffected(r) {
    return state.buses.filter(b => {
      const name = b.original_route || b.route_label;
      const a = r.source.replace(" ", "");
      const c = r.destination.replace(" ", "");

      return (
        name.includes(`${a}-${c}`) ||
        name.includes(`${c}-${a}`) ||
        (b.source === r.source &&
          b.destination === r.destination) ||
        (b.source === r.destination &&
          b.destination === r.source)
      );
    });
  }

  function blockRoute(route_id, kind) {
    const r = state.routes.find(
      x => x.route_id === route_id
    );

    if (!r) {
      throw Error(`Unknown route: ${route_id}`);
    }

    if (!r.available) {
      throw Error(`Route already blocked: ${route_id}`);
    }

    r.available = false;
    r.road_status = "blocked";

    r[
      kind === "flood"
        ? "flood_status"
        : "accident_status"
    ] = kind === "flood" ? "flooded" : "accident";

    const alternative_path = shortestPath(
      r.source,
      r.destination
    );

    const affected_buses = busesAffected(r).map(b => {
      const old_route = b.route_label;

      const new_route = alternative_path.path
        ? alternative_path.path.join(" → ")
        : "No alternative";

      const added_delay_min =
        alternative_path.minutes === null
          ? 0
          : Math.max(
              0,
              alternative_path.minutes -
                r.base_travel_time_min
            );

      b.current_incident = `${kind} on ${route_id}`;
      b.alternative_route = new_route;
      b.route_label = new_route;

      b.status = alternative_path.path
        ? "rerouted"
        : "stopped";

      b.delay_minutes += added_delay_min;

      b.estimated_arrival = new Date(
        new Date(b.estimated_arrival).getTime() +
          added_delay_min * 60000
      ).toISOString();

      return {
        bus_id: b.bus_id,
        old_route,
        new_route,
        added_delay_min
      };
    });

    incident(
      kind,
      `${kind === "flood" ? "Flood" : "Accident"} reported on ${route_id}`,
      route_id
    );

    alert(
      `${route_id} blocked by ${kind}. ${affected_buses.length} simulated bus(es) affected.`,
      "critical"
    );

    save();

    return copy({
      route_id,
      status: "blocked",
      alternative_path,
      affected_buses
    });
  }

  function network() {
    const routers = state.nodes.filter(
      n => n.node_type.includes("router")
    );

    const switches = state.nodes.filter(
      n => n.node_type === "switch"
    );

    return copy({
      nodes: state.nodes,
      links: state.links,
      summary: {
        active_routers: routers.filter(
          n => n.status === "operational"
        ).length,

        active_switches: switches.filter(
          n => n.status === "operational"
        ).length,

        failed_links: state.links.filter(
          l => l.status === "down"
        ).length,

        avg_packet_loss_pct: +(
          state.links.reduce(
            (s, l) => s + l.packet_loss_pct,
            0
          ) / state.links.length
        ).toFixed(1)
      }
    });
  }

  function networkChange(link_id, failed) {
    const link = state.links.find(
      l => l.link_id === link_id
    );

    if (!link) {
      throw Error(`Unknown link: ${link_id}`);
    }

    link.status = failed ? "down" : "up";
    link.packet_loss_pct = failed ? 100 : 0;

    if (failed) {
      incident(
        "network_failure",
        `Communication link ${link_id} failed`,
        null,
        link_id
      );

      alert(
        `Network link ${link_id} failed (simulation)`,
        "critical"
      );
    } else {
      resolve("link_id", link_id);

      alert(
        `Network link ${link_id} restored`,
        "info"
      );
    }

    save();

    return copy({
      link_id,
      status: link.status
    });
  }

  // Functions consumed by the dashboard API layer
  const Demo = {
    buses: async () => copy(state.buses),

    bus: async id => {
      const b = state.buses.find(
        x => x.bus_id === id
      );

      if (!b) throw Error("Bus not found");

      return copy(b);
    },

    routes: async () => copy(state.routes),

    network: async () => network(),

    alerts: async () => copy(state.alerts),

    incidents: async () => copy(state.incidents),

    alternativeRoute: async (src, dst) =>
      copy(shortestPath(src, dst)),

    simulateFlood: async id =>
      blockRoute(id, "flood"),

    simulateAccident: async id =>
      blockRoute(id, "accident"),

    simulateNetworkFailure: async id =>
      networkChange(id, true),

    restoreNetwork: async id =>
      networkChange(id, false),

    simulateDelay: async (
      bus_id,
      extra_minutes
    ) => {
      const b = state.buses.find(
        x => x.bus_id === bus_id
      );

      if (!b) throw Error("Bus not found");

      const extra = Number(extra_minutes);

      if (!Number.isFinite(extra) || extra < 0) {
        throw Error("Invalid delay");
      }

      b.delay_minutes += extra;

      b.estimated_arrival = new Date(
        new Date(b.estimated_arrival).getTime() +
          extra * 60000
      ).toISOString();

      b.status = "delayed";

      incident(
        "delay",
        `${bus_id} delayed by ${extra} minutes`
      );

      alert(
        `${bus_id} delayed by ${extra} minutes`
      );

      save();

      return copy(b);
    },

    restoreRoute: async id => {
      const r = state.routes.find(
        x => x.route_id === id
      );

      if (!r) throw Error("Route not found");

      r.available = true;
      r.road_status = "clear";
      r.flood_status = "none";
      r.accident_status = "none";

      resolve("route_id", id);

      state.buses.forEach(b => {
        if (
          b.current_incident &&
          b.current_incident.endsWith(`on ${id}`)
        ) {
          b.current_incident = null;
          b.alternative_route = null;
          b.route_label = b.original_route;

          b.status = b.delay_minutes
            ? "delayed"
            : "on_time";
        }
      });

      alert(
        `Route ${id} restored`,
        "info"
      );

      save();

      return copy({
        route_id: id,
        status: "restored"
      });
    },

    resetSimulation: async () => {
      state = initialState();
      save();

      return { status: "reset" };
    }
  };

  window.Demo = Demo;
})();
