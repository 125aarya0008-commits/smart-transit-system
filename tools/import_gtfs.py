
import csv
import io
import json
import sys
import zipfile
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict


def read_csv(z, filename):
    with z.open(filename) as file:
        text = io.TextIOWrapper(file, encoding="utf-8-sig")
        return list(csv.DictReader(text))


def import_gtfs(zip_path, output_path):
    with zipfile.ZipFile(zip_path) as z:
        stops = read_csv(z, "stops.txt")
        routes = read_csv(z, "routes.txt")
        trips = read_csv(z, "trips.txt")
        stop_times = read_csv(z, "stop_times.txt")

    stop_order = defaultdict(list)

    for row in stop_times:
        stop_order[row["trip_id"]].append(row)

    formatted_trips = []

    for trip in trips:
        trip_id = trip["trip_id"]

        ordered = sorted(
            stop_order[trip_id],
            key=lambda x: int(x["stop_sequence"])
        )

        if not ordered:
            continue

        formatted_trips.append({
            "trip_id": trip_id,
            "route_id": trip["route_id"],
            "direction_id": trip.get("direction_id", ""),
            "stop_ids": [
                row["stop_id"] for row in ordered
            ]
        })

    result = {
        "metadata": {
            "city": "Mumbai",
            "operator": "BEST",
            "mode": "schedule",
            "source": "GTFS import - verify provider and date",
            "generated_at": datetime.now(
                timezone.utc
            ).isoformat()
        },
        "stops": stops,
        "routes": routes,
        "trips": formatted_trips
    }

    Path(output_path).parent.mkdir(
        parents=True, exist_ok=True
    )

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print("GTFS import completed!")
    print("Stops:", len(stops))
    print("Routes:", len(routes))
    print("Trips:", len(formatted_trips))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(
            "Usage: python tools/import_gtfs.py "
            "feed.zip frontend/data/transit.json"
        )
        sys.exit(1)

    import_gtfs(sys.argv[1], sys.argv[2])
