"""Wheel build hook: bundle the Node workers into ``src/rejox/_workers/``.

Runs for every wheel, editable included, so ``pip install -e .`` and an
installed wheel run the same bundles. See ``scripts/bundle_workers.py``.
"""

import subprocess
import sys
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict) -> None:
        subprocess.run([sys.executable, str(Path(self.root) / "scripts" / "bundle_workers.py")], check=True)
