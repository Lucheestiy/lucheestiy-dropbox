from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from app.tracing import configure_tracing


@pytest.fixture
def app():
    return Flask(__name__)


@patch.dict(os.environ, {"DROPPR_OTEL_ENABLED": "false"})
def test_tracing_disabled(app):
    """Test that tracing does nothing when disabled"""
    with patch("app.tracing.trace.set_tracer_provider") as mock_set_provider:
        configure_tracing(app)
        mock_set_provider.assert_not_called()


@patch.dict(os.environ, {
    "DROPPR_OTEL_ENABLED": "true",
    "DROPPR_OTEL_SERVICE_NAME": "test-service",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4317"
})
@patch("app.tracing.TracerProvider")
@patch("app.tracing.OTLPSpanExporter")
@patch("app.tracing.BatchSpanProcessor")
@patch("app.tracing.trace.set_tracer_provider")
@patch("app.tracing.FlaskInstrumentor")
@patch("app.tracing.RequestsInstrumentor")
@patch("app.tracing.CeleryInstrumentor")
def test_tracing_enabled_with_otlp_endpoint(
    mock_celery_inst,
    mock_requests_inst,
    mock_flask_inst,
    mock_set_provider,
    mock_batch_processor,
    mock_otlp_exporter,
    mock_tracer_provider,
    app
):
    """Test tracing configuration when enabled with OTLP endpoint"""
    mock_provider = MagicMock()
    mock_tracer_provider.return_value = mock_provider
    mock_exporter = MagicMock()
    mock_otlp_exporter.return_value = mock_exporter
    mock_processor = MagicMock()
    mock_batch_processor.return_value = mock_processor

    configure_tracing(app)

    # Verify provider was created with service name
    mock_tracer_provider.assert_called_once()
    resource_arg = mock_tracer_provider.call_args[1]["resource"]
    assert resource_arg.attributes["service.name"] == "test-service"

    # Verify OTLP exporter was created
    mock_otlp_exporter.assert_called_once_with(
        endpoint="http://localhost:4317",
        insecure=True
    )

    # Verify batch processor was added
    mock_batch_processor.assert_called_once_with(mock_exporter)
    mock_provider.add_span_processor.assert_called_once_with(mock_processor)

    # Verify tracer provider was set
    mock_set_provider.assert_called_once_with(mock_provider)

    # Verify instrumentors were called
    mock_flask_inst.return_value.instrument_app.assert_called_once_with(app)
    mock_requests_inst.return_value.instrument.assert_called_once()
    mock_celery_inst.return_value.instrument.assert_called_once()


@patch.dict(os.environ, {
    "DROPPR_OTEL_ENABLED": "true",
    "OTEL_EXPORTER_OTLP_ENDPOINT": ""
})
@patch("app.tracing.TracerProvider")
@patch("app.tracing.ConsoleSpanExporter")
@patch("app.tracing.BatchSpanProcessor")
@patch("app.tracing.trace.set_tracer_provider")
@patch("app.tracing.FlaskInstrumentor")
@patch("app.tracing.RequestsInstrumentor")
@patch("app.tracing.CeleryInstrumentor")
def test_tracing_enabled_without_otlp_endpoint(
    mock_celery_inst,
    mock_requests_inst,
    mock_flask_inst,
    mock_set_provider,
    mock_batch_processor,
    mock_console_exporter,
    mock_tracer_provider,
    app
):
    """Test tracing falls back to console exporter when no OTLP endpoint"""
    mock_provider = MagicMock()
    mock_tracer_provider.return_value = mock_provider
    mock_exporter = MagicMock()
    mock_console_exporter.return_value = mock_exporter
    mock_processor = MagicMock()
    mock_batch_processor.return_value = mock_processor

    configure_tracing(app)

    # Verify provider used default service name
    mock_tracer_provider.assert_called_once()
    resource_arg = mock_tracer_provider.call_args[1]["resource"]
    assert resource_arg.attributes["service.name"] == "droppr-media-server"

    # Verify console exporter was used
    mock_console_exporter.assert_called_once()
    mock_batch_processor.assert_called_once_with(mock_exporter)
    mock_provider.add_span_processor.assert_called_once_with(mock_processor)

    # Verify tracer provider was set
    mock_set_provider.assert_called_once_with(mock_provider)

    # Verify instrumentors were called
    mock_flask_inst.return_value.instrument_app.assert_called_once_with(app)
    mock_requests_inst.return_value.instrument.assert_called_once()
    mock_celery_inst.return_value.instrument.assert_called_once()
