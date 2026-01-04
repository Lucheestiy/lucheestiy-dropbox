import time


def test_parsing_helpers(app_module):
    import app.services.video_meta as video_meta_service
    assert video_meta_service._parse_float("3.5") == 3.5
    assert video_meta_service._parse_float("bad") is None
    assert video_meta_service._positive_int("5") == 5
    assert video_meta_service._positive_int("0") is None
    assert video_meta_service._positive_float("2.5") == 2.5
    assert video_meta_service._positive_float("-1") is None

    assert video_meta_service._parse_ratio("16:9") == (16.0, 9.0)
    assert video_meta_service._parse_ratio("1/0") is None
    assert video_meta_service._parse_ratio("bad") is None

    assert video_meta_service._parse_fps("30") == 30.0
    assert video_meta_service._parse_fps("30000/1001") == 30000 / 1001
    assert video_meta_service._parse_fps("0/0") is None

    timestamp = video_meta_service._parse_iso8601_to_unix("2024-01-01T00:00:00Z")
    assert isinstance(timestamp, int)

    meta = {"a": 1, "b": None, "c": "", "d": {}}
    assert video_meta_service._strip_empty(meta) == {"a": 1}


def test_extract_ffprobe_meta(app_module):
    import app.services.video_meta as video_meta_service
    payload = {
        "format": {"duration": "12.5", "size": "2048"},
        "streams": [
            {"codec_type": "video", "width": 1920, "height": 1080, "r_frame_rate": "30/1"},
            {"codec_type": "audio", "sample_rate": "44100", "channels": 2},
        ],
    }
    meta = video_meta_service._extract_ffprobe_meta(payload)
    assert meta
    assert meta["duration"] == 12.5
    assert meta["size"] == 2048
    assert meta["video"]["width"] == 1920
    assert meta["video"]["height"] == 1080
    assert meta["video"]["fps"] == 30.0
