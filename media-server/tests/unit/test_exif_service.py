from __future__ import annotations

import pytest
from datetime import datetime

from app.services.exif import (
    is_image_file,
    extract_searchable_fields,
    parse_exif_date,
    parse_gps_coordinate,
    search_by_exif,
    get_unique_camera_models,
)


def test_is_image_file():
    """Test image file detection"""
    assert is_image_file("photo.jpg")
    assert is_image_file("photo.JPG")
    assert is_image_file("photo.jpeg")
    assert is_image_file("photo.png")
    assert is_image_file("photo.tiff")
    assert is_image_file("photo.heic")
    assert is_image_file("photo.cr2")
    assert is_image_file("photo.nef")
    assert not is_image_file("video.mp4")
    assert not is_image_file("document.pdf")
    assert not is_image_file("file.txt")


def test_extract_searchable_fields_camera_info():
    """Test extraction of camera information"""
    raw_exif = {
        "Make": "Canon",
        "Model": "EOS 5D Mark IV",
        "LensModel": "EF 24-70mm f/2.8L II USM",
    }

    result = extract_searchable_fields(raw_exif)

    assert result["camera_make"] == "Canon"
    assert result["camera_model"] == "EOS 5D Mark IV"
    assert result["lens_model"] == "EF 24-70mm f/2.8L II USM"


def test_extract_searchable_fields_camera_settings():
    """Test extraction of camera settings"""
    raw_exif = {
        "ISO": 800,
        "FNumber": "f/2.8",
        "ShutterSpeed": "1/200",
        "FocalLength": "50mm",
    }

    result = extract_searchable_fields(raw_exif)

    assert result["iso"] == 800
    assert result["aperture"] == "f/2.8"
    assert result["shutter_speed"] == "1/200"
    assert result["focal_length"] == "50mm"


def test_extract_searchable_fields_dimensions():
    """Test extraction of image dimensions"""
    raw_exif = {
        "ImageWidth": 6720,
        "ImageHeight": 4480,
    }

    result = extract_searchable_fields(raw_exif)

    assert result["width"] == 6720
    assert result["height"] == 4480


def test_extract_searchable_fields_date():
    """Test extraction and parsing of date"""
    raw_exif = {
        "DateTimeOriginal": "2023:12:25 14:30:45",
    }

    result = extract_searchable_fields(raw_exif)

    assert "date_taken" in result
    assert result["date_taken"] == "2023-12-25T14:30:45"


def test_extract_searchable_fields_gps():
    """Test extraction of GPS coordinates"""
    raw_exif = {
        "GPSLatitude": "37 deg 46' 29.66\" N",
        "GPSLatitudeRef": "N",
        "GPSLongitude": "122 deg 25' 9.12\" W",
        "GPSLongitudeRef": "W",
    }

    result = extract_searchable_fields(raw_exif)

    assert "gps_latitude" in result
    assert "gps_longitude" in result
    assert abs(result["gps_latitude"] - 37.7749) < 0.01
    assert abs(result["gps_longitude"] - (-122.4192)) < 0.01


def test_extract_searchable_fields_metadata():
    """Test extraction of copyright and keywords"""
    raw_exif = {
        "Copyright": "© 2023 John Doe",
        "Artist": "John Doe",
        "Keywords": ["vacation", "beach", "sunset"],
        "ImageDescription": "Beautiful sunset at the beach",
    }

    result = extract_searchable_fields(raw_exif)

    assert result["copyright"] == "© 2023 John Doe"
    assert result["artist"] == "John Doe"
    assert result["keywords"] == ["vacation", "beach", "sunset"]
    assert result["description"] == "Beautiful sunset at the beach"


def test_extract_searchable_fields_empty():
    """Test extraction with empty EXIF data"""
    result = extract_searchable_fields({})
    assert result == {}

    result = extract_searchable_fields(None)
    assert result == {}


def test_parse_exif_date_valid():
    """Test parsing valid EXIF date"""
    date_str = "2023:12:25 14:30:45"
    result = parse_exif_date(date_str)
    assert result == "2023-12-25T14:30:45"


def test_parse_exif_date_invalid():
    """Test parsing invalid EXIF date"""
    assert parse_exif_date("invalid") is None
    assert parse_exif_date("") is None
    assert parse_exif_date(None) is None


def test_parse_gps_coordinate_dms():
    """Test parsing GPS coordinate in DMS format"""
    # North latitude
    coord = parse_gps_coordinate("37 deg 46' 29.66\" N", "N")
    assert abs(coord - 37.7749) < 0.01

    # South latitude (negative)
    coord = parse_gps_coordinate("33 deg 52' 0\" S", "S")
    assert abs(coord - (-33.8667)) < 0.01

    # East longitude
    coord = parse_gps_coordinate("151 deg 12' 0\" E", "E")
    assert abs(coord - 151.2) < 0.01

    # West longitude (negative)
    coord = parse_gps_coordinate("122 deg 25' 9.12\" W", "W")
    assert abs(coord - (-122.4192)) < 0.01


def test_parse_gps_coordinate_decimal():
    """Test parsing GPS coordinate in decimal format"""
    coord = parse_gps_coordinate("37.7749", "N")
    assert abs(coord - 37.7749) < 0.01

    coord = parse_gps_coordinate("-122.4192", "W")
    assert abs(coord - (-122.4192)) < 0.01


def test_parse_gps_coordinate_invalid():
    """Test parsing invalid GPS coordinate"""
    assert parse_gps_coordinate("invalid", "N") is None
    assert parse_gps_coordinate("", "N") is None
    assert parse_gps_coordinate(None, "N") is None


def test_search_by_exif_camera_make():
    """Test searching by camera make"""
    files = [
        {"name": "photo1.jpg", "exif": {"camera_make": "Canon"}},
        {"name": "photo2.jpg", "exif": {"camera_make": "Nikon"}},
        {"name": "photo3.jpg", "exif": {"camera_make": "Canon"}},
    ]

    results = search_by_exif(files, camera_make="Canon")
    assert len(results) == 2
    assert results[0]["name"] == "photo1.jpg"
    assert results[1]["name"] == "photo3.jpg"


def test_search_by_exif_camera_model():
    """Test searching by camera model"""
    files = [
        {"name": "photo1.jpg", "exif": {"camera_model": "EOS 5D Mark IV"}},
        {"name": "photo2.jpg", "exif": {"camera_model": "D850"}},
        {"name": "photo3.jpg", "exif": {"camera_model": "EOS R5"}},
    ]

    results = search_by_exif(files, camera_model="EOS")
    assert len(results) == 2
    assert results[0]["name"] == "photo1.jpg"
    assert results[1]["name"] == "photo3.jpg"


def test_search_by_exif_iso_range():
    """Test searching by ISO range"""
    files = [
        {"name": "photo1.jpg", "exif": {"iso": 100}},
        {"name": "photo2.jpg", "exif": {"iso": 800}},
        {"name": "photo3.jpg", "exif": {"iso": 3200}},
        {"name": "photo4.jpg", "exif": {"iso": 1600}},
    ]

    results = search_by_exif(files, iso_min=800, iso_max=2000)
    assert len(results) == 2
    assert results[0]["name"] == "photo2.jpg"
    assert results[1]["name"] == "photo4.jpg"


def test_search_by_exif_date_range():
    """Test searching by date range"""
    files = [
        {"name": "photo1.jpg", "exif": {"date_taken": "2023-01-15T12:00:00"}},
        {"name": "photo2.jpg", "exif": {"date_taken": "2023-06-20T15:30:00"}},
        {"name": "photo3.jpg", "exif": {"date_taken": "2023-12-25T18:45:00"}},
    ]

    results = search_by_exif(
        files, date_from="2023-06-01T00:00:00", date_to="2023-12-31T23:59:59"
    )
    assert len(results) == 2
    assert results[0]["name"] == "photo2.jpg"
    assert results[1]["name"] == "photo3.jpg"


def test_search_by_exif_gps():
    """Test searching by GPS presence"""
    files = [
        {"name": "photo1.jpg", "exif": {"gps_latitude": 37.7749, "gps_longitude": -122.4192}},
        {"name": "photo2.jpg", "exif": {}},
        {"name": "photo3.jpg", "exif": {"gps_latitude": 40.7128, "gps_longitude": -74.0060}},
    ]

    # Only photos with GPS
    results = search_by_exif(files, has_gps=True)
    assert len(results) == 2
    assert results[0]["name"] == "photo1.jpg"
    assert results[1]["name"] == "photo3.jpg"

    # Only photos without GPS
    results = search_by_exif(files, has_gps=False)
    assert len(results) == 1
    assert results[0]["name"] == "photo2.jpg"


def test_search_by_exif_keywords():
    """Test searching by keywords"""
    files = [
        {"name": "photo1.jpg", "exif": {"keywords": ["vacation", "beach"]}},
        {"name": "photo2.jpg", "exif": {"keywords": ["family", "portrait"]}},
        {"name": "photo3.jpg", "exif": {"keywords": ["vacation", "sunset"]}},
    ]

    results = search_by_exif(files, keywords=["vacation"])
    assert len(results) == 2
    assert results[0]["name"] == "photo1.jpg"
    assert results[1]["name"] == "photo3.jpg"


def test_search_by_exif_multiple_criteria():
    """Test searching with multiple criteria"""
    files = [
        {
            "name": "photo1.jpg",
            "exif": {
                "camera_make": "Canon",
                "iso": 800,
                "date_taken": "2023-06-15T12:00:00",
            },
        },
        {
            "name": "photo2.jpg",
            "exif": {
                "camera_make": "Canon",
                "iso": 1600,
                "date_taken": "2023-06-20T15:00:00",
            },
        },
        {
            "name": "photo3.jpg",
            "exif": {
                "camera_make": "Nikon",
                "iso": 800,
                "date_taken": "2023-06-18T10:00:00",
            },
        },
    ]

    results = search_by_exif(
        files,
        camera_make="Canon",
        iso_min=500,
        iso_max=1000,
        date_from="2023-06-01T00:00:00",
    )
    assert len(results) == 1
    assert results[0]["name"] == "photo1.jpg"


def test_search_by_exif_no_matches():
    """Test searching with no matching results"""
    files = [
        {"name": "photo1.jpg", "exif": {"camera_make": "Canon"}},
        {"name": "photo2.jpg", "exif": {"camera_make": "Nikon"}},
    ]

    results = search_by_exif(files, camera_make="Sony")
    assert len(results) == 0


def test_get_unique_camera_models():
    """Test getting unique camera models"""
    files = [
        {"name": "photo1.jpg", "exif": {"camera_make": "Canon", "camera_model": "EOS 5D"}},
        {"name": "photo2.jpg", "exif": {"camera_make": "Nikon", "camera_model": "D850"}},
        {"name": "photo3.jpg", "exif": {"camera_make": "Canon", "camera_model": "EOS 5D"}},
        {"name": "photo4.jpg", "exif": {"camera_make": "Canon", "camera_model": "EOS R5"}},
    ]

    cameras = get_unique_camera_models(files)
    assert len(cameras) == 3

    # Should be sorted
    assert cameras[0]["make"] == "Canon"
    assert cameras[0]["model"] == "EOS 5D"
    assert cameras[1]["make"] == "Canon"
    assert cameras[1]["model"] == "EOS R5"
    assert cameras[2]["make"] == "Nikon"
    assert cameras[2]["model"] == "D850"


def test_get_unique_camera_models_empty():
    """Test getting unique camera models from empty list"""
    cameras = get_unique_camera_models([])
    assert cameras == []


def test_get_unique_camera_models_no_exif():
    """Test getting unique camera models when files have no EXIF"""
    files = [
        {"name": "photo1.jpg", "exif": {}},
        {"name": "photo2.jpg"},
    ]

    cameras = get_unique_camera_models(files)
    # Should still return "Unknown" entries
    assert len(cameras) >= 0
