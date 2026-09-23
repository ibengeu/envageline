import hashlib
import tempfile
import unittest
from pathlib import Path

from integrity import IntegrityError, ensure_verified


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ModelIntegrityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "model.onnx"

    def tearDown(self) -> None:
        self.dir.cleanup()

    def test_accepts_a_model_file_matching_its_pinned_digest(self) -> None:
        self.path.write_bytes(b"genuine weights")
        ensure_verified(self.path, sha256(b"genuine weights"))
        self.assertTrue(self.path.exists())

    def test_rejects_and_removes_a_model_file_that_does_not_match(self) -> None:
        self.path.write_bytes(b"tampered weights")
        with self.assertRaises(IntegrityError):
            ensure_verified(self.path, sha256(b"genuine weights"))
        self.assertFalse(self.path.exists())

    def test_rejects_a_model_file_that_is_missing(self) -> None:
        with self.assertRaises(IntegrityError):
            ensure_verified(self.path, sha256(b"genuine weights"))


if __name__ == "__main__":
    unittest.main()
