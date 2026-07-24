"""
PyOS - Process Manager
======================
Simulates an OS process table. Each process has a PID, name, state,
CPU%, memory, and start time — like /proc on Linux.

Real OS concept:
  Process states: NEW → READY → RUNNING → WAITING → TERMINATED
  The scheduler cycles CPU % across running processes to look realistic.
  Memory is allocated from a simulated 1GB pool.
"""

import time
import random
import threading
from dataclasses import dataclass
from enum import Enum


class ProcessState(str, Enum):
    RUNNING  = "running"
    SLEEPING = "sleeping"
    WAITING  = "waiting"
    STOPPED  = "stopped"
    ZOMBIE   = "zombie"


@dataclass
class Process:
    pid      : int
    name     : str
    state    : ProcessState
    cpu      : float        # CPU %
    memory   : int          # MB
    user     : str
    started  : float        # Unix timestamp
    priority : int          # 0-20 (nice value)

    def to_dict(self) -> dict:
        return {
            "pid"     : self.pid,
            "name"    : self.name,
            "state"   : self.state.value,
            "cpu"     : round(self.cpu, 1),
            "memory"  : self.memory,
            "user"    : self.user,
            "uptime"  : int(time.time() - self.started),
            "priority": self.priority,
        }


class ProcessManager:
    """
    Maintains the simulated process table.
    Runs a background thread that fluctuates CPU/memory values
    to simulate real OS behaviour.

    Memory model: total=1024MB, kernel reserves 128MB.
    """

    TOTAL_MEM   = 1024   # MB
    KERNEL_MEM  = 128    # reserved by OS

    # Realistic system process templates
    _SYSTEM_PROCS = [
        ("kernel",       "root",  0,   32,  ProcessState.RUNNING),
        ("init",         "root",  1,   12,  ProcessState.SLEEPING),
        ("systemd",      "root",  2,   18,  ProcessState.SLEEPING),
        ("kworker",      "root",  0,    4,  ProcessState.SLEEPING),
        ("sshd",         "root",  0,    8,  ProcessState.SLEEPING),
        ("cron",         "root",  0,    4,  ProcessState.SLEEPING),
        ("dbus-daemon",  "root",  0,    6,  ProcessState.SLEEPING),
        ("pyos-kernel",  "user",  2,   48,  ProcessState.RUNNING),
        ("pyos-server",  "user",  1,   64,  ProcessState.RUNNING),
        ("file-manager", "user",  0,   32,  ProcessState.SLEEPING),
        ("terminal",     "user",  0,   16,  ProcessState.SLEEPING),
        ("desktop",      "user",  1,   42,  ProcessState.RUNNING),
        ("logger",       "user",  0,    8,  ProcessState.SLEEPING),
    ]

    def __init__(self):
        self._table  : dict[int, Process] = {}
        self._lock   = threading.Lock()
        self._next_pid = 1
        self._boot_time = time.time()

        self._seed_system_processes()
        self._start_simulation()

    # ── Seeding ────────────────────────────────────────────────────────────

    def _seed_system_processes(self):
        for name, user, cpu, mem, state in self._SYSTEM_PROCS:
            pid = self._next_pid
            self._next_pid += 1
            self._table[pid] = Process(
                pid      = pid,
                name     = name,
                state    = state,
                cpu      = cpu + random.uniform(-0.5, 0.5),
                memory   = mem,
                user     = user,
                started  = self._boot_time - random.randint(10, 3600),
                priority = random.randint(0, 19),
            )

    # ── Background simulation ──────────────────────────────────────────────

    def _start_simulation(self):
        """Tick every 2s to fluctuate CPU/memory — mimics /proc updates."""
        def _tick():
            while True:
                time.sleep(2)
                self._fluctuate()
        t = threading.Thread(target=_tick, daemon=True)
        t.start()

    def _fluctuate(self):
        with self._lock:
            for pid, proc in self._table.items():
                # CPU drift
                if proc.state == ProcessState.RUNNING:
                    delta = random.uniform(-1.5, 1.5)
                    proc.cpu = max(0.0, min(99.0, proc.cpu + delta))
                else:
                    proc.cpu = 0.0

                # Occasional state change (not for PID 1/2)
                if pid > 3 and random.random() < 0.05:
                    if proc.state == ProcessState.SLEEPING:
                        proc.state = ProcessState.RUNNING
                        proc.cpu = random.uniform(0.5, 5.0)
                    elif proc.state == ProcessState.RUNNING and proc.cpu < 1.0:
                        proc.state = ProcessState.SLEEPING

                # Memory slight drift
                if proc.state == ProcessState.RUNNING:
                    proc.memory = max(4, proc.memory + random.randint(-2, 2))

    # ── Public API ─────────────────────────────────────────────────────────

    def list_processes(self) -> list[dict]:
        with self._lock:
            return [p.to_dict() for p in
                    sorted(self._table.values(), key=lambda p: p.pid)]

    def get_process(self, pid: int) -> dict | None:
        with self._lock:
            p = self._table.get(pid)
            return p.to_dict() if p else None

    def spawn(self, name: str, user: str = "user") -> dict:
        """Spawn a new user process."""
        with self._lock:
            pid = self._next_pid
            self._next_pid += 1
            mem = random.randint(16, 128)
            proc = Process(
                pid      = pid,
                name     = name,
                state    = ProcessState.RUNNING,
                cpu      = random.uniform(0.5, 8.0),
                memory   = mem,
                user     = user,
                started  = time.time(),
                priority = 10,
            )
            self._table[pid] = proc
            return proc.to_dict()

    def kill(self, pid: int) -> bool:
        """Kill a process (cannot kill PID 1 or kernel)."""
        with self._lock:
            if pid in (1, 2):
                return False   # protect init/kernel
            if pid not in self._table:
                return False
            # Mark as zombie briefly then remove
            self._table[pid].state = ProcessState.ZOMBIE
            self._table[pid].cpu   = 0.0
            del self._table[pid]
            return True

    def memory_stats(self) -> dict:
        """Aggregate memory usage across all processes."""
        with self._lock:
            used = self.KERNEL_MEM + sum(p.memory for p in self._table.values())
            used = min(used, self.TOTAL_MEM)
            free = max(0, self.TOTAL_MEM - used)
            return {
                "total_mb" : self.TOTAL_MEM,
                "used_mb"  : used,
                "free_mb"  : free,
                "percent"  : round(used / self.TOTAL_MEM * 100, 1),
            }

    def cpu_stats(self) -> dict:
        """Aggregate CPU across all running processes."""
        with self._lock:
            running = [p for p in self._table.values()
                       if p.state == ProcessState.RUNNING]
            total_cpu = min(100.0, sum(p.cpu for p in running))
            return {
                "percent"      : round(total_cpu, 1),
                "process_count": len(self._table),
                "running"      : len(running),
                "sleeping"     : sum(1 for p in self._table.values()
                                     if p.state == ProcessState.SLEEPING),
            }
