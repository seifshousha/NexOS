"""
PyOS - Terminal Commands
========================
Each shell command is an isolated function that receives:
    - cmd     : parsed Command object (args, flags)
    - session : TerminalSession (cwd, env, history)
    - kernel  : Kernel (filesystem access)

Returns a CommandResult with stdout, stderr, and exit_code.

Real OS concept: mirrors how /bin/ls, /bin/mkdir etc. are separate
executables that receive argv[] and interact with the kernel via syscalls.
"""

from dataclasses import dataclass, field
from core.parser  import Command
from core.kernel  import Kernel, KernelError
import time


# ─────────────────────────────────────────────
#  CommandResult — standardized output
# ─────────────────────────────────────────────
@dataclass
class CommandResult:
    """
    Standardized return type for every command function.
    exit_code 0 = success  (Unix convention)
    exit_code 1 = error
    action    : optional dict to trigger a GUI action in the frontend
                e.g. {'type': 'open_editor', 'path': '/home/user/file.txt'}
    """
    stdout    : str  = ""
    stderr    : str  = ""
    exit_code : int  = 0
    clear     : bool = False
    action    : dict = None   # GUI action signal

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


def _ok(text: str = "") -> CommandResult:
    return CommandResult(stdout=text)

def _err(text: str) -> CommandResult:
    return CommandResult(stderr=text, exit_code=1)


# ─────────────────────────────────────────────
#  Path resolution helper
# ─────────────────────────────────────────────
def _resolve_path(raw_path: str, cwd: str) -> str:
    """
    Resolve a path relative to cwd, or return it as-is if absolute.

    Examples (cwd = /home/user):
        "docs"        → /home/user/docs
        "../"         → /home
        "/etc"        → /etc
        "a/b/c"       → /home/user/a/b/c

    Real OS concept: equivalent to realpath() + getcwd() in libc.
    """
    if raw_path.startswith("/"):
        path = raw_path
    else:
        path = cwd.rstrip("/") + "/" + raw_path

    # Normalize: resolve . and ..
    parts  = []
    for part in path.split("/"):
        if part == "" or part == ".":
            continue
        elif part == "..":
            if parts:
                parts.pop()
        else:
            parts.append(part)

    return "/" + "/".join(parts)


# ─────────────────────────────────────────────
#  Command implementations
# ─────────────────────────────────────────────

def cmd_pwd(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """pwd — print working directory."""
    return _ok(session.cwd)


def cmd_ls(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """
    ls [path] [-l] [-a]
    List directory contents.
    -l : long format (size + modified time)
    """
    raw_path = cmd.get_arg(0, session.cwd)
    path     = _resolve_path(raw_path, session.cwd)
    long_fmt = cmd.has_flag("-l")

    try:
        entries = kernel.fs_ls(path)
    except KernelError as e:
        return _err(f"ls: {e}")

    if not entries:
        return _ok("(empty directory)")

    lines = []
    for e in entries:
        icon = "📂" if e["type"] == "dir" else "📄"
        if long_fmt:
            size_str = f"{e['size']:>6} bytes" if e["type"] == "file" else "      <dir>"
            lines.append(f"{icon}  {e['modified']}  {size_str}  {e['name']}")
        else:
            suffix = "/" if e["type"] == "dir" else ""
            lines.append(f"{icon}  {e['name']}{suffix}")

    return _ok("\n".join(lines))


def cmd_cd(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """
    cd [path]
    Change current working directory.
    No path → cd to /home/user (home directory).
    """
    raw_path = cmd.get_arg(0, "/home/user")
    path     = _resolve_path(raw_path, session.cwd)

    try:
        entries = kernel.fs_ls(path)      # ls proves path is a valid directory
        _ = entries                        # suppress unused warning
    except KernelError as e:
        return _err(f"cd: {e}")

    session.cwd = path
    return _ok()                           # cd produces no output on success (Unix convention)


def cmd_mkdir(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """
    mkdir <name> [name2 ...]
    Create one or more directories relative to cwd.
    """
    if not cmd.args:
        return _err("mkdir: missing operand")

    results = []
    for name in cmd.args:
        path = _resolve_path(name, session.cwd)
        try:
            kernel.fs_mkdir(path)
            results.append(f"created: {path}")
        except KernelError as e:
            results.append(f"mkdir: {name}: {e}")

    return _ok("\n".join(results))


def cmd_touch(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """
    touch <file> [file2 ...]
    Create empty files (or update mtime if they exist).
    """
    if not cmd.args:
        return _err("touch: missing file operand")

    results = []
    for name in cmd.args:
        path = _resolve_path(name, session.cwd)
        try:
            kernel.fs_touch(path)
            results.append(f"touched: {path}")
        except KernelError as e:
            results.append(f"touch: {name}: {e}")

    return _ok("\n".join(results))


def cmd_cat(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """
    cat <file>
    Print file contents to terminal.
    """
    if not cmd.args:
        return _err("cat: missing file operand")

    path = _resolve_path(cmd.get_arg(0), session.cwd)
    try:
        content = kernel.fs_read(path)
        return _ok(content if content else "(empty file)")
    except KernelError as e:
        return _err(f"cat: {e}")


def cmd_write(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """
    write <file> <content...>
    Write content to a file (creates if not exists, overwrites if exists).
    PyOS convenience command — equivalent to: echo "text" > file
    """
    if len(cmd.args) < 2:
        return _err("write: usage: write <file> <content>")

    path    = _resolve_path(cmd.args[0], session.cwd)
    content = " ".join(cmd.args[1:]) + "\n"
    try:
        kernel.fs_write(path, content)
        return _ok(f"written {len(content)} bytes → {path}")
    except KernelError as e:
        return _err(f"write: {e}")


def cmd_rm(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """
    rm [-r] <path> [path2 ...]
    Remove files or directories.
    -r : recursive (required for non-empty directories)
    """
    if not cmd.args:
        return _err("rm: missing operand")

    recursive = cmd.has_flag("-r") or cmd.has_flag("-R")
    results   = []

    for name in cmd.args:
        path = _resolve_path(name, session.cwd)
        try:
            kernel.fs_delete(path, recursive=recursive)
            results.append(f"removed: {path}")
        except KernelError as e:
            results.append(f"rm: {name}: {e}")

    return _ok("\n".join(results))


def cmd_mv(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """
    mv <source> <destination_dir>
    Move a file or directory.
    """
    if len(cmd.args) < 2:
        return _err("mv: usage: mv <source> <destination>")

    src  = _resolve_path(cmd.args[0], session.cwd)
    dest = _resolve_path(cmd.args[1], session.cwd)
    try:
        msg = kernel.fs_move(src, dest)
        return _ok(msg)
    except KernelError as e:
        return _err(f"mv: {e}")


def cmd_rename(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """
    rename <path> <new_name>
    Rename a file or directory (new_name is just the name, not a path).
    """
    if len(cmd.args) < 2:
        return _err("rename: usage: rename <path> <new_name>")

    path     = _resolve_path(cmd.args[0], session.cwd)
    new_name = cmd.args[1]
    try:
        msg = kernel.fs_rename(path, new_name)
        return _ok(msg)
    except KernelError as e:
        return _err(f"rename: {e}")


def cmd_stat(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """
    stat <path>
    Show file/directory metadata.
    """
    if not cmd.args:
        return _err("stat: missing operand")

    path = _resolve_path(cmd.get_arg(0), session.cwd)
    try:
        meta  = kernel.fs_stat(path)
        lines = [f"  {k:<12}: {v}" for k, v in meta.items() if v is not None]
        return _ok("\n".join(lines))
    except KernelError as e:
        return _err(f"stat: {e}")


def cmd_clear(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """clear — signal the terminal to wipe its display."""
    return CommandResult(clear=True)


def cmd_history(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """history — print command history for this session."""
    if not session.history:
        return _ok("(no history)")
    lines = [f"  {i+1:>3}  {h}" for i, h in enumerate(session.history)]
    return _ok("\n".join(lines))


def cmd_uptime(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """uptime — show how long the OS has been running."""
    return _ok(f"uptime: {kernel.uptime()}")


def cmd_help(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """help — list all available commands."""
    help_text = """
VirtOS Terminal — Available Commands
───────────────────────────────────
  pwd                     Print working directory
  ls [-l] [path]          List directory contents
  cd [path]               Change directory
  mkdir <name> [...]      Create directories
  touch <file> [...]      Create empty files
  cat <file>              Print file content
  write <file> <text>     Write text to file
  nano <file>             Open file in Text Editor
  rm [-r] <path> [...]    Remove files/directories
  mv <src> <dst_dir>      Move file or directory
  rename <path> <name>    Rename file or directory
  stat <path>             Show metadata
  history                 Show command history
  uptime                  Show OS uptime
  clear                   Clear terminal screen
  help                    Show this help
───────────────────────────────────""".strip()
    return _ok(help_text)


def cmd_nano(cmd: Command, session, kernel: Kernel) -> CommandResult:
    """
    nano <file>
    Open a file in the GUI Text Editor.
    Creates the file if it doesn't exist.
    """
    if not cmd.args:
        return _err("nano: missing file operand")

    path = _resolve_path(cmd.get_arg(0), session.cwd)

    # Create file if it doesn't exist
    try:
        kernel.fs_touch(path)
    except KernelError:
        pass  # File already exists — that's fine

    return CommandResult(
        stdout = f"Opening {path} in Text Editor...",
        action = {'type': 'open_editor', 'path': path}
    )
