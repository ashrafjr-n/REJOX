"""Where rejox writes by default — never inside the installed package.

``site-packages`` can be read-only and is shared by everything in the
environment, so run workspaces and the AI cache live in the user's cache
directory: ``$XDG_CACHE_HOME/rejox``, else ``~/.cache/rejox``. Each location
still has its own env override (``REJOX_WORKSPACE_ROOT``, ``REJOX_AI_CACHE``).
"""

from __future__ import annotations

import os
from pathlib import Path


def cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache"
    return Path(base) / "rejox"
