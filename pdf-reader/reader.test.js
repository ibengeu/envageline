const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const {
  normalizePdfText,
  splitIntoSpeechChunks,
  renderExtractedText,
  renderSpeechFocus,
} = require("./app.js");

test("normalizePdfText preserves paragraphs while removing extraction noise", () => {
  const raw = "This is a hyphen-\nated word.\nThis continues the same paragraph.\n\n\nNext   paragraph.";

  assert.equal(
    normalizePdfText(raw),
    "This is a hyphenated word. This continues the same paragraph.\n\nNext paragraph.",
  );
});

test("splitIntoSpeechChunks returns speakable sentence groups within a max length", () => {
  const text = [
    "First sentence is short.",
    "Second sentence has enough words to matter.",
    "Third sentence closes the idea.",
  ].join(" ");

  assert.deepEqual(splitIntoSpeechChunks(text, 58), [
    "First sentence is short.",
    "Second sentence has enough words to matter.",
    "Third sentence closes the idea.",
  ]);
});

test("splitIntoSpeechChunks keeps long unpunctuated text speakable", () => {
  const text = "word ".repeat(80).trim();
  const chunks = splitIntoSpeechChunks(text, 120);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 120));
  assert.equal(chunks.join(" "), text);
});

test("splitIntoSpeechChunks bounds a single overlong token", () => {
  const text = "x".repeat(305);
  const chunks = splitIntoSpeechChunks(text, 120);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 120));
  assert.equal(chunks.join(""), text);
});

test("renderExtractedText treats PDF content as literal text", () => {
  const container = { textContent: "", innerHTML: "" };
  const text = "Chapter <img src=x onerror=alert(1)> & notes";

  renderExtractedText(container, text);

  assert.equal(container.textContent, text);
  assert.equal(container.innerHTML, "");
});

test("renderSpeechFocus highlights the active sentence without parsing PDF text as markup", () => {
  function textNode(value) {
    return { type: "text", textContent: value };
  }

  function elementNode(tag) {
    return {
      type: "element",
      tag,
      className: "",
      textContent: "",
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    };
  }

  const container = {
    ownerDocument: {
      createTextNode: textNode,
      createElement: elementNode,
    },
    children: [],
    textContent: "",
    replaceChildren(...nodes) {
      this.children = nodes;
      this.textContent = nodes.map((node) => node.textContent).join("");
    },
  };
  const text = "First sentence. Read <img src=x onerror=alert(1)> literally. Last sentence.";

  const nextOffset = renderSpeechFocus(
    container,
    text,
    "Read <img src=x onerror=alert(1)> literally.",
  );

  assert.equal(container.textContent, text);
  assert.equal(container.children[1].className, "sentence-focus");
  assert.equal(container.children[1].textContent, "Read <img src=x onerror=alert(1)> literally.");
  assert.equal(container.children[1].attributes["data-magnifier"], "");
  assert.ok(nextOffset > text.indexOf("Read"));
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createElement(id) {
  return {
    id,
    disabled: false,
    hidden: false,
    textContent: "",
    value: "",
    files: [],
    listeners: {},
    children: [],
    attributes: {},
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); },
      toggle(value, force) {
        if (force === undefined ? !this.values.has(value) : force) {
          this.values.add(value);
        } else {
          this.values.delete(value);
        }
      },
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    closest() {
      return this;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    replaceChildren(...nodes) {
      this.children = nodes;
      this.textContent = nodes.map((node) => node.textContent || "").join("");
      const selected = nodes.find((node) => node.selected) || nodes[0];
      if (selected) this.value = selected.value;
    },
  };
}

function createFakeDocument() {
  const ids = [
    "fileInput",
    "dropZone",
    "fileName",
    "status",
    "statusDot",
    "voiceField",
    "voiceHelp",
    "pitchField",
    "pages",
    "wordCount",
    "textOutput",
    "play",
    "pause",
    "resume",
    "stop",
    "ttsProvider",
    "localEndpoint",
    "localSettings",
    "voice",
    "rate",
    "pitch",
    "rateValue",
    "pitchValue",
    "progress",
  ];
  const document = {
    elements: {},
    listeners: {},
    visibilityState: "visible",
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    dispatchEvent(event) {
      const handler = this.listeners[event.type];
      if (handler) handler(event);
    },
    querySelector(selector) {
      return this.elements[selector.slice(1)];
    },
    createElement(tag) {
      return {
        ownerDocument: document,
        tag,
        className: "",
        textContent: "",
        value: "",
        selected: false,
        attributes: {},
        closest() {
          return this;
        },
        classList: {
          values: new Set(),
          add(value) {
            this.values.add(value);
          },
          remove(value) {
            this.values.delete(value);
          },
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        getAttribute(name) {
          return this.attributes[name];
        },
        scrollIntoView() {},
      };
    },
    createTextNode(textContent) {
      return { ownerDocument: document, textContent };
    },
  };
  const elements = Object.fromEntries(ids.map((id) => [id, createElement(id)]));
  elements.rate.value = "1";
  elements.pitch.value = "1";
  document.elements = elements;
  Object.values(elements).forEach((element) => {
    element.ownerDocument = document;
  });

  return document;
}

function createPdf(text, pageCount = 1) {
  return {
    numPages: pageCount,
    async getPage() {
      return {
        async getTextContent() {
          return { items: [{ str: text }] };
        },
      };
    },
  };
}

function createFile(name, type = "application/pdf", marker = name) {
  return {
    name,
    type,
    async arrayBuffer() {
      return marker;
    },
  };
}

function loadBrowserApp({
  pdfLoader = () => Promise.resolve(createPdf("Loaded text.")),
  speech = true,
  voices = [{ name: "Natural Voice", lang: "en-US", voiceURI: "voice-1" }],
  fetchImpl,
} = {}) {
  const previous = {
    window: global.window,
    document: global.document,
    speech: global.SpeechSynthesisUtterance,
    indexedDB: global.indexedDB,
    crypto: global.crypto,
  };
  const fakeDocument = createFakeDocument();
  const speechSynthesis = speech
    ? {
        spoken: [],
        cancelled: 0,
        paused: 0,
        resumed: 0,
        getVoices: () => voices,
        addEventListener() {},
        speak(utterance) {
          this.spoken.push(utterance);
        },
        cancel() {
          this.cancelled += 1;
        },
        pause() {
          this.paused += 1;
        },
        resume() {
          this.resumed += 1;
        },
      }
    : undefined;
  const fakeWindow = {
    pdfjsLib: {
      getDocument({ data }) {
        return { promise: pdfLoader(data) };
      },
    },
    URL: {
      objectUrlCount: 0,
      createObjectURL() {
        this.objectUrlCount += 1;
        return `blob:audio-${this.objectUrlCount}`;
      },
      revokeObjectURL() {},
    },
    matchMedia: () => ({ matches: true }),
  };
  if (fetchImpl) fakeWindow.fetch = fetchImpl;
  if (speechSynthesis) fakeWindow.speechSynthesis = speechSynthesis;
  fakeWindow.Audio = function Audio(src) {
    this.src = src;
    this.paused = true;
    this.currentTime = 0;
    this.play = () => {
      this.paused = false;
      fakeWindow.lastAudio = this;
      return Promise.resolve();
    };
    this.pause = () => {
      this.paused = true;
    };
  };

  // Stub IndexedDB: always returns cache misses so tests exercise the fetch path
  global.indexedDB = {
    open() {
      const req = {};
      Promise.resolve().then(() => {
        if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: { objectStoreNames: { contains: () => true }, createObjectStore() {} } } });
        if (req.onsuccess) req.onsuccess({ target: { result: { transaction() { return { objectStore() { return { get() { const r = {}; Promise.resolve().then(() => { if (r.onsuccess) r.onsuccess(); }); return r; }, put() {}, delete() {}, index() { return { getAll() { const r = {}; Promise.resolve().then(() => { if (r.onsuccess) r.onsuccess({ target: { result: [] } }); }); return r; } }; }, createIndex() {} }; }, oncomplete: null, onerror: null } } } } });
      });
      return req;
    },
  };
  // Stub crypto.subtle.digest: returns a fixed 32-byte buffer (unique per input via simple hash)
  global.crypto = {
    subtle: {
      digest(_alg, data) {
        const bytes = new Uint8Array(32);
        const view = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer || new TextEncoder().encode(String(data)).buffer);
        for (let i = 0; i < view.length; i++) bytes[i % 32] ^= view[i];
        return Promise.resolve(bytes.buffer);
      },
    },
  };

  global.window = fakeWindow;
  global.document = fakeDocument;
  global.Blob = global.Blob || class Blob {};
  if (speech) {
    global.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) {
      this.text = text;
    };
  } else {
    delete global.SpeechSynthesisUtterance;
  }

  delete require.cache[require.resolve("./app.js")];
  require("./app.js");

  return {
    elements: fakeDocument.elements,
    window: fakeWindow,
    speechSynthesis,
    trigger(id, type, event = {}) {
      return fakeDocument.elements[id].listeners[type](event);
    },
    restore() {
      global.window = previous.window;
      global.document = previous.document;
      if (previous.speech) {
        global.SpeechSynthesisUtterance = previous.speech;
      } else {
        delete global.SpeechSynthesisUtterance;
      }
      if (previous.indexedDB !== undefined) {
        global.indexedDB = previous.indexedDB;
      } else {
        delete global.indexedDB;
      }
      if (previous.crypto !== undefined) {
        global.crypto = previous.crypto;
      } else {
        delete global.crypto;
      }
      delete require.cache[require.resolve("./app.js")];
      require("./app.js");
    },
  };
}

test("non-PDF selection clears previous readable text and disables playback", async () => {
  const app = loadBrowserApp({ pdfLoader: () => Promise.resolve(createPdf("First document.")) });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    assert.equal(app.elements.play.disabled, false);

    await app.trigger("fileInput", "change", {
      target: { files: [createFile("notes.txt", "text/plain")] },
    });

    assert.equal(app.elements.status.textContent, "Choose a PDF file.");
    assert.equal(app.elements.fileName.textContent, "No file selected");
    assert.equal(app.elements.play.disabled, true);
    assert.equal(app.elements.pause.disabled, true);
    assert.equal(app.elements.resume.disabled, true);
  } finally {
    app.restore();
  }
});

test("PDF load failure clears stale chunks and disables playback", async () => {
  let shouldFail = false;
  const app = loadBrowserApp({
    pdfLoader: () => (shouldFail ? Promise.reject(new Error("Could not read this PDF.")) : Promise.resolve(createPdf("First document."))),
  });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    assert.equal(app.elements.play.disabled, false);

    shouldFail = true;
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("broken.pdf")] },
    });

    assert.equal(app.elements.status.textContent, "Could not read this PDF.");
    assert.equal(app.elements.play.disabled, true);
    assert.equal(app.elements.stop.disabled, true);
  } finally {
    app.restore();
  }
});

test("newer PDF selection wins when an older extraction finishes later", async () => {
  const slow = deferred();
  const app = loadBrowserApp({
    pdfLoader: (marker) => (marker === "slow" ? slow.promise : Promise.resolve(createPdf("Second document."))),
  });
  try {
    const slowLoad = app.trigger("fileInput", "change", {
      target: { files: [createFile("slow.pdf", "application/pdf", "slow")] },
    });
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("fast.pdf", "application/pdf", "fast")] },
    });

    slow.resolve(createPdf("First document."));
    await slowLoad;

    assert.equal(app.elements.fileName.textContent, "fast.pdf");
    assert.equal(app.elements.textOutput.textContent, "Second document.");
  } finally {
    app.restore();
  }
});

test("unsupported speech synthesis keeps playback commands disabled after extraction", async () => {
  const app = loadBrowserApp({ speech: false });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });

    assert.equal(app.elements.textOutput.textContent, "Loaded text.");
    assert.equal(app.elements.play.disabled, true);
    assert.equal(app.elements.pause.disabled, true);
    assert.equal(app.elements.resume.disabled, true);
  } finally {
    app.restore();
  }
});

test("local Kokoro provider can play extracted text without browser speech synthesis", async () => {
  const calls = [];
  const app = loadBrowserApp({
    speech: false,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/voices")) {
        return {
          ok: true,
          async json() {
            return { voices: ["af_heart"] };
          },
        };
      }
      return {
        ok: true,
        async blob() {
          return new Blob(["audio"], { type: "audio/wav" });
        },
      };
    },
  });
  try {
    app.elements.ttsProvider.value = "local";
    app.elements.localEndpoint.value = "/v1/audio/speech";
    app.elements.voice.value = "af_heart";
    await app.trigger("ttsProvider", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });

    assert.equal(app.elements.play.disabled, false);
    await app.trigger("play", "click");

    const speechCalls = calls.filter((c) => c.url.endsWith("/speech"));
    assert.equal(calls[0].url, "/v1/audio/voices");
    assert.equal(speechCalls.length >= 1, true);
    assert.deepEqual(JSON.parse(speechCalls[0].options.body), {
      input: "Loaded text.",
      voice: "af_heart",
      response_format: "wav",
      speed: 1,
    });
    assert.equal(app.window.lastAudio.src, "blob:audio-1");
    assert.equal(app.elements.status.textContent, "Reading 1 of 1...");
  } finally {
    app.restore();
  }
});

test("clicking a text chunk starts reading from that portion", async () => {
  const calls = [];
  const app = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("First sentence. Second sentence. Third sentence.")),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/voices")) {
        return {
          ok: true,
          async json() {
            return { voices: ["af_heart"] };
          },
        };
      }
      return {
        ok: true,
        async blob() {
          return new Blob(["audio"], { type: "audio/wav" });
        },
      };
    },
  });
  try {
    app.elements.ttsProvider.value = "local";
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("ttsProvider", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });

    const thirdChunk = app.elements.textOutput.children.find((node) => node.getAttribute?.("data-chunk-index") === "2");
    assert.ok(thirdChunk);

    // Let any background prefetch fetches from file load settle first
    await new Promise((resolve) => setTimeout(resolve, 20));
    const beforeClick = calls.filter((call) => call.url.endsWith("/speech")).length;
    await app.trigger("textOutput", "click", { target: thirdChunk });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const speechCall = calls.filter((call) => call.url.endsWith("/speech"))[beforeClick];
    assert.ok(speechCall);
    assert.deepEqual(JSON.parse(speechCall.options.body), {
      input: "Third sentence.",
      voice: "af_heart",
      response_format: "wav",
      speed: 1,
    });
  } finally {
    app.restore();
  }
});

test("local Kokoro prefetches the next speech chunk while the current chunk is being prepared", async () => {
  const calls = [];
  const first = deferred();
  const second = deferred();
  const app = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("First chunk. ".repeat(40))),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/voices")) {
        return { ok: true, async json() { return { voices: ["af_heart"] }; } };
      }
      const speechCallsSoFar = calls.filter((c) => c.url.endsWith("/speech")).length;
      if (speechCallsSoFar === 1) return first.promise;
      return second.promise;
    },
  });
  try {
    app.elements.ttsProvider.value = "local";
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("ttsProvider", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });

    // Trigger play — this starts chunk[0] fetch and prefetch for chunk[1] concurrently
    const playPromise = app.trigger("play", "click");

    // Allow async IDB miss + sha256 to resolve so fetches are in flight
    await new Promise((resolve) => setTimeout(resolve, 20));

    // At least 2 speech fetches should now be in flight (chunk[0] + at least one prefetch)
    assert.ok(calls.filter((c) => c.url.endsWith("/speech")).length >= 2);

    first.resolve({ ok: true, async blob() { return new Blob(["audio-1"], { type: "audio/wav" }); } });
    await playPromise;

    assert.equal(app.window.lastAudio.src, "blob:audio-1");
  } finally {
    second.resolve({ ok: true, async blob() { return new Blob(["audio-2"], { type: "audio/wav" }); } });
    app.restore();
  }
});

test("local Kokoro provider loads available voices from the sibling voices endpoint", async () => {
  const calls = [];
  const app = loadBrowserApp({
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        async json() {
          return { voices: ["af_bella", "af_heart", "am_puck"] };
        },
      };
    },
  });
  try {
    app.elements.ttsProvider.value = "local";
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("ttsProvider", "change");

    assert.equal(calls[0], "/v1/audio/voices");
    assert.deepEqual(
      app.elements.voice.children.map((option) => option.value),
      ["af_bella", "af_heart", "am_puck"],
    );
    assert.equal(app.elements.voice.value, "af_heart");
  } finally {
    app.restore();
  }
});

test("local voice discovery keeps manual fallback when Kokoro is unavailable", async () => {
  const app = loadBrowserApp({
    fetchImpl: async () => ({ ok: false }),
  });
  try {
    app.elements.ttsProvider.value = "local";
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("ttsProvider", "change");

    assert.equal(app.elements.voice.value, "af_heart");
    assert.equal(app.elements.status.textContent, "Local Kokoro voices unavailable.");
  } finally {
    app.restore();
  }
});

test("local TTS endpoint rejects non-localhost URLs before sending text", async () => {
  let speechCalls = 0;
  const app = loadBrowserApp({
    speech: false,
    fetchImpl: async (url) => {
      if (url.endsWith("/speech")) {
        speechCalls += 1;
      }
      return { ok: true, blob: async () => new Blob(["audio"]) };
    },
  });
  try {
    app.elements.ttsProvider.value = "local";
    app.elements.localEndpoint.value = "https://example.com/v1/audio/speech";
    await app.trigger("ttsProvider", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });

    await app.trigger("play", "click");

    assert.equal(speechCalls, 0);
    assert.equal(app.elements.status.textContent, "Local TTS must use localhost or 127.0.0.1.");
  } finally {
    app.restore();
  }
});

test("same-origin local TTS endpoint is accepted", async () => {
  let speechCalls = 0;
  const app = loadBrowserApp({
    speech: false,
    fetchImpl: async (url) => {
      if (url.endsWith("/voices")) {
        return { ok: true, async json() { return { voices: ["af_heart"] }; } };
      }
      if (url.endsWith("/speech")) {
        speechCalls += 1;
      }
      return { ok: true, async blob() { return new Blob(["audio"]); } };
    },
  });
  try {
    app.elements.ttsProvider.value = "local";
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("ttsProvider", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    await app.trigger("play", "click");

    assert.equal(speechCalls, 1);
    assert.equal(app.elements.status.textContent, "Reading 1 of 1...");
  } finally {
    app.restore();
  }
});

test("local TTS falls back to localhost:8880 when the same-origin endpoint is unavailable", async () => {
  const calls = [];
  const app = loadBrowserApp({
    speech: false,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === "/v1/audio/voices" || url === "http://localhost:8880/v1/audio/voices") {
        return {
          ok: true,
          async json() {
            return { voices: ["af_heart"] };
          },
        };
      }
      if (url === "http://localhost:8880/v1/audio/speech") {
        return {
          ok: true,
          async blob() {
            return new Blob(["audio"], { type: "audio/wav" });
          },
        };
      }
      return { ok: false };
    },
  });
  try {
    app.elements.ttsProvider.value = "local";
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("ttsProvider", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    await app.trigger("play", "click");

    assert.ok(calls.includes("http://localhost:8880/v1/audio/speech"));
    assert.equal(app.elements.status.textContent, "Reading 1 of 1...");
  } finally {
    app.restore();
  }
});

test("speech playback errors clear paused state and restore stable controls", async () => {
  const app = loadBrowserApp({ pdfLoader: () => Promise.resolve(createPdf("Read this sentence.")) });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    app.trigger("play", "click");
    app.speechSynthesis.spoken[0].onerror();

    assert.equal(app.elements.status.textContent, "Speech playback stopped.");
    assert.equal(app.elements.play.disabled, false);
    assert.equal(app.elements.pause.disabled, true);
    assert.equal(app.elements.resume.disabled, true);
    assert.equal(app.elements.textOutput.textContent, "Read this sentence.");
  } finally {
    app.restore();
  }
});

test("local Kokoro playback pauses and resumes when the page visibility changes", async () => {
  const app = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("First chunk. ".repeat(40))),
    fetchImpl: async (url) => {
      if (url.endsWith("/voices")) {
        return {
          ok: true,
          async json() {
            return { voices: ["af_heart"] };
          },
        };
      }
      return {
        ok: true,
        async blob() {
          return new Blob(["audio"], { type: "audio/wav" });
        },
      };
    },
  });
  try {
    app.elements.ttsProvider.value = "local";
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("ttsProvider", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    await app.trigger("play", "click");

    assert.equal(app.window.lastAudio.paused, false);
    app.window.visibilityState = "hidden";
    global.document.visibilityState = "hidden";
    global.document.dispatchEvent({ type: "visibilitychange" });

    assert.equal(app.window.lastAudio.paused, true);
    assert.equal(app.elements.status.textContent, "Paused.");

    global.document.visibilityState = "visible";
    global.document.dispatchEvent({ type: "visibilitychange" });

    assert.equal(app.window.lastAudio.paused, false);
    assert.equal(app.elements.status.textContent, "Reading resumed.");
  } finally {
    app.restore();
  }
});

test("voice selector is disabled when the browser returns no voices", () => {
  const app = loadBrowserApp({ voices: [] });
  try {
    assert.equal(app.elements.voice.disabled, true);
    assert.equal(app.elements.voice.textContent, "No voices available");
  } finally {
    app.restore();
  }
});

test("static shell exposes resume control and local-only PDF engine policy", () => {
  const root = __dirname;
  const html = readFileSync(join(root, "index.html"), "utf8");
  const engine = readFileSync(join(root, "pdf-engine.js"), "utf8");

  assert.match(html, /id="resume"/);
  assert.match(html, /id="ttsProvider"/);
  assert.match(html, /id="localEndpoint"/);
  assert.match(html, /value="\/v1\/audio\/speech"/);
  assert.match(html, /src="\.\/app\.js" type="module"/);
  assert.doesNotMatch(html, /cdnjs\.cloudflare\.com/);
  assert.match(html, /connect-src 'self' http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/);
  assert.match(html, /media-src 'self' blob: http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/);
  assert.match(engine, /vendor\/pdfjs-4\.10\.38\/pdf\.min\.mjs/);
  assert.doesNotMatch(engine, /https:\/\/cdnjs\.cloudflare\.com/);
});

test("reader layout keeps long PDF text inside a viewport-constrained scroll region", () => {
  const css = readFileSync(join(__dirname, "styles.css"), "utf8");

  assert.match(css, /\.app-shell\s*{[^}]*height:\s*100dvh;/s);
  assert.match(css, /\.app-shell\s*{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.reader-core\s*{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.text-output\s*{[^}]*flex:\s*1;/s);
  assert.match(css, /\.text-output\s*{[^}]*min-height:\s*0;/s);
  assert.match(css, /\.text-output\s*{[^}]*overflow:\s*auto;/s);
});
