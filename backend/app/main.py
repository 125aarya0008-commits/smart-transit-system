"""
Smart Transit Communication & Route Management System — Backend API.

Run with:
    uvicorn app.main:app --reload --port 8000

This backend represents the "Backend API" + "Network Simulation Layer"
layers of the architecture:

    Cisco Packet Tracer Network
        v
    Routers / Switches / Servers      <- modelled by NetworkNode / NetworkLink
        v
    Network Simulation Layer          <- this file's /simulate/* endpoints
        v
    Backend API                       <- FastAPI routes below
        v
    Database                          <- SQLite via SQLAlchemy
        v
    Web Dashboard                     <- frontend/ (React, calls this API)

IMPORTANT (see docs/PROJECT_DOCUMENTATION.md section 20): this server does
NOT control physical buses or a live Packet Tracer instance. It simulates
the network + transit layer so the concepts (OSPF rerouting, ICMP-style
health checks, MQTT-style status pushes) can be demonstrated without
special hardware, per the brief's "Simulation Mode" requirement.
"""
from datetime import datetime, timedelta
from typing import List

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from . import models, schemas, routing
from .database import engine, SessionLocal, Base, get_db
from .seed import seed, reset_and_seed

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Smart Transit Communication & Route Management System",
    description="Network-first public transit monitoring & rerouting API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # demo/college-project setting; restrict in production
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def delay_minutes(bus: models.Bus) -> int:
    delta = (bus.estimated_arrival - bus.scheduled_arrival).total_seconds() / 60
    return max(0, int(delta))


def bus_to_out(bus: models.Bus) -> schemas.BusOut:
    return schemas.BusOut(
        bus_id=bus.bus_id, route_label=bus.route_label, current_zone=bus.current_zone,
        source=bus.source, destination=bus.destination,
        scheduled_arrival=bus.scheduled_arrival, estimated_arrival=bus.estimated_arrival,
        status=bus.status, network_connection_status=bus.network_connection_status,
        current_incident=bus.current_incident, alternative_route=bus.alternative_route,
        original_route=bus.original_route, delay_minutes=delay_minutes(bus),
    )


# Maps a Packet-Tracer zone router to the zone name used by the application
# route graph, so a network-layer link failure (e.g. "R2-R3") can be tied to
# the matching transit route (e.g. "Zone 1-Zone 2") for the demo in section
# 21 of the brief. R1 is the core router and has no direct zone mapping.
ZONE_ROUTER_MAP = {"R2": "Zone 1", "R3": "Zone 2", "R4": "Zone 3", "R5": "Zone 4"}


def link_to_route_id(db: Session, link: models.NetworkLink):
    """Best-effort mapping from a network link to its corresponding transit
    route, in either direction. Returns None if the link doesn't correspond
    to a zone-to-zone road segment (e.g. a router-to-switch link)."""
    src_zone = ZONE_ROUTER_MAP.get(link.source_node_id)
    dst_zone = ZONE_ROUTER_MAP.get(link.dest_node_id)
    if not (src_zone and dst_zone):
        return None
    for candidate in (f"{src_zone}-{dst_zone}", f"{dst_zone}-{src_zone}"):
        if db.query(models.Route).filter(models.Route.route_id == candidate).first():
            return candidate
    return None


def push_alert(db: Session, severity: str, category: str, message: str):
    db.add(models.Alert(severity=severity, category=category, message=message))


def buses_on_route(db: Session, route: models.Route) -> List[models.Bus]:
    """Buses currently affected by a given route (their route_label mentions
    both zone endpoints, or they are sitting in one of the two zones)."""
    affected = []
    for bus in db.query(models.Bus).all():
        label = bus.route_label.replace(" ", "")
        a = route.source.replace(" ", "")
        b = route.destination.replace(" ", "")
        if (a in label and b in label) or bus.current_zone in (route.source, route.destination):
            affected.append(bus)
    return affected


# --------------------------------------------------------------------------
# Buses
# --------------------------------------------------------------------------

@app.get("/buses", response_model=List[schemas.BusOut])
def list_buses(db: Session = Depends(get_db)):
    return [bus_to_out(b) for b in db.query(models.Bus).all()]


@app.get("/buses/{bus_id}", response_model=schemas.BusOut)
def get_bus(bus_id: str, db: Session = Depends(get_db)):
    bus = db.query(models.Bus).filter(models.Bus.bus_id == bus_id).first()
    if not bus:
        raise HTTPException(404, "Bus not found")
    return bus_to_out(bus)


# --------------------------------------------------------------------------
# Routes (application-level road/transit graph)
# --------------------------------------------------------------------------

@app.get("/routes", response_model=List[schemas.RouteOut])
def list_routes(db: Session = Depends(get_db)):
    return db.query(models.Route).all()


@app.get("/routes/{route_id}", response_model=schemas.RouteOut)
def get_route(route_id: str, db: Session = Depends(get_db)):
    route = db.query(models.Route).filter(models.Route.route_id == route_id).first()
    if not route:
        raise HTTPException(404, "Route not found")
    return route


@app.get("/alternative-route/{source}/{destination}")
def alternative_route(source: str, destination: str, db: Session = Depends(get_db)):
    path_zones, path_route_ids, total_minutes = routing.dijkstra(db, source, destination)
    if path_zones is None:
        raise HTTPException(404, f"No available path between {source} and {destination}")
    return {
        "source": source, "destination": destination,
        "path": path_zones, "route_ids": path_route_ids,
        "estimated_minutes": total_minutes,
    }


# --------------------------------------------------------------------------
# Network topology
# --------------------------------------------------------------------------

@app.get("/network")
def network_status(db: Session = Depends(get_db)):
    nodes = db.query(models.NetworkNode).all()
    links = db.query(models.NetworkLink).all()
    failed_links = [l for l in links if l.status == "down"]
    return {
        "nodes": [schemas.NetworkNodeOut.model_validate(n) for n in nodes],
        "links": [schemas.NetworkLinkOut.model_validate(l) for l in links],
        "summary": {
            "active_routers": sum(1 for n in nodes if "router" in n.node_type and n.status == "operational"),
            "active_switches": sum(1 for n in nodes if n.node_type == "switch" and n.status == "operational"),
            "total_nodes": len(nodes),
            "failed_links": len(failed_links),
            "avg_packet_loss_pct": round(sum(l.packet_loss_pct for l in links) / len(links), 2) if links else 0,
        },
    }


# --------------------------------------------------------------------------
# Incidents & Alerts
# --------------------------------------------------------------------------

@app.get("/alerts", response_model=List[schemas.AlertOut])
def list_alerts(db: Session = Depends(get_db)):
    return db.query(models.Alert).order_by(models.Alert.created_at.desc()).limit(50).all()


@app.get("/incidents", response_model=List[schemas.IncidentOut])
def list_incidents(db: Session = Depends(get_db)):
    return db.query(models.Incident).order_by(models.Incident.created_at.desc()).all()


@app.post("/incident", response_model=schemas.IncidentOut)
def create_incident(incident: schemas.IncidentIn, db: Session = Depends(get_db)):
    """Generic incident logger (used internally by /simulate/* below, and
    available directly for manually logging an incident type not covered by
    a dedicated simulation endpoint)."""
    rec = models.Incident(
        incident_type=incident.incident_type, route_id=incident.route_id,
        link_id=incident.link_id, zone=incident.zone,
        description=incident.description, status="active",
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


# --------------------------------------------------------------------------
# Simulation controls
# --------------------------------------------------------------------------

def _reroute_affected_buses(db: Session, route: models.Route, incident_label: str):
    """Shared rerouting logic used by flood + accident simulations."""
    rerouted_info = []
    for bus in buses_on_route(db, route):
        path_zones, path_route_ids, total_minutes = routing.dijkstra(db, bus.source, bus.destination)
        if path_zones:
            old_label = bus.route_label
            new_label = "-".join(z.replace(" ", "") for z in path_zones)
            added_delay = max(5, int(total_minutes * 0.15))
            bus.route_label = new_label
            bus.alternative_route = new_label
            bus.status = "rerouted"
            bus.current_incident = incident_label
            bus.estimated_arrival = bus.estimated_arrival + timedelta(minutes=added_delay)

            db.add(models.RouteHistory(
                bus_id=bus.bus_id, old_route=old_label, new_route=new_label,
                reason=incident_label, added_delay_min=added_delay,
            ))
            push_alert(db, "warning", "reroute", f"{bus.bus_id} has been rerouted via {new_label}.")
            rerouted_info.append({
                "bus_id": bus.bus_id, "old_route": old_label, "new_route": new_label,
                "added_delay_min": added_delay,
            })
        else:
            bus.status = "stopped"
            bus.current_incident = incident_label
            push_alert(db, "critical", "reroute", f"{bus.bus_id} has no available alternative route.")
    return rerouted_info


@app.post("/simulate/flood")
def simulate_flood(payload: schemas.SimulateFloodIn, db: Session = Depends(get_db)):
    route = db.query(models.Route).filter(models.Route.route_id == payload.route_id).first()
    if not route:
        raise HTTPException(404, "Route not found")

    route.flood_status = "flooded"
    route.road_status = "blocked"
    route.available = False

    db.add(models.Incident(
        incident_type="flood", route_id=route.route_id, zone=route.source,
        description=f"Flooding reported on {route.route_id}.", status="active",
    ))
    push_alert(db, "critical", "flood", f"Flood detected on {route.route_id}. Route marked unavailable.")

    rerouted = _reroute_affected_buses(db, route, f"Flood on {route.route_id}")
    db.commit()

    alt = routing.dijkstra(db, route.source, route.destination)
    return {
        "route_id": route.route_id, "status": "flooded",
        "affected_buses": rerouted,
        "alternative_path": {"path": alt[0], "route_ids": alt[1], "minutes": alt[2]},
    }


@app.post("/simulate/accident")
def simulate_accident(payload: schemas.SimulateAccidentIn, db: Session = Depends(get_db)):
    route = db.query(models.Route).filter(models.Route.route_id == payload.route_id).first()
    if not route:
        raise HTTPException(404, "Route not found")

    route.accident_status = "accident"
    route.road_status = "blocked"
    route.available = False

    db.add(models.Incident(
        incident_type="accident", route_id=route.route_id, zone=route.source,
        description=f"Accident reported on {route.route_id}.", status="active",
    ))
    push_alert(db, "critical", "accident", f"Accident on {route.route_id}. Route unavailable.")

    rerouted = _reroute_affected_buses(db, route, f"Accident on {route.route_id}")
    db.commit()

    alt = routing.dijkstra(db, route.source, route.destination)
    return {
        "route_id": route.route_id, "status": "accident",
        "affected_buses": rerouted,
        "alternative_path": {"path": alt[0], "route_ids": alt[1], "minutes": alt[2]},
    }


@app.post("/simulate/network-failure")
def simulate_network_failure(payload: schemas.SimulateNetworkFailureIn, db: Session = Depends(get_db)):
    link = db.query(models.NetworkLink).filter(models.NetworkLink.link_id == payload.link_id).first()
    if not link:
        raise HTTPException(404, "Link not found")

    link.status = "down"
    link.packet_loss_pct = 100.0

    # A non-redundant link failure can strand a zone router from the core;
    # mark the destination node as degraded to visualise it on the topology map.
    dest_node = db.query(models.NetworkNode).filter(models.NetworkNode.node_id == link.dest_node_id).first()
    if dest_node and not link.is_redundant:
        dest_node.status = "warning"

    db.add(models.Incident(
        incident_type="network_failure", link_id=link.link_id,
        description=f"Network link {link.link_id} has failed.", status="active",
    ))
    push_alert(db, "critical", "network", f"Network link {link.link_id} has failed. OSPF recalculating routes.")

    # If this network link backs an application-level transit route, mark
    # that route's network_status too, so Route Management reflects it.
    matching_route_id = link_to_route_id(db, link)
    if matching_route_id:
        matching_route = db.query(models.Route).filter(models.Route.route_id == matching_route_id).first()
        if matching_route:
            matching_route.network_status = "down" if not link.is_redundant else "degraded"

    push_alert(db, "info", "network", f"Alternative communication path established around {link.link_id}.")
    db.commit()
    return {"link_id": link.link_id, "status": "down", "message": "OSPF will reconverge around this link."}


@app.post("/simulate/delay")
def simulate_delay(payload: schemas.SimulateDelayIn, db: Session = Depends(get_db)):
    bus = db.query(models.Bus).filter(models.Bus.bus_id == payload.bus_id).first()
    if not bus:
        raise HTTPException(404, "Bus not found")

    bus.estimated_arrival = bus.estimated_arrival + timedelta(minutes=payload.extra_minutes)
    d = delay_minutes(bus)
    bus.status = "severely_delayed" if d >= 30 else ("delayed" if d > 0 else "on_time")

    push_alert(db, "warning", "delay", f"{bus.bus_id} is delayed by {d} minutes.")
    db.commit()
    return {"bus_id": bus.bus_id, "delay_minutes": d, "status": bus.status}


@app.post("/simulate/restore-network")
def restore_network(payload: schemas.SimulateNetworkFailureIn, db: Session = Depends(get_db)):
    link = db.query(models.NetworkLink).filter(models.NetworkLink.link_id == payload.link_id).first()
    if not link:
        raise HTTPException(404, "Link not found")

    link.status = "up"
    link.packet_loss_pct = 0.0
    dest_node = db.query(models.NetworkNode).filter(models.NetworkNode.node_id == link.dest_node_id).first()
    if dest_node:
        dest_node.status = "operational"

    matching_route_id = link_to_route_id(db, link)
    if matching_route_id:
        route = db.query(models.Route).filter(models.Route.route_id == matching_route_id).first()
        if route:
            route.network_status = "up"

    push_alert(db, "info", "network", f"Network link {link.link_id} restored. Network returned to normal.")
    db.commit()
    return {"link_id": link.link_id, "status": "up"}


@app.post("/simulate/restore-route/{route_id}")
def restore_route(route_id: str, db: Session = Depends(get_db)):
    route = db.query(models.Route).filter(models.Route.route_id == route_id).first()
    if not route:
        raise HTTPException(404, "Route not found")

    route.available = True
    route.road_status = "clear"
    route.flood_status = "none"
    route.accident_status = "none"
    route.network_status = "up"

    for inc in db.query(models.Incident).filter(
        models.Incident.route_id == route_id, models.Incident.status == "active"
    ):
        inc.status = "resolved"
        inc.resolved_at = datetime.utcnow()

    push_alert(db, "info", "road_blockage", f"Route {route_id} has been restored and is available.")
    db.commit()
    return {"route_id": route_id, "status": "restored"}


@app.post("/simulate/reset")
def reset_simulation():
    reset_and_seed()
    return {"status": "reset"}


@app.get("/")
def root():
    return {
        "service": "Smart Transit Communication & Route Management System",
        "docs": "/docs",
    }
