"""
PyOS - Command Parser
=====================
Tokenizes raw terminal input into structured Command objects.

Real OS concept: This mirrors how a Unix shell (bash/zsh) lexes and parses
input — splitting on whitespace, handling quoted strings, and separating
the command name from its arguments and flags.

Design: The parser is intentionally decoupled from execution.
It produces a Command object that any executor can consume.
"""

import shlex
from dataclasses import dataclass, field


# ─────────────────────────────────────────────
#  Command — parsed representation of one input
# ─────────────────────────────────────────────
@dataclass
class Command:
    """
    Structured output from the parser.

    Example:  "rm -r /home/user/docs"
        name  = "rm"
        args  = ["/home/user/docs"]
        flags = {"-r"}
        raw   = "rm -r /home/user/docs"
    """
    name  : str
    args  : list[str]           = field(default_factory=list)
    flags : set[str]            = field(default_factory=set)
    raw   : str                 = ""

    def get_arg(self, index: int, default: str = "") -> str:
        """Safely retrieve a positional argument by index."""
        return self.args[index] if index < len(self.args) else default

    def has_flag(self, flag: str) -> bool:
        return flag in self.flags

    def __repr__(self):
        return f"Command(name={self.name!r}, args={self.args}, flags={self.flags})"


# ─────────────────────────────────────────────
#  ParseError
# ─────────────────────────────────────────────
class ParseError(Exception):
    """Raised when input cannot be tokenized (e.g. unmatched quotes)."""
    pass


# ─────────────────────────────────────────────
#  CommandParser
# ─────────────────────────────────────────────
class CommandParser:
    """
    Lexes and parses a raw input string into a Command.

    Uses shlex for proper tokenization (handles quoted paths with spaces).
    Tokens starting with '-' are treated as flags, others as positional args.

    Real OS concept: equivalent to the lexer stage in bash's input pipeline.
    """

    @staticmethod
    def parse(raw: str) -> Command | None:
        """
        Parse a raw input line into a Command object.

        Returns None for empty input.
        Raises ParseError for malformed input (e.g. unmatched quotes).

        Examples:
            "ls /home"          → Command(name="ls",    args=["/home"])
            "mkdir my dir"      → Command(name="mkdir", args=["my", "dir"])
            'touch "my file"'   → Command(name="touch", args=["my file"])
            "rm -r /tmp"        → Command(name="rm",    args=["/tmp"], flags={"-r"})
        """
        raw = raw.strip()
        if not raw:
            return None

        try:
            # shlex.split handles quoted strings correctly
            tokens = shlex.split(raw)
        except ValueError as e:
            raise ParseError(f"Parse error: {e}")

        name  = tokens[0].lower()
        args  = []
        flags = set()

        for token in tokens[1:]:
            if token.startswith("-") and len(token) > 1:
                # Multi-flag shorthand: "-rf" → {"-r", "-f"}
                if len(token) > 2 and not token.startswith("--"):
                    for ch in token[1:]:
                        flags.add(f"-{ch}")
                else:
                    flags.add(token)
            else:
                args.append(token)

        return Command(name=name, args=args, flags=flags, raw=raw)
