"""
PyOS - Kernel
=============
The Kernel is the central authority of the OS simulator.
It initializes all subsystems (VFS, ProcessManager, MemoryManager)
and provides a unified API for the UI and terminal layers.

Real OS concept: In Linux, the kernel owns resource managers and
exposes syscall interfaces. Here the Kernel class plays that role.
"""

import time
import logging
from core.filesystem import VirtualFileSystem

# ── Logging (kernel dmesg equivalent) ─────────────────────────────────────
logging.basicConfig(
    level   = logging.INFO,
    format  = "[%(asctime)s] [KERNEL] %(levelname)s: %(message)s",
    datefmt = "%H:%M:%S",
)
logger = logging.getLogger("kernel")


# ─────────────────────────────────────────────
#  KernelError
# ─────────────────────────────────────────────
class KernelError(Exception):
    """Raised when a kernel-level operation fails."""
    pass


# ─────────────────────────────────────────────
#  Kernel
# ─────────────────────────────────────────────
class Kernel:
    """
    The OS Kernel — boots subsystems, owns global state,
    and arbitrates access to hardware/memory/file resources.

    Subsystems managed:
        - vfs      : VirtualFileSystem
        - (Phase 2) process_manager, memory_manager
    """

    VERSION = "VirtOS 1.0.0"

    def __init__(self, fs_path: str = "data/fs.json"):
        self.boot_time = time.time()
        self.vfs       = None
        self._fs_path  = fs_path
        logger.info(f"Kernel initializing — {self.VERSION}")

    # ── Boot sequence ──────────────────────────────────────────────────────

    def boot(self):
        """
        Kernel boot sequence.
        Mirrors init → mount VFS → spawn init process in real kernels.
        """
        logger.info("=== BOOT SEQUENCE START ===")
        self._init_vfs()
        self._init_default_tree()
        logger.info(f"=== BOOT COMPLETE — uptime: 0s ===")
        return self

    def _init_vfs(self):
        """Mount the virtual file system."""
        logger.info(f"Mounting VFS from '{self._fs_path}'")
        self.vfs = VirtualFileSystem(storage_path=self._fs_path)
        logger.info("VFS mounted OK")

    def _init_default_tree(self):
        """
        Create the default directory tree on first boot.
        Mirrors Linux FHS (Filesystem Hierarchy Standard).
        Only creates dirs that don't already exist.
        """
        default_dirs = [
            "/bin",      # system binaries
            "/etc",      # configuration files
            "/home",     # user home directories
            "/home/user",
            "/home/user/Desktop",     # desktop surface
            "/home/user/Documents",   # user documents
            "/home/user/Downloads",   # user downloads
            "/tmp",      # temporary files
            "/var",      # variable data (logs, etc.)
            "/var/log",
        ]
        for d in default_dirs:
            ok, _ = self.vfs.mkdir(d)
            if ok:
                logger.info(f"  Created default dir: {d}")

        # Write kernel boot log
        self.vfs.write("/var/log/boot.log",
                       f"VirtOS kernel booted at {time.ctime(self.boot_time)}\n")

    # ── Uptime ─────────────────────────────────────────────────────────────

    def uptime(self) -> str:
        elapsed = int(time.time() - self.boot_time)
        h, r    = divmod(elapsed, 3600)
        m, s    = divmod(r, 60)
        return f"{h:02d}:{m:02d}:{s:02d}"

    # ── VFS syscall wrappers ───────────────────────────────────────────────
    # The kernel validates and delegates — callers should never touch vfs directly.

    def fs_ls(self, path: str = "/") -> list[dict]:
        ok, result = self.vfs.ls(path)
        if not ok:
            raise KernelError(result[0].get("error", "ls failed"))
        return result

    def fs_mkdir(self, path: str) -> str:
        ok, msg = self.vfs.mkdir(path)
        if not ok:
            raise KernelError(msg)
        logger.info(f"mkdir: {path}")
        return msg

    def fs_touch(self, path: str, content: str = "") -> str:
        ok, msg = self.vfs.touch(path, content)
        if not ok:
            raise KernelError(msg)
        return msg

    def fs_write(self, path: str, content: str) -> str:
        ok, msg = self.vfs.write(path, content)
        if not ok:
            raise KernelError(msg)
        logger.info(f"write: {path} ({len(content)} bytes)")
        return msg

    def fs_read(self, path: str) -> str:
        ok, result = self.vfs.read(path)
        if not ok:
            raise KernelError(result)
        return result

    def fs_delete(self, path: str, recursive: bool = False) -> str:
        ok, msg = self.vfs.delete(path, recursive)
        if not ok:
            raise KernelError(msg)
        logger.info(f"delete: {path}")
        return msg

    def fs_rename(self, path: str, new_name: str) -> str:
        ok, msg = self.vfs.rename(path, new_name)
        if not ok:
            raise KernelError(msg)
        return msg

    def fs_move(self, src: str, dest_dir: str) -> str:
        ok, msg = self.vfs.move(src, dest_dir)
        if not ok:
            raise KernelError(msg)
        return msg

    def fs_stat(self, path: str) -> dict:
        ok, result = self.vfs.stat(path)
        if not ok:
            raise KernelError(result.get("error", "stat failed"))
        return result

    # ── Status ─────────────────────────────────────────────────────────────

    def status(self) -> dict:
        """Return a snapshot of current kernel state."""
        return {
            "version" : self.VERSION,
            "uptime"  : self.uptime(),
            "fs_path" : self._fs_path,
        }

    def shutdown(self):
        """Graceful shutdown — flush VFS to disk."""
        logger.info("Kernel shutting down — flushing VFS...")
        self.vfs.save()
        logger.info("Shutdown complete.")
