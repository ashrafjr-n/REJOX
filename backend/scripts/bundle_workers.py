"""Bundle the Node workers into ``src/rejox/_workers/`` with esbuild.

    python scripts/bundle_workers.py          # from backend/

Writes ``parser.js`` and ``codemod.js`` (self-contained, no node_modules) plus
``THIRD_PARTY_LICENSES.txt`` for the npm packages bundled into them. The wheel's
build hook (``hatch_build.py``) calls :func:`bundle`, so a checkout and an
installed wheel run the exact same files. Stdlib only: it runs before rejox is
installed.

Versions come from each worker's package-lock.json (``npm ci``), so the same
commit produces the same bundles on every machine.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
OUT_DIR = BACKEND / "src" / "rejox" / "_workers"

# bundle name → (worker package dir, entry point)
WORKERS = {
    "parser": ("parser-worker", "src/index.ts"),
    "codemod": ("codemod-worker", "src/main.ts"),
}

ESBUILD_FLAGS = [
    "--bundle",
    "--platform=node",
    "--target=node20",
    "--format=cjs",
    "--minify",
    # Keeps notices of code vendored inside a package (@ts-morph/common ships
    # TypeScript, Apache-2.0); package-level licenses go to THIRD_PARTY_LICENSES.txt.
    "--legal-comments=eof",
    "--log-level=warning",
]


def _npm() -> str:
    npm = shutil.which("npm")
    if npm is None:
        sys.exit("npm is required to bundle the workers (Node 20+).")
    return npm


def _packages(metafile: Path, worker_dir: Path) -> set[Path]:
    """The npm package directories esbuild actually pulled into the bundle."""
    dirs: set[Path] = set()
    for source in json.loads(metafile.read_text())["inputs"]:
        if "node_modules/" not in source:
            continue
        head, rest = source.rsplit("node_modules/", 1)
        parts = rest.split("/")
        name = "/".join(parts[:2]) if parts[0].startswith("@") else parts[0]
        dirs.add((worker_dir / head / "node_modules" / name).resolve())
    return dirs


def _license_text(pkg_dir: Path) -> str:
    meta = json.loads((pkg_dir / "package.json").read_text())
    header = f"{meta['name']}@{meta['version']} — {meta.get('license', 'UNKNOWN')}"
    files = sorted(p for p in pkg_dir.iterdir() if p.name.upper().startswith(("LICENSE", "LICENCE", "COPYING")))
    body = "\n".join(f.read_text(errors="replace").strip() for f in files) or "(no license file shipped)"
    return f"{'=' * 78}\n{header}\n{'=' * 78}\n{body}\n"


def bundle(out_dir: Path = OUT_DIR) -> list[Path]:
    npm = _npm()
    out_dir.mkdir(parents=True, exist_ok=True)
    packages: set[Path] = set()
    written: list[Path] = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, (package, entry) in WORKERS.items():
            worker_dir = BACKEND / package
            if not (worker_dir / "node_modules").is_dir():
                subprocess.run(
                    [npm, "ci", "--no-audit", "--no-fund", "--ignore-scripts"], cwd=worker_dir, check=True
                )
            out = out_dir / f"{name}.js"
            metafile = Path(tmp) / f"{name}.meta.json"
            subprocess.run(
                [str(worker_dir / "node_modules" / ".bin" / "esbuild"), entry, *ESBUILD_FLAGS,
                 f"--outfile={out}", f"--metafile={metafile}"],
                cwd=worker_dir,
                check=True,
            )
            packages |= _packages(metafile, worker_dir)
            written.append(out)

    # One entry per package@version: the two workers share ts-morph + TypeScript.
    texts = {_license_text(p) for p in packages}
    licenses = out_dir / "THIRD_PARTY_LICENSES.txt"
    licenses.write_text(
        "Third-party software bundled into rejox/_workers/*.js\n\n" + "\n".join(sorted(texts))
    )
    written.append(licenses)
    return written


if __name__ == "__main__":
    for path in bundle():
        print(f"{path.stat().st_size:>10,}  {path.relative_to(BACKEND)}")
