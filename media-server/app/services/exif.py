from __future__ import annotations

import json
import logging
import os
import subprocess
from datetime import datetime
from typing import Any

logger = logging.getLogger("droppr.exif")

# Supported image extensions for EXIF extraction
SUPPORTED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".tiff",
    ".tif",
    ".heic",
    ".heif",
    ".webp",
    ".dng",
    ".cr2",
    ".nef",
    ".arw",
}


def is_image_file(filename: str) -> bool:
    """Check if file is an image that might have EXIF data"""
    ext = os.path.splitext(filename.lower())[1]
    return ext in SUPPORTED_EXTENSIONS


def extract_exif_data(file_path: str) -> dict[str, Any] | None:
    """
    Extract EXIF metadata from an image file using exiftool.

    Returns a dictionary of EXIF tags or None if extraction fails.
    """
    if not os.path.exists(file_path):
        logger.warning(f"File not found: {file_path}")
        return None

    if not is_image_file(file_path):
        logger.debug(f"Skipping non-image file: {file_path}")
        return None

    try:
        # Use exiftool to extract metadata as JSON
        result = subprocess.run(
            ["exiftool", "-json", "-charset", "utf8", file_path],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

        if result.returncode != 0:
            logger.warning(f"exiftool failed for {file_path}: {result.stderr}")
            return None

        # Parse JSON output
        data = json.loads(result.stdout)
        if not data or not isinstance(data, list) or len(data) == 0:
            return None

        return data[0]

    except subprocess.TimeoutExpired:
        logger.error(f"exiftool timeout for {file_path}")
        return None
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse exiftool JSON: {e}")
        return None
    except FileNotFoundError:
        logger.error("exiftool not found. Install it with: apt-get install libimage-exiftool-perl")
        return None
    except Exception as e:
        logger.error(f"Unexpected error extracting EXIF: {e}")
        return None


def extract_searchable_fields(exif_data: dict[str, Any]) -> dict[str, Any]:
    """
    Extract commonly searched EXIF fields into a normalized structure.

    Returns a dictionary with standardized field names and values.
    """
    if not exif_data:
        return {}

    searchable: dict[str, Any] = {}

    # Camera information
    if "Make" in exif_data:
        searchable["camera_make"] = str(exif_data["Make"]).strip()
    if "Model" in exif_data:
        searchable["camera_model"] = str(exif_data["Model"]).strip()

    # Lens information
    if "LensModel" in exif_data:
        searchable["lens_model"] = str(exif_data["LensModel"]).strip()
    elif "Lens" in exif_data:
        searchable["lens_model"] = str(exif_data["Lens"]).strip()

    # Camera settings
    if "ISO" in exif_data:
        try:
            searchable["iso"] = int(exif_data["ISO"])
        except (ValueError, TypeError):
            pass

    if "FNumber" in exif_data:
        searchable["aperture"] = str(exif_data["FNumber"])
    elif "Aperture" in exif_data:
        searchable["aperture"] = str(exif_data["Aperture"])

    if "ShutterSpeed" in exif_data:
        searchable["shutter_speed"] = str(exif_data["ShutterSpeed"])
    elif "ExposureTime" in exif_data:
        searchable["shutter_speed"] = str(exif_data["ExposureTime"])

    if "FocalLength" in exif_data:
        searchable["focal_length"] = str(exif_data["FocalLength"])

    # Image dimensions
    if "ImageWidth" in exif_data:
        try:
            searchable["width"] = int(exif_data["ImageWidth"])
        except (ValueError, TypeError):
            pass

    if "ImageHeight" in exif_data:
        try:
            searchable["height"] = int(exif_data["ImageHeight"])
        except (ValueError, TypeError):
            pass

    # Date information
    if "DateTimeOriginal" in exif_data:
        searchable["date_taken"] = parse_exif_date(exif_data["DateTimeOriginal"])
    elif "CreateDate" in exif_data:
        searchable["date_taken"] = parse_exif_date(exif_data["CreateDate"])

    # GPS location
    if "GPSLatitude" in exif_data and "GPSLongitude" in exif_data:
        lat = parse_gps_coordinate(exif_data["GPSLatitude"], exif_data.get("GPSLatitudeRef", "N"))
        lon = parse_gps_coordinate(exif_data["GPSLongitude"], exif_data.get("GPSLongitudeRef", "E"))
        if lat is not None and lon is not None:
            searchable["gps_latitude"] = lat
            searchable["gps_longitude"] = lon

    # GPS location name
    if "GPSPosition" in exif_data:
        searchable["gps_position"] = str(exif_data["GPSPosition"])

    # Copyright and author
    if "Copyright" in exif_data:
        searchable["copyright"] = str(exif_data["Copyright"]).strip()
    if "Artist" in exif_data:
        searchable["artist"] = str(exif_data["Artist"]).strip()
    elif "Creator" in exif_data:
        searchable["artist"] = str(exif_data["Creator"]).strip()

    # Keywords and tags
    if "Keywords" in exif_data:
        keywords = exif_data["Keywords"]
        if isinstance(keywords, list):
            searchable["keywords"] = [str(k).strip() for k in keywords if k]
        elif isinstance(keywords, str):
            searchable["keywords"] = [k.strip() for k in keywords.split(",") if k.strip()]

    # Image description
    if "ImageDescription" in exif_data:
        searchable["description"] = str(exif_data["ImageDescription"]).strip()
    elif "Description" in exif_data:
        searchable["description"] = str(exif_data["Description"]).strip()

    # Orientation
    if "Orientation" in exif_data:
        searchable["orientation"] = str(exif_data["Orientation"])

    # Color space
    if "ColorSpace" in exif_data:
        searchable["color_space"] = str(exif_data["ColorSpace"])

    return searchable


def parse_exif_date(date_str: str) -> str | None:
    """
    Parse EXIF date string to ISO format.

    EXIF dates are typically in format: "2023:12:31 14:30:45"
    """
    if not date_str:
        return None

    try:
        # Replace colons in date part with dashes
        normalized = date_str.replace(":", "-", 2)
        # Parse and format as ISO
        dt = datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S")
        return dt.isoformat()
    except (ValueError, AttributeError):
        return None


def parse_gps_coordinate(coord_str: str, ref: str) -> float | None:
    """
    Parse GPS coordinate from EXIF format to decimal degrees.

    Example: "37 deg 46' 29.66\" N" -> 37.774906
    """
    if not coord_str:
        return None

    try:
        # Handle already decimal format
        if isinstance(coord_str, (int, float)):
            coord = float(coord_str)
        elif " deg " in coord_str:
            # Parse DMS format: "37 deg 46' 29.66\" N"
            parts = coord_str.replace("\"", "").replace("'", "").split()
            degrees = float(parts[0])
            minutes = float(parts[2]) if len(parts) > 2 else 0
            seconds = float(parts[3]) if len(parts) > 3 else 0

            coord = degrees + (minutes / 60.0) + (seconds / 3600.0)
        else:
            coord = float(coord_str)

        # Apply hemisphere (S and W are negative)
        ref = (ref or "").upper()
        if ref in {"S", "W"}:
            coord = -abs(coord)
        elif ref in {"N", "E"}:
            coord = abs(coord)

        return coord

    except (ValueError, IndexError, AttributeError):
        return None


def search_by_exif(
    file_list: list[dict[str, Any]],
    camera_make: str | None = None,
    camera_model: str | None = None,
    iso_min: int | None = None,
    iso_max: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    has_gps: bool | None = None,
    keywords: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    Filter file list by EXIF metadata criteria.

    Args:
        file_list: List of file metadata dicts (must include 'exif' field)
        camera_make: Filter by camera manufacturer
        camera_model: Filter by camera model
        iso_min: Minimum ISO value
        iso_max: Maximum ISO value
        date_from: Earliest date (ISO format)
        date_to: Latest date (ISO format)
        has_gps: Filter files with/without GPS data
        keywords: List of keywords to match

    Returns:
        Filtered list of files matching criteria
    """
    results = []

    for file_info in file_list:
        exif = file_info.get("exif")
        if exif is None or not isinstance(exif, dict):
            continue

        # Camera make filter
        if camera_make:
            if exif.get("camera_make", "").lower() != camera_make.lower():
                continue

        # Camera model filter
        if camera_model:
            model = exif.get("camera_model", "").lower()
            if camera_model.lower() not in model:
                continue

        # ISO range filter
        if iso_min is not None or iso_max is not None:
            iso = exif.get("iso")
            if iso is None:
                continue
            if iso_min is not None and iso < iso_min:
                continue
            if iso_max is not None and iso > iso_max:
                continue

        # Date range filter
        if date_from or date_to:
            date_taken = exif.get("date_taken")
            if not date_taken:
                continue
            if date_from and date_taken < date_from:
                continue
            if date_to and date_taken > date_to:
                continue

        # GPS filter
        if has_gps is not None:
            has_coords = "gps_latitude" in exif and "gps_longitude" in exif
            if has_gps != has_coords:
                continue

        # Keywords filter
        if keywords:
            file_keywords = exif.get("keywords", [])
            if not any(kw.lower() in [fk.lower() for fk in file_keywords] for kw in keywords):
                continue

        results.append(file_info)

    return results


def get_unique_camera_models(file_list: list[dict[str, Any]]) -> list[dict[str, str]]:
    """
    Get list of unique camera makes and models from file list.

    Returns:
        List of dicts with 'make' and 'model' keys
    """
    cameras = set()

    for file_info in file_list:
        exif = file_info.get("exif", {})
        if not exif:
            continue

        make = exif.get("camera_make", "Unknown")
        model = exif.get("camera_model", "Unknown")
        cameras.add((make, model))

    return [{"make": make, "model": model} for make, model in sorted(cameras)]
