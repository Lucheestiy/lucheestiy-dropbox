from __future__ import annotations

import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.celery import CeleryInstrumentor
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter


def configure_tracing(app) -> None:
    otel_enabled = os.environ.get("DROPPR_OTEL_ENABLED", "false").lower() == "true"
    if not otel_enabled:
        return

    service_name = os.environ.get("DROPPR_OTEL_SERVICE_NAME", "droppr-media-server")
    exporter_otlp_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "")

    resource = Resource.create(
        {
            "service.name": service_name,
        }
    )

    provider = TracerProvider(resource=resource)
    
    if exporter_otlp_endpoint:
        exporter = OTLPSpanExporter(endpoint=exporter_otlp_endpoint, insecure=True)
        provider.add_span_processor(BatchSpanProcessor(exporter))
    else:
        # Fallback to console if no endpoint provided
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))

    trace.set_tracer_provider(provider)
    
    # Instrument Flask
    FlaskInstrumentor().instrument_app(app)
    
    # Instrument Requests
    RequestsInstrumentor().instrument()
    
    # Instrument Celery
    CeleryInstrumentor().instrument()
