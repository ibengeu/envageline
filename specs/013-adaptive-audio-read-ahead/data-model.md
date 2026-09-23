# Data Model: Adaptive Audio Read-Ahead

## Synthesis Result

Represents one completed local narration request.

| Field | Type | Rules |
|---|---|---|
| `blob` | audio blob | Required. The bytes are playable by the speech engine. |
| `synthesisMs` | finite number | Required for a network result. Used to update the timing estimate. |

## Prepared Audio Entry

Represents an active or completed request for one narration context.

| Field | Type | Rules |
|---|---|---|
| `key` | opaque string | Includes segment identity, voice identity, and rate. |
| `segmentId` | string | Identifies the visible narration segment. |
| `voiceId` | string or null | Part of the playback context. |
| `rate` | number | Part of the playback context. |
| `promise` | promise of audio blob | Shared by the current playback request and read-ahead callers. |

## Read-Ahead Window

The active ordered segment range used for preparation.

- The current segment is the playback anchor.
- The window contains zero to six later segments.
- Entries before the anchor are removed from the active in-memory map.
- A segment is reusable only when its key matches the current voice and rate.

## Playback Context

The identity under which prepared audio is valid.

- Document identity
- Playback generation
- Voice identity
- Playback rate

Any document or playback-session change invalidates prior prepared work. Voice or rate changes
produce different prepared-audio keys and clear old work before new preparation begins.

## State Transitions

```text
unrequested -> preparing -> ready -> playing
                 |            |
                 +-> failed   +-> discarded

old context -> cancelled or ignored
```

- `preparing`: synthesis is in flight.
- `ready`: audio is available for playback.
- `failed`: a background request failed and can be retried later; it does not fail current
  playback by itself.
- `discarded`: the entry is no longer valid for the active context.
