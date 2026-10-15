"""SQLAlchemy 2.0 ORM models for Meridian LLMOps persistence.

These models back the relational store (parsed documents and chunks, extracted
fields awaiting human review, and verified answers with their claims and
citations). They are kept separate from the Pydantic API schemas in
``packages.core.models`` (see issue #66).
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
