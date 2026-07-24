"""
PyOS - Terminal (Shell)
=======================
The Terminal is the user-facing shell that:
  1. Maintains a TerminalSession (cwd, history, env vars)
  2. Accepts raw input → parses it → dispatches to a command function
  3. Renders output (stdout/stderr) back to the user

Real OS concept:
  - TerminalSession ≈ process environment (PWD, HOME, PATH, shell history)
  - dispatch()      ≈ execve() — looks up the command and hands control to it
  - The command registry ≈ /bin — a map of name → executable

Architecture:
  raw input → Parser → Command → dispatch() → CommandFn → CommandResult → render
"""

from core.parser   import CommandParser, ParseError
from core.commands import (
    CommandResult,
    cmd_pwd, cmd_ls, cmd_cd, cmd_mkdir, cmd_touch,
    cmd_cat, cmd_write, cmd_rm, cmd_mv, cmd_rename,
    cmd_stat, cmd_clear, cmd_history, cmd_uptime, cmd_help,
    cmd_nano,
)
from core.kernel import Kernel


# ─────────────────────────────────────────────
#  TerminalSession — per-session state
# ─────────────────────────────────────────────
class TerminalSession:
    """
    Holds all state for one terminal session.

    Real OS concept: equivalent to a process's environment block.
    Each shell process owns its own cwd, env vars, and history file.
    """

    def __init__(self, username: str = "user", home: str = "/home/user"):
        self.username = username
        self.home     = home
        self.cwd      = home              # start in home directory
        self.history  : list[str] = []    # command history (like ~/.bash_history)
        self.env      : dict      = {     # environment variables
            "HOME"  : home,
            "USER"  : username,
            "SHELL" : "/bin/pysh",
            "TERM"  : "pyos-terminal",
        }

    def record(self, raw: str):
        """Add a command to history (skip duplicates of last entry)."""
        stripped = raw.strip()
        if stripped and (not self.history or self.history[-1] != stripped):
            self.history.append(stripped)

    @property
    def prompt(self) -> str:
        """
        Build the shell prompt string.
        Mirrors bash PS1: user@hostname:cwd$
        Abbreviates home directory as ~
        """
        cwd_display = self.cwd.replace(self.home, "~", 1)
        return f"{self.username}@pyos:{cwd_display}$ "


# ─────────────────────────────────────────────
#  Terminal
# ─────────────────────────────────────────────
class Terminal:
    """
    The PyOS shell — parses input, dispatches commands, renders output.

    Usage (programmatic):
        terminal = Terminal(kernel)
        result   = terminal.execute("ls /home")
        print(result.stdout)

    Usage (interactive REPL):
        terminal.run()
    """

    def __init__(self, kernel: Kernel, username: str = "user"):
        self.kernel  = kernel
        self.session = TerminalSession(username=username,
                                       home=f"/home/{username}")
        self.parser  = CommandParser()

        # ── Command Registry ──────────────────────────────────────────────
        # Maps command name → handler function.
        # Real OS concept: analogous to PATH resolution in Unix shells.
        # Adding a new command is just one line here — fully extensible.
        self._registry: dict = {
            "pwd"     : cmd_pwd,
            "ls"      : cmd_ls,
            "cd"      : cmd_cd,
            "mkdir"   : cmd_mkdir,
            "touch"   : cmd_touch,
            "cat"     : cmd_cat,
            "write"   : cmd_write,
            "rm"      : cmd_rm,
            "mv"      : cmd_mv,
            "rename"  : cmd_rename,
            "stat"    : cmd_stat,
            "clear"   : cmd_clear,
            "history" : cmd_history,
            "uptime"  : cmd_uptime,
            "help"    : cmd_help,
            "nano"    : cmd_nano,
        }

        self._screen_lines: list[str] = []   # in-memory terminal buffer

    # ── Core execution pipeline ────────────────────────────────────────────

    def execute(self, raw: str) -> CommandResult:
        """
        Full pipeline: raw string → parse → dispatch → CommandResult.

        This is the main entry point for both the REPL and the GUI terminal.
        """
        self.session.record(raw)

        # Step 1: Parse
        try:
            cmd = self.parser.parse(raw)
        except ParseError as e:
            return CommandResult(stderr=str(e), exit_code=1)

        if cmd is None:
            return CommandResult()   # empty input → no-op

        # Step 2: Dispatch
        return self._dispatch(cmd)

    def _dispatch(self, cmd) -> CommandResult:
        """
        Look up the command in the registry and call its handler.

        Real OS concept: mirrors execve() — find the binary, load it, run it.
        Unknown commands return a "command not found" error (exit code 127).
        """
        handler = self._registry.get(cmd.name)
        if handler is None:
            return CommandResult(
                stderr    = f"pysh: command not found: {cmd.name}  (try 'help')",
                exit_code = 127,    # Unix convention for "command not found"
            )
        try:
            return handler(cmd, self.session, self.kernel)
        except Exception as e:
            # Catch unexpected errors so the terminal never crashes
            return CommandResult(stderr=f"[internal error] {e}", exit_code=1)

    # ── Rendering ──────────────────────────────────────────────────────────

    def _render(self, prompt: str, result: CommandResult):
        """Write a command's output to the screen buffer and stdout."""
        if result.clear:
            self._screen_lines = []
            print("\033[2J\033[H", end="")   # ANSI clear screen
            return

        if result.stdout:
            self._screen_lines.append(result.stdout)
            print(result.stdout)

        if result.stderr:
            error_line = f"\033[31m{result.stderr}\033[0m"   # red text
            self._screen_lines.append(result.stderr)
            print(error_line)

    # ── Interactive REPL ───────────────────────────────────────────────────

    def run(self):
        """
        Interactive Read-Eval-Print Loop.
        Real OS concept: the shell's main() loop — read input, eval, print, loop.
        """
        print(f"\n  PyOS Terminal  —  type 'help' for commands, 'exit' to quit")
        print(f"  Kernel: {self.kernel.VERSION}  |  Uptime: {self.kernel.uptime()}\n")

        while True:
            try:
                raw = input(self.session.prompt)
            except (EOFError, KeyboardInterrupt):
                print("\n  logout")
                break

            if raw.strip().lower() in ("exit", "quit", "logout"):
                print("  logout")
                break

            result = self.execute(raw)
            self._render(self.session.prompt, result)
