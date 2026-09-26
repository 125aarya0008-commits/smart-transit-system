"""
Populates the database with a realistic sample topology, route graph and
bus fleet so the dashboard has something to show the moment it starts.

Topology mirrors packet-tracer/topology-plan.md:
  R1 (core) -- R2 (Zone 1)
            -- R3 (Zone 2)
            -- R4 (Zone 3)
            -- R5 (Zone 4)
  plus redundant links R2-R3, R3-R5, R4-R5, R2-R4 for OSPF rerouting demos.
"""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from . import models
from .database import engine, SessionLocal, Base


NODES = [
    # node_id, name,              type,          zone,     ip,              x,   y
    ("R1", "Core Router",        "core_router", "Core",   "10.0.0.1/30",   400, 60),
    ("R2", "Zone 1 Router",      "zone_router", "Zone 1",  "10.0.1.1/24",   120, 220),
    ("R3", "Zone 2 Router",      "zone_router", "Zone 2",  "10.0.2.1/24",   320, 220),
    ("R4", "Zone 3 Router",      "zone_router", "Zone 3",  "10.0.3.1/24",   520, 220),
    ("R5", "Zone 4 Router",      "zone_router", "Zone 4",  "10.0.4.1/24",   700, 220),
    ("SW1", "Zone 1 Switch",     "switch",      "Zone 1",  "10.0.1.2/24",   120, 340),
    ("SW2", "Zone 2 Switch",     "switch",      "Zone 2",  "10.0.2.2/24",   320, 340),
    ("SW3", "Zone 3 Switch",     "switch",      "Zone 3",  "10.0.3.2/24",   520, 340),
    ("SW4", "Zone 4 Switch",     "switch",      "Zone 4",  "10.0.4.2/24",   700, 340),
    ("SRV1", "Dashboard Server", "server",      "Core",   "10.0.0.10/30",  400, 400),
]

# source, dest, protocol, bandwidth, redundant
LINKS = [
    ("R1", "R2", "OSPF", 100, False),
    ("R1", "R3", "OSPF", 100, False),
    ("R1", "R4", "OSPF", 100, False),
    ("R1", "R5", "OSPF", 100, False),
    ("R2", "R3", "OSPF", 50, True),
    ("R3", "R5", "OSPF", 50, True),
    ("R4", "R5", "OSPF", 50, True),
    ("R2", "R4", "OSPF", 50, True),
    ("R2", "SW1", "Ethernet", 1000, False),
    ("R3", "SW2", "Ethernet", 1000, False),
    ("R4", "SW3", "Ethernet", 1000, False),
    ("R5", "SW4", "Ethernet", 1000, False),
    ("R1", "SRV1", "Ethernet", 1000, False),
]

# route_id derived as f"{source}-{dest}", distance_km, base_travel_time_min
ROUTES = [
    ("Zone 1", "Zone 2", 8.5, 16),
    ("Zone 2", "Zone 3", 10.2, 19),
    ("Zone 3", "Zone 4", 7.1, 14),
    ("Zone 1", "Zone 3", 15.4, 27),   # redundant path via R2-R4
    ("Zone 2", "Zone 4", 14.8, 26),   # redundant path via R3-R5
    ("Zone 1", "Zone 4", 22.0, 38),
]

BUSES = [
    # bus_id, route_label, current_zone, source, destination, sched_offset_min, eta_offset_min
    ("BUS-101", "Zone1-Zone2",        "Zone 1", "Zone 1", "Zone 2", 10, 10),
    ("BUS-205", "Zone2-Zone3-Zone4",  "Zone 3", "Zone 2", "Zone 4", -2, 16),
    ("BUS-310", "Zone3-Zone4",        "Zone 3", "Zone 3", "Zone 4", 20, 20),
    ("BUS-402", "Zone1-Zone3",        "Zone 1", "Zone 1", "Zone 3", 35, 35),
    ("BUS-518", "Zone4-Zone3",        "Zone 4", "Zone 4", "Zone 3", 5, 5),
    ("BUS-627", "Zone2-Zone1",        "Zone 2", "Zone 2", "Zone 1", -8, 4),
]


def seed(db: Session):
    if db.query(models.NetworkNode).first():
        return  # already seeded

    now = datetime.utcnow()

    for node_id, name, ntype, zone, ip, x, y in NODES:
        db.add(models.NetworkNode(
            node_id=node_id, name=name, node_type=ntype, zone=zone,
            ip_address=ip, status="operational", x=x, y=y,
        ))

    for src, dst, proto, bw, redundant in LINKS:
        db.add(models.NetworkLink(
            link_id=f"{src}-{dst}", source_node_id=src, dest_node_id=dst,
            protocol=proto, bandwidth_mbps=bw, status="up",
            is_redundant=redundant, packet_loss_pct=0.0,
        ))

    for src, dst, dist, t in ROUTES:
        db.add(models.Route(
            route_id=f"{src}-{dst}", source=src, destination=dst,
            distance_km=dist, base_travel_time_min=t,
            network_status="up", road_status="clear",
            flood_status="none", accident_status="none", available=True,
        ))

    for bus_id, route_label, zone, src, dst, sched_off, eta_off in BUSES:
        db.add(models.Bus(
            bus_id=bus_id, route_label=route_label, current_zone=zone,
            source=src, destination=dst,
            scheduled_arrival=now + timedelta(minutes=sched_off),
            estimated_arrival=now + timedelta(minutes=eta_off),
            status="on_time", network_connection_status="connected",
            original_route=route_label,
        ))

    db.commit()


def reset_and_seed():
    """Used by /simulate/reset — drops and recreates all sample data."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()
