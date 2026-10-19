
/*
 * Mumbai BEST data loader
 * Loads actual route, stop and trip-pattern records.
 * No FastAPI or PostgreSQL required.
 */

(function () {
  "use strict";

  const DATA_URL = "data/best-optimized.json";

  let datasetPromise = null;

  function load() {
    if (!datasetPromise) {
      datasetPromise = fetch(DATA_URL)
        .then(response => {
          if (!response.ok) {
            throw new Error(
              `BEST dataset failed to load: ${response.status}`
            );
          }
          return response.json();
        })
        .then(data => {
          if (
            !Array.isArray(data.routes) ||
            !Array.isArray(data.stops) ||
            !Array.isArray(data.trips)
          ) {
            throw new Error("Invalid BEST dataset structure");
          }

          const stopsById = new Map(
            data.stops.map(stop => [
              stop.stop_id,
              {
                ...stop,
                stop_lat: Number(stop.stop_lat),
                stop_lon: Number(stop.stop_lon)
              }
            ])
          );

          const routesById = new Map(
            data.routes.map(route => [
              route.route_id,
              route
            ])
          );

          const tripsByRoute = new Map();

          for (const trip of data.trips) {
            if (!tripsByRoute.has(trip.route_id)) {
              tripsByRoute.set(trip.route_id, []);
            }
            tripsByRoute.get(trip.route_id).push(trip);
          }

          return {
            metadata: data.metadata,
            stops: [...stopsById.values()],
            routes: data.routes,
            trips: data.trips,
            stopsById,
            routesById,
            tripsByRoute
          };
        })
        .catch(error => {
          datasetPromise = null;
          throw error;
        });
    }

    return datasetPromise;
  }

  async function getRoutes() {
    const data = await load();

    return data.routes.map(route => {
      const patterns =
        data.tripsByRoute.get(route.route_id) || [];

      return {
        ...route,
        trip_pattern_count: patterns.length,
        stop_count: patterns.length
          ? patterns[0].stop_ids.length
          : 0
      };
    });
  }

  async function getStops() {
    const data = await load();
    return data.stops;
  }

  async function getTrips() {
    const data = await load();
    return data.trips;
  }

  async function getRouteDetails(routeId) {
    const data = await load();
    const route = data.routesById.get(routeId);

    if (!route) return null;

    const patterns =
      data.tripsByRoute.get(routeId) || [];

    return {
      ...route,
      patterns: patterns.map(trip => ({
        ...trip,
        stops: trip.stop_ids
          .map(id => data.stopsById.get(id))
          .filter(Boolean)
      }))
    };
  }

  async function getSummary() {
    const data = await load();

    return {
      operator: data.metadata.operator,
      city: data.metadata.city,
      source: data.metadata.source,
      routes: data.routes.length,
      stops: data.stops.length,
      trip_patterns: data.trips.length
    };
  }

  window.BestData = {
    load,
    getRoutes,
    getStops,
    getTrips,
    getRouteDetails,
    getSummary
  };
})();
