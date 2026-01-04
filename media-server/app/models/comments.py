from __future__ import annotations

from sqlalchemy import Column, Index, Integer, Text

from . import CommentsBase


class Comment(CommentsBase):
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    share_hash = Column(Text, nullable=False)
    file_path = Column(Text, nullable=False) # Use "/" for root/share-level comments
    author = Column(Text, nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(Integer, nullable=False)
    updated_at = Column(Integer, nullable=False)

    __table_args__ = (
        Index("idx_comments_share_file", "share_hash", "file_path"),
        Index("idx_comments_created_at", "created_at"),
    )
