"""Print an InventoryBallast engine's identity in the form capability-manifest.json records.

python -m inventory_optimizer_api.engine_fingerprint /path/to/InventoryBallast
python -m inventory_optimizer_api.engine_fingerprint          # the engine Python imports
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .engine_source import (
    ENGINE_MODULE,
    checkout_version,
    engine_import_dir,
    engine_package_dir,
    git_head_commit,
    source_fingerprint,
)


def main(argv: list[str] | None = None) -> int:
    """Print the identity of an engine checkout (or the engine Python would import) in the
    form capability-manifest.json records, for re-pinning or troubleshooting."""
    parser = argparse.ArgumentParser(prog="python -m inventory_optimizer_api.engine_fingerprint")
    parser.add_argument("checkout", nargs="?", help="InventoryBallast checkout (default: imported)")
    args = parser.parse_args(argv)
    if args.checkout:
        root = Path(args.checkout).expanduser().resolve()
        import_dir = engine_import_dir(root)
        package_dir = import_dir / ENGINE_MODULE if import_dir is not None else None
        version, commit = checkout_version(root), git_head_commit(root)
    else:
        package_dir, version, commit = engine_package_dir(), None, None
    if package_dir is None:
        print("inventory_optimizer package not found", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "engine_package_version": version,
                "engine_commit": commit,
                "engine_fingerprint": source_fingerprint(package_dir),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
