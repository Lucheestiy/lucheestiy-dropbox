from __future__ import annotations

from sqlalchemy import Column, Index, Integer, Text

from . import VideoMetaBase


class VideoMeta(VideoMetaBase):
    __tablename__ = "video_meta"

    path = Column(Text, primary_key=True)
    status = Column(Text, nullable=False)
    action = Column(Text)
    error = Column(Text)
    uploaded_at = Column(Integer)
    processed_at = Column(Integer)
    original_size = Column(Integer)
    processed_size = Column(Integer)
    original_meta_json = Column(Text)
    processed_meta_json = Column(Text)

    __table_args__ = (Index("idx_video_meta_status", "status"),)
