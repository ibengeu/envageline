import { readFile } from "node:fs/promises";
import * as ort from "onnxruntime-web";

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

const bytes = await readFile(new URL("../public/models/pp_doclayout_s.onnx", import.meta.url));
const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
const image = new Float32Array(1 * 3 * 480 * 480);
const mean = [0.485, 0.456, 0.406];
const std = [0.229, 0.224, 0.225];
for (let channel = 0; channel < 3; channel += 1) {
  image.fill((1 - mean[channel]) / std[channel], channel * 480 * 480, (channel + 1) * 480 * 480);
}
const result = await session.run({
  image: new ort.Tensor("float32", image, [1, 3, 480, 480]),
  scale_factor: new ort.Tensor("float32", new Float32Array([1, 1]), [1, 2]),
});

process.stdout.write(`${JSON.stringify({
  inputs: session.inputNames,
  outputs: session.outputNames,
  outputMetadata: Object.fromEntries(Object.entries(result).map(([name, tensor]) => [
    name,
    { type: tensor.type, dims: tensor.dims, length: tensor.data.length },
  ])),
})}\n`);
