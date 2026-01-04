from __future__ import annotations

from unittest.mock import MagicMock
import pytest
from flask import Flask

from app.services.container import (
    ServiceContainer,
    build_services,
    init_services,
    get_services,
)
from app.services.filebrowser import FileBrowserClient


def test_service_container_dataclass():
    """Test ServiceContainer dataclass creation"""
    fb_client = FileBrowserClient()
    container = ServiceContainer(filebrowser=fb_client)

    assert isinstance(container, ServiceContainer)
    assert container.filebrowser is fb_client


def test_build_services():
    """Test build_services creates a ServiceContainer with FileBrowserClient"""
    container = build_services()

    assert isinstance(container, ServiceContainer)
    assert isinstance(container.filebrowser, FileBrowserClient)


def test_init_services_with_provided_container():
    """Test init_services with a provided ServiceContainer"""
    app = Flask(__name__)
    app.extensions = {}

    mock_fb = MagicMock(spec=FileBrowserClient)
    provided_container = ServiceContainer(filebrowser=mock_fb)

    result = init_services(app, services=provided_container)

    assert result is provided_container
    assert app.extensions["services"] is provided_container
    assert app.extensions["services"].filebrowser is mock_fb


def test_init_services_without_provided_container():
    """Test init_services builds a new container if none provided"""
    app = Flask(__name__)
    app.extensions = {}

    result = init_services(app)

    assert isinstance(result, ServiceContainer)
    assert isinstance(result.filebrowser, FileBrowserClient)
    assert app.extensions["services"] is result


def test_get_services_when_exists():
    """Test get_services retrieves existing container from app context"""
    app = Flask(__name__)
    mock_fb = MagicMock(spec=FileBrowserClient)
    expected_container = ServiceContainer(filebrowser=mock_fb)
    app.extensions = {"services": expected_container}

    with app.app_context():
        result = get_services()

        assert result is expected_container
        assert result.filebrowser is mock_fb


def test_get_services_creates_if_not_exists():
    """Test get_services creates and caches container if it doesn't exist"""
    app = Flask(__name__)
    app.extensions = {}

    with app.app_context():
        result = get_services()

        assert isinstance(result, ServiceContainer)
        assert isinstance(result.filebrowser, FileBrowserClient)
        assert app.extensions["services"] is result

        # Second call should return same instance
        result2 = get_services()
        assert result2 is result


def test_get_services_multiple_calls_same_instance():
    """Test get_services returns same instance on multiple calls"""
    app = Flask(__name__)
    app.extensions = {}

    with app.app_context():
        first = get_services()
        second = get_services()
        third = get_services()

        assert first is second
        assert second is third
