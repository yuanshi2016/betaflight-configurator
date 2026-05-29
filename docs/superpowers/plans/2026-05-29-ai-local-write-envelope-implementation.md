# AI Local Write Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic local write-envelope layer for ordinary BBL analysis so `rates`, `filters`, and `pid` can all be analyzed locally, while only locally-bounded values can become writeable AI recommendations.

**Architecture:** Extend the existing ordinary BBL analysis path so single-log analysis produces per-group candidate values and blocked reasons, aggregate those envelopes across selected logs, preserve them in the AI payload, and reconcile AI output against the local envelope before any UI write or FC write path runs. Keep the model in a selection-and-explanation role; the executable plan must always be local-first and parser-enforced.

**Tech Stack:** Vue 3, Pinia, Vitest, existing BBL summary and analysis utilities, existing AI provider adapter layer, existing MSP write path in `AiAdvisor.vue`

---

## File Structure

- Modify: `src/js/autotune-ai/blackboxBblAnalysis.js`
  - add single-log `writeEnvelope` generation for `rates`, `filters`, `pid`
- Modify: `src/js/autotune-ai/blackboxBblAggregate.js`
  - aggregate group-level envelopes across selected logs
- Modify: `src/js/autotune-ai/payloadBuilder.js`
  - include and preserve `localAnalysis.writeEnvelope`
- Modify: `src/js/autotune-ai/providerAdapters.js`
  - constrain AI prompt to local candidate keys and `suggestedValue`
- Modify: `src/js/autotune-ai/responseParser.js`
  - reconcile AI output with local envelope and build `effectivePlan`
- Modify: `src/stores/autotuneAi.js`
  - store `localWriteEnvelope`, `effectivePlan`, and carry them through follow-up
- Modify: `src/components/tabs/autotune/AiAdvisor.vue`
  - show local envelope, AI selection, guard status, and write from `effectivePlan`
- Modify: `locales/en/messages.json`
  - add new AI envelope / guard labels
- Modify: `locales/zh_CN/messages.json`
  - add new Simplified Chinese AI envelope / guard labels
- Modify: `locales/zh_TW/messages.json`
  - add new Traditional Chinese AI envelope / guard labels
- Modify: `test/js/autotune_ai/blackboxBblAnalysis.test.js`
  - add envelope tests for rates, filters, pid blocking
- Modify: `test/js/autotune_ai/blackboxBblAggregate.test.js`
  - add aggregate envelope tests
- Modify: `test/js/autotune_ai/payloadBuilder.test.js`
  - add envelope payload and compaction tests
- Modify: `test/js/autotune_ai/providerAdapters.test.js`
  - add prompt contract tests for envelope-constrained writes
- Modify: `test/js/autotune_ai/responseParser.test.js`
  - add guard reconciliation tests
- Modify: `test/js/autotune_ai/storeDefaults.test.js`
  - add store state / follow-up context tests
- Modify: `test/js/autotune_ai/dockStyles.test.js`
  - add UI structure tests for local envelope and guard display

## Execution Notes

- Run targeted tests with `./node_modules/.bin/vitest` rather than `npx vitest`.
- If `.husky/pre-commit` is still failing with `undefined@lint-staged` in this environment, append `--no-verify` to the commit commands below.
- Do not change CHIRP autotune behavior in this plan. Keep the ordinary BBL AI path isolated.

### Task 1: Add Single-Log Write Envelopes

**Files:**
- Modify: `src/js/autotune-ai/blackboxBblAnalysis.js`
- Test: `test/js/autotune_ai/blackboxBblAnalysis.test.js`

- [ ] **Step 1: Write the failing rates-envelope test**

```js
it("builds a conservative rates write envelope when low-usage legacy rates exceed the craft profile limits", () => {
    const result = analyzeBblLog({
        summary: {
            samples: { decodedMainFrames: 1400, corruptFrames: 0, unsupportedEncodedFrames: 0, durationUs: 8_000_000 },
            fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true } },
            fieldStats: {
                setpoint: {
                    0: { mean: 4, rms: 18, max: 50 },
                    1: { mean: 3, rms: 16, max: 46 },
                    2: { mean: 2, rms: 14, max: 40 },
                },
                motor: {
                    0: { mean: 1500, rms: 1510, max: 1700, count: 1400 },
                    1: { mean: 1498, rms: 1508, max: 1690, count: 1400 },
                    2: { mean: 1502, rms: 1512, max: 1710, count: 1400 },
                    3: { mean: 1499, rms: 1509, max: 1695, count: 1400 },
                },
            },
        },
        craftContext: { craftType: "long-range", flightStyle: "smooth-cruise" },
        staticConfig: {
            rates: {
                rates_type: 0,
                roll_rate: 100,
                pitch_rate: 96,
                yaw_rate: 72,
            },
        },
    });

    expect(result.writeEnvelope.rates.writeableAllowed).toBe(true);
    expect(result.writeEnvelope.rates.candidates.roll_rate).toEqual(
        expect.objectContaining({
            suggestedValue: 90,
            min: 90,
            max: 95,
            step: 1,
        }),
    );
    expect(result.writeEnvelope.rates.candidates.pitch_rate).toEqual(
        expect.objectContaining({
            suggestedValue: 88,
        }),
    );
    expect(result.writeEnvelope.rates.candidates.yaw_rate).toEqual(
        expect.objectContaining({
            suggestedValue: 69,
        }),
    );
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/blackboxBblAnalysis.test.js --reporter=dot`

Expected: FAIL with `result.writeEnvelope` undefined or missing `rates.candidates`

- [ ] **Step 3: Write the minimal rates-envelope implementation**

```js
const MAX_RATES_SINGLE_DELTA = 10;

function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function buildRatesCandidate(currentValue, recommendedMax) {
    const overshoot = currentValue - recommendedMax;
    const delta = Math.min(MAX_RATES_SINGLE_DELTA, Math.ceil(overshoot / 2));
    const suggestedValue = Math.round(currentValue - delta);

    return {
        suggestedValue,
        min: suggestedValue,
        max: Math.max(suggestedValue, currentValue - 5),
        step: 1,
    };
}

function buildRatesWriteEnvelope(summary = {}, craftContext = {}, staticConfig = {}) {
    const diagnostics = detectRatesMismatch(summary, craftContext, staticConfig);
    if (!diagnostics.length) {
        return {
            writeableAllowed: false,
            blockedReason: "no_rates_mismatch_detected",
            confidence: "low",
            candidates: {},
        };
    }

    const exceededAxes = diagnostics[0].evidence.exceededAxes || [];
    const candidates = Object.fromEntries(
        exceededAxes.map(({ axis, configured, recommendedMax }) => {
            return [`${axis}_rate`, {
                ...buildRatesCandidate(configured, recommendedMax),
                reason: "runtime usage is low and configured rate exceeds the craft profile limit",
                evidenceRefs: [`ratesMismatch.${axis}`],
            }];
        }),
    );

    return {
        writeableAllowed: Object.keys(candidates).length > 0,
        blockedReason: "",
        confidence: diagnostics[0].confidence || "medium",
        candidates,
    };
}
```

- [ ] **Step 4: Add the failing filters / pid blocking tests**

```js
it("keeps filter writes explain-only for a single usable log even when fft evidence exists", () => {
    const result = analyzeBblLog({
        summary: {
            samples: { decodedMainFrames: 1400, corruptFrames: 0, unsupportedEncodedFrames: 0, durationUs: 8_000_000 },
            fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true } },
            analysisInput: {
                axes: {
                    roll: {
                        timeUs: Array.from({ length: 128 }, (_, index) => index * 500),
                        gyro: Array.from({ length: 128 }, (_, index) => Math.sin(index / 4) * 60),
                        setpoint: Array.from({ length: 128 }, () => 0),
                        dterm: Array.from({ length: 128 }, (_, index) => Math.sin(index / 3) * 20),
                    },
                },
            },
        },
        craftContext: { craftType: "freestyle", frameSize: "5寸" },
        staticConfig: { rates: { rates_type: 0 } },
    });

    expect(result.writeEnvelope.filters.writeableAllowed).toBe(false);
    expect(result.writeEnvelope.filters.blockedReason).toBe("single_log_filter_evidence_requires_confirmation");
});

it("blocks pid writes when high-confidence motor imbalance is present", () => {
    const result = analyzeBblLog({
        summary: {
            samples: { decodedMainFrames: 1400, corruptFrames: 0, unsupportedEncodedFrames: 0, durationUs: 8_000_000 },
            fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true } },
            fieldStats: {
                motor: {
                    0: { mean: 1600, rms: 1610, max: 1800, count: 1400 },
                    1: { mean: 1595, rms: 1605, max: 1790, count: 1400 },
                    2: { mean: 1430, rms: 1440, max: 1630, count: 1400 },
                    3: { mean: 1425, rms: 1435, max: 1625, count: 1400 },
                },
            },
            analysisInput: {
                axes: {
                    roll: {
                        timeUs: Array.from({ length: 128 }, (_, index) => index * 500),
                        gyro: Array.from({ length: 128 }, () => 0),
                        setpoint: Array.from({ length: 128 }, () => 35),
                    },
                },
            },
        },
        craftContext: { craftType: "freestyle", frameSize: "5寸" },
        staticConfig: { rates: { rates_type: 0 } },
    });

    expect(result.writeEnvelope.pid.writeableAllowed).toBe(false);
    expect(result.writeEnvelope.pid.blockedReason).toBe("mechanical_imbalance_detected");
});
```

- [ ] **Step 5: Run the same targeted test file and verify the new cases fail**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/blackboxBblAnalysis.test.js --reporter=dot`

Expected: FAIL with missing `filters` / `pid` envelope fields or wrong blocked reasons

- [ ] **Step 6: Write the minimal filter and pid envelope helpers**

```js
function hasHighConfidenceMotorImbalance(diagnostics = []) {
    return diagnostics.some((diagnostic) => diagnostic.type === "motor_output_imbalance" && diagnostic.confidence === "high");
}

function buildFiltersWriteEnvelope({ quality, axes, diagnostics }) {
    const hasUsableFft = Object.values(axes || {}).some((axis) => axis?.frequencyDomain?.fftUsable === true);
    const hasFilterAdvice = Object.values(axes || {}).some(
        (axis) => axis?.filterAdvice?.gyroNotch?.direction === "enable" || axis?.filterAdvice?.dtermLowpass?.direction === "lower",
    );

    if (quality?.status !== QUALITY_STATUS.USABLE || !hasUsableFft || !hasFilterAdvice) {
        return {
            writeableAllowed: false,
            blockedReason: "insufficient_filter_evidence",
            confidence: "low",
            candidates: {},
        };
    }

    return {
        writeableAllowed: false,
        blockedReason: "single_log_filter_evidence_requires_confirmation",
        confidence: "medium",
        candidates: {},
    };
}

function buildPidWriteEnvelope({ quality, axes, diagnostics }) {
    if (quality?.status !== QUALITY_STATUS.USABLE) {
        return {
            writeableAllowed: false,
            blockedReason: "insufficient_pid_evidence",
            confidence: "low",
            candidates: {},
        };
    }

    if (hasHighConfidenceMotorImbalance(diagnostics)) {
        return {
            writeableAllowed: false,
            blockedReason: "mechanical_imbalance_detected",
            confidence: "high",
            candidates: {},
        };
    }

    return {
        writeableAllowed: false,
        blockedReason: "single_log_pid_requires_multi_log_confirmation",
        confidence: "medium",
        candidates: {},
    };
}
```

- [ ] **Step 7: Return the full write envelope from `analyzeBblLog`**

```js
export function analyzeBblLog({ summary, craftContext = {}, staticConfig = {} } = {}) {
    const quality = classifyLogQuality(summary);
    const diagnostics = [];
    let axes = {};

    if (summary?.analysisInput?.axes) {
        const axisAnalysis = analyzeAxes(summary.analysisInput, craftContext);
        axes = axisAnalysis.axes;
        diagnostics.push(...axisAnalysis.diagnostics);
    }

    if (quality.status !== QUALITY_STATUS.UNUSABLE) {
        diagnostics.push(...detectMotorImbalance(summary));
        diagnostics.push(...detectRatesMismatch(summary, craftContext, staticConfig));
    }

    const writeEnvelope = {
        rates: buildRatesWriteEnvelope(summary, craftContext, staticConfig),
        filters: buildFiltersWriteEnvelope({ quality, axes, diagnostics, craftContext, staticConfig }),
        pid: buildPidWriteEnvelope({ quality, axes, diagnostics, craftContext, staticConfig }),
    };

    return {
        quality,
        axes,
        diagnostics,
        writeEnvelope,
        recommendations: buildRecommendations({ diagnostics, craftContext, staticConfig, quality, axes }),
        evidenceSummary: buildEvidenceSummary({ quality, diagnostics, axes }),
    };
}
```

- [ ] **Step 8: Run the targeted single-log analysis tests and verify they pass**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/blackboxBblAnalysis.test.js --reporter=dot`

Expected: PASS

- [ ] **Step 9: Commit the single-log envelope work**

```bash
git add test/js/autotune_ai/blackboxBblAnalysis.test.js src/js/autotune-ai/blackboxBblAnalysis.js
git commit -m "feat: add single-log ai write envelopes"
```

### Task 2: Aggregate Write Envelopes Across Selected Logs

**Files:**
- Modify: `src/js/autotune-ai/blackboxBblAggregate.js`
- Test: `test/js/autotune_ai/blackboxBblAggregate.test.js`

- [ ] **Step 1: Write the failing aggregate-envelope test**

```js
it("promotes rates to writeable when multiple usable logs agree on the same suggested values", () => {
    const aggregate = aggregateBblAnalyses([
        {
            logIndex: 0,
            quality: { status: "usable" },
            diagnostics: [],
            recommendations: [],
            writeEnvelope: {
                rates: {
                    writeableAllowed: true,
                    blockedReason: "",
                    confidence: "medium",
                    candidates: {
                        roll_rate: { suggestedValue: 90, min: 90, max: 95, step: 1, reason: "same", evidenceRefs: ["ratesMismatch.roll"] },
                    },
                },
                filters: { writeableAllowed: false, blockedReason: "single_log_filter_evidence_requires_confirmation", confidence: "medium", candidates: {} },
                pid: { writeableAllowed: false, blockedReason: "single_log_pid_requires_multi_log_confirmation", confidence: "medium", candidates: {} },
            },
        },
        {
            logIndex: 1,
            quality: { status: "usable" },
            diagnostics: [],
            recommendations: [],
            writeEnvelope: {
                rates: {
                    writeableAllowed: true,
                    blockedReason: "",
                    confidence: "high",
                    candidates: {
                        roll_rate: { suggestedValue: 90, min: 90, max: 95, step: 1, reason: "same", evidenceRefs: ["ratesMismatch.roll"] },
                    },
                },
                filters: { writeableAllowed: false, blockedReason: "single_log_filter_evidence_requires_confirmation", confidence: "medium", candidates: {} },
                pid: { writeableAllowed: false, blockedReason: "single_log_pid_requires_multi_log_confirmation", confidence: "medium", candidates: {} },
            },
        },
    ]);

    expect(aggregate.writeEnvelope.rates.writeableAllowed).toBe(true);
    expect(aggregate.writeEnvelope.rates.confidence).toBe("high");
    expect(aggregate.writeEnvelope.rates.candidates.roll_rate.suggestedValue).toBe(90);
});
```

- [ ] **Step 2: Run the aggregate test to verify it fails**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/blackboxBblAggregate.test.js --reporter=dot`

Expected: FAIL with missing `writeEnvelope` on the aggregate result

- [ ] **Step 3: Write the failing conflict-downgrade test**

```js
it("downgrades filters to explain-only when usable logs disagree on suggested filter values", () => {
    const aggregate = aggregateBblAnalyses([
        {
            logIndex: 0,
            quality: { status: "usable" },
            diagnostics: [],
            recommendations: [],
            writeEnvelope: {
                filters: {
                    writeableAllowed: true,
                    blockedReason: "",
                    confidence: "medium",
                    candidates: {
                        slider_dterm_filter_multiplier: {
                            suggestedValue: 92,
                            min: 92,
                            max: 95,
                            step: 1,
                            reason: "first",
                            evidenceRefs: ["roll.frequencyDomain.dtermHighFreqAvg"],
                        },
                    },
                },
            },
        },
        {
            logIndex: 1,
            quality: { status: "usable" },
            diagnostics: [],
            recommendations: [],
            writeEnvelope: {
                filters: {
                    writeableAllowed: true,
                    blockedReason: "",
                    confidence: "medium",
                    candidates: {
                        slider_dterm_filter_multiplier: {
                            suggestedValue: 88,
                            min: 88,
                            max: 91,
                            step: 1,
                            reason: "second",
                            evidenceRefs: ["pitch.frequencyDomain.dtermHighFreqAvg"],
                        },
                    },
                },
            },
        },
    ]);

    expect(aggregate.writeEnvelope.filters.writeableAllowed).toBe(false);
    expect(aggregate.writeEnvelope.filters.blockedReason).toBe("conflicting_candidate_values");
    expect(aggregate.writeEnvelope.filters.candidates).toEqual({});
});
```

- [ ] **Step 4: Run the aggregate test file again and verify the new case fails**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/blackboxBblAggregate.test.js --reporter=dot`

Expected: FAIL with missing group-level envelope merge behavior

- [ ] **Step 5: Implement the minimal group-envelope merge helpers**

```js
const ENVELOPE_GROUPS = ["pid", "filters", "rates"];

function getEnvelopeGroup(result, groupName) {
    return result?.writeEnvelope?.[groupName] || null;
}

function pickDominantBlockedReason(reasons = []) {
    return reasons[0] || "insufficient_group_evidence";
}

function mergeCandidatesForGroup(entries = []) {
    const merged = {};

    Object.entries(entries[0]?.candidates || {}).forEach(([key, candidate]) => {
        const allSame = entries.every((entry) => entry?.candidates?.[key]?.suggestedValue === candidate.suggestedValue);
        if (!allSame) {
            return;
        }

        merged[key] = cloneValue(candidate);
    });

    return merged;
}

function buildAggregateEnvelopeForGroup(groupName, usableResults = []) {
    const entries = usableResults.map((result) => getEnvelopeGroup(result, groupName)).filter(Boolean);
    if (!entries.length) {
        return {
            writeableAllowed: false,
            blockedReason: "no_group_envelope",
            confidence: "low",
            candidates: {},
        };
    }

    const writeableEntries = entries.filter((entry) => entry.writeableAllowed === true);
    if (writeableEntries.length < 2) {
        return {
            writeableAllowed: false,
            blockedReason: pickDominantBlockedReason(entries.map((entry) => entry.blockedReason).filter(Boolean)),
            confidence: entries[0].confidence || "low",
            candidates: {},
        };
    }

    const candidates = mergeCandidatesForGroup(writeableEntries);
    if (!Object.keys(candidates).length) {
        return {
            writeableAllowed: false,
            blockedReason: "conflicting_candidate_values",
            confidence: "medium",
            candidates: {},
        };
    }

    return {
        writeableAllowed: true,
        blockedReason: "",
        confidence: boostConfidence(writeableEntries[0].confidence || "medium", writeableEntries.length),
        candidates,
    };
}
```

- [ ] **Step 6: Return the aggregate write envelope from `aggregateBblAnalyses`**

```js
export function aggregateBblAnalyses(results = []) {
    const usable = results.filter((result) => result?.quality?.status !== QUALITY_STATUS.UNUSABLE);
    const groups = groupDiagnostics(usable);
    const axisSummary = summarizeAxisAdvice(usable);

    return {
        selectedLogIndexes: results.map((result) => result.logIndex),
        usableLogIndexes: usable.map((result) => result.logIndex),
        consensusDiagnostics: buildConsensus(groups),
        conflictingDiagnostics: buildConflictingDiagnostics(groups),
        aggregateRecommendations: buildAggregateRecommendations(usable),
        aggregateQuality: summarizeAggregateQuality(results, usable),
        axes: axisSummary.axes,
        axisConflicts: axisSummary.axisConflicts,
        writeEnvelope: Object.fromEntries(
            ENVELOPE_GROUPS.map((groupName) => [groupName, buildAggregateEnvelopeForGroup(groupName, usable)]),
        ),
    };
}
```

- [ ] **Step 7: Run the aggregate test file and verify it passes**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/blackboxBblAggregate.test.js --reporter=dot`

Expected: PASS

- [ ] **Step 8: Commit the aggregate-envelope work**

```bash
git add test/js/autotune_ai/blackboxBblAggregate.test.js src/js/autotune-ai/blackboxBblAggregate.js
git commit -m "feat: aggregate ai write envelopes across logs"
```

### Task 3: Preserve `writeEnvelope` In The AI Payload

**Files:**
- Modify: `src/js/autotune-ai/payloadBuilder.js`
- Test: `test/js/autotune_ai/payloadBuilder.test.js`

- [ ] **Step 1: Write the failing payload-envelope inclusion test**

```js
it("includes the aggregate write envelope in the compact AI payload", () => {
    const payload = buildAiPayload({
        localBblAnalysis: {
            aggregateQuality: { status: "usable", reason: "all_selected_logs_usable" },
            writeEnvelope: {
                rates: {
                    writeableAllowed: true,
                    blockedReason: "",
                    confidence: "high",
                    candidates: {
                        roll_rate: {
                            suggestedValue: 90,
                            min: 90,
                            max: 95,
                            step: 1,
                            reason: "runtime low usage",
                            evidenceRefs: ["ratesMismatch.roll"],
                        },
                    },
                },
            },
        },
    });

    expect(payload.localAnalysis.writeEnvelope.rates).toEqual(
        expect.objectContaining({
            writeableAllowed: true,
            confidence: "high",
        }),
    );
    expect(payload.localAnalysis.writeEnvelope.rates.candidates.roll_rate).toEqual(
        expect.objectContaining({
            suggestedValue: 90,
            min: 90,
            max: 95,
            step: 1,
        }),
    );
});
```

- [ ] **Step 2: Run the targeted payload test and verify it fails**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/payloadBuilder.test.js --reporter=dot`

Expected: FAIL with missing `localAnalysis.writeEnvelope`

- [ ] **Step 3: Add the failing compaction-priority test**

```js
it("preserves writeEnvelope before dropping local actionability details during payload compaction", () => {
    const hugeText = "oversized-".repeat(4000);
    const payload = buildAiPayload({
        cliSummary: { notes: hugeText },
        csvSummary: { notes: hugeText },
        bblSummary: { notes: hugeText },
        localBblAnalysis: {
            aggregateQuality: { status: "usable", reason: "all_selected_logs_usable" },
            consensusDiagnostics: Array.from({ length: 10 }, (_, index) => ({
                type: `diag-${index}`,
                confidence: "high",
                explanation: hugeText,
            })),
            writeEnvelope: {
                rates: {
                    writeableAllowed: true,
                    blockedReason: "",
                    confidence: "high",
                    candidates: {
                        roll_rate: {
                            suggestedValue: 90,
                            min: 90,
                            max: 95,
                            step: 1,
                            reason: hugeText,
                            evidenceRefs: ["ratesMismatch.roll", hugeText],
                        },
                    },
                },
            },
        },
    });

    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(20 * 1024);
    expect(payload.localAnalysis.writeEnvelope.rates.candidates.roll_rate.suggestedValue).toBe(90);
});
```

- [ ] **Step 4: Run the payload test file again and verify the new case fails**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/payloadBuilder.test.js --reporter=dot`

Expected: FAIL with missing write-envelope summarization or wrong compaction priority

- [ ] **Step 5: Implement payload summarizers for `writeEnvelope`**

```js
function summarizeWriteEnvelopeCandidate(candidate) {
    return Object.fromEntries(
        Object.entries({
            suggestedValue: candidate?.suggestedValue,
            min: candidate?.min,
            max: candidate?.max,
            step: candidate?.step,
            reason: trimText(candidate?.reason, MAX_NESTED_TEXT_LENGTH),
            evidenceRefs: Array.isArray(candidate?.evidenceRefs) ? candidate.evidenceRefs.slice(0, 4) : undefined,
        }).filter(([, value]) => value !== undefined),
    );
}

function summarizeWriteEnvelope(writeEnvelope) {
    if (!writeEnvelope || typeof writeEnvelope !== "object") {
        return undefined;
    }

    return Object.fromEntries(
        Object.entries(writeEnvelope)
            .map(([groupName, envelope]) => [
                groupName,
                Object.fromEntries(
                    Object.entries({
                        writeableAllowed: envelope?.writeableAllowed,
                        blockedReason: trimText(envelope?.blockedReason, MAX_NESTED_TEXT_LENGTH),
                        confidence: envelope?.confidence,
                        candidates: envelope?.candidates
                            ? Object.fromEntries(
                                  Object.entries(envelope.candidates)
                                      .map(([key, candidate]) => [key, summarizeWriteEnvelopeCandidate(candidate)])
                                      .filter(([, candidate]) => candidate && Object.keys(candidate).length > 0),
                              )
                            : {},
                    }).filter(([, value]) => value !== undefined),
                ),
            ])
            .filter(([, envelope]) => envelope && Object.keys(envelope).length > 0),
    );
}
```

- [ ] **Step 6: Attach the summarized write envelope and move it ahead of quality-only fallback**

```js
function summarizeLocalBblAnalysis(localBblAnalysis) {
    const summary = {
        selectedLogIndexes: Array.isArray(localBblAnalysis.selectedLogIndexes) ? [...localBblAnalysis.selectedLogIndexes] : undefined,
        aggregateQuality,
        consensusDiagnostics: Array.isArray(localBblAnalysis.consensusDiagnostics)
            ? localBblAnalysis.consensusDiagnostics
                  .slice(0, MAX_LOCAL_ANALYSIS_ITEMS)
                  .map((item) => summarizeDiagnosticItem(item))
                  .filter((item) => item && Object.keys(item).length > 0)
            : undefined,
        conflictingDiagnostics: Array.isArray(localBblAnalysis.conflictingDiagnostics)
            ? localBblAnalysis.conflictingDiagnostics
                  .slice(0, MAX_LOCAL_ANALYSIS_ITEMS)
                  .map((item) => summarizeDiagnosticItem(item, { includeConflict: true }))
                  .filter((item) => item && Object.keys(item).length > 0)
            : undefined,
        aggregateRecommendations: Array.isArray(localBblAnalysis.aggregateRecommendations)
            ? localBblAnalysis.aggregateRecommendations
                  .slice(0, MAX_LOCAL_ANALYSIS_ITEMS)
                  .map((item) => summarizeRecommendationItem(item))
                  .filter((item) => item && Object.keys(item).length > 0)
            : undefined,
        axes: summarizeAxisAnalysis(localBblAnalysis.axes),
        writeEnvelope: summarizeWriteEnvelope(localBblAnalysis.writeEnvelope),
    };

    return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined));
}

function summarizeLocalBblAnalysisForLimit(localBblAnalysis) {
    const summary = {
        selectedLogIndexes: Array.isArray(localBblAnalysis.selectedLogIndexes) ? [...localBblAnalysis.selectedLogIndexes] : undefined,
        aggregateQuality,
        writeEnvelope: summarizeWriteEnvelope(localBblAnalysis.writeEnvelope),
        consensusDiagnostics: Array.isArray(localBblAnalysis.consensusDiagnostics)
            ? localBblAnalysis.consensusDiagnostics
                  .slice(0, MAX_LOCAL_ANALYSIS_ITEMS)
                  .map((item) => summarizeDiagnosticItem(item))
                  .filter((item) => item && Object.keys(item).length > 0)
            : undefined,
        aggregateRecommendations: Array.isArray(localBblAnalysis.aggregateRecommendations)
            ? localBblAnalysis.aggregateRecommendations
                  .slice(0, MAX_LOCAL_ANALYSIS_ITEMS)
                  .map((item) => summarizeRecommendationItem(item))
                  .filter((item) => item && Object.keys(item).length > 0)
            : undefined,
        axes: summarizeAxisAnalysisLite(localBblAnalysis.axes),
    };

    return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined));
}
```

- [ ] **Step 7: Run the payload test file and verify it passes**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/payloadBuilder.test.js --reporter=dot`

Expected: PASS

- [ ] **Step 8: Commit the payload-envelope work**

```bash
git add test/js/autotune_ai/payloadBuilder.test.js src/js/autotune-ai/payloadBuilder.js
git commit -m "feat: preserve write envelopes in ai payloads"
```

### Task 4: Constrain The AI Prompt To Local Candidates

**Files:**
- Modify: `src/js/autotune-ai/providerAdapters.js`
- Test: `test/js/autotune_ai/providerAdapters.test.js`

- [ ] **Step 1: Write the failing provider prompt test**

```js
it("tells the model to only echo local suggested values from localAnalysis.writeEnvelope", () => {
    const request = buildProviderRequest(
        {
            provider: "deepseek-openai",
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-v4-pro",
            apiKey: "secret-key",
        },
        {
            craftContext: { craftType: "long-range" },
            localAnalysis: {
                writeEnvelope: {
                    rates: {
                        writeableAllowed: true,
                        blockedReason: "",
                        confidence: "high",
                        candidates: {
                            roll_rate: { suggestedValue: 90, min: 90, max: 95, step: 1, reason: "runtime low usage" },
                        },
                    },
                },
            },
        },
    );
    const body = JSON.parse(request.options.body);

    expect(body.messages[0].content).toContain("Use localAnalysis.writeEnvelope as the only source of writeable values.");
    expect(body.messages[0].content).toContain("If you return a value, it must match the candidate suggestedValue exactly.");
    expect(body.messages[0].content).toContain("Do not invent keys or interpolate inside min/max.");
});
```

- [ ] **Step 2: Run the provider prompt test and verify it fails**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/providerAdapters.test.js --reporter=dot`

Expected: FAIL with missing write-envelope-specific prompt language

- [ ] **Step 3: Add the prompt constraints to both first-turn prompt builders**

```js
function createSystemPrompt(locale) {
    const responseLanguage = getResponseLanguage(locale);

    return [
        "You are an assistant for Betaflight tuning analysis.",
        "Use only the structured JSON payload.",
        "Treat localAnalysis as the primary technical evidence for ordinary Blackbox logs.",
        "Use localAnalysis.writeEnvelope as the only source of writeable values.",
        "If you return a value, it must match the candidate suggestedValue exactly.",
        "Do not invent keys or interpolate inside min/max.",
        "If localAnalysis.writeEnvelope.<group>.writeableAllowed is false, keep that group non-writeable and explain the limitation.",
        "Do not output CLI commands.",
        "Do not recommend raw FC.PIDS writes.",
        "Return exactly this JSON shape:",
        RESPONSE_CONTRACT,
        `Respond in ${responseLanguage}.`,
    ].join(" ");
}

function createUserPrompt(payload, locale) {
    return [
        `Analyze this compact Betaflight tuning payload and return JSON with summary, overallRisk, groups.pid, groups.filters, groups.rates, and flightTestNotes. Respond in ${getResponseLanguage(locale)}.`,
        "Only use keys and suggested values that already exist in localAnalysis.writeEnvelope.",
        "Return exactly this JSON shape:",
        RESPONSE_CONTRACT,
        JSON.stringify(payload),
    ].join("\n\n");
}
```

- [ ] **Step 4: Run the provider prompt test file and verify it passes**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/providerAdapters.test.js --reporter=dot`

Expected: PASS

- [ ] **Step 5: Commit the prompt-constraint work**

```bash
git add test/js/autotune_ai/providerAdapters.test.js src/js/autotune-ai/providerAdapters.js
git commit -m "feat: constrain ai writes to local envelopes"
```

### Task 5: Reconcile AI Output With The Local Envelope

**Files:**
- Modify: `src/js/autotune-ai/responseParser.js`
- Test: `test/js/autotune_ai/responseParser.test.js`

- [ ] **Step 1: Write the failing parser guard test for out-of-envelope values**

```js
it("drops ai values that are not exact matches for local suggestedValue", () => {
    const parsed = parseAiResponse(
        JSON.stringify({
            summary: "Reduce rates a bit.",
            overallRisk: "medium",
            groups: {
                rates: {
                    writeable: true,
                    confidence: "high",
                    explanation: "Lower roll rate.",
                    values: {
                        roll_rate: 92,
                    },
                },
            },
        }),
        {
            localAnalysis: {
                aggregateQuality: { status: "usable" },
                writeEnvelope: {
                    rates: {
                        writeableAllowed: true,
                        blockedReason: "",
                        confidence: "high",
                        candidates: {
                            roll_rate: { suggestedValue: 90, min: 90, max: 95, step: 1, reason: "runtime low usage" },
                        },
                    },
                },
            },
        },
    );

    expect(parsed.groups.rates.writeable).toBe(false);
    expect(parsed.groups.rates.values).toEqual({});
    expect(parsed.groups.rates.explanation).toContain("suggestedValue");
});
```

- [ ] **Step 2: Write the failing parser guard test for blocked groups**

```js
it("forces blocked groups non-writeable even when ai tries to write them", () => {
    const parsed = parseAiResponse(
        JSON.stringify({
            summary: "Use more filtering.",
            overallRisk: "medium",
            groups: {
                filters: {
                    writeable: true,
                    confidence: "high",
                    explanation: "Lower dterm filtering multiplier.",
                    values: {
                        slider_dterm_filter_multiplier: 92,
                    },
                },
            },
        }),
        {
            localAnalysis: {
                aggregateQuality: { status: "usable" },
                writeEnvelope: {
                    filters: {
                        writeableAllowed: false,
                        blockedReason: "single_log_filter_evidence_requires_confirmation",
                        confidence: "medium",
                        candidates: {
                            slider_dterm_filter_multiplier: { suggestedValue: 92, min: 92, max: 95, step: 1, reason: "fft evidence" },
                        },
                    },
                },
            },
        },
    );

    expect(parsed.groups.filters.writeable).toBe(false);
    expect(parsed.groups.filters.values).toEqual({});
    expect(parsed.groups.filters.explanation).toContain("single_log_filter_evidence_requires_confirmation");
});
```

- [ ] **Step 3: Run the parser tests and verify they fail**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/responseParser.test.js --reporter=dot`

Expected: FAIL because current parser only uses aggregate-quality gating

- [ ] **Step 4: Implement local-envelope reconciliation helpers**

```js
function getLocalWriteEnvelope(payload = {}) {
    return payload?.localAnalysis?.writeEnvelope || {};
}

function getEnvelopeGroup(payload = {}, groupName) {
    const envelope = getLocalWriteEnvelope(payload)?.[groupName];
    return envelope && typeof envelope === "object" ? envelope : null;
}

function reconcileGroupWithEnvelope(groupName, groupValue, payload = {}) {
    const envelope = getEnvelopeGroup(payload, groupName);
    if (!envelope) {
        return {
            ...groupValue,
            writeable: false,
            explanation: groupValue.explanation ? `Missing local envelope. ${groupValue.explanation}` : "Missing local envelope.",
            values: {},
        };
    }

    if (envelope.writeableAllowed !== true) {
        return {
            ...groupValue,
            writeable: false,
            explanation: groupValue.explanation
                ? `${envelope.blockedReason || "Local group gate blocked writes."} ${groupValue.explanation}`.trim()
                : envelope.blockedReason || "Local group gate blocked writes.",
            values: {},
        };
    }

    const acceptedValues = Object.fromEntries(
        Object.entries(groupValue.values || {}).filter(([key, value]) => {
            const candidate = envelope.candidates?.[key];
            return candidate && candidate.suggestedValue === value;
        }),
    );

    if (!Object.keys(acceptedValues).length) {
        return {
            ...groupValue,
            writeable: false,
            explanation: groupValue.explanation
                ? `No values matched local suggestedValue. ${groupValue.explanation}`.trim()
                : "No values matched local suggestedValue.",
            values: {},
        };
    }

    return {
        ...groupValue,
        writeable: groupValue.writeable === true,
        values: acceptedValues,
    };
}
```

- [ ] **Step 5: Apply reconciliation in `parseAiResponse` and expose an `effectivePlan`**

```js
function reconcileGroups(groups, payload) {
    return Object.fromEntries(
        Object.entries(groups).map(([groupName, groupValue]) => [groupName, reconcileGroupWithEnvelope(groupName, groupValue, payload)]),
    );
}

export function parseAiResponse(responseText, payload = undefined) {
    let parsed;

    try {
        parsed = JSON.parse(stripMarkdownFence(responseText));
    } catch {
        throw new Error("AI response was not valid JSON.");
    }

    const groups = {};
    GROUPS.forEach((group) => {
        if (parsed?.groups?.[group] !== undefined) {
            groups[group] = normalizeGroup(group, parsed.groups[group]);
        }
    });

    const reconciledGroups = reconcileGroups(groups, payload);

    return {
        summary: asString(parsed?.summary),
        overallRisk: RISKS.has(parsed?.overallRisk) ? parsed.overallRisk : "medium",
        groups: reconciledGroups,
        effectivePlan: {
            groups: reconciledGroups,
        },
        flightTestNotes: asString(parsed?.flightTestNotes),
    };
}
```

- [ ] **Step 6: Run the parser tests and verify they pass**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/responseParser.test.js --reporter=dot`

Expected: PASS

- [ ] **Step 7: Commit the parser-guard work**

```bash
git add test/js/autotune_ai/responseParser.test.js src/js/autotune-ai/responseParser.js
git commit -m "feat: reconcile ai output with local envelopes"
```

### Task 6: Store `localWriteEnvelope` And `effectivePlan`

**Files:**
- Modify: `src/stores/autotuneAi.js`
- Test: `test/js/autotune_ai/storeDefaults.test.js`

- [ ] **Step 1: Write the failing store state test**

```js
it("tracks local write envelopes and the reconciled effective plan", () => {
    const storeSource = readFileSync("src/stores/autotuneAi.js", "utf8");

    expect(storeSource).toContain("localWriteEnvelope");
    expect(storeSource).toContain("effectivePlan");
    expect(storeSource).toContain("sessionState.localWriteEnvelope");
    expect(storeSource).toContain("sessionState.effectivePlan");
});
```

- [ ] **Step 2: Write the failing analyze-path test**

```js
it("stores the local write envelope and effective plan after a successful ai analysis", async () => {
    const store = useAutotuneAiStore();
    Object.assign(store.craftContext, {
        craftType: "long-range",
        frameSize: "8",
        allUpWeight: "2000",
        prop: "8x3.7x3",
        motorKv: "1100",
        battery: "6S",
        flightStyle: "smooth",
        riskPreference: "balanced",
    });
    store.providerSettings.apiKey = "secret";
    store.sessionState.localBblAnalysis = {
        aggregateQuality: { status: "usable", reason: "all_selected_logs_usable" },
        writeEnvelope: {
            rates: {
                writeableAllowed: true,
                blockedReason: "",
                confidence: "high",
                candidates: {
                    roll_rate: { suggestedValue: 90, min: 90, max: 95, step: 1, reason: "runtime low usage" },
                },
            },
        },
    };
    store.sessionState.bblSummary = createBblSummary();
    mockBuildAiPayload.mockReturnValue({
        sourceSummary: { hasBbl: true },
        localAnalysis: store.sessionState.localBblAnalysis,
    });
    mockExplainTuningAnalysis.mockResolvedValue(JSON.stringify({
        summary: "ok",
        overallRisk: "medium",
        groups: {
            rates: {
                writeable: true,
                confidence: "high",
                explanation: "Use the local rate rollback.",
                values: { roll_rate: 90 },
            },
        },
        flightTestNotes: "test hover",
    }));
    mockParseAiResponse.mockReturnValue({
        summary: "ok",
        overallRisk: "medium",
        groups: {
            rates: { writeable: true, confidence: "high", explanation: "Use the local rate rollback.", values: { roll_rate: 90 } },
        },
        effectivePlan: {
            groups: {
                rates: { writeable: true, confidence: "high", explanation: "Use the local rate rollback.", values: { roll_rate: 90 } },
            },
        },
        flightTestNotes: "test hover",
    });

    await store.analyze();

    expect(store.sessionState.localWriteEnvelope).toEqual(store.sessionState.localBblAnalysis.writeEnvelope);
    expect(store.sessionState.effectivePlan).toEqual(
        expect.objectContaining({
            groups: expect.objectContaining({
                rates: expect.objectContaining({
                    values: { roll_rate: 90 },
                }),
            }),
        }),
    );
});
```

- [ ] **Step 3: Run the store test file and verify it fails**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/storeDefaults.test.js --reporter=dot`

Expected: FAIL with missing state fields or missing analyze-path assignments

- [ ] **Step 4: Add the new default state fields**

```js
export function defaultSessionState() {
    return {
        cliText: "",
        parsedCliSummary: null,
        csvSummary: null,
        bblSummary: null,
        bblFileData: null,
        selectedBblLogIndexes: [],
        localBblAnalysesByLog: {},
        localBblAnalysis: null,
        localWriteEnvelope: null,
        aiResponse: null,
        effectivePlan: null,
        selectedGroups: {
            pid: true,
            filters: true,
            rates: false,
        },
        requestState: "idle",
        lastError: "",
        lastPayload: null,
        panelOpen: true,
        aiConfigOpen: false,
        conversationHistory: [],
        conversationTrimmed: false,
        followUpInput: "",
        followUpState: "idle",
    };
}
```

- [ ] **Step 5: Assign the new state during analysis and follow-up**

```js
async function analyze({ analysisResult = null } = {}) {
    if (!requiredContextComplete.value) {
        throw new Error("Fill the required craft context fields before analysis.");
    }
    if (!providerSettings.apiKey) {
        throw new Error("Enter an AI provider API key before analysis.");
    }

    const payload = buildAiPayload({
        craftContext,
        cliSummary: sessionState.parsedCliSummary,
        csvSummary: sessionState.csvSummary,
        bblSummary: sessionState.bblSummary,
        analysisResult,
        localBblAnalysis: sessionState.localBblAnalysis,
    });

    const locale = i18n.getCurrentLocale();
    const rawResponse = await explainTuningAnalysis(providerSettings, payload, null, undefined, { locale });
    const parsedResponse = parseAiResponse(rawResponse, payload);

    sessionState.lastPayload = payload;
    sessionState.localWriteEnvelope = payload?.localAnalysis?.writeEnvelope || null;
    sessionState.aiResponse = parsedResponse;
    sessionState.effectivePlan = parsedResponse?.effectivePlan || null;
}

async function sendFollowUp() {
    const userMessage = String(sessionState.followUpInput || "").trim();
    if (!userMessage || sessionState.followUpState === "loading") {
        return null;
    }

    const payload = sessionState.lastPayload || null;
    const rawResponse = await explainTuningAnalysis(providerSettings, null, providerHistory, undefined, {
        locale: i18n.getCurrentLocale(),
    });

    const parsedResponse = parseAiResponse(rawResponse, payload);
    sessionState.aiResponse = parsedResponse;
    sessionState.effectivePlan = parsedResponse?.effectivePlan || sessionState.effectivePlan;
}
```

- [ ] **Step 6: Clear the new fields in reset / source invalidation paths**

```js
function invalidateAiOutput() {
    sessionState.aiResponse = null;
    sessionState.lastPayload = null;
    sessionState.localWriteEnvelope = null;
    sessionState.effectivePlan = null;
    clearConversation();
}

function resetResponse() {
    sessionState.aiResponse = null;
    sessionState.effectivePlan = null;
    sessionState.localWriteEnvelope = sessionState.localBblAnalysis?.writeEnvelope || null;
    sessionState.lastPayload = null;
    sessionState.lastError = "";
    sessionState.requestState = "idle";
}
```

- [ ] **Step 7: Run the store test file and verify it passes**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/storeDefaults.test.js --reporter=dot`

Expected: PASS

- [ ] **Step 8: Commit the store-state work**

```bash
git add test/js/autotune_ai/storeDefaults.test.js src/stores/autotuneAi.js
git commit -m "feat: store local envelopes and effective plans"
```

### Task 7: Show Local Envelope, AI Selection, And Guard Status In The UI

**Files:**
- Modify: `src/components/tabs/autotune/AiAdvisor.vue`
- Modify: `locales/en/messages.json`
- Modify: `locales/zh_CN/messages.json`
- Modify: `locales/zh_TW/messages.json`
- Test: `test/js/autotune_ai/dockStyles.test.js`

- [ ] **Step 1: Write the failing UI structure test**

```js
it("renders local write-envelope and effective-plan sections separately from the raw ai response", () => {
    const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");
    const englishMessages = readFileSync("locales/en/messages.json", "utf8");

    expect(component).toContain("localWriteEnvelopeGroups");
    expect(component).toContain("effectivePlanGroups");
    expect(component).toContain("autotuneAiLocalWriteEnvelope");
    expect(component).toContain("autotuneAiGuardedPlan");
    expect(component).toContain("autotuneAiAiRequested");
    expect(component).toContain("autotuneAiGuardRejected");
    expect(component).toContain("sessionState.localWriteEnvelope");
    expect(component).toContain("sessionState.effectivePlan");
    expect(englishMessages).toContain("autotuneAiLocalWriteEnvelope");
    expect(englishMessages).toContain("autotuneAiGuardRejected");
});
```

- [ ] **Step 2: Run the UI structure test and verify it fails**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/dockStyles.test.js --reporter=dot`

Expected: FAIL with missing computed groups or missing locale keys

- [ ] **Step 3: Add computed views for local envelopes and effective plans**

```js
const localWriteEnvelopeGroups = computed(() => {
    const groups = sessionState.localWriteEnvelope || {};
    return [
        { key: "pid", labelKey: "autotuneAiGroupPid", data: groups.pid || null },
        { key: "filters", labelKey: "autotuneAiGroupFilters", data: groups.filters || null },
        { key: "rates", labelKey: "autotuneAiGroupRates", data: groups.rates || null },
    ].filter((group) => group.data);
});

const effectivePlanGroups = computed(() => {
    const groups = sessionState.effectivePlan?.groups || {};
    return [
        { key: "pid", labelKey: "autotuneAiGroupPid", data: groups.pid || null },
        { key: "filters", labelKey: "autotuneAiGroupFilters", data: groups.filters || null },
        { key: "rates", labelKey: "autotuneAiGroupRates", data: groups.rates || null },
    ]
        .filter((group) => group.data)
        .map((group) => ({
            ...group,
            values: Object.entries(group.data.values || {}).map(([key, value]) => ({ key, value })),
        }));
});
```

- [ ] **Step 4: Render the local envelope and effective plan sections in the template**

```vue
<section v-if="sessionState.localWriteEnvelope" class="autotune-ai-section">
    <header class="autotune-ai-section__header">
        <div class="autotune-ai-section__title">
            <UIcon name="i-lucide-shield-check" class="size-4" />
            <h3>{{ $t("autotuneAiLocalWriteEnvelope") }}</h3>
        </div>
    </header>

    <div v-for="group in localWriteEnvelopeGroups" :key="`envelope-${group.key}`" class="rounded border border-neutral-500/30 p-3">
        <div class="flex items-center justify-between gap-2">
            <h4 class="text-sm font-semibold">{{ $t(group.labelKey) }}</h4>
            <span class="text-xs">{{ $t(confidenceLabelKey(group.data.confidence)) }}</span>
        </div>
        <p class="text-sm mt-2">
            {{
                group.data.writeableAllowed
                    ? $t("autotuneAiAiRequested")
                    : `${$t("autotuneAiExplainOnly")}: ${group.data.blockedReason || $t("autotuneAiNoWriteableValues")}`
            }}
        </p>
    </div>
</section>

<section v-if="sessionState.effectivePlan" class="autotune-ai-section">
    <header class="autotune-ai-section__header">
        <div class="autotune-ai-section__title">
            <UIcon name="i-lucide-shield" class="size-4" />
            <h3>{{ $t("autotuneAiGuardedPlan") }}</h3>
        </div>
    </header>

    <div v-for="group in effectivePlanGroups" :key="`effective-${group.key}`" class="rounded border border-neutral-500/30 p-3">
        <div class="flex items-center justify-between gap-2">
            <h4 class="text-sm font-semibold">{{ $t(group.labelKey) }}</h4>
            <span class="text-xs">
                {{ group.data.writeable ? $t("autotuneAiAiAccepted") : $t("autotuneAiGuardRejected") }}
            </span>
        </div>
        <p class="text-sm mt-2">{{ group.data.explanation }}</p>
    </div>
</section>
```

- [ ] **Step 5: Add the new locale strings**

```json
{
  "autotuneAiLocalWriteEnvelope": { "message": "Local write envelope" },
  "autotuneAiGuardedPlan": { "message": "Guarded execution plan" },
  "autotuneAiAiRequested": { "message": "AI may select from these local candidates." },
  "autotuneAiAiAccepted": { "message": "AI accepted" },
  "autotuneAiGuardRejected": { "message": "Rejected by local guard" },
  "autotuneAiExplainOnly": { "message": "Explain only" }
}
```

```json
{
  "autotuneAiLocalWriteEnvelope": { "message": "本地写入边界" },
  "autotuneAiGuardedPlan": { "message": "本地守卫后的执行计划" },
  "autotuneAiAiRequested": { "message": "AI 只能从这些本地候选值中选择。" },
  "autotuneAiAiAccepted": { "message": "AI 已采纳" },
  "autotuneAiGuardRejected": { "message": "被本地守卫拒绝" },
  "autotuneAiExplainOnly": { "message": "仅解释，不可写" }
}
```

```json
{
  "autotuneAiLocalWriteEnvelope": { "message": "本地寫入邊界" },
  "autotuneAiGuardedPlan": { "message": "本地守衛後的執行計畫" },
  "autotuneAiAiRequested": { "message": "AI 只能從這些本地候選值中選擇。" },
  "autotuneAiAiAccepted": { "message": "AI 已採納" },
  "autotuneAiGuardRejected": { "message": "被本地守衛拒絕" },
  "autotuneAiExplainOnly": { "message": "僅解釋，不可寫" }
}
```

- [ ] **Step 6: Run the UI structure test file and verify it passes**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/dockStyles.test.js --reporter=dot`

Expected: PASS

- [ ] **Step 7: Commit the UI envelope-display work**

```bash
git add test/js/autotune_ai/dockStyles.test.js src/components/tabs/autotune/AiAdvisor.vue locales/en/messages.json locales/zh_CN/messages.json locales/zh_TW/messages.json
git commit -m "feat: show local ai write envelopes in advisor ui"
```

### Task 8: Write To FC Only From `effectivePlan`

**Files:**
- Modify: `src/components/tabs/autotune/AiAdvisor.vue`
- Test: `test/js/autotune_ai/dockStyles.test.js`

- [ ] **Step 1: Write the failing write-path test**

```js
it("writes fc values from the reconciled effective plan instead of the raw ai response", () => {
    const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");

    expect(component).toContain("const group = sessionState.effectivePlan?.groups?.[groupKey]");
    expect(component).toContain("const groups = effectivePlanGroups.value");
    expect(component).not.toContain("const group = sessionState.aiResponse?.groups?.[groupKey]");
});
```

- [ ] **Step 2: Run the UI structure test file and verify it fails**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/dockStyles.test.js --reporter=dot`

Expected: FAIL because `writeGroup` and `writeAll` still read from `sessionState.aiResponse`

- [ ] **Step 3: Switch `writeGroup` to use the reconciled plan**

```js
async function writeGroup(groupKey, { skipEeprom = false } = {}) {
    const group = sessionState.effectivePlan?.groups?.[groupKey];
    if (!group || group.writeable !== true || !Object.keys(group.values || {}).length) {
        return false;
    }

    writeState[groupKey] = "loading";
    writeError[groupKey] = "";

    try {
        const values = group.values;
        const needsSliders = Object.keys(values).some((key) => SLIDER_KEYS.has(key));
        const needsRcTuning = Object.keys(values).some((key) => RC_TUNING_KEYS.has(key));
        if (needsSliders && !FC.TUNING_SLIDERS) {
            throw new Error("FC tuning sliders not loaded.");
        }
        if (needsRcTuning && !FC.RC_TUNING) {
            throw new Error("FC RC tuning not loaded.");
        }

        for (const [key, value] of Object.entries(values)) {
            if (SLIDER_KEYS.has(key)) {
                FC.TUNING_SLIDERS[key] = value;
            } else if (RC_TUNING_KEYS.has(key)) {
                FC.RC_TUNING[key] = value;
            }
        }

        if (needsSliders) {
            await MSP.promise(MSPCodes.MSP_SET_SIMPLIFIED_TUNING, mspHelper.crunch(MSPCodes.MSP_SET_SIMPLIFIED_TUNING));
        }
        if (needsRcTuning) {
            await MSP.promise(MSPCodes.MSP_SET_RC_TUNING, mspHelper.crunch(MSPCodes.MSP_SET_RC_TUNING));
        }

        if (!skipEeprom) {
            await MSP.promise(MSPCodes.MSP_EEPROM_WRITE);
        }

        if (needsSliders && !skipEeprom) {
            await validateTuningSliders();
            pidTuningStore.hasChanges = true;
        }

        if (!skipEeprom) {
            writeState[groupKey] = "done";
            setTimeout(() => {
                writeState[groupKey] = "idle";
            }, 3000);
        }

        return needsSliders;
    } catch (err) {
        writeState[groupKey] = "error";
        writeError[groupKey] = err?.message || "Write failed.";
        setTimeout(() => {
            writeState[groupKey] = "idle";
            writeError[groupKey] = "";
        }, 5000);
        if (skipEeprom) {
            throw err;
        }
        return false;
    }
}
```

- [ ] **Step 4: Switch `writeAll` and the writeability badge logic to use the reconciled plan**

```js
const hasWriteableSelectedGroups = computed(() =>
    effectivePlanGroups.value.some(
        (group) =>
            sessionState.selectedGroups[group.key] &&
            group.data.writeable === true &&
            group.values.length,
    ),
);

async function writeAll() {
    const groups = effectivePlanGroups.value
        .filter((group) => sessionState.selectedGroups[group.key] && group.data.writeable === true && group.values.length)
        .map((group) => group.key);

    if (!groups.length) {
        return;
    }

    let needsSliders = false;
    for (const key of groups) {
        const wroteSliders = await writeGroup(key, { skipEeprom: true });
        if (wroteSliders) {
            needsSliders = true;
        }
    }

    await MSP.promise(MSPCodes.MSP_EEPROM_WRITE);

    if (needsSliders) {
        await validateTuningSliders();
        pidTuningStore.hasChanges = true;
    }

    groups.forEach((key) => {
        writeState[key] = "done";
        setTimeout(() => {
            writeState[key] = "idle";
        }, 3000);
    });
}
```

- [ ] **Step 5: Run the UI structure test file and verify it passes**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/dockStyles.test.js --reporter=dot`

Expected: PASS

- [ ] **Step 6: Run the final focused suite**

Run: `./node_modules/.bin/vitest run test/js/autotune_ai/blackboxBblAnalysis.test.js test/js/autotune_ai/blackboxBblAggregate.test.js test/js/autotune_ai/payloadBuilder.test.js test/js/autotune_ai/providerAdapters.test.js test/js/autotune_ai/responseParser.test.js test/js/autotune_ai/storeDefaults.test.js test/js/autotune_ai/dockStyles.test.js --reporter=dot`

Expected: PASS

- [ ] **Step 7: Commit the guarded write-path work**

```bash
git add src/components/tabs/autotune/AiAdvisor.vue test/js/autotune_ai/dockStyles.test.js
git commit -m "feat: write fc changes from guarded ai plan"
```
