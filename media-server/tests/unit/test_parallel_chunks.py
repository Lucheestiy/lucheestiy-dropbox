from __future__ import annotations

import os
import tempfile
import pytest

from app.services.parallel_chunks import (
    ChunkTracker,
    get_chunk_file_path,
    get_tracker_file_path,
    save_chunk_tracker,
    load_chunk_tracker,
    store_chunk,
    assemble_chunks,
    cleanup_chunks,
    cleanup_expired_sessions,
)


@pytest.fixture
def temp_dir():
    """Create a temporary directory for testing"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


def test_chunk_tracker_initialization():
    """Test ChunkTracker initialization"""
    tracker = ChunkTracker(1000)
    assert tracker.total_size == 1000
    assert tracker.received_ranges == []
    assert not tracker.is_complete()


def test_chunk_tracker_add_single_range():
    """Test adding a single byte range"""
    tracker = ChunkTracker(1000)
    tracker.add_range(0, 99)

    assert len(tracker.received_ranges) == 1
    assert tracker.received_ranges[0] == (0, 99)
    assert tracker.get_received_bytes() == 100
    assert not tracker.is_complete()


def test_chunk_tracker_merge_adjacent_ranges():
    """Test merging adjacent ranges"""
    tracker = ChunkTracker(1000)
    tracker.add_range(0, 99)
    tracker.add_range(100, 199)

    assert len(tracker.received_ranges) == 1
    assert tracker.received_ranges[0] == (0, 199)
    assert tracker.get_received_bytes() == 200


def test_chunk_tracker_merge_overlapping_ranges():
    """Test merging overlapping ranges"""
    tracker = ChunkTracker(1000)
    tracker.add_range(0, 150)
    tracker.add_range(100, 250)

    assert len(tracker.received_ranges) == 1
    assert tracker.received_ranges[0] == (0, 250)
    assert tracker.get_received_bytes() == 251


def test_chunk_tracker_non_overlapping_ranges():
    """Test non-overlapping ranges stay separate"""
    tracker = ChunkTracker(1000)
    tracker.add_range(0, 99)
    tracker.add_range(200, 299)

    assert len(tracker.received_ranges) == 2
    assert tracker.received_ranges[0] == (0, 99)
    assert tracker.received_ranges[1] == (200, 299)
    assert tracker.get_received_bytes() == 200


def test_chunk_tracker_out_of_order_insertion():
    """Test chunks added out of order are properly sorted"""
    tracker = ChunkTracker(1000)
    tracker.add_range(400, 499)
    tracker.add_range(0, 99)
    tracker.add_range(200, 299)

    assert len(tracker.received_ranges) == 3
    assert tracker.received_ranges[0] == (0, 99)
    assert tracker.received_ranges[1] == (200, 299)
    assert tracker.received_ranges[2] == (400, 499)


def test_chunk_tracker_is_complete():
    """Test completion detection"""
    tracker = ChunkTracker(1000)

    # Not complete with partial data
    tracker.add_range(0, 499)
    assert not tracker.is_complete()

    # Complete when all bytes received
    tracker.add_range(500, 999)
    assert tracker.is_complete()


def test_chunk_tracker_missing_ranges():
    """Test getting missing byte ranges"""
    tracker = ChunkTracker(1000)

    # All missing initially
    missing = tracker.get_missing_ranges()
    assert len(missing) == 1
    assert missing[0] == (0, 999)

    # Add first chunk
    tracker.add_range(0, 299)
    missing = tracker.get_missing_ranges()
    assert len(missing) == 1
    assert missing[0] == (300, 999)

    # Add chunk in middle
    tracker.add_range(600, 899)
    missing = tracker.get_missing_ranges()
    assert len(missing) == 2
    assert missing[0] == (300, 599)
    assert missing[1] == (900, 999)

    # Fill all gaps
    tracker.add_range(300, 599)
    tracker.add_range(900, 999)
    missing = tracker.get_missing_ranges()
    assert len(missing) == 0


def test_chunk_tracker_serialization():
    """Test tracker serialization and deserialization"""
    tracker = ChunkTracker(1000)
    tracker.add_range(0, 299)
    tracker.add_range(600, 899)

    # Serialize
    data = tracker.to_dict()
    assert data["total_size"] == 1000
    assert len(data["received_ranges"]) == 2

    # Deserialize
    restored = ChunkTracker.from_dict(data)
    assert restored.total_size == 1000
    assert len(restored.received_ranges) == 2
    assert restored.received_ranges[0] == (0, 299)
    assert restored.received_ranges[1] == (600, 899)


def test_get_chunk_file_path(temp_dir):
    """Test chunk file path generation"""
    path = get_chunk_file_path(temp_dir, "upload123", 0)
    assert "upload123.chunk.0" in path
    assert os.path.dirname(path).endswith(".upload-sessions")


def test_get_tracker_file_path(temp_dir):
    """Test tracker file path generation"""
    path = get_tracker_file_path(temp_dir, "upload123")
    assert "upload123.tracker" in path
    assert os.path.dirname(path).endswith(".upload-sessions")


def test_save_and_load_chunk_tracker(temp_dir):
    """Test saving and loading chunk tracker"""
    tracker = ChunkTracker(1000)
    tracker.add_range(0, 299)
    tracker.add_range(600, 899)

    # Save
    save_chunk_tracker(temp_dir, "upload123", tracker)

    # Load
    loaded = load_chunk_tracker(temp_dir, "upload123", 1000)
    assert loaded.total_size == 1000
    assert len(loaded.received_ranges) == 2
    assert loaded.received_ranges[0] == (0, 299)


def test_load_nonexistent_tracker(temp_dir):
    """Test loading non-existent tracker creates new one"""
    tracker = load_chunk_tracker(temp_dir, "nonexistent", 1000)
    assert tracker.total_size == 1000
    assert len(tracker.received_ranges) == 0


def test_store_chunk(temp_dir):
    """Test storing a chunk"""
    chunk_data = b"Hello, World!"
    path = store_chunk(temp_dir, "upload123", chunk_data, 0, 0)

    assert os.path.exists(path)
    with open(path, "rb") as f:
        assert f.read() == chunk_data


def test_assemble_chunks(temp_dir):
    """Test assembling chunks into final file"""
    # Create 3 chunks
    chunk_size = 10
    total_size = 25

    store_chunk(temp_dir, "upload123", b"0123456789", 0, 0)
    store_chunk(temp_dir, "upload123", b"0123456789", 10, 1)
    store_chunk(temp_dir, "upload123", b"01234", 20, 2)

    target_path = os.path.join(temp_dir, "final.bin")

    # Assemble
    success = assemble_chunks(temp_dir, "upload123", target_path, total_size, chunk_size)

    assert success
    assert os.path.exists(target_path)
    assert os.path.getsize(target_path) == total_size

    with open(target_path, "rb") as f:
        data = f.read()
        assert len(data) == 25
        assert data == b"01234567890123456789" + b"01234"


def test_assemble_chunks_missing_chunk(temp_dir):
    """Test assembling fails when chunk is missing"""
    # Create only 2 of 3 chunks
    store_chunk(temp_dir, "upload123", b"0123456789", 0, 0)
    store_chunk(temp_dir, "upload123", b"01234", 20, 2)
    # Missing chunk 1

    target_path = os.path.join(temp_dir, "final.bin")

    # Should fail
    success = assemble_chunks(temp_dir, "upload123", target_path, 25, 10)

    assert not success


def test_cleanup_chunks(temp_dir):
    """Test cleaning up chunk files"""
    # Create some chunks
    store_chunk(temp_dir, "upload123", b"data1", 0, 0)
    store_chunk(temp_dir, "upload123", b"data2", 10, 1)
    store_chunk(temp_dir, "upload123", b"data3", 20, 2)

    # Create tracker
    tracker = ChunkTracker(30)
    save_chunk_tracker(temp_dir, "upload123", tracker)

    # Cleanup
    cleanup_chunks(temp_dir, "upload123", 3)

    # Verify files are gone
    assert not os.path.exists(get_tracker_file_path(temp_dir, "upload123"))
    assert not os.path.exists(get_chunk_file_path(temp_dir, "upload123", 0))
    assert not os.path.exists(get_chunk_file_path(temp_dir, "upload123", 1))
    assert not os.path.exists(get_chunk_file_path(temp_dir, "upload123", 2))


def test_cleanup_expired_sessions(temp_dir):
    """Test cleaning up expired sessions"""
    import time

    session_dir = os.path.join(temp_dir, ".upload-sessions")
    os.makedirs(session_dir, exist_ok=True)

    # Create an old file
    old_file = os.path.join(session_dir, "old.chunk.0")
    with open(old_file, "w") as f:
        f.write("old data")

    # Make it old (modify timestamp)
    old_time = time.time() - (25 * 3600)  # 25 hours ago
    os.utime(old_file, (old_time, old_time))

    # Create a new file
    new_file = os.path.join(session_dir, "new.chunk.0")
    with open(new_file, "w") as f:
        f.write("new data")

    # Cleanup sessions older than 24 hours
    cleaned = cleanup_expired_sessions(temp_dir, max_age_hours=24)

    assert cleaned >= 1
    assert not os.path.exists(old_file)
    assert os.path.exists(new_file)


def test_chunk_tracker_complex_scenario():
    """Test complex parallel upload scenario"""
    tracker = ChunkTracker(10000)

    # Simulate chunks arriving out of order
    tracker.add_range(5000, 5999)  # Middle chunk first
    tracker.add_range(0, 999)  # First chunk
    tracker.add_range(8000, 8999)  # Near end
    tracker.add_range(2000, 2999)  # Another middle
    tracker.add_range(1000, 1999)  # Fill gap
    tracker.add_range(3000, 4999)  # Large chunk
    tracker.add_range(6000, 7999)  # Fill another gap
    tracker.add_range(9000, 9999)  # Last chunk

    # Should be complete
    assert tracker.is_complete()
    assert tracker.get_received_bytes() == 10000
    assert len(tracker.received_ranges) == 1
    assert tracker.received_ranges[0] == (0, 9999)
