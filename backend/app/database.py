"""
Database setup for the Smart Transit Communication & Route Management System.

Uses SQLite for zero-config local demos. Swap SQLALCHEMY_DATABASE_URL for a
MySQL/Postgres URL in production without touching any other file.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

SQLALCHEMY_DATABASE_URL = "sqlite:///./smart_transit.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
