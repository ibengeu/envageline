import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPlaybackSession, type SpeakResult } from "./session.ts";

interface Sentence {
  id: string;
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

// A stand-in narrator: each sentence "plays" until the test lets it finish,
// and the speaker is either audible or silenced by pause.
function listener(ids: string[] = ["one", "two", "three"]) {
  const sentences: Sentence[] = ids.map((id) => ({ id }));
  const heard: string[] = [];
  const audio = { silenced: false, speaking: null as string | null };
  let finishCurrent: ((result: SpeakResult) => void) | null = null;
  let failCurrent: ((cause: unknown) => void) | null = null;
  const session = createPlaybackSession<Sentence>({
    speak: (sentence) =>
      new Promise<SpeakResult>((resolve, reject) => {
        heard.push(sentence.id);
        audio.speaking = sentence.id;
        finishCurrent = resolve;
        failCurrent = reject;
      }),
    pauseAudio: () => {
      audio.silenced = true;
    },
    resumeAudio: () => {
      audio.silenced = false;
    },
    stopAudio: () => {
      audio.speaking = null;
      audio.silenced = false;
      finishCurrent?.("aborted");
      finishCurrent = null;
    },
    first: async () => sentences[0] ?? null,
    next: async (sentence) => sentences[sentences.findIndex((s) => s.id === sentence.id) + 1] ?? null,
    onChange: () => undefined,
    onError: () => undefined,
  });
  return {
    session,
    sentences,
    heard,
    audio,
    async finishSentence(result: SpeakResult = "completed") {
      const finish = finishCurrent;
      finishCurrent = null;
      audio.speaking = null;
      finish?.(result);
      await flush();
    },
    async failSentence(cause: unknown) {
      const fail = failCurrent;
      finishCurrent = null;
      fail?.(cause);
      await flush();
    },
  };
}

describe("playback session", () => {
  it("narrates each sentence once, in order, then reports completion", async () => {
    const book = listener();

    book.session.play();
    await flush();
    await book.finishSentence();
    await book.finishSentence();
    await book.finishSentence();

    assert.deepEqual(book.heard, ["one", "two", "three"]);
    assert.equal(book.session.status, "completed");
  });

  it("never starts a second narration when play is pressed again while already playing", async () => {
    const book = listener();

    book.session.play();
    book.session.play();
    await flush();
    book.session.play();
    await flush();
    await book.finishSentence();

    assert.deepEqual(book.heard, ["one", "two"]);
    assert.equal(book.session.status, "playing");
  });

  it("pauses mid-sentence and resumes the same sentence without starting it over", async () => {
    const book = listener();
    book.session.play();
    await flush();

    book.session.pause();
    assert.equal(book.session.status, "paused");
    assert.equal(book.audio.silenced, true);

    book.session.play();
    assert.equal(book.session.status, "playing");
    assert.equal(book.audio.silenced, false);
    await book.finishSentence();

    assert.deepEqual(book.heard, ["one", "two"]);
  });

  it("holds the next sentence while paused, even when the current one finishes during the pause", async () => {
    const book = listener();
    book.session.play();
    await flush();

    book.session.pause();
    await book.finishSentence();

    assert.deepEqual(book.heard, ["one"]);
    assert.equal(book.session.status, "paused");

    book.session.play();
    await flush();
    assert.deepEqual(book.heard, ["one", "two"]);
    assert.equal(book.session.status, "playing");
  });

  it("pausing while narration is still starting keeps it silent until resumed", async () => {
    const book = listener();

    book.session.play();
    book.session.pause();
    await flush();

    assert.deepEqual(book.heard, []);
    assert.equal(book.session.status, "paused");

    book.session.play();
    await flush();
    assert.deepEqual(book.heard, ["one"]);
  });

  it("seeking while playing abandons the current sentence and carries on from the target", async () => {
    const book = listener(["one", "two", "three", "four"]);
    book.session.play();
    await flush();

    book.session.seek(book.sentences[2]!);
    await flush();
    await book.finishSentence();

    assert.deepEqual(book.heard, ["one", "three", "four"]);
    assert.equal(book.session.current?.id, "four");
    assert.equal(book.session.status, "playing");
  });

  it("seeking while paused moves the position but stays silent until play", async () => {
    const book = listener(["one", "two", "three"]);
    book.session.play();
    await flush();
    book.session.pause();

    book.session.seek(book.sentences[2]!);
    await flush();

    assert.deepEqual(book.heard, ["one"]);
    assert.equal(book.session.status, "paused");
    assert.equal(book.session.current?.id, "three");

    book.session.play();
    await flush();
    assert.deepEqual(book.heard, ["one", "three"]);
  });

  it("reports a narration failure and lets play retry from the same sentence", async () => {
    const book = listener();
    book.session.play();
    await flush();
    await book.finishSentence();

    await book.failSentence(new Error("voice service unavailable"));
    assert.equal(book.session.status, "error");

    book.session.play();
    await flush();
    assert.deepEqual(book.heard, ["one", "two", "two"]);
  });

  it("stopping ends narration for good; nothing more is spoken afterwards", async () => {
    const book = listener();
    book.session.play();
    await flush();

    book.session.stop();
    await book.finishSentence();
    await flush();

    assert.deepEqual(book.heard, ["one"]);
    assert.equal(book.session.status, "idle");
  });

  it("pressing play while a book is opening waits, then starts at the restored sentence", async () => {
    const book = listener();
    book.session.prepare();
    book.session.play();
    await flush();
    assert.deepEqual(book.heard, []);
    assert.equal(book.session.status, "preparing");

    book.session.seek(book.sentences[2]!, { autoplay: false });
    await flush();

    assert.deepEqual(book.heard, ["three"]);
  });

  it("opening a book without pressing play stays silent on the restored sentence", async () => {
    const book = listener();
    book.session.prepare();
    book.session.seek(book.sentences[1]!, { autoplay: false });
    await flush();

    assert.deepEqual(book.heard, []);
    assert.equal(book.session.current?.id, "two");
  });
});
