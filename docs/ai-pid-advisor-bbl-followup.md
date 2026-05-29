# AI PID Advisor BBL Follow-up

Date: 2026-05-26

## Decision

Generic `.bbl` support for the AI PID advisor should stay isolated from the existing Autotune / CHIRP path.

Do not modify:

- `src/js/blackbox/chirp_bbl_parser.js`
- `src/composables/useAutotune.js`
- Autotune tab frequency-response behavior

Reason: the existing Autotune importer is CHIRP-specific. It requires `debug_mode = CHIRP` and chirp flight segments, while ordinary Blackbox logs can still be valid and importable in Betaflight Blackbox Viewer. Mixing generic BBL handling into the CHIRP parser would increase upstream merge conflicts and risk regressions.

## Current Implementation

Added an AI-advisor-only generic BBL summary path:

- `src/js/autotune-ai/blackboxBblSummary.js`
- `src/stores/autotuneAi.js`
- `src/js/autotune-ai/payloadBuilder.js`
- `src/js/autotune-ai/inputSourceDetector.js`

The first version summarizes BBL log headers and field definitions. It extracts:

- log segment count
- selected log index
- firmware revision and API version
- data version
- `looptime`
- `pid_process_denom`
- estimated sample rate
- `debug_mode`
- whether main-frame fields include time, gyro, setpoint, debug, and motor data

The second pass adds bounded main-frame statistics for whitelisted ordinary Blackbox fields:

- decoded main-frame count
- corrupt-frame count
- first / last timestamp
- duration
- per-axis min / max / mean / RMS for `gyroADC[n]`
- per-axis min / max / mean / RMS for `setpoint[n]`
- per-index min / max / mean / RMS for `motor[n]`
- per-index min / max / mean / RMS for `debug[n]`

The third pass improves real-log robustness:

- supports `TAG8_8SVB` grouped field encoding
- automatically selects the log segment with the most decoded main frames
- caps decoded frames with `maxDecodedFrames` so large imports remain bounded
- exposes whether decoding was truncated

The fourth pass makes input sources additive instead of mutually exclusive:

- CLI dump / diff, Blackbox CSV, and BBL summaries can coexist in the same AI request
- uploading a BBL no longer clears the parsed CLI summary
- uploading a CLI file no longer clears the BBL summary
- the AI payload now includes an `inputSources` object with per-source presence and sanitized summaries
- raw BBL bytes are retained only in memory for log switching and are not persisted into session storage
- the UI shows separate source rows for CLI, CSV, and BBL so users can see which evidence is active
- BBL files with multiple embedded logs expose `availableLogs`, and the page includes a small BBL log manager for selecting which flight segment feeds the summary

This is enough for the AI advisor to accept ordinary `.bbl` files and include compact Blackbox metadata plus basic signal statistics in the AI payload without requiring CHIRP.

## Non-goals In This Pass

This pass does not implement full Blackbox Viewer CSV export parity.

It does not yet extract full time-series samples such as:

- gyro traces
- setpoint traces
- motor traces
- PID terms
- RC commands
- debug channels

It also does not run transfer-function analysis on ordinary logs. That remains separate from the CHIRP Autotune workflow.

## Next Steps

Recommended next step is to expand the isolated decoder carefully with real-log fixtures and only bounded outputs:

- sample rate from actual frame timestamps across I/P frames
- additional common grouped encodings (`TAG2_3S32`, `TAG8_4S16`, `TAG2_3SVARIABLE`)
- motor saturation hints
- throttle / RC command statistics when fields are present
- PID term statistics when fields are present
- optional decimated samples for AI context
- manual clearing controls for individual input sources, if users start combining many files during one tuning session

Keep raw rows out of the AI payload. Store only bounded summaries so the payload remains under the existing size cap.
