# AI PID Advisor Planning Document

> **For future implementation sessions:** use this document as the product and engineering source of truth. The next implementation session should execute in small tasks with tests, and should not expand scope without updating this file first.

**Goal:** Add an AI-assisted tuning workflow to Betaflight Configurator that can analyze craft context, CLI configuration, optional CSV log exports, and current FC configuration, then explain and optionally write selected PID/filter/rates recommendations.

**Architecture:** Keep safety-critical calculations local and deterministic. AI receives only structured summaries, explains the result, and returns bounded structured recommendations. User-selected write groups are validated locally before writing through existing Betaflight Configurator MSP paths.

**Tech Stack:** Vue 3, Pinia, existing MSP helpers, existing Autotune spectral analysis utilities, browser `fetch`, local `ConfigStorage`, `SessionStorage`, Web Worker for large CSV parsing/analysis.

---

## 1. Confirmed Product Decisions

- AI providers:
  - Support local direct API calls.
  - Support DeepSeek OpenAI-compatible API.
  - Support DeepSeek Anthropic-compatible API.
  - Support Anthropic Messages API format.
  - Do not introduce a backend proxy in v1.

- AI role:
  - AI is an advisor and structured recommender.
  - AI must not directly execute CLI.
  - AI must not write raw `FC.PIDS`.
  - AI must not bypass Betaflight firmware validation.

- Inputs:
  - Analysis can run without CSV.
  - Supported input sources:
    - Current connected flight controller configuration.
    - Imported or pasted CLI `diff all` / `dump` / `dump all`.
    - Imported CSV exported from `.bbl`.
  - CSV is optional and provides stronger dynamic evidence.

- Pre-analysis prompt:
  - Before analysis, the user must fill a structured craft context form.
  - The form covers craft type, frame size, weight, prop, motor KV, battery, flight style, current problem, tuning goal, and risk preference.
  - User may add optional notes, but cannot override system safety rules.

- AI write behavior:
  - AI output is split into PID, Filters, and Rates groups.
  - User can select which groups to apply.
  - Default selected groups: PID and Filters.
  - Default unselected group: Rates, because rates are pilot feel.
  - Provide `Preview Selected` and `Apply Selected & Save`.

- Lifecycle:
  - Left sidebar tab switching, refresh, expert mode toggle, FC disconnect/reconnect, and FC reboot must not clear AI panel data.
  - AI panel state must survive component remounts during the current app session.

---

## 2. User Workflow

1. User opens Autotune / AI Advisor.
2. User configures AI provider:
   - provider format
   - base URL
   - model
   - API key
   - temperature
   - max tokens
3. User fills Craft Context.
4. User chooses analysis source:
   - Analyze Current FC
   - Import CLI
   - Paste CLI
   - Import CSV
   - Import CLI + CSV
5. App parses inputs locally and creates a compact analysis payload.
6. AI receives only summary JSON, not raw CSV or full CLI dump.
7. AI returns grouped explanation and recommendations.
8. UI shows PID / Filters / Rates cards with current/proposed/delta/risk/confidence.
9. User selects groups.
10. User clicks Preview Selected or Apply Selected & Save.
11. App validates locally, writes selected groups through MSP, saves, and keeps AI panel state intact during reconnect/reboot.

---

## 3. Data Sources

### 3.1 Current FC

Use existing in-memory `FC` objects after MSP data load:

- `FC.TUNING_SLIDERS`
- `FC.FILTER_CONFIG`
- `FC.RC_TUNING`
- `FC.PID_ADVANCED_CONFIG`
- `FC.CONFIG`
- relevant feature/build option metadata

Current FC analysis supports static AI review even without CLI or CSV.

### 3.2 CLI Import Or Paste

Supported input:

- `diff all`
- `dump`
- `dump all`
- backup text created by existing CLI backup flows

Implementation intent:

- Parse locally into a structured config summary.
- Extract only whitelisted tuning-related keys.
- Do not send the full CLI text to AI.

Important parsed groups:

- profile and rateprofile commands
- `set` values related to PID, filters, rates, motors, gyro, DShot, dynamic notch, RPM filter, antigravity, feedforward, simplified tuning
- feature flags relevant to filtering and blackbox

### 3.3 CSV Import

Supported source:

- Blackbox Explorer CSV exported from `.bbl`.

Required CSV data:

- time column or enough timing information to infer sample rate
- `setpoint[0]`, `setpoint[1]`, `setpoint[2]`
- `gyroADC[0]`, `gyroADC[1]`, `gyroADC[2]`
- `debug[0]`, `debug[1]`, `debug[2]`, `debug[3]`

CSV behavior:

- Parse with streaming/chunk logic.
- Analyze in a Web Worker.
- Extract chirp segments from `debug[1]`.
- Reuse existing transfer function and recommendation utilities after converting CSV rows into the same internal `chirpData` shape used by BBL parsing.
- Do not send raw CSV rows, raw time-series arrays, or full spectra to AI.

Metadata fallback:

- If CSV lacks firmware/API/current slider metadata, use current connected FC config.
- If no connected FC and metadata is incomplete, allow explanation but disable Apply.

---

## 4. Craft Context Form

Required fields:

- craft type: freestyle / racing / cinematic / long range / whoop / other
- frame size or wheelbase
- all-up weight
- prop size and blade count
- motor KV
- battery cell count and typical pack size
- flight style
- main symptom
- tuning goal
- risk preference: conservative / balanced / aggressive

Optional fields:

- flight controller model
- gyro model
- ESC protocol
- motor output limit
- known mechanical issues
- environment notes
- freeform user notes

Persistence:

- Store Craft Context in `ConfigStorage`.
- Keep one default context for v1.
- Future extension can support multiple craft profiles.

---

## 5. AI Provider Design

Create a provider adapter layer with one public call:

```js
explainTuningAnalysis(settings, payload)
```

Provider settings:

```js
{
    provider: "deepseek-openai" | "deepseek-anthropic" | "anthropic",
    baseUrl: string,
    model: string,
    apiKey: string,
    temperature: number,
    maxTokens: number
}
```

Default provider presets:

- DeepSeek OpenAI-compatible:
  - base URL: `https://api.deepseek.com`
  - endpoint: `/chat/completions`
  - auth: `Authorization: Bearer <key>`
- DeepSeek Anthropic-compatible:
  - base URL: `https://api.deepseek.com/anthropic`
  - endpoint: `/v1/messages`
  - auth: `x-api-key`
- Anthropic:
  - base URL: `https://api.anthropic.com`
  - endpoint: `/v1/messages`
  - auth: `x-api-key`
  - include `anthropic-version`

Do not use SDKs in v1. Use `fetch` so desktop/web packaging stays simple.

---

## 6. AI Payload Contract

Payload sent to AI must be compact and structured:

```js
{
    craftContext: {},
    sourceSummary: {
        hasCurrentFc: boolean,
        hasCli: boolean,
        hasCsv: boolean,
        metadataSource: "current-fc" | "cli" | "csv" | "mixed" | "missing"
    },
    staticConfig: {
        firmware: {},
        pid: {},
        filters: {},
        rates: {},
        features: {}
    },
    dynamicAnalysis: {
        axes: {
            roll: {},
            pitch: {},
            yaw: {}
        }
    },
    existingRecommendation: {
        pid: {},
        filters: {},
        rates: {}
    }
}
```

Rules:

- Hard limit payload size, for example 20 KB.
- Include metrics and summaries only.
- Exclude full CLI text.
- Exclude raw CSV rows.
- Exclude full time-series arrays.
- Exclude API key and secrets.

---

## 7. AI Response Contract

AI must return JSON with this shape:

```js
{
    "summary": "string",
    "overallRisk": "low" | "medium" | "high",
    "groups": {
        "pid": {
            "writeable": true,
            "confidence": "low" | "medium" | "high",
            "explanation": "string",
            "values": {}
        },
        "filters": {
            "writeable": true,
            "confidence": "low" | "medium" | "high",
            "explanation": "string",
            "values": {}
        },
        "rates": {
            "writeable": true,
            "confidence": "low" | "medium" | "high",
            "explanation": "string",
            "values": {}
        }
    },
    "flightTestNotes": "string"
}
```

Local code must treat AI output as untrusted:

- Parse JSON defensively.
- Ignore unknown groups.
- Ignore unknown fields.
- Reject values outside local bounds.
- Reject direct CLI commands.
- Reject raw PID writes.
- Reject rates type changes.

---

## 8. Write Semantics

### 8.1 Preview Selected

Preview must:

- show selected group diffs
- run local validation
- not write EEPROM
- not execute CLI
- not persist changes to FC unless explicitly designed as a staged local preview

Recommended v1 behavior:

- Preview is display-only.
- Apply is the only operation that writes to FC.

### 8.2 Apply Selected & Save

Apply must:

1. Save AI panel state to `SessionStorage`.
2. Save original snapshots of:
   - `FC.TUNING_SLIDERS`
   - `FC.FILTER_CONFIG`
   - `FC.RC_TUNING`
3. Recompute `baseConfigFingerprint`.
4. If fingerprint changed, block Apply and mark result stale.
5. Apply selected groups.
6. Run relevant MSP writes.
7. Run firmware validation where available.
8. Write EEPROM.
9. Preserve AI panel state across disconnect/reconnect/reboot.

PID group:

- Write simplified tuning sliders only.
- Do not write raw `FC.PIDS`.
- Use existing simplified tuning validation.

Filters group:

- Write simplified gyro/dterm filter sliders only.
- Use existing gyro/dterm simplified calculation path.
- Save resulting `FC.FILTER_CONFIG` and simplified tuning.
- Advanced notch/RPM/dynamic notch direct writes are explain-only in v1.

Rates group:

- Write current rates type values only:
  - roll/pitch/yaw rc rate
  - roll/pitch/yaw rate
  - roll/pitch/yaw expo
- Do not change `rates_type`.
- Do not change throttle curve or throttle limit in v1.

---

## 9. State And Lifecycle

Create an AI advisor Pinia store. It should own:

- provider settings status
- craft context
- source selection
- parsed source summaries
- AI request state
- AI response
- parsed recommendations
- selected write groups
- preview/apply status
- stale status
- last error
- base config fingerprint

Persist:

- Provider settings: `ConfigStorage`
- Craft Context: `ConfigStorage`
- Current session AI panel state: `SessionStorage`

Must survive:

- left sidebar tab switch
- Autotune component remount
- expert mode toggle
- PID page refresh
- FC disconnect/reconnect
- FC reboot during save

Staleness:

- Record a fingerprint when AI recommendation is generated.
- Recompute before Apply.
- If different, keep explanation but disable Apply until user revalidates or reruns analysis.

---

## 10. UI Placement

Recommended location:

- Add AI Advisor inside Autotune tab, below import/analyze controls and near gain recommendations.

Main UI sections:

1. AI Provider Settings
2. Craft Context
3. Input Sources
4. Local Analysis Result
5. AI Explanation
6. PID / Filters / Rates Recommendation Cards
7. Preview / Apply Selected & Save toolbar

No landing page or marketing copy. Keep the UI operational and dense.

---

## 11. Likely Files To Create Or Modify

Likely new files:

- `src/stores/autotuneAi.js`
- `src/composables/useAutotuneAi.js`
- `src/js/autotune-ai/providerAdapters.js`
- `src/js/autotune-ai/payloadBuilder.js`
- `src/js/autotune-ai/responseParser.js`
- `src/js/autotune-ai/cliConfigParser.js`
- `src/js/autotune-ai/csvChirpParser.js`
- `src/js/workers/autotune_csv_worker.js`
- `src/components/tabs/autotune/AiAdvisor.vue`
- `src/components/tabs/autotune/AiProviderSettings.vue`
- `src/components/tabs/autotune/CraftContextForm.vue`
- `src/components/tabs/autotune/AiRecommendationGroups.vue`

Likely modified files:

- `src/components/tabs/AutotuneTab.vue`
- `src/composables/useAutotune.js`
- `src/stores/autotune.js`
- `locales/en/messages.json`
- relevant locale files as project policy requires
- tests under `test/js`

---

## 12. Implementation Phases

### Phase 1: Static AI Advisor Without Writes

- Add AI settings store and UI.
- Add Craft Context form.
- Add current FC and CLI parsing.
- Build compact payload.
- Call AI provider.
- Parse and display grouped AI response.
- No Apply in this phase.

Acceptance:

- User can analyze current FC config without CSV.
- User can import/paste CLI and analyze without CSV.
- AI output is displayed as PID / Filters / Rates groups.
- Raw CLI is not sent to AI.

### Phase 2: CSV Local Analysis

- Add `.csv` file picker support.
- Implement streaming CSV parser.
- Move CSV parsing and analysis to worker.
- Convert CSV into existing chirp analysis shape.
- Reuse spectral analysis utilities.
- Merge CSV metrics into AI payload.

Acceptance:

- Blackbox Explorer CSV can be analyzed locally.
- UI remains responsive with large CSV files.
- AI payload contains only summary metrics.

### Phase 3: Preview And Staleness

- Add response validator and group whitelist.
- Add config fingerprinting.
- Add Preview Selected.
- Add stale detection.
- Add SessionStorage snapshot restore.

Acceptance:

- Switching tabs does not clear AI panel.
- Changed FC config marks recommendations stale.
- Preview does not write EEPROM.

### Phase 4: Apply Selected & Save

- Implement grouped Apply.
- PID writes simplified tuning only.
- Filters write simplified gyro/dterm sliders only.
- Rates write current rates type rate/expo only.
- Add rollback attempt on failure.
- Preserve AI panel during reconnect/reboot.

Acceptance:

- User can apply selected groups.
- Invalid groups are disabled.
- Failed apply preserves AI output and error.
- Successful apply saves to FC.

---

## 13. Test Plan

Unit tests:

- provider request construction for DeepSeek OpenAI-compatible
- provider request construction for DeepSeek Anthropic-compatible
- provider request construction for Anthropic Messages API
- CLI parser extracts tuning keys from `diff all`
- CLI parser ignores unsupported commands
- CSV parser identifies required columns
- CSV parser extracts chirp segments from `debug[1]`
- payload builder excludes raw CSV and full CLI
- response parser rejects unknown fields and invalid values
- config fingerprint changes when selected FC config changes

Component/composable tests:

- Craft Context required validation
- provider settings save/load
- AI analysis works without CSV
- AI analysis works with CLI only
- AI analysis works with CSV summary
- tab switch preserves AI state
- stale state disables Apply
- group checkboxes default PID+Filters selected and Rates unselected
- Preview does not call EEPROM write
- Apply only writes selected groups

Manual tests:

- DeepSeek OpenAI-compatible connection test
- DeepSeek Anthropic-compatible connection test
- Anthropic Messages API connection test
- large CSV import responsiveness
- FC disconnect/reconnect after save
- FC reboot after save
- no CSV + current FC analysis
- no CSV + imported CLI analysis

---

## 14. Safety Constraints

- Never send API keys to logs, prompts, payloads, or error details.
- Never send raw CSV to AI.
- Never send full CLI dump to AI.
- Never execute AI-generated CLI.
- Never write raw PID arrays from AI.
- Never switch rates type from AI.
- Never apply stale recommendations.
- Always validate locally before writing.
- Always preserve AI panel state before write operations.

---

## 15. Open Risks

- Direct browser calls may hit provider CORS restrictions. If that happens, show a clear error and defer proxy support to a later phase.
- CSV column names may vary by Blackbox Explorer version. The parser should normalize common variants and report missing required columns clearly.
- CLI dumps from different Betaflight versions may include settings not known to v1. Unknown keys should be ignored, not sent raw to AI.
- Static analysis without CSV is lower confidence. UI must communicate this clearly.

