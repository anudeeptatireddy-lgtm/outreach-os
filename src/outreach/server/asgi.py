"""ASGI entry point: `uvicorn outreach.server.asgi:app`."""

from outreach.server.app import create_app

app = create_app()
