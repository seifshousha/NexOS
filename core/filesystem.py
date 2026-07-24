"""
PyOS - Virtual File System
==========================
Implements a hierarchical file system stored as a JSON tree.
Supports: create, delete, rename, move, read, write for files and dirs.

Real OS concept: Inodes are represented as FSNode objects. The tree mirrors
how Linux/Unix VFS works — everything is a node with metadata + children.
"""

import json
import os
import time
from typing import Optional


# ─────────────────────────────────────────────
#  FSNode — the inode equivalent
# ─────────────────────────────────────────────
class FSNode:
    """
    Represents a single file or directory in the virtual file system.
    Analogous to an inode in real operating systems.

    Attributes:
        name     : display name
        is_dir   : True = directory, False = file
        content  : text content (files only)
        children : dict[name -> FSNode] (dirs only)
        created  : Unix timestamp of creation
        modified : Unix timestamp of last modification
        size     : byte-length of content
    """

    def __init__(self, name: str, is_dir: bool = False, content: str = ""):
        self.name     = name
        self.is_dir   = is_dir
        self.content  = content if not is_dir else ""
        self.children : dict[str, "FSNode"] = {}
        self.created  = time.time()
        self.modified = time.time()
        self.size     = len(content.encode())

    # ── Serialization ──────────────────────────────────────────────────────
    def to_dict(self) -> dict:
        """Recursively serialize node to a plain dict (for JSON storage)."""
        return {
            "name"    : self.name,
            "is_dir"  : self.is_dir,
            "content" : self.content,
            "created" : self.created,
            "modified": self.modified,
            "size"    : self.size,
            "children": {k: v.to_dict() for k, v in self.children.items()},
        }

    @staticmethod
    def from_dict(data: dict) -> "FSNode":
        """Recursively reconstruct node from a plain dict."""
        node          = FSNode(data["name"], data["is_dir"], data["content"])
        node.created  = data["created"]
        node.modified = data["modified"]
        node.size     = data["size"]
        node.children = {k: FSNode.from_dict(v) for k, v in data["children"].items()}
        return node

    def __repr__(self):
        tag = "DIR" if self.is_dir else "FILE"
        return f"<{tag} '{self.name}' size={self.size}>"


# ─────────────────────────────────────────────
#  VirtualFileSystem
# ─────────────────────────────────────────────
class VirtualFileSystem:
    """
    Full hierarchical virtual file system with persistent JSON storage.

    Path conventions:
        /            → root
        /home/alice  → nested directory
        /etc/os.conf → file inside a directory

    Real OS concept: path resolution walks the tree node-by-node,
    just like the Linux VFS dentry cache traversal.
    """

    def __init__(self, storage_path: str = "data/fs.json"):
        self.storage_path = storage_path
        self.root         = FSNode("/", is_dir=True)   # root inode
        self._load()                                    # restore from disk if exists

    # ── Internal helpers ───────────────────────────────────────────────────

    def _resolve(self, path: str) -> Optional[FSNode]:
        """Walk the tree and return the node at path, or None if not found."""
        path = path.strip("/")
        if not path:                        # empty path = root
            return self.root
        node = self.root
        for part in path.split("/"):
            if not node.is_dir or part not in node.children:
                return None
            node = node.children[part]
        return node

    def _resolve_parent(self, path: str) -> tuple[Optional[FSNode], str]:
        """Return (parent_node, child_name) for a given path."""
        path   = path.rstrip("/")
        parts  = path.rsplit("/", 1)
        parent_path = parts[0] if parts[0] else "/"
        child_name  = parts[1] if len(parts) > 1 else ""
        return self._resolve(parent_path), child_name

    def _touch_modified(self, node: FSNode):
        node.modified = time.time()

    # ── Persistence ────────────────────────────────────────────────────────

    def _save(self):
        """Serialize the entire FS tree to JSON (persistent storage)."""
        os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)
        with open(self.storage_path, "w") as f:
            json.dump(self.root.to_dict(), f, indent=2)

    def save(self):
        """Public API — flush the filesystem to disk."""
        self._save()

    def _load(self):
        """Load FS tree from JSON if the file exists."""
        if os.path.exists(self.storage_path):
            with open(self.storage_path) as f:
                self.root = FSNode.from_dict(json.load(f))

    # ── Directory operations ───────────────────────────────────────────────

    def mkdir(self, path: str) -> tuple[bool, str]:
        """Create a directory (and intermediate dirs if needed — like mkdir -p)."""
        path = path.strip("/")
        node = self.root
        for part in path.split("/"):
            if part not in node.children:
                new_dir = FSNode(part, is_dir=True)
                node.children[part] = new_dir
                self._touch_modified(node)
            node = node.children[part]
            if not node.is_dir:
                return False, f"'{part}' exists and is not a directory"
        self._save()
        return True, f"Directory '/{path}' created"

    def ls(self, path: str = "/") -> tuple[bool, list[dict]]:
        """List contents of a directory."""
        node = self._resolve(path)
        if node is None:
            return False, [{"error": f"Path '{path}' not found"}]
        if not node.is_dir:
            return False, [{"error": f"'{path}' is not a directory"}]
        entries = []
        for name, child in sorted(node.children.items()):
            entries.append({
                "name"    : name,
                "type"    : "dir" if child.is_dir else "file",
                "size"    : child.size,
                "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(child.modified)),
            })
        return True, entries

    # ── File operations ────────────────────────────────────────────────────

    def touch(self, path: str, content: str = "") -> tuple[bool, str]:
        """Create a file (or update its timestamp if it already exists)."""
        parent, name = self._resolve_parent(path)
        if parent is None:
            return False, f"Parent directory does not exist"
        if not name:
            return False, "Invalid path"
        if name in parent.children:
            self._touch_modified(parent.children[name])   # update timestamp
        else:
            parent.children[name] = FSNode(name, is_dir=False, content=content)
            self._touch_modified(parent)
        self._save()
        return True, f"File '{path}' ready"

    def write(self, path: str, content: str) -> tuple[bool, str]:
        """Write (overwrite) content to a file."""
        node = self._resolve(path)
        if node is None:
            return self.touch(path, content)     # auto-create if missing
        if node.is_dir:
            return False, f"'{path}' is a directory"
        node.content  = content
        node.size     = len(content.encode())
        node.modified = time.time()
        self._save()
        return True, f"Written {node.size} bytes to '{path}'"

    def read(self, path: str) -> tuple[bool, str]:
        """Read and return the content of a file."""
        node = self._resolve(path)
        if node is None:
            return False, f"File '{path}' not found"
        if node.is_dir:
            return False, f"'{path}' is a directory — use ls"
        return True, node.content

    # ── Shared operations (files + dirs) ───────────────────────────────────

    def delete(self, path: str, recursive: bool = False) -> tuple[bool, str]:
        """
        Delete a file or directory.
        Directories require recursive=True (like rm -r) to prevent accidents.
        """
        parent, name = self._resolve_parent(path)
        if parent is None or name not in parent.children:
            return False, f"'{path}' not found"
        node = parent.children[name]
        if node.is_dir and node.children and not recursive:
            return False, f"Directory not empty — use recursive=True"
        del parent.children[name]
        self._touch_modified(parent)
        self._save()
        return True, f"Deleted '{path}'"

    def rename(self, path: str, new_name: str) -> tuple[bool, str]:
        """Rename a file or directory in-place."""
        parent, old_name = self._resolve_parent(path)
        if parent is None or old_name not in parent.children:
            return False, f"'{path}' not found"
        if new_name in parent.children:
            return False, f"'{new_name}' already exists in this directory"
        node      = parent.children.pop(old_name)
        node.name = new_name
        parent.children[new_name] = node
        self._touch_modified(parent)
        self._save()
        return True, f"Renamed '{old_name}' → '{new_name}'"

    def move(self, src: str, dest_dir: str) -> tuple[bool, str]:
        """Move a file or directory to a new parent directory."""
        src_parent, src_name = self._resolve_parent(src)
        if src_parent is None or src_name not in src_parent.children:
            return False, f"Source '{src}' not found"
        dest = self._resolve(dest_dir)
        if dest is None:
            return False, f"Destination '{dest_dir}' not found"
        if not dest.is_dir:
            return False, f"Destination must be a directory"
        if src_name in dest.children:
            return False, f"'{src_name}' already exists at destination"
        node = src_parent.children.pop(src_name)
        dest.children[src_name] = node
        self._touch_modified(src_parent)
        self._touch_modified(dest)
        self._save()
        return True, f"Moved '{src}' → '{dest_dir}/{src_name}'"

    def stat(self, path: str) -> tuple[bool, dict]:
        """Return metadata about a node (like stat syscall)."""
        node = self._resolve(path)
        if node is None:
            return False, {"error": f"'{path}' not found"}
        return True, {
            "name"    : node.name,
            "type"    : "directory" if node.is_dir else "file",
            "size"    : node.size,
            "created" : time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(node.created)),
            "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(node.modified)),
            "children": len(node.children) if node.is_dir else None,
        }
