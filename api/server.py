"""
VirtOS — Unified Server  (api/server.py)
========================================
FastAPI application that serves BOTH:

  • REST API    → /api/fs/*, /api/terminal/*, /api/system/*
  • Frontend    → /static/(style.css, app.js, ...) + GET / → index.html

Single origin eliminates CORS, simplifies packaging, and removes the
race condition between the two servers in the old dual-server setup.

Architecture:
  ┌─────────────────────────────────────────┐
  │  FastAPI (port 8000)                    │
  │                                         │
  │  GET /                  → index.html    │
  │  GET /static/*          → frontend/     │
  │  POST /api/fs/*         → VFS ops       │
  │  POST /api/terminal/*   → Shell         │
  │  GET  /api/system/*     → Metrics       │
  └─────────────────────────────────────────┘
"""

import os, time, logging

from fastapi                 import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses       import FileResponse
from fastapi.staticfiles     import StaticFiles
from pydantic                import BaseModel

from config                  import FRONTEND_DIR, INDEX_HTML, FS_STORE, APP_VERSION
from core.kernel             import Kernel, KernelError
from core.terminal           import Terminal
from api.process_manager     import ProcessManager


# ── App ───────────────────────────────────────────────────────────────────
app = FastAPI(
    title       = "VirtOS API",
    version     = APP_VERSION,
    docs_url    = "/api/docs",
    redoc_url   = "/api/redoc",
    openapi_url = "/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

kernel   = Kernel(fs_path=FS_STORE).boot()
terminal = Terminal(kernel, username="user")
procs    = ProcessManager()
_cpu_history: list = [0.0] * 30


# ── Models ────────────────────────────────────────────────────────────────
class MkdirBody(BaseModel):   path: str
class TouchBody(BaseModel):   path: str; content: str = ""
class WriteBody(BaseModel):   path: str; content: str
class DeleteBody(BaseModel):  path: str; recursive: bool = False
class RenameBody(BaseModel):  path: str; new_name: str
class MoveBody(BaseModel):    src: str;  dest_dir: str
class CommandBody(BaseModel): command: str
class SpawnBody(BaseModel):   name: str; user: str = "user"


# ══════════════════════════════════════════════════════════════════════
#  API ROUTES — all under /api
# ══════════════════════════════════════════════════════════════════════

@app.get("/api/fs/ls")
def fs_ls(path: str = Query("/")):
    try:    return {"ok": True, "entries": kernel.fs_ls(path)}
    except KernelError as e: raise HTTPException(400, str(e))

@app.get("/api/fs/read")
def fs_read(path: str = Query(...)):
    try:    return {"ok": True, "content": kernel.fs_read(path)}
    except KernelError as e: raise HTTPException(400, str(e))

@app.get("/api/fs/stat")
def fs_stat(path: str = Query(...)):
    try:    return {"ok": True, "stat": kernel.fs_stat(path)}
    except KernelError as e: raise HTTPException(400, str(e))

@app.post("/api/fs/mkdir")
def fs_mkdir(body: MkdirBody):
    try:    return {"ok": True, "message": kernel.fs_mkdir(body.path)}
    except KernelError as e: raise HTTPException(400, str(e))

@app.post("/api/fs/touch")
def fs_touch(body: TouchBody):
    try:    return {"ok": True, "message": kernel.fs_touch(body.path, body.content)}
    except KernelError as e: raise HTTPException(400, str(e))

@app.post("/api/fs/write")
def fs_write(body: WriteBody):
    try:    return {"ok": True, "message": kernel.fs_write(body.path, body.content)}
    except KernelError as e: raise HTTPException(400, str(e))

@app.delete("/api/fs/delete")
def fs_delete(body: DeleteBody):
    try:    return {"ok": True, "message": kernel.fs_delete(body.path, body.recursive)}
    except KernelError as e: raise HTTPException(400, str(e))

@app.post("/api/fs/rename")
def fs_rename(body: RenameBody):
    try:    return {"ok": True, "message": kernel.fs_rename(body.path, body.new_name)}
    except KernelError as e: raise HTTPException(400, str(e))

@app.post("/api/fs/move")
def fs_move(body: MoveBody):
    try:    return {"ok": True, "message": kernel.fs_move(body.src, body.dest_dir)}
    except KernelError as e: raise HTTPException(400, str(e))


@app.post("/api/terminal/execute")
def terminal_execute(body: CommandBody):
    result = terminal.execute(body.command)
    return {"ok": result.ok, "stdout": result.stdout, "stderr": result.stderr,
            "exit_code": result.exit_code, "prompt": terminal.session.prompt,
            "clear": result.clear, "action": result.action}

@app.get("/api/terminal/prompt")
def terminal_prompt():
    return {"prompt": terminal.session.prompt, "cwd": terminal.session.cwd}

@app.get("/api/terminal/history")
def terminal_history():
    return {"history": terminal.session.history}


@app.get("/api/system/processes")
def get_processes():
    return {"ok": True, "processes": procs.list_processes(),
            "memory": procs.memory_stats(), "cpu": procs.cpu_stats()}

@app.get("/api/system/processes/{pid}")
def get_process(pid: int):
    p = procs.get_process(pid)
    if not p: raise HTTPException(404, f"Process {pid} not found")
    return {"ok": True, "process": p}

@app.delete("/api/system/processes/{pid}")
def kill_process(pid: int):
    if not procs.kill(pid):
        raise HTTPException(400, f"Cannot kill PID {pid}")
    return {"ok": True, "message": f"Process {pid} terminated"}

@app.post("/api/system/processes/spawn")
def spawn_process(body: SpawnBody):
    return {"ok": True, "process": procs.spawn(body.name, body.user)}


@app.get("/api/system/info")
def system_info():
    global _cpu_history
    cpu = procs.cpu_stats(); mem = procs.memory_stats()
    _cpu_history.append(cpu["percent"])
    if len(_cpu_history) > 30: _cpu_history.pop(0)
    return {"ok": True, "version": kernel.VERSION, "uptime": kernel.uptime(),
            "cpu": {**cpu, "history": _cpu_history[-20:]},
            "memory": mem, "fs_path": kernel.status()["fs_path"]}

@app.get("/api/system/uptime")
def system_uptime():
    elapsed = int(time.time() - kernel.boot_time)
    h, r = divmod(elapsed, 3600); m, s = divmod(r, 60)
    return {"ok": True, "uptime": kernel.uptime(), "uptime_secs": elapsed,
            "formatted": f"{h}h {m}m {s}s",
            "boot_time": time.strftime("%Y-%m-%d %H:%M:%S",
                                       time.localtime(kernel.boot_time))}

@app.get("/api/system/status")
def system_status():
    return {"ok": True, "status": "running", "version": kernel.VERSION,
            "uptime": kernel.uptime()}

@app.get("/api/health")
def health():
    """Lightweight liveness probe."""
    return {"status": "ok", "ts": int(time.time())}

@app.get("/api")
def api_root():
    return {"name": "VirtOS API", "version": APP_VERSION, "docs": "/api/docs"}


# ══════════════════════════════════════════════════════════════════════
#  STATIC FILE SERVING
#
#  Mount order matters — FastAPI evaluates in registration order:
#    1. Explicit /api/* routes above   ← win for API calls
#    2. /static/* StaticFiles mount    ← serves CSS/JS/etc.
#    3. GET /  explicit route          ← serves index.html
#    4. Catch-all /{path}              ← SPA fallback
#
#  NEVER mount StaticFiles at "/" with html=True — it would shadow
#  all subsequent routes including the API.
# ══════════════════════════════════════════════════════════════════════

if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
else:
    logging.warning(f"Frontend dir not found: {FRONTEND_DIR}")


@app.get("/", include_in_schema=False)
async def serve_root():
    """Entry point: serve index.html at the root URL."""
    if not os.path.isfile(INDEX_HTML):
        raise HTTPException(503, "Frontend not found — check FRONTEND_DIR in config.py")
    return FileResponse(INDEX_HTML, media_type="text/html",
                        headers={"Cache-Control": "no-cache"})


@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    """
    Catch-all SPA fallback → index.html.
    Guards against intercepting /api/ or /static/ paths.
    """
    if full_path.startswith(("api/", "static/")):
        raise HTTPException(404, f"Not found: /{full_path}")
    return FileResponse(INDEX_HTML, media_type="text/html",
                        headers={"Cache-Control": "no-cache"})
