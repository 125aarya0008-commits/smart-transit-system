# Smart Transit Communication & Route Management System — Project Documentation

## 1. Abstract
Public bus-tracking apps like Chalo show *where a bus is*. This project
demonstrates *why a transit network keeps working when part of it breaks* —
it models buses, roads and the underlying communication network together,
so a flood, an accident, or a network-link failure can be simulated and the
system's automatic response (dynamic rerouting, alerting, delay
recalculation) observed end to end.

## 2. Introduction
The system pairs a Cisco Packet Tracer network model (routers, switches,
OSPF) with a web dashboard that visualises both the transit layer (buses,
routes, delays) and the network layer (nodes, links, protocols) that carries
the system's own monitoring traffic.

## 3. Problem Statement
Conventional transit apps treat GPS tracking as the whole problem and give
no visibility into the communication infrastructure a real ITS (Intelligent
Transportation System) depends on, nor into how that infrastructure
recovers from failure.

## 4. Objectives
- Represent buses, zones and roads as a network-aware graph.
- Model a realistic router/switch topology using OSPF for dynamic routing.
- Detect and recompute routes automatically when a road or network link
  fails (flood, accident, link failure).
- Visualise both the transit and the network layer, live, in one dashboard.
- Provide a hardware-free Simulation Mode suitable for a classroom demo.

## 5. Existing System
Existing apps (e.g. Chalo) provide live GPS bus tracking and ETAs but treat
the network as invisible infrastructure: they do not model routing
protocols, network failures, or how a control system would reroute traffic
and buses together during an outage.

## 6. Proposed System
A layered system: Packet Tracer network → simulated network layer → FastAPI
backend → SQLite database → React dashboard. Two graphs run side by side —
an application-level road graph (Dijkstra) and a conceptual OSPF network
graph — and a failure in either is visualised and can trigger rerouting.

## 7. System Architecture
```
Cisco Packet Tracer Network      (packet-tracer/topology-plan.md)
        v
Routers / Switches / Servers      (models.NetworkNode / NetworkLink)
        v
Network Simulation Layer          (main.py /simulate/* endpoints)
        v
Backend API                       (FastAPI, backend/app/main.py)
        v
Database                          (SQLite via SQLAlchemy)
        v
Web Dashboard                     (frontend/, React + REST calls)
```

## 8. Network Architecture
Single-area OSPF (Area 0). One core router (R1) connects to four zone
routers (R2–R5), each fronting a zone LAN switch. Four redundant
inter-zone links (R2–R3, R3–R5, R4–R5, R2–R4) exist purely so OSPF has an
alternative path to converge onto when a primary link fails.

## 9. Cisco Packet Tracer Topology
See `packet-tracer/topology-plan.md` for the full device list, physical
layout diagram, and step-by-step build instructions.

## 10. IP Addressing Scheme
See `packet-tracer/topology-plan.md` §3 — /30 point-to-point links between
routers, /24 zone LANs, DHCP-assigned end-device addresses.

## 11. Routing Protocol — OSPF
OSPF (single area) is used at the network layer so router-to-router paths
recalculate automatically when a link fails. `backend/app/routing.py`
mirrors this concept at the application layer with a Dijkstra
implementation over the road/zone graph — the same algorithm OSPF uses
internally (SPF, Shortest Path First) to build its routing table.

## 12. TCP/IP Protocol Stack
See the in-app **Protocols** page, or the table in
`packet-tracer/topology-plan.md` — summarised: HTTP/HTTPS + MQTT + DNS +
SNMP (application), TCP/UDP (transport), IPv4 + ICMP + OSPF (network),
Ethernet/Wi-Fi (data link).

## 13. MQTT Communication
Real bus hardware would publish `bus/<id>/location` and
`bus/<id>/status` messages over MQTT to a broker, which the backend
subscribes to and persists as `BusLocation` rows. In Simulation Mode this
is stood in for by the `/simulate/*` endpoints and `BusLocation` writes —
swapping in a real MQTT broker (e.g. Mosquitto) is a drop-in replacement
for the simulation layer, not a redesign.

## 14. Network Monitoring
`GET /network` reports per-link status and packet loss, aggregated into a
network-health summary — a simplified stand-in for SNMP polling /
ICMP reachability checks a real NMS would run against each router.

## 15. Route-Rerouting Algorithm
Dijkstra's algorithm (`backend/app/routing.py::dijkstra`) runs over the
`routes` table, skipping any route marked unavailable, and returns the
shortest remaining path plus its total travel time. Any bus whose current
route touches the affected segment is moved onto that new path and given an
added-delay penalty.

## 16. Flood Scenario
`POST /simulate/flood {route_id}` marks the route unavailable, logs an
Incident, reroutes every affected bus via Dijkstra, and raises Alerts —
exactly the seven-step flow described in the project brief §7.

## 17. Accident Scenario
`POST /simulate/accident {route_id}` follows the same flow as the flood
scenario (§16), logged as a distinct incident type for reporting purposes.

## 18. Network Failure Scenario
`POST /simulate/network-failure {link_id}` marks a Packet-Tracer-level link
down, marks the corresponding transit route degraded/down if one exists,
and raises Alerts describing OSPF's expected reconvergence. See
`packet-tracer/topology-plan.md` §6 for the matching manual demo in the
actual Packet Tracer file.

## 19. Database Design
Tables: `buses`, `routes`, `network_nodes`, `network_links`, `incidents`,
`alerts`, `bus_locations`, `route_history` — see `backend/app/models.py`
for full column definitions and relationships.

## 20. API Design
REST endpoints under FastAPI (`backend/app/main.py`), auto-documented at
`/docs` (Swagger UI) once the server is running: `/buses`, `/routes`,
`/network`, `/alerts`, `/incidents`, `/alternative-route/{source}/{destination}`,
and the `/simulate/*` control endpoints (`flood`, `accident`,
`network-failure`, `delay`, `restore-network`, `restore-route`, `reset`).

## 21. Dashboard Design
Eight pages: Dashboard, Live Bus Monitoring, Route Management, Network
Topology, Incident Management, Alerts, Network Statistics, Protocols — see
`frontend/`. Styled as a minimalist white dashboard with a consistent
blue = operational/active, red = warning/failed status coding across every
panel (topology map, route map, bus cards, alerts, charts).

## 22. Testing
- **Unit-level**: `backend/app/routing.py`'s Dijkstra logic was verified
  standalone against known shortest paths, including forced-detour cases
  where the direct edge is removed.
- **Integration**: each `/simulate/*` endpoint was traced end-to-end —
  incident logged → route/link marked → affected buses identified →
  alternative path computed → alerts raised → dashboard reflects the change
  on next poll (4s interval).
- **Manual/UI**: run through the Demonstration Scenario (§23 below) on the
  running dashboard before presenting.

## 23. Results
The system correctly identifies every bus whose current route touches a
blocked segment, computes a valid alternative path when one exists (and
flags the bus as `stopped` when it does not), and keeps a full audit trail
of every reroute in `route_history` with the added delay.

## 24. Limitations
- Simulation Mode stands in for live GPS/MQTT hardware and a live Packet
  Tracer bridge — see §13 and §18 for exactly what is simulated versus
  modeled.
- Single OSPF area only (no inter-area/ABR demonstration).
- No authentication layer — acceptable for a local classroom demo, not for
  production deployment.

## 25. Future Scope
- Bridge to a real MQTT broker for genuine bus telemetry.
- A Packet Tracer → backend API bridge (via its scripting/Python module) so
  a real `shutdown` command in Packet Tracer triggers `/simulate/network-failure`
  automatically instead of via the dashboard button.
- Multi-area OSPF and BGP for a city-scale rather than town-scale network.
- Real-time push (WebSocket/MQTT) instead of dashboard polling.
- Swap SQLite for a persistent Postgres instance in deployment so simulated
  state survives host restarts (see README deployment notes).

## 26. Conclusion
By modelling the communication network and the transit network as two
linked graphs — one governed by OSPF concepts, one by application-level
Dijkstra — this project demonstrates that a public transit monitoring
system is, underneath the map view, a network-fault-tolerance problem: the
dashboard's job is to make that fault tolerance visible and explainable.
