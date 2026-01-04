from __future__ import annotations

from dataclasses import dataclass

from flask import current_app

from .filebrowser import FileBrowserClient


@dataclass
class ServiceContainer:
    filebrowser: FileBrowserClient


def build_services() -> ServiceContainer:
    return ServiceContainer(filebrowser=FileBrowserClient())


def init_services(app, services: ServiceContainer | None = None) -> ServiceContainer:
    container = services or build_services()
    app.extensions["services"] = container
    return container


def get_services() -> ServiceContainer:
    container = current_app.extensions.get("services")
    if container is None:
        container = build_services()
        current_app.extensions["services"] = container
    return container
