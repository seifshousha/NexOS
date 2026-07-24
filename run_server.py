"""
VirtOS — Unified Launcher
==========================
Single command to start the entire VirtOS system.

    python run_server.py              # production (port 8000)
    python run_server.py --dev        # dev mode (auto-reload + debug)
    python run_server.py --port 9000  # custom port
    PYOS_PORT=9000 python run_server.py

After starting, open:
    http://localhost:8000             ← Desktop UI
    http://localhost:8000/api/docs    ← Swagger API explorer
"""

import sys
import os
import argparse

# Project root (directory containing this file)
ROOT = os.path.dirname(os.path.abspath(__file__))

from config import HOST, PORT, APP_VERSION


def parse_args():
    p = argparse.ArgumentParser(description="VirtOS unified server")
    p.add_argument("--dev",    action="store_true",
                   help="Enable auto-reload and debug logging")
    p.add_argument("--host",   default=HOST,
                   help=f"Bind host (default: {HOST})")
    p.add_argument("--port",   type=int, default=PORT,
                   help=f"Bind port (default: {PORT})")
    return p.parse_args()


def print_banner(host, port, dev):
    line = "=" * 46
    mode = "development (auto-reload)" if dev else "production"
    print(f"""
  +{line}+
  |  VirtOS {APP_VERSION:<37}|
  +{line}+
  |  Mode     : {mode:<32}|
  |  Desktop  : http://localhost:{port:<16}|
  |  API Docs : http://localhost:{port}/api/docs{" " * (11 - len(str(port)))}|
  +{line}+
""")


def main():
    args = parse_args()

    try:
        import uvicorn
    except ImportError:
        print("\n  ERROR: uvicorn not installed.")
        print("  Run:  pip install fastapi uvicorn\n")
        sys.exit(1)

    print_banner(args.host, args.port, args.dev)

    # Change to project root so relative paths (data/, frontend/) resolve correctly
    os.chdir(ROOT)

    uvicorn.run(
        "api.server:app",
        host       = args.host,
        port       = args.port,
        reload     = args.dev,
        log_level  = "debug" if args.dev else "warning",
        # Pass access log only in dev — keeps production output clean
        access_log = args.dev,
    )


if __name__ == "__main__":
    main()
