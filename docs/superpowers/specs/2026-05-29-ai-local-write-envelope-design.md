# AI Local Write Envelope Design

## Goal

Improve the Betaflight AI tuning workflow so `PID`, `Filters`, and `Rates` can all be analyzed locally, while only allowing writeable recommendations when local evidence is strong enough and bounded by deterministic local rules.

The target architecture is `local write envelope + AI explanation`:

- local analysis produces diagnostics, candidate values, write permissions, bounds, and blocking reasons
- AI explains and selects from local candidates
- parser and apply logic enforce local boundaries and reject any AI value outside the local envelope

This replaces the weaker pattern where AI is asked to infer writeable values from a thin summary payload.

## Product Decisions

- All three groups must be covered: `pid`, `filters`, and `rates`.
- Coverage does not imply writeability. Each group has its own local write gate.
- AI must not invent keys or values.
- AI must not write raw PID values.
- AI must not write advanced raw filter or notch parameters in v1.
- Token conservation is no longer a primary goal for this feature path. Evidence density is preferred over aggressive payload compaction.

## Architecture

The recommendation pipeline becomes:

1. `blackboxBblAnalysis.js`
   - analyze one ordinary BBL log
   - produce diagnostics, per-axis evidence, and single-log write envelopes
2. `blackboxBblAggregate.js`
   - merge multiple selected logs
   - produce aggregate diagnostics and group-level aggregate write envelopes
3. `payloadBuilder.js`
   - include `localAnalysis.writeEnvelope` in the AI payload
   - preserve `writeEnvelope` with highest compaction priority
4. `providerAdapters.js`
   - tell the model it may only use local candidate keys and values
5. `responseParser.js`
   - reconcile AI output against the local write envelope
   - build the final executable plan
6. `autotuneAi.js`
   - store local envelope, AI response, and reconciled effective plan separately
7. `AiAdvisor.vue`
   - display local evidence, local candidates, AI selection, and guard acceptance separately
8. apply / preview flow
   - apply only the reconciled effective plan

## Local Write Envelope Contract

Local analysis should produce a unified structure:

```js
{
  pid: {
    writeableAllowed: boolean,
    blockedReason: string,
    confidence: "low" | "medium" | "high",
    candidates: {
      [key]: {
        suggestedValue: number,
        min: number,
        max: number,
        step: number,
        reason: string,
        evidenceRefs: string[]
      }
    }
  },
  filters: {
    writeableAllowed: boolean,
    blockedReason: string,
    confidence: "low" | "medium" | "high",
    candidates: {}
  },
  rates: {
    writeableAllowed: boolean,
    blockedReason: string,
    confidence: "low" | "medium" | "high",
    candidates: {}
  }
}
```

Semantics:

- `writeableAllowed` is a local safety decision for that group only
- `blockedReason` explains why the group is explain-only
- `confidence` is local confidence in the write envelope, not AI confidence
- `candidates` are the only keys AI may use
- in v1, AI may only echo `suggestedValue`; it may not choose another value inside `min/max`

## Group Rules

### Rates

Writeable scope in v1:

- `roll_rate`
- `pitch_rate`
- `yaw_rate`

Only for legacy rates:

- `rates_type === 0`

Write conditions:

- aggregate local quality is `usable`
- runtime setpoint usage is clearly low
- configured rates exceed the local craft profile limit
- direction is consistent across selected usable logs

Candidate generation:

- move only in the more conservative direction
- never raise rates automatically
- use a bounded partial rollback, not a full jump to the target limit

Suggested v1 limits:

- single write delta capped to `10`
- single write delta capped to half the detected overshoot
- final value rounded to integer step

Fallback behavior:

- non-legacy rates stay explain-only
- mixed runtime usage stays explain-only
- conflicting multi-log evidence stays explain-only

### Filters

Writeable scope in v1:

- `slider_gyro_filter_multiplier`
- `slider_dterm_filter_multiplier`

Not writeable in v1:

- raw notch settings
- advanced dynamic notch settings
- direct raw lowpass settings

Write conditions:

- FFT usable
- stable repeated frequency-domain evidence across selected usable logs
- no strong mechanical imbalance block

Candidate generation:

- only allow stronger filtering in v1
- no automatic filter loosening

Suggested v1 limits:

- gyro filter multiplier: reduce by `3` to `5`
- dterm filter multiplier: reduce by `5` to `8`
- clamp to current local UI validation bounds

Fallback behavior:

- single-log evidence may produce candidates but default to explain-only
- at least two usable logs with consistent direction are required before `writeableAllowed=true`
- unstable spectral peaks or degraded logs keep the group explain-only

### PID

Writeable scope in v1:

- `slider_master_multiplier`
- `slider_d_gain`
- `slider_i_gain`
- `slider_feedforward_gain`

Not writeable in v1:

- raw `FC.PIDS`
- `slider_roll_pitch_ratio`
- `slider_pitch_pi_gain`
- advanced per-axis raw PID writes

Write conditions:

- aggregate local quality is `usable`
- no high-confidence mechanical imbalance block
- stable roll/pitch time-domain evidence exists
- D changes require both time-domain support and frequency-domain cleanliness

Candidate generation:

- `slider_master_multiplier`
  - only when roll and pitch both show consistent under-tracking
- `slider_d_gain`
  - only when peak error is elevated and high-frequency D-term evidence is not risky
- `slider_i_gain`
  - only when steady-state error is repeatedly elevated
- `slider_feedforward_gain`
  - only when moving error is elevated while steady error is not the dominant issue

Suggested v1 limits:

- any PID slider single-step change capped to `6`
- prefer changing fewer items per run
- ordering preference:
  - `master` or `feedforward` first
  - `i` second
  - `d` most restricted

Fallback behavior:

- single-log ordinary BBL defaults to explain-only for PID writes
- noisy frequency evidence blocks D writes
- mechanical or resonance concerns keep PID explain-only

## Payload Design

`localAnalysis` should include:

```js
{
  aggregateQuality: {},
  consensusDiagnostics: [],
  conflictingDiagnostics: [],
  aggregateRecommendations: [],
  axes: {},
  writeEnvelope: {}
}
```

Token priority rules change:

1. preserve `writeEnvelope`
2. preserve per-axis summarized evidence
3. preserve consensus diagnostics and aggregate recommendations
4. drop bulky source summaries first
5. only then fall back to `aggregateQuality`-only local analysis

This avoids the current failure mode where the most actionable local evidence is dropped before AI analysis.

## AI Prompt Rules

Provider prompt must explicitly state:

- use `localAnalysis.writeEnvelope` as the write boundary
- only keys listed in `candidates` are allowed
- if returning `writeable=true`, values must match local `suggestedValue`
- do not add keys
- do not interpolate inside `min/max`
- if a group has `writeableAllowed=false`, keep the group non-writeable and explain why

This keeps AI in a selection-and-explanation role rather than a value-generation role.

## Parser And Guard Rules

After normal JSON parsing, a reconciliation step must produce an executable `effectivePlan`.

Guard rules:

- if group is missing from local envelope, drop it
- if `writeableAllowed=false`, force `writeable=false`
- if key is not present in local candidates, drop it
- if returned value differs from `suggestedValue`, drop it
- if a group ends with empty `values`, force `writeable=false`
- preserve rejection reasons for UI display

The apply path must never use raw AI output. It must use `effectivePlan` only.

## Store And UI

Store state should separate:

- local analysis
- local write envelope
- raw AI response
- parsed AI response
- reconciled effective plan
- preview diff

Suggested shape:

```js
sessionState: {
  localBblAnalysis,
  localWriteEnvelope,
  aiRawResponseText,
  aiResponse,
  effectivePlan,
  applyPreview
}
```

UI should display four layers per group:

1. local evidence
2. local candidate values
3. AI decision
4. local guard acceptance or rejection

This prevents users from confusing:

- no local evidence
- AI not selecting a candidate
- AI selecting a blocked group
- AI returning values rejected by local guards

## Follow-Up Conversation Rules

Follow-up prompts must continue carrying:

- local write envelope
- last reconciled effective plan
- blocked reasons

Follow-up AI replies must stay within the same local boundaries and may only reconsider whether to use existing candidates.

## Implementation Order

Recommended order:

1. extend `blackboxBblAnalysis.js` to output group-level write envelopes
2. extend `blackboxBblAggregate.js` to aggregate group envelopes across selected logs
3. extend `payloadBuilder.js` to include and preserve `writeEnvelope`
4. update `providerAdapters.js` prompt contract
5. add envelope reconciliation to `responseParser.js`
6. extend `autotuneAi.js` store state and follow-up context
7. update `AiAdvisor.vue` to visualize local candidates vs AI result vs guard result
8. switch preview / apply to `effectivePlan`

## Delivery Phases

### Phase 1

- complete full writeable chain for `rates`
- build `filters` and `pid` envelopes, but keep them mostly explain-only

### Phase 2

- enable writeable `filters` when repeated stable spectral evidence is present

### Phase 3

- enable limited writeable `pid` when repeated stable low-noise evidence exists

This order is intentional. `rates` is the easiest group to constrain and validate. `pid` is the riskiest and should be opened last.

## Test Plan

Add or expand tests in this order:

- `blackboxBblAnalysis.test.js`
  - rates candidate generation
  - filter and PID blocked reasons
  - mechanical noise and resonance downgrade rules
- `blackboxBblAggregate.test.js`
  - independent group-level writeability
  - multi-log consistency promotion
  - multi-log conflict downgrade
- `payloadBuilder.test.js`
  - `writeEnvelope` included in payload
  - `writeEnvelope` survives compaction
- `providerAdapters.test.js`
  - prompt explicitly binds AI to local candidates and suggested values
- `responseParser.test.js`
  - out-of-envelope keys dropped
  - changed values dropped
  - blocked groups forced non-writeable
  - empty write groups downgraded
- `storeDefaults.test.js`
  - local envelope and effective plan state
  - follow-up context persistence
- AI advisor UI tests
  - local candidate view
  - AI decision view
  - guard rejection view
  - final applyable plan view

## Out Of Scope For V1

- direct raw PID writes
- direct advanced filter writes
- AI-selected alternate values inside local min/max ranges
- auto-applying recommendations without explicit user selection
- using ordinary BBL local analysis to replace CHIRP Autotune workflows
