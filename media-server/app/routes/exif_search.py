from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from ..services.exif import (
    extract_exif_data,
    extract_searchable_fields,
    get_unique_camera_models,
    search_by_exif,
)
from ..utils.validation import is_valid_share_hash

logger = logging.getLogger("droppr.exif_search")


def create_exif_search_blueprint(deps: dict):
    """Create blueprint for EXIF search functionality"""
    bp = Blueprint("exif_search", __name__)

    get_share_files = deps["get_share_files"]

    @bp.route("/api/share/<share_hash>/exif-search", methods=["POST"])
    def exif_search(share_hash: str):
        """
        Search files in a share by EXIF metadata.

        POST /api/share/<hash>/exif-search
        {
            "camera_make": "Canon",
            "camera_model": "EOS 5D",
            "iso_min": 100,
            "iso_max": 3200,
            "date_from": "2023-01-01T00:00:00",
            "date_to": "2023-12-31T23:59:59",
            "has_gps": true,
            "keywords": ["vacation", "beach"]
        }
        """
        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid share hash"}), 400

        # Get all files from share
        try:
            files = get_share_files(share_hash)
            if not files:
                return jsonify({"results": [], "total": 0})
        except Exception as e:
            logger.error(f"Failed to get share files: {e}")
            return jsonify({"error": "Failed to load share"}), 500

        # Parse search criteria
        data = request.get_json(silent=True) or {}

        camera_make = data.get("camera_make")
        camera_model = data.get("camera_model")
        iso_min = data.get("iso_min")
        iso_max = data.get("iso_max")
        date_from = data.get("date_from")
        date_to = data.get("date_to")
        has_gps = data.get("has_gps")
        keywords = data.get("keywords")

        # Validate ISO range
        if iso_min is not None:
            try:
                iso_min = int(iso_min)
            except (ValueError, TypeError):
                return jsonify({"error": "Invalid iso_min value"}), 400

        if iso_max is not None:
            try:
                iso_max = int(iso_max)
            except (ValueError, TypeError):
                return jsonify({"error": "Invalid iso_max value"}), 400

        # Ensure files have EXIF data loaded
        # (This would be done by background job in production)
        files_with_exif = []
        for file_info in files:
            if "exif" not in file_info:
                # Extract EXIF on-demand (could be cached)
                file_path = file_info.get("path")
                if file_path:
                    exif_data = extract_exif_data(file_path)
                    if exif_data:
                        file_info["exif"] = extract_searchable_fields(exif_data)
            files_with_exif.append(file_info)

        # Perform search
        results = search_by_exif(
            files_with_exif,
            camera_make=camera_make,
            camera_model=camera_model,
            iso_min=iso_min,
            iso_max=iso_max,
            date_from=date_from,
            date_to=date_to,
            has_gps=has_gps,
            keywords=keywords,
        )

        return jsonify(
            {
                "results": results,
                "total": len(results),
                "searched": len(files_with_exif),
                "criteria": {
                    "camera_make": camera_make,
                    "camera_model": camera_model,
                    "iso_min": iso_min,
                    "iso_max": iso_max,
                    "date_from": date_from,
                    "date_to": date_to,
                    "has_gps": has_gps,
                    "keywords": keywords,
                },
            }
        )

    @bp.route("/api/share/<share_hash>/exif-cameras")
    def get_cameras(share_hash: str):
        """
        Get list of unique cameras used in share.

        GET /api/share/<hash>/exif-cameras
        """
        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid share hash"}), 400

        try:
            files = get_share_files(share_hash)
            if not files:
                return jsonify({"cameras": []})
        except Exception as e:
            logger.error(f"Failed to get share files: {e}")
            return jsonify({"error": "Failed to load share"}), 500

        # Ensure files have EXIF data
        files_with_exif = []
        for file_info in files:
            if "exif" not in file_info:
                file_path = file_info.get("path")
                if file_path:
                    exif_data = extract_exif_data(file_path)
                    if exif_data:
                        file_info["exif"] = extract_searchable_fields(exif_data)
            files_with_exif.append(file_info)

        cameras = get_unique_camera_models(files_with_exif)

        return jsonify({"cameras": cameras, "total": len(cameras)})

    @bp.route("/api/file/<path:file_path>/exif")
    def get_file_exif(file_path: str):
        """
        Get EXIF metadata for a specific file.

        GET /api/file/<path>/exif
        """
        # This endpoint would need proper authorization in production
        # For now, it's a simple extraction endpoint

        try:
            exif_data = extract_exif_data(file_path)
            if not exif_data:
                return jsonify({"error": "No EXIF data found"}), 404

            searchable = extract_searchable_fields(exif_data)

            return jsonify(
                {
                    "file": file_path,
                    "exif": searchable,
                    "raw": exif_data,  # Include raw EXIF for debugging
                }
            )
        except Exception as e:
            logger.error(f"Failed to extract EXIF: {e}")
            return jsonify({"error": "Failed to extract EXIF data"}), 500

    return bp
