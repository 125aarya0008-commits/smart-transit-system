# Smart Transit Communication & Route Management System

A network-first public transit monitoring system: buses, roads and the
underlying router/switch communication network are modelled together, so a
flood, accident, or network-link failure triggers automatic rerouting —
demonstrated live on a dashboard, backed by a Cisco Packet Tracer topology
plan using OSPF.

```
smart-transit-system/
├── backend/            FastAPI + SQLite REST API, Dijkstra rerouting engine
├── frontend/            React (CDN, no build step) network-ops dashboard
├── packet-tracer/       Topology plan, IP scheme, OSPF config, build guide
├── docs/                Full project documentation (26 sections)
└── README.md            You are here
```

## Running it locally

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API is now live at `http://localhost:8000` (interactive docs at
`http://localhost:8000/docs`). Sample data (topology, routes, 6 buses) is
seeded automatically on first startup.

### 2. Frontend

No build step — it's plain HTML/CSS/JS with React loaded from a CDN.

```bash
cd frontend
python3 -m http.server 5500
```

Then open `http://localhost:5500` in a browser. If your backend runs on a
different host/port, add before the other scripts in `index.html`:

```html
<script>window.API_BASE = "http://<host>:<port>";</script>
```

### 3. Cisco Packet Tracer

Build the `.pkt` file by hand in Packet Tracer following
`packet-tracer/topology-plan.md` — it lists every device, the IP addressing
scheme, sample OSPF/DHCP config, and the exact steps to demonstrate a link
failure and OSPF reconvergence.

## Deploying it publicly (Render)

1. Push this whole folder to a GitHub repository.
2. On Render, create a **Web Service** from the repo with root directory
   `backend`, build command `pip install -r requirements.txt`, and start
   command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
3. On Render, create a **Static Site** from the same repo with root
   directory `frontend`, no build command, and publish directory `.`.
4. In `frontend/index.html`, set `window.API_BASE` to the Web Service's
   URL (see the comment already in that file) before the static site is
   deployed/redeployed.
5. SQLite (`smart_transit.db`) resets on every Render restart/redeploy
   because the free-tier filesystem is not persistent — fine for demos; use
   a Render Persistent Disk or Render Postgres if the simulated state needs
   to survive restarts.

## Demo script (see docs §23 for the full walkthrough)

1. Open the dashboard — Dashboard tab shows all-green network health and 6
   connected buses.
2. Go to **Route Management**, click **Flood** on `Zone 2-Zone 3` — watch
   BUS-205 get rerouted and an alert appear.
3. Go to **Network Topology**, pick a link (e.g. `R2-R3`) and click
   **Simulate Network Failure** — the node turns amber and the link goes
   red/dashed.
4. Click **Restore Link** / **Restore** on the route to return to normal.
5. Check **Network Statistics** for delay and availability charts, and
   **Alerts** for the full notification feed.
6. Use **Incident Management → Reset Simulation** to restore the original
   sample dataset before the next run-through.

## Tech stack

| Layer      | Technology                              |
|------------|-------------------------------------------|
| Frontend   | React 18 (CDN + Babel standalone), Chart.js, minimalist white/blue/red theme |
| Backend    | FastAPI, SQLAlchemy                        |
| Database   | SQLite (swap the URL in `backend/app/database.py` for MySQL/Postgres) |
| Routing    | Dijkstra's algorithm (`backend/app/routing.py`) |
| Network model | Cisco Packet Tracer, OSPF, IPv4, ICMP, DHCP, MQTT-conceptual, SNMP-conceptual |

See `docs/PROJECT_DOCUMENTATION.md` for the full write-up (architecture,
IP scheme, algorithm details, testing, limitations, future scope) ready to
adapt into your submission report.
