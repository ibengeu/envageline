# Prepared Audio Speech Contract

## Synthesis

The speech engine exposes a synthesis result containing a playable audio blob and the elapsed
synthesis time. Synthesis does not start playback.

## Playback

The existing speech entry point continues to support direct synthesis and playback. It also accepts
an optional prepared audio blob. When a prepared blob is supplied, the engine plays it and does not
send a second synthesis request.

## Cancellation

- Stopping playback rejects or cancels the active playback promise.
- Stopping the engine aborts owned background synthesis requests.
- A cancelled request cannot install an audio element or start playback.

## Errors

- Non-loopback endpoint: reject before fetch with the existing security error.
- Unreachable server: use the existing unavailable error.
- Non-success response or malformed audio response: use the existing synthesis-failed error.
- Background errors are handled by the scheduler and do not fail current playback.
