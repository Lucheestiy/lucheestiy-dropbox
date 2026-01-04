from __future__ import annotations

import json
import logging
import os
import time

logger = logging.getLogger("droppr.parallel_chunks")


class ChunkTracker:
    """
    Tracks received chunks for parallel uploads and determines completion.

    Supports both sequential and parallel chunk uploads by tracking
    received byte ranges and merging them when all chunks are received.
    """

    def __init__(self, total_size: int):
        self.total_size = total_size
        self.received_ranges: list[tuple[int, int]] = []  # List of (start, end) tuples

    def add_range(self, start: int, end: int) -> None:
        """Add a received byte range and merge overlapping ranges"""
        self.received_ranges.append((start, end))
        self.received_ranges.sort()
        self._merge_ranges()

    def _merge_ranges(self) -> None:
        """Merge overlapping or adjacent ranges"""
        if not self.received_ranges:
            return

        merged = []
        current_start, current_end = self.received_ranges[0]

        for start, end in self.received_ranges[1:]:
            if start <= current_end + 1:  # Overlapping or adjacent
                current_end = max(current_end, end)
            else:
                merged.append((current_start, current_end))
                current_start, current_end = start, end

        merged.append((current_start, current_end))
        self.received_ranges = merged

    def is_complete(self) -> bool:
        """Check if all bytes have been received"""
        if not self.received_ranges:
            return False

        # Should have exactly one range covering 0 to total_size-1
        return (
            len(self.received_ranges) == 1
            and self.received_ranges[0][0] == 0
            and self.received_ranges[0][1] >= self.total_size - 1
        )

    def get_received_bytes(self) -> int:
        """Get total number of bytes received"""
        return sum(end - start + 1 for start, end in self.received_ranges)

    def get_missing_ranges(self) -> list[tuple[int, int]]:
        """Get list of missing byte ranges"""
        if not self.received_ranges:
            return [(0, self.total_size - 1)]

        missing = []
        current_pos = 0

        for start, end in self.received_ranges:
            if current_pos < start:
                missing.append((current_pos, start - 1))
            current_pos = max(current_pos, end + 1)

        if current_pos < self.total_size:
            missing.append((current_pos, self.total_size - 1))

        return missing

    def to_dict(self) -> dict:
        """Serialize to dictionary"""
        return {
            "total_size": self.total_size,
            "received_ranges": self.received_ranges,
        }

    @classmethod
    def from_dict(cls, data: dict) -> ChunkTracker:
        """Deserialize from dictionary"""
        tracker = cls(data["total_size"])
        tracker.received_ranges = [tuple(r) for r in data["received_ranges"]]
        return tracker


def get_chunk_file_path(base_dir: str, upload_id: str, chunk_index: int) -> str:
    """Get path to a chunk file"""
    session_dir = os.path.join(base_dir, ".upload-sessions")
    os.makedirs(session_dir, exist_ok=True)
    return os.path.join(session_dir, f"{upload_id}.chunk.{chunk_index}")


def get_tracker_file_path(base_dir: str, upload_id: str) -> str:
    """Get path to chunk tracker metadata file"""
    session_dir = os.path.join(base_dir, ".upload-sessions")
    os.makedirs(session_dir, exist_ok=True)
    return os.path.join(session_dir, f"{upload_id}.tracker")


def save_chunk_tracker(base_dir: str, upload_id: str, tracker: ChunkTracker) -> None:
    """Save chunk tracker to disk"""
    path = get_tracker_file_path(base_dir, upload_id)
    try:
        with open(path, "w") as f:
            json.dump(tracker.to_dict(), f)
    except Exception as exc:
        logger.error(f"Failed to save chunk tracker: {exc}")


def load_chunk_tracker(base_dir: str, upload_id: str, total_size: int) -> ChunkTracker:
    """Load chunk tracker from disk or create new one"""
    path = get_tracker_file_path(base_dir, upload_id)
    if os.path.exists(path):
        try:
            with open(path) as f:
                data = json.load(f)
                return ChunkTracker.from_dict(data)
        except Exception as exc:
            logger.warning(f"Failed to load chunk tracker: {exc}")

    return ChunkTracker(total_size)


def store_chunk(
    base_dir: str,
    upload_id: str,
    chunk_data: bytes,
    offset: int,
    chunk_index: int | None = None,
) -> str:
    """
    Store a chunk to disk.
    Returns the path where the chunk was stored.
    """
    if chunk_index is None:
        # Calculate chunk index from offset (assuming 8MB chunks)
        chunk_size = 8 * 1024 * 1024
        chunk_index = offset // chunk_size

    chunk_path = get_chunk_file_path(base_dir, upload_id, chunk_index)

    try:
        with open(chunk_path, "wb") as f:
            f.write(chunk_data)
        return chunk_path
    except Exception as exc:
        logger.error(f"Failed to store chunk: {exc}")
        raise


def assemble_chunks(
    base_dir: str,
    upload_id: str,
    target_path: str,
    total_size: int,
    chunk_size: int = 8 * 1024 * 1024,
) -> bool:
    """
    Assemble all chunks into final file.
    Returns True if successful.
    """
    try:
        num_chunks = (total_size + chunk_size - 1) // chunk_size

        # Open target file for writing
        with open(target_path, "wb") as target_file:
            for chunk_index in range(num_chunks):
                chunk_path = get_chunk_file_path(base_dir, upload_id, chunk_index)

                if not os.path.exists(chunk_path):
                    logger.error(f"Missing chunk {chunk_index}")
                    return False

                with open(chunk_path, "rb") as chunk_file:
                    target_file.write(chunk_file.read())

        # Verify file size
        actual_size = os.path.getsize(target_path)
        if actual_size != total_size:
            logger.error(
                f"Assembled file size mismatch: expected {total_size}, got {actual_size}"
            )
            return False

        # Clean up chunk files
        cleanup_chunks(base_dir, upload_id, num_chunks)

        return True

    except Exception as exc:
        logger.error(f"Failed to assemble chunks: {exc}")
        return False


def cleanup_chunks(
    base_dir: str, upload_id: str, num_chunks: int | None = None
) -> None:
    """Clean up chunk files and tracker"""
    try:
        # Remove tracker file
        tracker_path = get_tracker_file_path(base_dir, upload_id)
        if os.path.exists(tracker_path):
            os.remove(tracker_path)

        # Remove chunk files
        if num_chunks is not None:
            for chunk_index in range(num_chunks):
                chunk_path = get_chunk_file_path(base_dir, upload_id, chunk_index)
                if os.path.exists(chunk_path):
                    os.remove(chunk_path)
        else:
            # Try to remove all chunks with this upload_id
            session_dir = os.path.join(base_dir, ".upload-sessions")
            if os.path.exists(session_dir):
                prefix = f"{upload_id}.chunk."
                for filename in os.listdir(session_dir):
                    if filename.startswith(prefix):
                        try:
                            os.remove(os.path.join(session_dir, filename))
                        except Exception:
                            pass

    except Exception as exc:
        logger.warning(f"Failed to cleanup chunks: {exc}")


def cleanup_expired_sessions(base_dir: str, max_age_hours: int = 24) -> int:
    """
    Clean up expired upload sessions.
    Returns number of sessions cleaned up.
    """
    session_dir = os.path.join(base_dir, ".upload-sessions")
    if not os.path.exists(session_dir):
        return 0

    cutoff_time = time.time() - (max_age_hours * 3600)
    cleaned = 0

    try:
        for filename in os.listdir(session_dir):
            filepath = os.path.join(session_dir, filename)

            # Check file age
            if os.path.getmtime(filepath) < cutoff_time:
                try:
                    os.remove(filepath)
                    cleaned += 1
                except Exception:
                    pass

    except Exception as exc:
        logger.error(f"Failed to cleanup expired sessions: {exc}")

    return cleaned
