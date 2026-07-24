"""
PyOS — config.py
================
Single source of truth for all runtime paths and settings.

Why this file exists:
  Python's os.getcwd() depends on where you launch from. This module
  anchors all paths to the directory containing config.py itself, so
  "python run_server.py" and "python api/server.py" both resolve paths
  identically — a common source of "file not found" bugs in multi-file projects.

Real OS concept: equivalent to /etc/os-release — a stable, declarative
configuration that all subsystems read rather than each guessing paths.
"""

import os

# ── Project root = directory containing this file ─────────────────────────
ROOT_DIR     = os.path.dirname(os.path.abspath(__file__))

# ── Subdirectories ─────────────────────────────────────────────────────────
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
DATA_DIR     = os.path.join(ROOT_DIR, "data")
API_DIR      = os.path.join(ROOT_DIR, "api")

# ── Runtime paths ──────────────────────────────────────────────────────────
FS_STORE     = os.path.join(DATA_DIR, "fs.json")
INDEX_HTML   = os.path.join(FRONTEND_DIR, "index.html")

# ── Server settings ────────────────────────────────────────────────────────
HOST         = os.environ.get("PYOS_HOST", "0.0.0.0")
PORT         = int(os.environ.get("PYOS_PORT", "8000"))
DEBUG        = os.environ.get("PYOS_DEBUG", "false").lower() == "true"

# ── Application metadata ───────────────────────────────────────────────────
APP_NAME     = "VirtOS"
APP_VERSION  = "1.0.0"
API_PREFIX   = "/api"          # all API routes live under /api/...
STATIC_PATH  = "/static"       # static assets served under /static/...

# ── Ensure data directory exists on import ─────────────────────────────────
os.makedirs(DATA_DIR, exist_ok=True)
