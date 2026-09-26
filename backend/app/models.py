"""
ORM models. Each table maps directly to one of the entities in the project
brief (Buses, Routes, NetworkNodes, NetworkLinks, Incidents, Alerts,
BusLocations, RouteHistory).
"""
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime

from .database import Base


class NetworkNode(Base):
    """A router / switch / server in the Cisco Packet Tracer topology.

    node_type: core_router | zone_router | switch | server
    zone: geographic zone this node represents (matches the Packet Tracer plan)
    """
    __tablename__ = "network_nodes"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, unique=True, index=True)   # e.g. "R1", "SW-Z1"
    name = Column(String)
    node_type = Column(String)
    zone = Column(String)
    ip_address = Column(String)
    status = Column(String, default="operational")       # operational|warning|failed
    x = Column(Float, default=0)                          # layout coords for topology map
    y = Column(Float, default=0)


class NetworkLink(Base):
    """A link between two NetworkNodes (maps to a Packet Tracer serial/ethernet link)."""
    __tablename__ = "network_links"

    id = Column(Integer, primary_key=True, index=True)
    link_id = Column(String, unique=True, index=True)     # e.g. "R2-R3"
    source_node_id = Column(String, index=True)
    dest_node_id = Column(String, index=True)
    protocol = Column(String, default="OSPF")
    bandwidth_mbps = Column(Integer, default=100)
    status = Column(String, default="up")                 # up|degraded|down
    is_redundant = Column(Boolean, default=False)
    packet_loss_pct = Column(Float, default=0.0)


class Route(Base):
    """A road/route segment used by application-level Dijkstra rerouting.

    This is the transport-layer graph edge; it is conceptually anchored to a
    NetworkLink (source_zone -> dest_zone) so a network failure and a road
    incident can independently or jointly affect the same corridor.
    """
    __tablename__ = "routes"

    id = Column(Integer, primary_key=True, index=True)
    route_id = Column(String, unique=True, index=True)    # e.g. "R2-R3"
    source = Column(String, index=True)                   # zone / node label, e.g. "Zone 2"
    destination = Column(String, index=True)
    distance_km = Column(Float)
    base_travel_time_min = Column(Integer)
    network_status = Column(String, default="up")         # up|degraded|down
    road_status = Column(String, default="clear")          # clear|blocked
    flood_status = Column(String, default="none")          # none|flooded
    accident_status = Column(String, default="none")       # none|accident
    available = Column(Boolean, default=True)


class Bus(Base):
    __tablename__ = "buses"

    id = Column(Integer, primary_key=True, index=True)
    bus_id = Column(String, unique=True, index=True)       # e.g. "BUS-205"
    route_label = Column(String)                           # e.g. "R2-R3-R5"
    current_zone = Column(String)
    source = Column(String)
    destination = Column(String)
    scheduled_arrival = Column(DateTime)
    estimated_arrival = Column(DateTime)
    status = Column(String, default="on_time")             # on_time|delayed|severely_delayed|rerouted|stopped|offline
    network_connection_status = Column(String, default="connected")  # connected|weak|offline
    current_incident = Column(String, nullable=True)
    alternative_route = Column(String, nullable=True)
    original_route = Column(String, nullable=True)


class BusLocation(Base):
    """Time-stamped location pings, simulating MQTT telemetry from each bus."""
    __tablename__ = "bus_locations"

    id = Column(Integer, primary_key=True, index=True)
    bus_id = Column(String, index=True)
    zone = Column(String)
    lat = Column(Float)
    lng = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow)


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)
    incident_type = Column(String)                         # flood|accident|network_failure
    route_id = Column(String, nullable=True)
    link_id = Column(String, nullable=True)
    zone = Column(String, nullable=True)
    description = Column(String)
    status = Column(String, default="active")               # active|resolved
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    severity = Column(String, default="info")               # info|warning|critical
    category = Column(String)                                # flood|accident|network|delay|reroute|road_blockage
    message = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


class RouteHistory(Base):
    """Audit trail of route recalculations, for the Results/Testing section."""
    __tablename__ = "route_history"

    id = Column(Integer, primary_key=True, index=True)
    bus_id = Column(String, index=True)
    old_route = Column(String)
    new_route = Column(String)
    reason = Column(String)
    added_delay_min = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
