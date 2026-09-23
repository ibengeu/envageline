# PP-DocLayout-S ONNX

`pp_doclayout_s.onnx` is a browser-local document-layout model.

- Upstream model: `PaddlePaddle/PP-DocLayout-S`
- ONNX export: `stefanj0/PP-DocLayout-S-ONNX`
- License: Apache License 2.0
- Size: 4,917,852 bytes
- SHA-256: `33688dbee1c23e34b81777e97cb428eb40f24b242c02b5f623484959e830aec8`
- Input: float32 `[1, 3, 480, 480]` plus float32 scale factor `[1, 2]`
- Source: <https://huggingface.co/stefanj0/PP-DocLayout-S-ONNX>
- Upstream license: <https://huggingface.co/PaddlePaddle/PP-DocLayout-S>

The application fetches this file only from its same-origin asset path. It verifies the SHA-256 digest before ONNX Runtime executes the model.
