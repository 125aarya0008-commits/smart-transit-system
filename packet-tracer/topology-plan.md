# Cisco Packet Tracer Topology Plan

This file is the build spec for the `.pkt` file. Packet Tracer itself isn't
scriptable from this environment, so build it by hand in the Packet Tracer
GUI following this plan — it corresponds exactly to `backend/app/seed.py`,
so the dashboard's Network Topology page will match what you build.

## 1. Devices

| Device | Type              | Represents                  |
|--------|-------------------|------------------------------|
| R1     | Router (core)     | Core network / backbone       |
| R2     | Router            | Zone 1                        |
| R3     | Router            | Zone 2                        |
| R4     | Router            | Zone 3                        |
| R5     | Router            | Zone 4                        |
| SW1–SW4| 2960 Switch       | Zone 1–4 access switches       |
| SRV1   | Server            | Dashboard / backend API host  |
| PC-CC1 | PC                | Control-center terminal        |
| Bus1–Bus6 | PC (as end device) | Bus telemetry units (BUS-101…BUS-627) |

## 2. Physical layout

```
                         R1 (CORE)
                 ________/  |  |  \________
                /           |  |           \
              R2           R3  R4           R5
           (Zone 1)     (Zone 2)(Zone 3)  (Zone 4)
               |            |    |            |
             SW1          SW2   SW3         SW4
               |            |    |            |
           Bus1,Bus6    Bus2   Bus3,Bus5    Bus4

Redundant links (dashed above, solid in Packet Tracer):
  R2 -- R3   R3 -- R5   R4 -- R5   R2 -- R4

SRV1 and PC-CC1 connect directly to R1.
```

Use `Serial` links (with a DCE/DTE clock rate, e.g. `clock rate 64000` on the
DCE end) for router-to-router links, and `FastEthernet`/copper straight-through
for router-to-switch and switch-to-PC links.

## 3. IP addressing scheme

| Link / Segment       | Network          | Notes                        |
|-----------------------|------------------|-------------------------------|
| R1–R2                 | 10.0.10.0/30     | Core ↔ Zone 1                 |
| R1–R3                 | 10.0.11.0/30     | Core ↔ Zone 2                 |
| R1–R4                 | 10.0.12.0/30     | Core ↔ Zone 3                 |
| R1–R5                 | 10.0.13.0/30     | Core ↔ Zone 4                 |
| R2–R3                 | 10.0.20.0/30     | Redundant link                |
| R3–R5                 | 10.0.21.0/30     | Redundant link                |
| R4–R5                 | 10.0.22.0/30     | Redundant link                |
| R2–R4                 | 10.0.23.0/30     | Redundant link                |
| R2 LAN (Zone 1)       | 10.0.1.0/24      | DHCP pool for Bus1, Bus6       |
| R3 LAN (Zone 2)       | 10.0.2.0/24      | DHCP pool for Bus2             |
| R4 LAN (Zone 3)       | 10.0.3.0/24      | DHCP pool for Bus3, Bus5       |
| R5 LAN (Zone 4)       | 10.0.4.0/24      | DHCP pool for Bus4             |
| R1 LAN (Server/CC)    | 10.0.0.0/28      | SRV1 = 10.0.0.10, PC-CC1 = 10.0.0.11 |

## 4. OSPF configuration (sample, per router)

Run on every router (adjust network statements to that router's directly
connected subnets):

```
router ospf 1
 network 10.0.10.0 0.0.0.3 area 0
 network 10.0.20.0 0.0.0.3 area 0
 network 10.0.1.0 0.0.0.255 area 0
 default-information originate
```

Single area (Area 0) is enough for a college demo. Verify convergence with:

```
show ip ospf neighbor
show ip route ospf
```

## 5. DHCP (on each zone router, or a dedicated DHCP server)

```
ip dhcp pool ZONE1_POOL
 network 10.0.1.0 255.255.255.0
 default-router 10.0.1.1
 dns-server 8.8.8.8
```

Repeat per zone with the matching subnet.

## 6. Demonstrating the network-failure scenario in Packet Tracer

1. Confirm full OSPF convergence (`show ip route ospf` on R1 shows all zones).
2. Right-click the **R2–R3** link → **Delete**, or simply shut the interface:
   `interface s0/0/0` → `shutdown` on either end.
3. Re-run `show ip route ospf` — the route to the other zone now goes via
   the redundant path (e.g. through R1 or R4) instead.
4. This is the network-layer event that `POST /simulate/network-failure`
   mirrors in the dashboard: pick the same link_id (e.g. `R2-R3`) and the
   dashboard will show the same story at the application layer.

## 7. Correspondence table (Packet Tracer ↔ Dashboard)

| Packet Tracer element        | Dashboard element                          |
|-------------------------------|---------------------------------------------|
| R2 / R3 / R4 / R5              | Zone 1 / Zone 2 / Zone 3 / Zone 4 map nodes |
| R2–R3 / R3–R5 / R4–R5 / R2–R4 links | Redundant road segments in Route Management |
| `shutdown` on a router interface | `POST /simulate/network-failure` on the matching `link_id` |
| OSPF reconvergence            | Dijkstra recalculation in `backend/app/routing.py` |
| Bus1…Bus6 end devices          | BUS-101…BUS-627 records in the database      |
