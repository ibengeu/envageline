import {
  LAYOUT_INPUT_SIZE,
  LAYOUT_MODEL_PATH,
  LAYOUT_MODEL_SHA256,
  type LayoutInferenceBackend,
  verifyLayoutModelChecksum,
} from "./layout-classifier.ts";

interface NumericTensor {
  data: ArrayLike<number>;
  dims: readonly number[];
}

let backendPromise: Promise<LayoutInferenceBackend> | null = null;
let backendFailure: unknown;
const MODEL_BYTE_LENGTH = 4_917_852;
const MODEL_LOAD_TIMEOUT_MS = 30_000;

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Layout model load timed out.")), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function detectionOutput(outputs: Record<string, NumericTensor>): {
  detections: ArrayLike<number>;
  count: number;
} {
  const tensors = Object.values(outputs);
  const detections = tensors.find((tensor) => tensor.dims.at(-1) === 6);
  const countTensor = tensors.find((tensor) => tensor !== detections && tensor.data.length >= 1);
  const count = Number(countTensor?.data[0] ?? 0);
  if (!detections || !Number.isFinite(count)) {
    throw new Error("Layout model returned an invalid output contract.");
  }
  return { detections: detections.data, count };
}

async function loadBackend(): Promise<LayoutInferenceBackend> {
  // OWASP A03:2025 Software Supply Chain Failures.
  // Load only the bundled same-origin model and verify its pinned digest before execution.
  const response = await fetch(`${LAYOUT_MODEL_PATH}?sha256=${LAYOUT_MODEL_SHA256}`, {
    cache: "force-cache",
  });
  if (!response.ok) throw new Error("Layout model asset is unavailable.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== MODEL_BYTE_LENGTH) {
    throw new Error("Layout model asset has an invalid size.");
  }
  await verifyLayoutModelChecksum(bytes);

  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = true;
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });

  return {
    async run(image, scaleFactor) {
      const outputs = await session.run({
        image: new ort.Tensor("float32", image, [1, 3, LAYOUT_INPUT_SIZE, LAYOUT_INPUT_SIZE]),
        scale_factor: new ort.Tensor("float32", scaleFactor, [1, 2]),
      });
      return detectionOutput(outputs as Record<string, NumericTensor>);
    },
  };
}

export function getBrowserLayoutBackend(): Promise<LayoutInferenceBackend> {
  if (backendFailure) return Promise.reject(backendFailure);
  backendPromise ??= withTimeout(loadBackend(), MODEL_LOAD_TIMEOUT_MS).catch((cause) => {
    backendFailure = cause;
    throw cause;
  });
  return backendPromise;
}
