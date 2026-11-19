"""Vercel entry point: the whole FastAPI app as one Python function.

Static dashboard files are served by Vercel's CDN from frontend/dist; every /api/* and /u/*
request is rewritten here (see vercel.json).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from outreach.server.app import create_app  # noqa: E402

app = create_app()
