(function attachReader(globalScope) {
  "use strict";

  function normalizePdfText(text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/([A-Za-z])-\n([A-Za-z])/g, "$1$2")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .split(/\n\n/)
      .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
  }

  function splitLongText(text, maxLength) {
    const words = text.split(/\s+/).filter(Boolean);
    const chunks = [];
    let current = "";

    for (const word of words) {
      if (word.length > maxLength) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        for (let index = 0; index < word.length; index += maxLength) {
          chunks.push(word.slice(index, index + maxLength));
        }
        continue;
      }

      const next = current ? `${current} ${word}` : word;
      if (next.length > maxLength && current) {
        chunks.push(current);
        current = word;
      } else {
        current = next;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  function splitIntoSpeechChunks(text, maxLength = 260) {
    const normalized = normalizePdfText(text);
    if (!normalized) return [];

    const sentences = normalized.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [normalized];
    const chunks = [];

    for (const sentence of sentences.map((value) => value.trim()).filter(Boolean)) {
      if (sentence.length > maxLength) {
        chunks.push(...splitLongText(sentence, maxLength));
      } else {
        chunks.push(sentence);
      }
    }

    return chunks;
  }

  function renderExtractedText(container, text) {
    // OWASP A07:2025 Injection - PDF content is untrusted, so render only as text.
    container.textContent = text;
  }

  function renderSpeechFocus(container, fullText, focusText, fromIndex = 0) {
    const text = String(fullText || "");
    const focus = String(focusText || "");
    const start = focus ? text.indexOf(focus, Math.max(0, fromIndex)) : -1;

    if (start < 0 || !container.ownerDocument || typeof container.replaceChildren !== "function") {
      renderExtractedText(container, text);
      return -1;
    }

    const end = start + focus.length;
    const doc = container.ownerDocument;
    const before = doc.createTextNode(text.slice(0, start));
    const active = doc.createElement("span");
    const after = doc.createTextNode(text.slice(end));

    active.className = "sentence-focus";
    active.textContent = focus;
    active.setAttribute("data-magnifier", "");
    container.replaceChildren(before, active, after);
    if (typeof active.scrollIntoView === "function") {
      const reduceMotion = globalScope.matchMedia
        && globalScope.matchMedia("(prefers-reduced-motion: reduce)").matches;
      active.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
    return end;
  }

  function renderChunkedText(container, chunks, activeIndex = -1) {
    if (!container.ownerDocument || typeof container.replaceChildren !== "function") {
      renderExtractedText(container, chunks.join(" "));
      return;
    }

    const doc = container.ownerDocument;
    const nodes = [];
    let activeSpan = null;
    chunks.forEach((chunk, index) => {
      const span = doc.createElement("span");
      span.className = index === activeIndex ? "speech-chunk is-active" : "speech-chunk";
      if (typeof span.setAttribute === "function") {
        span.setAttribute("data-chunk-index", String(index));
      }
      span.textContent = chunk;
      nodes.push(span);
      if (index === activeIndex) activeSpan = span;
      if (index < chunks.length - 1) {
        nodes.push(doc.createTextNode(" "));
      }
    });

    container.replaceChildren(...nodes);

    if (activeSpan && typeof activeSpan.scrollIntoView === "function") {
      const reduceMotion = globalScope.matchMedia
        && globalScope.matchMedia("(prefers-reduced-motion: reduce)").matches;
      activeSpan.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
  }

  const api = {
    normalizePdfText,
    splitIntoSpeechChunks,
    renderExtractedText,
    renderSpeechFocus,
    renderChunkedText,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.PdfVoiceReader = api;

  if (typeof document === "undefined") return;

  const state = {
    text: "",
    chunks: [],
    chunkIndex: 0,
    utterance: null,
    audio: null,
    audioUrl: "",
    voices: [],
    isPaused: false,
    highlightOffset: 0,
    loadId: 0,
    speechSupported: false,
    playbackActive: false,
    playbackId: 0,
    localAudioCache: new Map(),
    visibilityPaused: false,
  };

  const elements = {
    fileInput: document.querySelector("#fileInput"),
    dropZone: document.querySelector("#dropZone"),
    fileName: document.querySelector("#fileName"),
    status: document.querySelector("#status"),
    statusDot: document.querySelector("#statusDot"),
    pages: document.querySelector("#pages"),
    wordCount: document.querySelector("#wordCount"),
    textOutput: document.querySelector("#textOutput"),
    play: document.querySelector("#play"),
    pause: document.querySelector("#pause"),
    resume: document.querySelector("#resume"),
    stop: document.querySelector("#stop"),
    ttsProvider: document.querySelector("#ttsProvider"),
    localEndpoint: document.querySelector("#localEndpoint"),
    localSettings: document.querySelector("#localSettings"),
    voiceField: document.querySelector("#voiceField"),
    voiceHelp: document.querySelector("#voiceHelp"),
    pitchField: document.querySelector("#pitchField"),
    voice: document.querySelector("#voice"),
    rate: document.querySelector("#rate"),
    pitch: document.querySelector("#pitch"),
    rateValue: document.querySelector("#rateValue"),
    pitchValue: document.querySelector("#pitchValue"),
    progress: document.querySelector("#progress"),
  };

  function setStatus(message) {
    elements.status.textContent = message;
  }

  function updateButtons() {
    const hasText = state.chunks.length > 0;
    const provider = elements.ttsProvider.value;
    const canSpeak = hasText && (provider === "local" || state.speechSupported);
    const isPlaying = (state.utterance || state.audio) && !state.isPaused;

    // Show Play only when not actively playing or paused mid-session
    elements.play.hidden = state.isPaused || isPlaying;
    elements.play.disabled = !canSpeak;

    // Pause only visible when something is actively playing
    elements.pause.hidden = !isPlaying;
    elements.pause.disabled = !isPlaying;

    // Resume only visible when paused
    elements.resume.hidden = !state.isPaused;
    elements.resume.disabled = !state.isPaused;

    elements.stop.disabled = !hasText;

    // Status dot reflects playback state
    if (elements.statusDot) {
      elements.statusDot.classList.toggle("is-playing", !!isPlaying);
      elements.statusDot.classList.toggle("is-paused", !!state.isPaused);
    }
  }

  function updateProgress() {
    if (!state.chunks.length) {
      elements.progress.value = 0;
      return;
    }
    elements.progress.value = Math.round((state.chunkIndex / state.chunks.length) * 100);
  }

  function renderPlaybackText(activeIndex = -1) {
    if (!state.chunks.length) {
      renderExtractedText(elements.textOutput, state.text || "Choose a PDF to preview extracted text.");
      return;
    }
    renderChunkedText(elements.textOutput, state.chunks, activeIndex);
  }

  function selectedVoice() {
    const [, , selectedVoiceUri] = elements.voice.value.split("|");
    return state.voices.find((voice) => voice.voiceURI === selectedVoiceUri) || null;
  }

  function loadVoices() {
    if (!state.speechSupported) return;
    state.voices = window.speechSynthesis.getVoices();
    const preferred = state.voices.find((voice) => /natural|premium|enhanced|neural/i.test(voice.name))
      || state.voices.find((voice) => voice.lang && voice.lang.startsWith(navigator.language.slice(0, 2)))
      || state.voices[0];

    if (!state.voices.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No voices available";
      elements.voice.replaceChildren(option);
      elements.voice.disabled = true;
      return;
    }

    elements.voice.disabled = false;
    elements.voice.replaceChildren(...state.voices.map((voice) => {
      const option = document.createElement("option");
      option.value = `${voice.name}|${voice.lang}|${voice.voiceURI}`;
      option.textContent = `${voice.name} (${voice.lang})`;
      if (preferred && voice.voiceURI === preferred.voiceURI) option.selected = true;
      return option;
    }));
  }

  function clearDocumentState(message = "Choose a PDF to begin.") {
    state.text = "";
    state.chunks = [];
    state.chunkIndex = 0;
    state.utterance = null;
    state.audio = null;
    state.isPaused = false;
    state.highlightOffset = 0;
    state.playbackActive = false;
    state.playbackId += 1;
    state.visibilityPaused = false;
    state.localAudioCache.clear();
    ewma.reset();
    elements.fileName.textContent = "No file selected";
    elements.pages.textContent = "0";
    elements.wordCount.textContent = "0";
    renderExtractedText(elements.textOutput, "Choose a PDF to preview extracted text.");
    setStatus(message);
    updateProgress();
    updateButtons();
  }

  function stopSpeech() {
    if (state.speechSupported) {
      window.speechSynthesis.cancel();
    }
    if (state.audio) {
      state.audio.pause();
      state.audio.currentTime = 0;
      state.audio = null;
    }
    if (state.audioUrl) {
      globalScope.URL.revokeObjectURL(state.audioUrl);
      state.audioUrl = "";
    }
  }

  function clearLocalAudioCache(beforeIndex = 0) {
    for (const [index, entry] of state.localAudioCache.entries()) {
      if (index < beforeIndex) {
        if (entry && typeof entry.catch === "function") entry.catch(() => {});
        state.localAudioCache.delete(index);
      }
    }
  }

  function failPlayback(message) {
    stopSpeech();
    state.utterance = null;
    state.audio = null;
    state.isPaused = false;
    state.highlightOffset = 0;
    state.playbackActive = false;
    state.playbackId += 1;
    state.visibilityPaused = false;
    if (state.text) renderPlaybackText();
    setStatus(message);
    updateButtons();
  }

  function isLocalTtsEndpoint(value) {
    if (typeof value === "string" && value.startsWith("/v1/audio/speech")) {
      return true;
    }
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:")
        && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    } catch {
      return false;
    }
  }

  function localVoicesEndpoint(value) {
    return localTtsEndpoints(value, "voices")[0];
  }

  function localTtsEndpoints(value, mode = "speech") {
    const path = mode === "voices" ? "/v1/audio/voices" : "/v1/audio/speech";
    const raw = typeof value === "string" ? value.trim() : "";
    const endpoints = [];
    const add = (candidate) => {
      if (candidate && !endpoints.includes(candidate)) endpoints.push(candidate);
    };

    if (raw.startsWith("/v1/audio/speech")) {
      add(path);
      if (typeof globalScope.location?.origin === "string") {
        add(new URL(path, globalScope.location.origin).toString());
      }
      add(`http://localhost:8880${path}`);
      add(`http://127.0.0.1:8880${path}`);
      return endpoints;
    }

    try {
      const url = new URL(raw);
      if (mode === "voices") {
        url.pathname = url.pathname.replace(/\/speech\/?$/, "/voices");
      }
      add(url.toString());
    } catch {
      add(path);
    }

    if (endpoints.length && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(endpoints[0])) {
      add(`http://localhost:8880${path}`);
      add(`http://127.0.0.1:8880${path}`);
    }

    return endpoints;
  }

  // --- Persistent LRU audio cache (IndexedDB) ---
  const ttsCache = (() => {
    const DB_NAME = "tts-audio-cache";
    const STORE = "entries";
    const DB_VERSION = 1;
    const MAX_BYTES = 150 * 1024 * 1024; // 150 MB

    let _db = null;

    function openDb() {
      if (_db) return Promise.resolve(_db);
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: "key" });
            store.createIndex("lastUsed", "lastUsed");
          }
        };
        req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
        req.onerror = () => reject(req.error);
      });
    }

    async function sha256Key(text, voice, speed) {
      const raw = `${voice}|${speed}|${text}`;
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    async function get(key) {
      const db = await openDb();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, "readwrite");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => {
          const entry = req.result;
          if (!entry) { resolve(null); return; }
          // Update lastUsed in the same transaction
          entry.lastUsed = Date.now();
          tx.objectStore(STORE).put(entry);
          resolve(entry.blob);
        };
        req.onerror = () => resolve(null);
      });
    }

    async function put(key, blob) {
      const db = await openDb();
      const entry = { key, blob, size: blob.size, lastUsed: Date.now() };
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(entry);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      evict().catch(() => {});
    }

    async function evict() {
      const db = await openDb();
      // Gather all entries sorted oldest-first by lastUsed
      const all = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).index("lastUsed").getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      let total = all.reduce((sum, e) => sum + (e.size || 0), 0);
      if (total <= MAX_BYTES) return;
      const toDelete = [];
      for (const entry of all) {
        if (total <= MAX_BYTES) break;
        toDelete.push(entry.key);
        total -= entry.size || 0;
      }
      if (!toDelete.length) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        toDelete.forEach((k) => tx.objectStore(STORE).delete(k));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }

    return { sha256Key, get, put };
  })();
  // --- end persistent cache ---

  // --- EWMA response-time estimator (Algorithm 2) ---
  const ewma = (() => {
    // α_fast tracks short-term spikes; α_slow tracks steady-state trend
    const ALPHA_FAST = 0.3;
    const ALPHA_SLOW = 0.05;
    const SAFETY = 0.9;          // conservative bias — prefer fewer prefetches over stalls
    const MIN_AHEAD = 1;         // always prefetch at least 1 chunk ahead
    const MAX_AHEAD = 6;         // cap to avoid memory bloat
    const CHUNK_PLAY_MS = 2500;  // approximate playback duration per chunk (ms)

    let fast = null;
    let slow = null;

    function record(responseMs) {
      if (fast === null) { fast = responseMs; slow = responseMs; return; }
      fast = ALPHA_FAST * responseMs + (1 - ALPHA_FAST) * fast;
      slow = ALPHA_SLOW * responseMs + (1 - ALPHA_SLOW) * slow;
    }

    function lookahead() {
      if (fast === null) return MIN_AHEAD;
      // Conservative estimate: use the slower (higher) of the two windows
      const estimatedMs = Math.max(fast, slow) / SAFETY;
      // How many chunks can Kokoro synthesise in one chunk's play window?
      const ahead = Math.floor(CHUNK_PLAY_MS / estimatedMs);
      return Math.min(Math.max(ahead, MIN_AHEAD), MAX_AHEAD);
    }

    function reset() { fast = null; slow = null; }

    return { record, lookahead, reset };
  })();
  // --- end EWMA ---

  async function waitForRetryDelay(attempt) {
    return new Promise((resolve) => {
      globalScope.setTimeout(resolve, Math.min(750, 150 * (attempt + 1)));
    });
  }

  async function fetchLocalAudioBlob(endpoint, chunkText, attempt = 0) {
    try {
      const endpoints = localTtsEndpoints(endpoint, "speech");
      let lastResponse = null;
      for (const ttsEndpoint of endpoints) {
        const t0 = Date.now();
        lastResponse = await globalScope.fetch(ttsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: chunkText,
            voice: elements.voice.value.trim() || "af_heart",
            response_format: "wav",
            speed: Number(elements.rate.value),
          }),
        });
        if (lastResponse.ok) {
          const blob = await lastResponse.blob();
          ewma.record(Date.now() - t0);
          return blob;
        }
      }
      throw new Error("Local TTS request failed.");
    } catch (error) {
      if (attempt >= 2) throw error;
      await waitForRetryDelay(attempt);
      return fetchLocalAudioBlob(endpoint, chunkText, attempt + 1);
    }
  }

  function localChunkPromise(index) {
    if (index < 0 || index >= state.chunks.length) return Promise.resolve(null);
    if (state.localAudioCache.has(index)) return state.localAudioCache.get(index);

    const endpoint = elements.localEndpoint.value.trim();
    const chunkText = state.chunks[index];
    const voice = elements.voice.value.trim() || "af_heart";
    const speed = Number(elements.rate.value);

    const promise = ttsCache.sha256Key(chunkText, voice, speed).then(async (cacheKey) => {
      const cached = await ttsCache.get(cacheKey);
      if (cached) return cached;

      const blob = await fetchLocalAudioBlob(endpoint, chunkText);
      ttsCache.put(cacheKey, blob).catch(() => {});
      return blob;
    });

    state.localAudioCache.set(index, promise);
    return promise;
  }

  function prefetchLocalAudio(index) {
    if (index < 0 || index >= state.chunks.length) return Promise.resolve(null);
    const promise = localChunkPromise(index);
    promise.catch(() => {});
    return promise;
  }

  function prefetchAhead(fromIndex) {
    const ahead = ewma.lookahead();
    for (let i = 1; i <= ahead; i += 1) {
      prefetchLocalAudio(fromIndex + i);
    }
  }

  function resumeLocalPlayback() {
    if (!state.playbackActive || elements.ttsProvider.value !== "local") return;
    if (state.audio && state.isPaused) {
      state.visibilityPaused = false;
      state.isPaused = false;
      state.audio.play().catch(() => {
        if (state.chunkIndex < state.chunks.length) {
          speakLocalChunk();
        }
      });
      setStatus("Reading resumed.");
      updateButtons();
      return;
    }

    if (!state.audio && state.chunkIndex < state.chunks.length) {
      state.visibilityPaused = false;
      speakLocalChunk();
    }
  }

  async function loadLocalVoices() {
    const endpoint = elements.localEndpoint.value.trim();
    if (!isLocalTtsEndpoint(endpoint)) {
      setStatus("Local TTS must use localhost or 127.0.0.1.");
      return;
    }

    try {
      const endpoints = localTtsEndpoints(endpoint, "voices");
      let response = null;
      for (const voiceEndpoint of endpoints) {
        response = await globalScope.fetch(voiceEndpoint);
        if (response.ok) break;
      }
      if (!response || !response.ok) throw new Error("Local voices unavailable.");
      const data = await response.json();
      const voices = Array.isArray(data.voices) ? data.voices : [];
      if (!voices.length) throw new Error("Local voices unavailable.");
      const preferred = voices.includes("af_heart") ? "af_heart" : voices[0];
      elements.voice.replaceChildren(...voices.map((voice) => {
        const option = document.createElement("option");
        option.value = voice;
        option.textContent = voice;
        option.selected = voice === preferred;
        return option;
      }));
      elements.voice.value = preferred;
    } catch {
      const option = document.createElement("option");
      option.value = "af_heart";
      option.textContent = "af_heart";
      option.selected = true;
      elements.voice.replaceChildren(option);
      elements.voice.value = "af_heart";
      setStatus("Local Kokoro voices unavailable.");
    }
  }

  async function updateProviderFields() {
    const isLocal = elements.ttsProvider.value === "local";
    elements.localSettings.hidden = !isLocal;
    // Pitch is not supported by Kokoro; hide it in local mode
    if (elements.pitchField) elements.pitchField.hidden = isLocal;
    // Voice help text only applies to browser voices
    if (elements.voiceHelp) elements.voiceHelp.hidden = isLocal;
    if (isLocal) {
      await loadLocalVoices();
      if (state.chunks.length && isLocalTtsEndpoint(elements.localEndpoint.value.trim())) {
        prefetchLocalAudio(state.chunkIndex);
        prefetchAhead(state.chunkIndex);
      }
    } else {
      loadVoices();
    }
    updateButtons();
  }

  async function loadPdfEngine() {
    if (!globalScope.pdfjsLib) {
      await import("./pdf-engine.js");
    }
    if (!globalScope.pdfjsLib) {
      throw new Error("PDF engine failed to load. Run the app from the local server and reload.");
    }
    return globalScope.pdfjsLib;
  }

  async function extractPdfText(file) {
    const pdfjsLib = await loadPdfEngine();
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(" "));
      setStatus(`Reading page ${pageNumber} of ${pdf.numPages}...`);
    }

    return {
      pageCount: pdf.numPages,
      text: normalizePdfText(pages.join("\n\n")),
    };
  }

  async function handleFile(file) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      state.loadId += 1;
      clearDocumentState("Choose a PDF file.");
      return;
    }

    const loadId = state.loadId + 1;
    state.loadId = loadId;
    stopReading();
    setStatus("Loading PDF...");
    elements.fileName.textContent = file.name;
    elements.play.disabled = true;

    try {
      const result = await extractPdfText(file);
      if (loadId !== state.loadId) return;
      state.text = result.text;
      state.chunks = splitIntoSpeechChunks(result.text);
      state.chunkIndex = 0;
      state.highlightOffset = 0;
      state.localAudioCache.clear();

      renderPlaybackText();
      elements.pages.textContent = String(result.pageCount);
      elements.wordCount.textContent = String(result.text ? result.text.split(/\s+/).filter(Boolean).length : 0);
      setStatus(state.chunks.length ? "Ready to read aloud." : "No readable text found.");
      if (elements.ttsProvider.value === "local"
        && state.chunks.length
        && isLocalTtsEndpoint(elements.localEndpoint.value.trim())) {
        prefetchLocalAudio(state.chunkIndex);
        prefetchAhead(state.chunkIndex);
      }
      updateProgress();
      updateButtons();
    } catch (error) {
      if (loadId !== state.loadId) return;
      clearDocumentState(error.message || "Could not read this PDF.");
    }
  }

  async function speakLocalChunk() {
    const playbackIndex = state.chunkIndex;
    const playbackSession = state.playbackId;

    if (state.chunkIndex >= state.chunks.length) {
      stopReading(false);
      setStatus("Finished.");
      elements.progress.value = 100;
      return;
    }

    const endpoint = elements.localEndpoint.value.trim();
    if (!isLocalTtsEndpoint(endpoint)) {
      failPlayback("Local TTS must use localhost or 127.0.0.1.");
      return;
    }

    renderPlaybackText(state.chunkIndex);
    setStatus(`Reading ${state.chunkIndex + 1} of ${state.chunks.length}...`);
    updateButtons();

    try {
      const currentChunk = localChunkPromise(playbackIndex);
      prefetchAhead(playbackIndex);
      const blob = await currentChunk;
      if (playbackSession !== state.playbackId || playbackIndex !== state.chunkIndex || !blob) {
        return;
      }
      clearLocalAudioCache(playbackIndex - 1);
      if (state.audioUrl) globalScope.URL.revokeObjectURL(state.audioUrl);
      state.audioUrl = globalScope.URL.createObjectURL(blob);
      state.audio = new globalScope.Audio(state.audioUrl);
      state.audio.onended = () => {
        if (playbackSession !== state.playbackId) return;
        state.audio = null;
        state.chunkIndex += 1;
        updateProgress();
        clearLocalAudioCache(state.chunkIndex - 1);
        speakLocalChunk();
      };
      state.audio.onerror = () => {
        if (playbackSession !== state.playbackId) return;
        if (state.playbackActive && elements.ttsProvider.value === "local") {
          state.audio = null;
          state.isPaused = false;
          state.visibilityPaused = false;
          setStatus("Reconnecting local TTS...");
          speakLocalChunk();
          return;
        }
        failPlayback("Local TTS playback stopped.");
      };
      state.playbackActive = true;
      await state.audio.play();
      updateButtons();
    } catch (error) {
      failPlayback(error.message || "Local TTS request failed.");
    }
  }

  function speakBrowserChunk() {
    if (!state.speechSupported || typeof SpeechSynthesisUtterance !== "function") {
      failPlayback("This browser does not support text-to-speech.");
      return;
    }

    if (state.chunkIndex >= state.chunks.length) {
      stopReading(false);
      setStatus("Finished.");
      elements.progress.value = 100;
      return;
    }

    const utterance = new SpeechSynthesisUtterance(state.chunks[state.chunkIndex]);
    utterance.voice = selectedVoice();
    utterance.rate = Number(elements.rate.value);
    utterance.pitch = Number(elements.pitch.value);
    utterance.onend = () => {
      state.chunkIndex += 1;
      updateProgress();
      speakBrowserChunk();
    };
    utterance.onerror = () => {
      failPlayback("Speech playback stopped.");
    };

    state.utterance = utterance;
    state.isPaused = false;
    renderPlaybackText(state.chunkIndex);
    setStatus(`Reading ${state.chunkIndex + 1} of ${state.chunks.length}...`);
    updateButtons();
    window.speechSynthesis.speak(utterance);
  }

  async function playReading() {
    if (!state.chunks.length) return;
    if (elements.ttsProvider.value === "local") {
      stopSpeech();
      state.playbackId += 1;
      state.playbackActive = true;
      await speakLocalChunk();
      return;
    }

    if (!state.speechSupported) {
      failPlayback("This browser does not support text-to-speech.");
      return;
    }

    window.speechSynthesis.cancel();
    speakBrowserChunk();
  }

  function pauseReading() {
    if (elements.ttsProvider.value === "local") {
      if (!state.audio) return;
      state.isPaused = true;
      state.visibilityPaused = false;
      state.audio.pause();
      setStatus("Paused.");
      updateButtons();
      return;
    }

    if (!state.utterance || !state.speechSupported) return;
    state.isPaused = true;
    window.speechSynthesis.pause();
    setStatus("Paused.");
    updateButtons();
  }

  function resumeReading() {
    if (!state.isPaused) return;
    if (elements.ttsProvider.value === "local") {
      state.isPaused = false;
      state.visibilityPaused = false;
      state.audio.play();
      setStatus("Reading resumed.");
      updateButtons();
      return;
    }

    if (!state.speechSupported) return;
    state.isPaused = false;
    window.speechSynthesis.resume();
    setStatus("Reading resumed.");
    updateButtons();
  }

  function stopReading(resetProgress = true) {
    stopSpeech();
    state.utterance = null;
    state.audio = null;
    state.isPaused = false;
    state.playbackActive = false;
    state.playbackId += 1;
    state.visibilityPaused = false;
    if (resetProgress) state.chunkIndex = 0;
    state.highlightOffset = 0;
    state.localAudioCache.clear();
    ewma.reset();
    if (state.text) renderPlaybackText();
    updateProgress();
    updateButtons();
  }

  elements.fileInput.addEventListener("change", (event) => handleFile(event.target.files[0]));
  elements.play.addEventListener("click", playReading);
  elements.pause.addEventListener("click", pauseReading);
  elements.resume.addEventListener("click", resumeReading);
  elements.ttsProvider.addEventListener("change", updateProviderFields);
  elements.localEndpoint.addEventListener("change", () => {
    if (elements.ttsProvider.value === "local") loadLocalVoices();
  });
  elements.stop.addEventListener("click", () => {
    stopReading();
    setStatus(state.chunks.length ? "Stopped." : "Choose a PDF to begin.");
  });

  elements.rate.addEventListener("input", () => {
    elements.rateValue.textContent = `${Number(elements.rate.value).toFixed(1)}x`;
  });
  elements.pitch.addEventListener("input", () => {
    elements.pitchValue.textContent = Number(elements.pitch.value).toFixed(1);
  });

  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
  elements.dropZone.addEventListener("dragleave", () => {
    elements.dropZone.classList.remove("is-dragging");
  });
  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
    handleFile(event.dataTransfer.files[0]);
  });
  elements.textOutput.addEventListener("click", (event) => {
    const target = typeof event.target?.closest === "function"
      ? event.target.closest("[data-chunk-index]")
      : null;
    if (!target || !state.chunks.length) return;

    const index = Number(target.getAttribute("data-chunk-index"));
    if (!Number.isInteger(index) || index < 0 || index >= state.chunks.length) return;

    state.chunkIndex = index;
    state.highlightOffset = 0;
    updateProgress();

    if (elements.ttsProvider.value === "local") {
      stopSpeech();
      state.playbackId += 1;
      state.playbackActive = true;
      state.isPaused = false;
      state.visibilityPaused = false;
      speakLocalChunk();
      return;
    }

    if (state.speechSupported) {
      window.speechSynthesis.cancel();
      speakBrowserChunk();
      return;
    }

    renderPlaybackText(index);
    setStatus(`Selected ${index + 1} of ${state.chunks.length}.`);
  });

  if ("speechSynthesis" in window) {
    state.speechSupported = true;
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
  } else {
    state.speechSupported = false;
    elements.voice.disabled = true;
    setStatus("This browser does not support text-to-speech.");
  }

  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (elements.ttsProvider.value !== "local") return;
      if (typeof document.visibilityState === "string" && document.visibilityState === "hidden") {
        if (state.audio && !state.audio.paused) {
          state.visibilityPaused = true;
          state.audio.pause();
          state.isPaused = true;
          setStatus("Paused.");
          updateButtons();
        }
        return;
      }
      if (state.visibilityPaused) {
        resumeLocalPlayback();
      }
    });
  }

  updateProviderFields();
  updateButtons();
})(typeof window !== "undefined" ? window : globalThis);
