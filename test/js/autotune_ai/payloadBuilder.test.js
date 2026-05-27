import { describe, expect, it } from "vitest";
import { buildAiPayload } from "../../../src/js/autotune-ai/payloadBuilder";

function repeatText(prefix, length) {
    return `${prefix}${"x".repeat(length)}`;
}

describe("autotune AI payload builder", () => {
    it("builds a compact payload from FC and CLI summaries without raw CLI or CSV content", () => {
        const fc = {
            CONFIG: {
                apiVersion: "1.48.0",
                flightControllerVersion: "4.6.0",
                targetName: "TEST",
                boardName: "F7",
                buildOptions: ["USE_DSHOT", "USE_CHIRP"],
            },
            TUNING_SLIDERS: { slider_master_multiplier: 100, slider_d_gain: 110 },
            FILTER_CONFIG: { dyn_notch_count: 3, gyro_rpm_notch_harmonics: 2 },
            RC_TUNING: { rates_type: 0, roll_rate: 70, pitch_rate: 70, yaw_rate: 60 },
            PID_ADVANCED_CONFIG: { pid_process_denom: 2, motorIdle: 5.5 },
            FEATURE_CONFIG: { features: 1234 },
        };
        const cliText = "set p_pitch = 58\nset osd_units = METRIC\n".repeat(500);
        const cliSummary = { pid: { p_pitch: 58 }, filters: {}, rates: {}, features: {}, rawCli: cliText };

        const payload = buildAiPayload({
            craftContext: { craftType: "racing", motorKv: "1960" },
            fc,
            cliSummary,
            rawCliText: cliText,
            csvSummary: { columns: ["debug[1]"], rawRows: [[1, 2, 3]] },
            bblSummary: {
                fileName: "flight.bbl",
                logCount: 1,
                rawBytes: new Uint8Array([1, 2, 3]),
                fields: { loggedFields: ["gyroADC[0]"] },
            },
        });
        const serialized = JSON.stringify(payload);

        expect(payload.sourceSummary).toMatchObject({ hasCurrentFc: true, hasCli: true, hasCsv: true, hasBbl: true });
        expect(payload.inputSources).toMatchObject({
            cli: { present: true },
            csv: { present: true },
            bbl: { present: true },
        });
        expect(payload.staticConfig.firmware.targetName).toBe("TEST");
        expect(payload.staticConfig.pid.slider_master_multiplier).toBe(100);
        expect(payload.staticConfig.cli.pid.p_pitch).toBe(58);
        expect(payload.staticConfig.bbl.fileName).toBe("flight.bbl");
        expect(serialized).not.toContain("osd_units");
        expect(serialized).not.toContain("rawRows");
        expect(serialized).not.toContain("rawBytes");
        expect(serialized.length).toBeLessThanOrEqual(20 * 1024);
    });

    it("includes selected log indexes and local analysis summaries in the payload", () => {
        const payload = buildAiPayload({
            craftContext: { craftType: "long-range" },
            bblSummary: {
                fileName: "flight.bbl",
                logCount: 3,
                selectedLogIndex: 1,
                fields: { loggedFields: ["gyroADC[0]"] },
            },
            localBblAnalysis: {
                selectedLogIndexes: [1, 2],
                aggregateQuality: { status: "usable", reason: "logs align well", rawBlob: "hidden" },
                consensusDiagnostics: [
                    {
                        type: "motor_output_imbalance",
                        confidence: "high",
                        risk: "medium",
                        classification: "propulsion",
                        explanation: repeatText("diag-", 400),
                        evidence: {
                            axis: "roll",
                            metric: "motor_delta",
                            samples: [1, 2, 3],
                            rawBytes: new Uint8Array([1, 2]),
                        },
                    },
                ],
                conflictingDiagnostics: [
                    {
                        type: "frame_resonance",
                        conflict: "partial_disagreement",
                        sources: 2,
                        reason: "insufficient_data",
                        explanation: repeatText("conflict-", 400),
                    },
                ],
                aggregateRecommendations: [
                    {
                        type: "review_rates_profile",
                        group: "rates",
                        priority: "medium",
                        actionability: "config_review",
                        explanation: repeatText("rec-", 400),
                        configSnapshot: {
                            profile: 2,
                            rates_type: 5,
                            rawRows: [[1, 2]],
                        },
                    },
                ],
                rawSamples: [{ axis: "roll", values: [1, 2, 3] }],
            },
        });

        expect(payload.inputSources.bbl.summary.selectedLogIndex).toBe(1);
        expect(payload.localAnalysis).toEqual({
            selectedLogIndexes: [1, 2],
            aggregateQuality: { status: "usable", reason: "logs align well" },
            consensusDiagnostics: [
                {
                    type: "motor_output_imbalance",
                    confidence: "high",
                    risk: "medium",
                    classification: "propulsion",
                    explanation: expect.any(String),
                    evidence: {
                        axis: "roll",
                        metric: "motor_delta",
                    },
                },
            ],
            conflictingDiagnostics: [
                {
                    type: "frame_resonance",
                    conflict: "partial_disagreement",
                    sources: 2,
                    explanation: expect.any(String),
                },
            ],
            aggregateRecommendations: [
                {
                    type: "review_rates_profile",
                    group: "rates",
                    priority: "medium",
                    actionability: "config_review",
                    explanation: expect.any(String),
                    configSnapshot: {
                        profile: 2,
                        rates_type: 5,
                    },
                },
            ],
        });
        expect(payload.localAnalysis.consensusDiagnostics).toHaveLength(1);
        expect(payload.localAnalysis.consensusDiagnostics[0].explanation.length).toBeLessThanOrEqual(240);
        expect(payload.localAnalysis.conflictingDiagnostics[0].explanation.length).toBeLessThanOrEqual(240);
        expect(payload.localAnalysis.aggregateRecommendations[0].explanation.length).toBeLessThanOrEqual(240);
        expect(JSON.stringify(payload)).not.toContain("rawSamples");
        expect(JSON.stringify(payload)).not.toContain("rawBlob");
    });

    it("caps local analysis lists and trims diagnostic and recommendation fields", () => {
        const payload = buildAiPayload({
            localBblAnalysis: {
                selectedLogIndexes: [1, 2, 3, 4, 5, 6],
                aggregateQuality: { status: "usable", reason: repeatText("reason-", 400), details: "ignored" },
                consensusDiagnostics: Array.from({ length: 8 }, (_, index) => ({
                    type: `consensus-${index}`,
                    confidence: "medium",
                    risk: "low",
                    classification: "test",
                    explanation: repeatText(`consensus-${index}-`, 400),
                    evidence: {
                        metric: `metric-${index}`,
                        axis: "roll",
                        note: repeatText("note-", 200),
                        peaks: Array.from({ length: 8 }, (_, peakIndex) => peakIndex),
                        rawBytes: new Uint8Array([1, 2]),
                    },
                    extraField: "ignored",
                })),
                conflictingDiagnostics: Array.from({ length: 7 }, (_, index) => ({
                    type: `conflict-${index}`,
                    conflict: "disagreement",
                    sources: index + 2,
                    explanation: repeatText(`conflict-${index}-`, 400),
                    extraField: "ignored",
                })),
                aggregateRecommendations: Array.from({ length: 9 }, (_, index) => ({
                    type: `recommendation-${index}`,
                    group: "filters",
                    priority: "high",
                    actionability: "config_change",
                    explanation: repeatText(`recommendation-${index}-`, 400),
                    configSnapshot: {
                        profile: index,
                        value: repeatText("snapshot-", 200),
                        recentAdjustments: Array.from({ length: 9 }, (_, adjustmentIndex) => ({
                            axis: "roll",
                            value: adjustmentIndex,
                        })),
                        rawRows: [[1, 2, 3]],
                    },
                    extraField: "ignored",
                })),
            },
        });

        expect(payload.localAnalysis.aggregateQuality).toEqual({
            status: "usable",
            reason: expect.any(String),
        });
        expect(payload.localAnalysis.aggregateQuality.reason.length).toBeLessThanOrEqual(160);
        expect(payload.localAnalysis.consensusDiagnostics).toHaveLength(5);
        expect(payload.localAnalysis.conflictingDiagnostics).toHaveLength(5);
        expect(payload.localAnalysis.aggregateRecommendations).toHaveLength(5);
        expect(payload.localAnalysis.consensusDiagnostics[0]).not.toHaveProperty("extraField");
        expect(payload.localAnalysis.conflictingDiagnostics[0]).not.toHaveProperty("extraField");
        expect(payload.localAnalysis.aggregateRecommendations[0]).not.toHaveProperty("extraField");
        expect(payload.localAnalysis.conflictingDiagnostics[0].sources).toBe(2);
        expect(payload.localAnalysis.consensusDiagnostics[0].explanation.length).toBeLessThanOrEqual(240);
        expect(payload.localAnalysis.aggregateRecommendations[0].explanation.length).toBeLessThanOrEqual(240);
        expect(payload.localAnalysis.consensusDiagnostics[0].evidence.peaks).toHaveLength(4);
        expect(payload.localAnalysis.aggregateRecommendations[0].configSnapshot.recentAdjustments).toHaveLength(4);
    });

    it("enforces the payload size limit by compacting local analysis before returning", () => {
        const hugeText = repeatText("oversized-", 6000);
        const payload = buildAiPayload({
            craftContext: { craftType: "cinelifter" },
            cliSummary: { pid: { p_pitch: 58 }, notes: hugeText.repeat(2) },
            csvSummary: { columns: ["debug[0]"], notes: hugeText.repeat(2) },
            bblSummary: { fileName: "flight.bbl", notes: hugeText.repeat(2) },
            analysisResult: {
                axes: {
                    roll: {
                        recommendedGains: { p: 60, d: 40 },
                        coherenceMean: 0.95,
                        peakFrequencyHz: 180,
                        rawSpectrum: hugeText,
                    },
                },
            },
            localBblAnalysis: {
                selectedLogIndexes: [1, 2, 3],
                aggregateQuality: { status: "usable", reason: hugeText },
                consensusDiagnostics: Array.from({ length: 12 }, (_, index) => ({
                    type: `consensus-${index}`,
                    confidence: "high",
                    risk: "medium",
                    classification: "oscillation",
                    explanation: hugeText,
                    evidence: {
                        metric: "gyro_peak",
                        detail: hugeText,
                    },
                })),
                conflictingDiagnostics: Array.from({ length: 10 }, (_, index) => ({
                    type: `conflict-${index}`,
                    conflict: "mixed",
                    sources: ["a", "b", "c", "d", "e"],
                    explanation: hugeText,
                })),
                aggregateRecommendations: Array.from({ length: 10 }, (_, index) => ({
                    type: `recommendation-${index}`,
                    group: "pid",
                    priority: "high",
                    actionability: "config_change",
                    explanation: hugeText,
                    configSnapshot: {
                        profile: index,
                        detail: hugeText,
                    },
                })),
            },
        });

        const serialized = JSON.stringify(payload);

        expect(serialized.length).toBeLessThanOrEqual(20 * 1024);
        expect(payload.dynamicAnalysis).toEqual({ axes: {} });
        expect(payload.staticConfig.cli).toBeUndefined();
        expect(payload.staticConfig.csv).toBeUndefined();
        expect(payload.staticConfig.bbl).toBeUndefined();
        expect(payload.localAnalysis).toBeUndefined();
    });
});
