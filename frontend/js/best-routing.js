
/*
 * Mumbai BEST stop-network routing engine
 * Uses actual GTFS-derived route patterns.
 * No backend or database required.
 *
 * Distances are geographic estimates, NOT travel times.
 * Disruptions are simulations.
 */

(function () {
  "use strict";

  let graphPromise = null;
  const blockedStops = new Set();
  const blockedEdges = new Set();

  const edgeKey = (a, b) => `${a}|${b}`;

  function distanceKm(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.stop_lat - a.stop_lat) * rad;
    const dLon = (b.stop_lon - a.stop_lon) * rad;

    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.stop_lat * rad) *
      Math.cos(b.stop_lat * rad) *
      Math.sin(dLon / 2) ** 2;

    return 6371 * 2 * Math.asin(
      Math.sqrt(Math.min(1, h))
    );
  }

  async function buildGraph() {
    const data = await BestData.load();
    const adjacency = new Map();
    const routesByEdge = new Map();
    const routesByStop = new Map();

    for (const stop of data.stops) {
      adjacency.set(stop.stop_id, []);
    }

    for (const trip of data.trips) {
      const ids = trip.stop_ids || [];

      for (const id of ids) {
        if (!routesByStop.has(id)) {
          routesByStop.set(id, new Set());
        }
        routesByStop.get(id).add(trip.route_id);
      }

      for (let i = 0; i < ids.length - 1; i++) {
        const from = ids[i];
        const to = ids[i + 1];

        if (from === to) continue;

        const a = data.stopsById.get(from);
        const b = data.stopsById.get(to);

        if (!a || !b) continue;

        const key = edgeKey(from, to);

        // Directed connection: follow the recorded
        // order of stops in each BEST trip pattern.
        adjacency.get(from).push({
          to,
          route_id: trip.route_id,
          distance_km: Math.max(
            0.001,
            distanceKm(a, b)
          )
        });

        if (!routesByEdge.has(key)) {
          routesByEdge.set(key, new Set());
        }

        routesByEdge.get(key).add(trip.route_id);
      }
    }

    return {
      data,
      adjacency,
      routesByEdge,
      routesByStop
    };
  }

  function load() {
    if (!graphPromise) {
      graphPromise = buildGraph().catch(error => {
        graphPromise = null;
        throw error;
      });
    }

    return graphPromise;
  }

  // Min-heap for efficient Dijkstra search
  class MinHeap {
    constructor() {
      this.items = [];
    }

    push(item) {
      const a = this.items;
      a.push(item);
      let i = a.length - 1;

      while (i > 0) {
        const p = Math.floor((i - 1) / 2);
        if (a[p].cost <= a[i].cost) break;

        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    }

    pop() {
      const a = this.items;
      if (!a.length) return null;

      const result = a[0];
      const last = a.pop();

      if (a.length) {
        a[0] = last;
        let i = 0;

        while (true) {
          let m = i;
          const l = i * 2 + 1;
          const r = l + 1;

          if (
            l < a.length &&
            a[l].cost < a[m].cost
          ) m = l;

          if (
            r < a.length &&
            a[r].cost < a[m].cost
          ) m = r;

          if (m === i) break;

          [a[m], a[i]] = [a[i], a[m]];
          i = m;
        }
      }

      return result;
    }

    get size() {
      return this.items.length;
    }
  }

  async function findRoute(sourceId, destinationId) {
    const graph = await load();
    const { data, adjacency } = graph;

    if (
      !adjacency.has(sourceId) ||
      !adjacency.has(destinationId)
    ) {
      throw new Error("Unknown BEST stop ID");
    }

    if (
      blockedStops.has(sourceId) ||
      blockedStops.has(destinationId)
    ) {
      return null;
    }

    const distances = new Map([[sourceId, 0]]);
    const previous = new Map();
    const queue = new MinHeap();

    queue.push({ id: sourceId, cost: 0 });

    while (queue.size) {
      const current = queue.pop();

      if (
        current.cost >
        (distances.get(current.id) ?? Infinity)
      ) continue;

      if (current.id === destinationId) break;

      for (const edge of adjacency.get(current.id)) {
        if (blockedStops.has(edge.to)) continue;

        if (
          blockedEdges.has(
            edgeKey(current.id, edge.to)
          )
        ) continue;

        const nextCost =
          current.cost + edge.distance_km;

        if (
          nextCost <
          (distances.get(edge.to) ?? Infinity)
        ) {
          distances.set(edge.to, nextCost);

          previous.set(edge.to, {
            from: current.id,
            route_id: edge.route_id
          });

          queue.push({
            id: edge.to,
            cost: nextCost
          });
        }
      }
    }

    if (!distances.has(destinationId)) {
      return null;
    }

    const stopIds = [destinationId];
    const segments = [];

    let cursor = destinationId;

    while (cursor !== sourceId) {
      const step = previous.get(cursor);
      if (!step) return null;

      segments.unshift({
        from: step.from,
        to: cursor,
        route_id: step.route_id
      });

      cursor = step.from;
      stopIds.unshift(cursor);
    }

    return {
      source_id: sourceId,
      destination_id: destinationId,

      distance_km: +distances
        .get(destinationId)
        .toFixed(2),

      stops: stopIds.map(id => {
        const stop = data.stopsById.get(id);

        return {
          stop_id: id,
          stop_name: stop.stop_name,
          lat: stop.stop_lat,
          lon: stop.stop_lon
        };
      }),

      segments: segments.map(s => ({
        ...s,
        route_short_name:
          data.routesById.get(s.route_id)
            ?.route_short_name || s.route_id
      })),

      note:
        "Shortest geographic-distance path on " +
        "recorded BEST stop connections. " +
        "Not a live ETA or verified available journey."
    };
  }

  async function blockStop(stopId) {
    const graph = await load();

    if (!graph.data.stopsById.has(stopId)) {
      throw new Error("Unknown BEST stop");
    }

    blockedStops.add(stopId);

    return {
      stop_id: stopId,
      affected_routes: [
        ...(graph.routesByStop.get(stopId) || [])
      ]
    };
  }

  async function blockConnection(from, to) {
    const graph = await load();
    const key = edgeKey(from, to);

    if (!graph.routesByEdge.has(key)) {
      throw new Error(
        "No recorded directed BEST connection"
      );
    }

    blockedEdges.add(key);

    return {
      from,
      to,
      affected_routes: [
        ...graph.routesByEdge.get(key)
      ]
    };
  }

  function restoreStop(id) {
    blockedStops.delete(id);
  }

  function restoreConnection(from, to) {
    blockedEdges.delete(edgeKey(from, to));
  }

  function reset() {
    blockedStops.clear();
    blockedEdges.clear();
  }

  function getDisruptions() {
    return {
      blocked_stops: [...blockedStops],
      blocked_connections: [...blockedEdges]
    };
  }

  window.BestRouting = {
    load,
    findRoute,
    blockStop,
    blockConnection,
    restoreStop,
    restoreConnection,
    reset,
    getDisruptions
  };
})();
