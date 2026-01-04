from __future__ import annotations

from sqlalchemy import Column, Index, Integer, Text

from . import AnalyticsBase


class DownloadEvent(AnalyticsBase):
    __tablename__ = "download_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    share_hash = Column(Text, nullable=False)
    event_type = Column(Text, nullable=False)
    file_path = Column(Text)
    ip = Column(Text)
    user_agent = Column(Text)
    referer = Column(Text)
    created_at = Column(Integer, nullable=False)

    __table_args__ = (
        Index("idx_download_events_share_hash", "share_hash"),
        Index("idx_download_events_share_hash_created_at", "share_hash", "created_at"),
        Index("idx_download_events_created_at", "created_at"),
        Index("idx_download_events_ip", "ip"),
        Index("idx_download_events_event_type", "event_type"),
    )


class DownloadEventArchive(AnalyticsBase):
    __tablename__ = "download_events_archive"

    id = Column(Integer, primary_key=True, autoincrement=True)
    share_hash = Column(Text, nullable=False)
    event_type = Column(Text, nullable=False)
    file_path = Column(Text)
    ip = Column(Text)
    user_agent = Column(Text)
    referer = Column(Text)
    created_at = Column(Integer, nullable=False)
    archived_at = Column(Integer, nullable=False)

    __table_args__ = (
        Index("idx_download_events_archive_share_hash", "share_hash"),
        Index("idx_download_events_archive_share_hash_created_at", "share_hash", "created_at"),
        Index("idx_download_events_archive_created_at", "created_at"),
        Index("idx_download_events_archive_ip", "ip"),
        Index("idx_download_events_archive_event_type", "event_type"),
    )


class AuthEvent(AnalyticsBase):
    __tablename__ = "auth_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(Text, nullable=False)
    path = Column(Text)
    ip = Column(Text)
    user_agent = Column(Text)
    success = Column(Integer, nullable=False)
    detail = Column(Text)
    created_at = Column(Integer, nullable=False)

    __table_args__ = (
        Index("idx_auth_events_created_at", "created_at"),
        Index("idx_auth_events_ip", "ip"),
        Index("idx_auth_events_event_type", "event_type"),
    )


class AuthEventArchive(AnalyticsBase):
    __tablename__ = "auth_events_archive"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(Text, nullable=False)
    path = Column(Text)
    ip = Column(Text)
    user_agent = Column(Text)
    success = Column(Integer, nullable=False)
    detail = Column(Text)
    created_at = Column(Integer, nullable=False)
    archived_at = Column(Integer, nullable=False)

    __table_args__ = (
        Index("idx_auth_events_archive_created_at", "created_at"),
        Index("idx_auth_events_archive_ip", "ip"),
        Index("idx_auth_events_archive_event_type", "event_type"),
    )
