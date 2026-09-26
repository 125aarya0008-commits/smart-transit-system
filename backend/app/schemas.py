from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class NetworkNodeOut(BaseModel):
    node_id: str
    name: str
    node_type: str
    zone: str
    ip_address: str
    status: str
    x: float
    y: float

    class Config:
        from_attributes = True


class NetworkLinkOut(BaseModel):
    link_id: str
    source_node_id: str
    dest_node_id: str
    protocol: str
    bandwidth_mbps: int
    status: str
    is_redundant: bool
    packet_loss_pct: float

    class Config:
        from_attributes = True


class RouteOut(BaseModel):
    route_id: str
    source: str
    destination: str
    distance_km: float
    base_travel_time_min: int
    network_status: str
    road_status: str
    flood_status: str
    accident_status: str
    available: bool

    class Config:
        from_attributes = True


class BusOut(BaseModel):
    bus_id: str
    route_label: str
    current_zone: str
    source: str
    destination: str
    scheduled_arrival: datetime
    estimated_arrival: datetime
    status: str
    network_connection_status: str
    current_incident: Optional[str] = None
    alternative_route: Optional[str] = None
    original_route: Optional[str] = None
    delay_minutes: int = 0

    class Config:
        from_attributes = True


class AlertOut(BaseModel):
    severity: str
    category: str
    message: str
    created_at: datetime

    class Config:
        from_attributes = True


class IncidentOut(BaseModel):
    incident_type: str
    route_id: Optional[str] = None
    link_id: Optional[str] = None
    zone: Optional[str] = None
    description: str
    status: str
    created_at: datetime
    resolved_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class IncidentIn(BaseModel):
    incident_type: str
    route_id: Optional[str] = None
    link_id: Optional[str] = None
    zone: Optional[str] = None
    description: str


class SimulateFloodIn(BaseModel):
    route_id: str


class SimulateAccidentIn(BaseModel):
    route_id: str


class SimulateNetworkFailureIn(BaseModel):
    link_id: str


class SimulateDelayIn(BaseModel):
    bus_id: str
    extra_minutes: int = 15
