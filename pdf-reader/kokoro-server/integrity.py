from __future__ import annotations

import hashlib
from pathlib import Path

_CHUNK = 1 << 20


class IntegrityError(Exception):
    """A model file does not match the digest it was pinned to."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_verified(path: Path, expected_sha256: str) -> None:
    # OWASP A03:2025 Software Supply Chain Failures - a model file that does
    # not match its pinned digest is deleted, never loaded, so a tampered or
    # truncated download is refetched rather than run.
    if not path.is_file():
        raise IntegrityError(f"{path.name} is missing")
    if _sha256(path) != expected_sha256.lower():
        path.unlink(missing_ok=True)
        raise IntegrityError(f"{path.name} does not match its pinned SHA-256 digest")
