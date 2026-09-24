import threading
import time
import unittest

from phonemes import SharedPhonemizer


class FakeBackend:
    def __init__(self, language: str) -> None:
        self.language = language


class SharedPhonemizerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.created: list[str] = []

        def create(language: str) -> FakeBackend:
            self.created.append(language)
            return FakeBackend(language)

        self.shared = SharedPhonemizer(create, lambda backend, text: f"{backend.language}:{text}")

    def test_sets_up_espeak_once_however_many_sentences_are_spoken(self) -> None:
        for n in range(50):
            self.shared.phonemize(f"Sentence {n}.", "en-us")
        self.assertEqual(self.created, ["en-us"])

    def test_speaks_each_language_with_its_own_espeak(self) -> None:
        self.assertEqual(self.shared.phonemize("colour", "en-gb"), "en-gb:colour")
        self.assertEqual(self.shared.phonemize("color", "en-us"), "en-us:color")
        self.assertEqual(self.shared.phonemize("flavour", "en-gb"), "en-gb:flavour")
        self.assertEqual(self.created, ["en-gb", "en-us"])

    def test_never_lets_two_requests_use_espeak_at_the_same_time(self) -> None:
        # espeak keeps global state, so a shared instance must be used by one
        # request at a time - including the moment it is first set up.
        created: list[str] = []
        busy = 0
        most_at_once = 0
        guard = threading.Lock()

        def create(language: str) -> FakeBackend:
            created.append(language)
            time.sleep(0.01)
            return FakeBackend(language)

        def run(backend: FakeBackend, text: str) -> str:
            nonlocal busy, most_at_once
            with guard:
                busy += 1
                most_at_once = max(most_at_once, busy)
            time.sleep(0.005)
            with guard:
                busy -= 1
            return text

        shared = SharedPhonemizer(create, run)
        workers = [
            threading.Thread(target=shared.phonemize, args=(f"Sentence {n}.", "en-us"))
            for n in range(8)
        ]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()

        self.assertEqual(most_at_once, 1)
        self.assertEqual(created, ["en-us"])


if __name__ == "__main__":
    unittest.main()
