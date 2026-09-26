"""
Application-level routing engine.

Builds a weighted graph from the `routes` table (each row is an edge between
two zones) and runs Dijkstra's algorithm to find the shortest available path.
This mirrors, at the application layer, what OSPF does at the network layer
in the Cisco Packet Tracer topology: when an edge/link becomes unavailable,
recompute the shortest remaining path.
"""
import heapq
from collections import defaultdict
from sqlalchemy.orm import Session

from . import models


def build_graph(db: Session, ignore_unavailable: bool = True):
    """Return an adjacency list: {zone: [(neighbor_zone, weight_minutes, route_id), ...]}"""
    graph = defaultdict(list)
    routes = db.query(models.Route).all()
    for r in routes:
        if ignore_unavailable and not r.available:
            continue
        weight = r.base_travel_time_min
        # Congestion penalty for degraded (but still available) network links
        if r.network_status == "degraded":
            weight = int(weight * 1.3)
        graph[r.source].append((r.destination, weight, r.route_id))
        graph[r.destination].append((r.source, weight, r.route_id))
    return graph


def dijkstra(db: Session, source: str, destination: str):
    """Returns (path_zones, path_route_ids, total_minutes) or (None, None, None)."""
    graph = build_graph(db)

    distances = {source: 0}
    previous = {}
    visited = set()
    pq = [(0, source)]

    while pq:
        dist, node = heapq.heappop(pq)
        if node in visited:
            continue
        visited.add(node)
        if node == destination:
            break
        for neighbor, weight, route_id in graph.get(node, []):
            new_dist = dist + weight
            if neighbor not in distances or new_dist < distances[neighbor]:
                distances[neighbor] = new_dist
                previous[neighbor] = (node, route_id)
                heapq.heappush(pq, (new_dist, neighbor))

    if destination not in distances:
        return None, None, None

    # Reconstruct path
    path_zones = [destination]
    path_route_ids = []
    cur = destination
    while cur != source:
        prev_node, route_id = previous[cur]
        path_route_ids.append(route_id)
        path_zones.append(prev_node)
        cur = prev_node

    path_zones.reverse()
    path_route_ids.reverse()
    return path_zones, path_route_ids, distances[destination]


def find_alternative_route(db: Session, source: str, destination: str, blocked_route_id: str = None):
    """
    Compute the best available path from source to destination, optionally
    forcing a specific route_id to be treated as unavailable (used right
    after marking an incident before the DB commit fully reflects it in
    every caller's session).
    """
    if blocked_route_id:
        route = db.query(models.Route).filter(models.Route.route_id == blocked_route_id).first()
        was_available = route.available if route else None
        if route:
            route.available = False
    path_zones, path_route_ids, total_minutes = dijkstra(db, source, destination)
    if blocked_route_id and route and was_available is not None:
        route.available = was_available  # caller is responsible for the real state change
    return path_zones, path_route_ids, total_minutes
