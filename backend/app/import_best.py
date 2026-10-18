
"""
Import BEST GTFS-derived stops and trip patterns
without changing the existing network simulation.
"""

import json
from pathlib import Path

from .database import SessionLocal, engine, Base
from . import models

DATA_FILE = Path(__file__).resolve().parent.parent / "best-optimized.json"
  
def import_best_data():
    if not DATA_FILE.exists():
        raise FileNotFoundError(
            f"BEST dataset not found: {DATA_FILE}"
        )

    with DATA_FILE.open("r", encoding="utf-8") as f:
        data = json.load(f)

    stops = data["stops"]
    trips = data["trips"]

    Base.metadata.create_all(bind=engine)

    db = SessionLocal()

    try:
        # Safe to run again: skip existing records.
        existing_stops = {
            row[0]
            for row in db.query(models.BestStop.stop_id).all()
        }

        existing_trips = {
            row[0]
            for row in db.query(models.BestTrip.trip_id).all()
        }

        new_stops = 0
        new_trips = 0

        for stop in stops:
            stop_id = stop["stop_id"]

            if stop_id in existing_stops:
                continue

            db.add(models.BestStop(
                stop_id=stop_id,
                stop_name=stop["stop_name"]
            ))
            new_stops += 1

        for trip in trips:
            trip_id = trip["trip_id"]

            if trip_id in existing_trips:
                continue

            db.add(models.BestTrip(
                trip_id=trip_id,
                route_id=trip["route_id"],
                stop_ids_json=json.dumps(
                    trip["stop_ids"]
                )
            ))
            new_trips += 1

        db.commit()

        print("BEST dataset import completed!")
        print(f"New stops imported: {new_stops}")
        print(f"New trips imported: {new_trips}")

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


if __name__ == "__main__":
    import_best_data()
