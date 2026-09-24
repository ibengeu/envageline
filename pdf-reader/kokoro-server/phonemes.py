from __future__ import annotations

import threading
from typing import Any, Callable


class SharedPhonemizer:
    """One phonemizer backend per language for the life of the process.

    ``phonemizer.phonemize()`` builds a new espeak backend on every call, and
    each backend loads a private copy of libespeak-ng that is never unloaded on
    Linux - about 4.4 MB leaked per sentence spoken. Reusing a backend removes
    that; the lock is needed because espeak keeps global state.
    """

    def __init__(
        self,
        create_backend: Callable[[str], Any],
        run: Callable[[Any, str], str],
    ) -> None:
        self._create_backend = create_backend
        self._run = run
        self._backends: dict[str, Any] = {}
        # OWASP A06:2025 Insecure Design - espeak is not thread-safe, so the
        # request threads take turns (phonemizing is milliseconds; synthesis,
        # the slow part, still runs concurrently).
        self._lock = threading.Lock()

    def phonemize(self, text: str, language: str) -> str:
        with self._lock:
            backend = self._backends.get(language)
            if backend is None:
                backend = self._create_backend(language)
                self._backends[language] = backend
            return self._run(backend, text)


def _espeak_backend(language: str) -> Any:
    # Built exactly as phonemizer.phonemize() builds it for kokoro-onnx 0.4.7's
    # call (preserve_punctuation=True, with_stress=True, all else default).
    from phonemizer.backend import BACKENDS
    from phonemizer.logger import get_logger
    from phonemizer.punctuation import Punctuation

    return BACKENDS["espeak"](
        language,
        punctuation_marks=Punctuation.default_marks(),
        preserve_punctuation=True,
        with_stress=True,
        tie=False,
        language_switch="keep-flags",
        words_mismatch="ignore",
        logger=get_logger(),
    )


def _run_espeak(backend: Any, text: str) -> str:
    # phonemizer.phonemize()'s own formatting step, with its default arguments.
    from phonemizer.phonemize import _phonemize
    from phonemizer.separator import default_separator

    return _phonemize(backend, text, default_separator, False, 1, False, False)


def install_shared_phonemizer() -> SharedPhonemizer:
    """Make kokoro-onnx reuse one espeak backend (pinned: kokoro-onnx 0.4.7).

    Replaces ``Tokenizer.phonemize`` with the same steps it performs today,
    except that the backend is shared instead of rebuilt on every call.
    """
    from kokoro_onnx.tokenizer import Tokenizer

    shared = SharedPhonemizer(_espeak_backend, _run_espeak)

    def phonemize(self: Any, text: str, lang: str = "en-us", norm: bool = True) -> str:
        if norm:
            text = Tokenizer.normalize_text(text)
        phonemes = shared.phonemize(text, lang)
        phonemes = "".join(filter(lambda p: p in self.vocab, phonemes))
        return phonemes.strip()

    Tokenizer.phonemize = phonemize
    return shared
