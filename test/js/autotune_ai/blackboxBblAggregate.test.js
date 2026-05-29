import { describe, expect, it } from "vitest";
import { aggregateBblAnalyses } from "../../../src/js/autotune-ai/blackboxBblAggregate";

describe("autotune AI multi-log BBL aggregation", () => {
    it("raises confidence for repeated matching diagnostics", () => {
        const aggregate = aggregateBblAnalyses([
            {
                logIndex: 0,
                quality: { status: "usable" },
                diagnostics: [{ type: "motor_output_imbalance", confidence: "medium" }],
                recommendations: [],
            },
            {
                logIndex: 1,
                quality: { status: "usable" },
                diagnostics: [{ type: "motor_output_imbalance", confidence: "high" }],
                recommendations: [],
            },
        ]);

        expect(aggregate.consensusDiagnostics).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: "motor_output_imbalance", confidence: "high" })]),
        );
        expect(aggregate.conflictingDiagnostics).toEqual([]);
        expect(aggregate.aggregateQuality.status).toBe("usable");
    });

    it("keeps singleton diagnostics explicitly marked as non-consensus", () => {
        const aggregate = aggregateBblAnalyses([
            {
                logIndex: 0,
                quality: { status: "usable" },
                diagnostics: [{ type: "rates_mismatch", confidence: "medium" }],
                recommendations: [],
            },
        ]);

        expect(aggregate.conflictingDiagnostics).toEqual([
            expect.objectContaining({
                type: "rates_mismatch",
                classification: "singleton",
                conflict: false,
                sources: 1,
            }),
        ]);
    });

    it("aggregates producer-shaped recommendation arrays conservatively", () => {
        const aggregate = aggregateBblAnalyses([
            {
                logIndex: 0,
                quality: { status: "usable" },
                diagnostics: [],
                recommendations: [
                    {
                        type: "review_rates_profile",
                        group: "rates",
                        priority: "low",
                        actionability: "config_review",
                        explanation: "Compare configured rates against the long-range use case before tuning.",
                        configSnapshot: { rates_type: 0, roll_rate: 70, pitch_rate: 68, yaw_rate: 60 },
                    },
                    {
                        group: "rates",
                        priority: "high",
                        actionability: "config_review",
                        explanation: "Malformed recommendation without a type should be ignored.",
                    },
                ],
            },
            {
                logIndex: 1,
                quality: { status: "usable" },
                diagnostics: [],
                recommendations: [
                    {
                        type: "review_rates_profile",
                        group: "rates",
                        priority: "high",
                        actionability: "config_review",
                        explanation: "Compare configured rates against the long-range use case before tuning.",
                        configSnapshot: { rates_type: 0, roll_rate: 65, pitch_rate: 70, yaw_rate: 58 },
                    },
                    {
                        type: "inspect_powertrain_balance",
                        group: "mechanical",
                        priority: "high",
                        actionability: "manual_check",
                        explanation: "Check propellers, motor health, frame alignment, and CG before relying on PID changes.",
                    },
                ],
            },
        ]);

        expect(aggregate.aggregateRecommendations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "review_rates_profile",
                    group: "rates",
                    priority: "high",
                    actionability: "config_review",
                    sources: 2,
                    configSnapshot: {
                        rates_type: 0,
                        roll_rate: 65,
                        pitch_rate: 68,
                        yaw_rate: 58,
                    },
                }),
                expect.objectContaining({
                    type: "inspect_powertrain_balance",
                    group: "mechanical",
                    actionability: "manual_check",
                    sources: 1,
                }),
            ]),
        );
        expect(aggregate.aggregateRecommendations).toHaveLength(2);
    });

    it("does not create false consensus for materially different rates mismatch evidence", () => {
        const aggregate = aggregateBblAnalyses([
            {
                logIndex: 0,
                quality: { status: "usable" },
                diagnostics: [
                    {
                        type: "rates_mismatch",
                        confidence: "medium",
                        evidence: {
                            ratesType: 0,
                            craftType: "long-range",
                            flightStyle: "smooth-cruise",
                            exceededAxes: [{ axis: "roll", configured: 92, recommendedMax: 80 }],
                            runtimeUsage: "low",
                        },
                    },
                ],
                recommendations: [],
            },
            {
                logIndex: 1,
                quality: { status: "usable" },
                diagnostics: [
                    {
                        type: "rates_mismatch",
                        confidence: "medium",
                        evidence: {
                            ratesType: 0,
                            craftType: "cinematic",
                            flightStyle: "generic",
                            exceededAxes: [{ axis: "yaw", configured: 75, recommendedMax: 60 }],
                            runtimeUsage: "low",
                        },
                    },
                ],
                recommendations: [],
            },
        ]);

        expect(aggregate.consensusDiagnostics).toEqual([]);
        expect(aggregate.conflictingDiagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "rates_mismatch",
                    classification: "singleton",
                    conflict: false,
                    sources: 1,
                }),
            ]),
        );
        expect(aggregate.conflictingDiagnostics).toHaveLength(2);
    });

    it("preserves selected logs separately from the usable subset", () => {
        const aggregate = aggregateBblAnalyses([
            {
                logIndex: 0,
                quality: { status: "unusable" },
                diagnostics: [{ type: "motor_output_imbalance", confidence: "high" }],
                recommendations: [
                    {
                        type: "collect_better_log",
                        group: "data_quality",
                        priority: "high",
                        actionability: "capture_log",
                        explanation: "Capture a longer log with required time, gyro, setpoint, and motor fields before tuning decisions.",
                    },
                ],
            },
            {
                logIndex: 1,
                quality: { status: "degraded" },
                diagnostics: [],
                recommendations: [],
            },
        ]);

        expect(aggregate.selectedLogIndexes).toEqual([0, 1]);
        expect(aggregate.usableLogIndexes).toEqual([1]);
        expect(aggregate.aggregateQuality.status).toBe("degraded");
        expect(aggregate.aggregateQuality.reason).toBe("includes_unusable_logs");
        expect(aggregate.consensusDiagnostics).toEqual([]);
        expect(aggregate.aggregateRecommendations).toEqual([]);
    });

    it("boosts repeated per-axis PID advice and marks conflicting directions separately", () => {
        const aggregate = aggregateBblAnalyses([
            {
                logIndex: 0,
                quality: { status: "usable" },
                diagnostics: [],
                recommendations: [],
                axes: {
                    roll: {
                        timeDomain: { rmsError: 40 },
                        frequencyDomain: { fftUsable: true },
                        pidAdvice: {
                            p: { direction: "increase", confidence: "medium", reason: "moving_error_high" },
                        },
                        filterAdvice: {
                            gyroNotch: { direction: "enable", confidence: "medium", reason: "gyro_peak" },
                        },
                    },
                },
            },
            {
                logIndex: 1,
                quality: { status: "usable" },
                diagnostics: [],
                recommendations: [],
                axes: {
                    roll: {
                        timeDomain: { rmsError: 45 },
                        frequencyDomain: { fftUsable: true },
                        pidAdvice: {
                            p: { direction: "increase", confidence: "high", reason: "moving_error_high" },
                        },
                        filterAdvice: {
                            gyroNotch: { direction: "enable", confidence: "medium", reason: "gyro_peak" },
                        },
                    },
                },
            },
            {
                logIndex: 2,
                quality: { status: "usable" },
                diagnostics: [],
                recommendations: [],
                axes: {
                    roll: {
                        timeDomain: { rmsError: 10 },
                        frequencyDomain: { fftUsable: true },
                        pidAdvice: {
                            p: { direction: "decrease", confidence: "medium", reason: "oscillation_risk" },
                        },
                        filterAdvice: {
                            gyroNotch: { direction: "disable", confidence: "low", reason: "clean_spectrum" },
                        },
                    },
                },
            },
            {
                logIndex: 3,
                quality: { status: "usable" },
                diagnostics: [],
                recommendations: [],
                axes: {
                    roll: {
                        timeDomain: { rmsError: 50 },
                        frequencyDomain: { fftUsable: false, reason: "insufficient_samples" },
                        pidAdvice: {
                            p: { direction: "increase", confidence: "medium", reason: "moving_error_high" },
                        },
                        filterAdvice: {},
                    },
                },
            },
        ]);

        expect(aggregate.axes.roll.pidAdvice.p).toEqual(
            expect.objectContaining({
                direction: "increase",
                confidence: "high",
                supportCount: 3,
                conflictCount: 1,
            }),
        );
        expect(aggregate.axes.roll.filterAdvice.gyroNotch).toEqual(
            expect.objectContaining({
                direction: "enable",
                supportCount: 2,
                conflictCount: 1,
            }),
        );
        expect(aggregate.axisConflicts).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    axis: "roll",
                    advicePath: "pidAdvice.p",
                    conflictingDirections: ["decrease", "increase"],
                }),
            ]),
        );
    });

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
                            roll_rate: {
                                suggestedValue: 90,
                                min: 90,
                                max: 95,
                                step: 1,
                                reason: "same",
                                evidenceRefs: ["ratesMismatch.roll"],
                            },
                        },
                    },
                    filters: {
                        writeableAllowed: false,
                        blockedReason: "single_log_filter_evidence_requires_confirmation",
                        confidence: "medium",
                        candidates: {},
                    },
                    pid: {
                        writeableAllowed: false,
                        blockedReason: "single_log_pid_requires_multi_log_confirmation",
                        confidence: "medium",
                        candidates: {},
                    },
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
                            roll_rate: {
                                suggestedValue: 90,
                                min: 90,
                                max: 95,
                                step: 1,
                                reason: "same",
                                evidenceRefs: ["ratesMismatch.roll"],
                            },
                        },
                    },
                    filters: {
                        writeableAllowed: false,
                        blockedReason: "single_log_filter_evidence_requires_confirmation",
                        confidence: "medium",
                        candidates: {},
                    },
                    pid: {
                        writeableAllowed: false,
                        blockedReason: "single_log_pid_requires_multi_log_confirmation",
                        confidence: "medium",
                        candidates: {},
                    },
                },
            },
        ]);

        expect(aggregate.writeEnvelope.rates.writeableAllowed).toBe(true);
        expect(aggregate.writeEnvelope.rates.confidence).toBe("high");
        expect(aggregate.writeEnvelope.rates.candidates.roll_rate).toEqual(
            expect.objectContaining({
                suggestedValue: 90,
                min: 90,
                max: 95,
                step: 1,
            }),
        );
    });

    it("promotes filters to writeable when multiple usable logs agree on the same suggested values", () => {
        const aggregate = aggregateBblAnalyses([
            {
                logIndex: 0,
                quality: { status: "usable" },
                diagnostics: [],
                recommendations: [],
                writeEnvelope: {
                    filters: {
                        writeableAllowed: false,
                        blockedReason: "single_log_filter_evidence_requires_confirmation",
                        confidence: "medium",
                        candidates: {
                            slider_gyro_filter_multiplier: {
                                suggestedValue: 95,
                                min: 95,
                                max: 100,
                                step: 1,
                                reason: "first",
                                evidenceRefs: ["roll.frequencyDomain.gyroPeakMagnitude"],
                            },
                            slider_dterm_filter_multiplier: {
                                suggestedValue: 92,
                                min: 92,
                                max: 100,
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
                        writeableAllowed: false,
                        blockedReason: "single_log_filter_evidence_requires_confirmation",
                        confidence: "high",
                        candidates: {
                            slider_gyro_filter_multiplier: {
                                suggestedValue: 95,
                                min: 95,
                                max: 100,
                                step: 1,
                                reason: "second",
                                evidenceRefs: ["pitch.frequencyDomain.gyroPeakMagnitude"],
                            },
                            slider_dterm_filter_multiplier: {
                                suggestedValue: 92,
                                min: 92,
                                max: 100,
                                step: 1,
                                reason: "second",
                                evidenceRefs: ["pitch.frequencyDomain.dtermHighFreqAvg"],
                            },
                        },
                    },
                },
            },
        ]);

        expect(aggregate.writeEnvelope.filters.writeableAllowed).toBe(true);
        expect(aggregate.writeEnvelope.filters.confidence).toBe("high");
        expect(aggregate.writeEnvelope.filters.candidates.slider_gyro_filter_multiplier).toEqual(
            expect.objectContaining({
                suggestedValue: 95,
                min: 95,
                max: 100,
                step: 1,
            }),
        );
        expect(aggregate.writeEnvelope.filters.candidates.slider_dterm_filter_multiplier).toEqual(
            expect.objectContaining({
                suggestedValue: 92,
                min: 92,
                max: 100,
                step: 1,
            }),
        );
    });

    it("promotes PID to writeable when multiple usable logs agree on the same suggested values", () => {
        const aggregate = aggregateBblAnalyses([
            {
                logIndex: 0,
                quality: { status: "usable" },
                diagnostics: [],
                recommendations: [],
                writeEnvelope: {
                    pid: {
                        writeableAllowed: false,
                        blockedReason: "single_log_pid_requires_multi_log_confirmation",
                        confidence: "medium",
                        candidates: {
                            slider_master_multiplier: {
                                suggestedValue: 102,
                                min: 100,
                                max: 102,
                                step: 1,
                                reason: "first",
                                evidenceRefs: ["roll.timeDomain.meanErrMoving"],
                            },
                            slider_feedforward_gain: {
                                suggestedValue: 104,
                                min: 100,
                                max: 104,
                                step: 1,
                                reason: "first",
                                evidenceRefs: ["roll.pidAdvice.ff"],
                            },
                            slider_i_gain: {
                                suggestedValue: 102,
                                min: 100,
                                max: 102,
                                step: 1,
                                reason: "first",
                                evidenceRefs: ["roll.timeDomain.meanErrSteady"],
                            },
                            slider_d_gain: {
                                suggestedValue: 103,
                                min: 100,
                                max: 103,
                                step: 1,
                                reason: "first",
                                evidenceRefs: ["roll.pidAdvice.d"],
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
                    pid: {
                        writeableAllowed: false,
                        blockedReason: "single_log_pid_requires_multi_log_confirmation",
                        confidence: "high",
                        candidates: {
                            slider_master_multiplier: {
                                suggestedValue: 102,
                                min: 100,
                                max: 102,
                                step: 1,
                                reason: "second",
                                evidenceRefs: ["pitch.timeDomain.meanErrMoving"],
                            },
                            slider_feedforward_gain: {
                                suggestedValue: 104,
                                min: 100,
                                max: 104,
                                step: 1,
                                reason: "second",
                                evidenceRefs: ["pitch.pidAdvice.ff"],
                            },
                            slider_i_gain: {
                                suggestedValue: 102,
                                min: 100,
                                max: 102,
                                step: 1,
                                reason: "second",
                                evidenceRefs: ["pitch.timeDomain.meanErrSteady"],
                            },
                            slider_d_gain: {
                                suggestedValue: 103,
                                min: 100,
                                max: 103,
                                step: 1,
                                reason: "second",
                                evidenceRefs: ["pitch.pidAdvice.d"],
                            },
                        },
                    },
                },
            },
        ]);

        expect(aggregate.writeEnvelope.pid.writeableAllowed).toBe(true);
        expect(aggregate.writeEnvelope.pid.confidence).toBe("high");
        expect(aggregate.writeEnvelope.pid.candidates.slider_master_multiplier).toEqual(
            expect.objectContaining({
                suggestedValue: 102,
                min: 100,
                max: 102,
                step: 1,
            }),
        );
        expect(aggregate.writeEnvelope.pid.candidates.slider_feedforward_gain).toEqual(
            expect.objectContaining({
                suggestedValue: 104,
                min: 100,
                max: 104,
                step: 1,
            }),
        );
        expect(aggregate.writeEnvelope.pid.candidates.slider_i_gain).toEqual(
            expect.objectContaining({
                suggestedValue: 102,
                min: 100,
                max: 102,
                step: 1,
            }),
        );
        expect(aggregate.writeEnvelope.pid.candidates.slider_d_gain).toEqual(
            expect.objectContaining({
                suggestedValue: 103,
                min: 100,
                max: 103,
                step: 1,
            }),
        );
    });

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

    it("keeps aggregate write envelopes explain-only when aggregate quality is degraded", () => {
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
                            roll_rate: {
                                suggestedValue: 90,
                                min: 90,
                                max: 95,
                                step: 1,
                                reason: "same",
                                evidenceRefs: ["ratesMismatch.roll"],
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
                                reason: "same",
                                evidenceRefs: ["ratesMismatch.roll"],
                            },
                        },
                    },
                },
            },
            {
                logIndex: 2,
                quality: { status: "degraded" },
                diagnostics: [],
                recommendations: [],
                writeEnvelope: {
                    rates: {
                        writeableAllowed: true,
                        blockedReason: "",
                        confidence: "medium",
                        candidates: {
                            roll_rate: {
                                suggestedValue: 90,
                                min: 90,
                                max: 95,
                                step: 1,
                                reason: "same",
                                evidenceRefs: ["ratesMismatch.roll"],
                            },
                        },
                    },
                },
            },
        ]);

        expect(aggregate.aggregateQuality.status).toBe("degraded");
        expect(aggregate.writeEnvelope.rates.writeableAllowed).toBe(false);
        expect(aggregate.writeEnvelope.rates.blockedReason).toBe("aggregate_quality_not_usable");
        expect(aggregate.writeEnvelope.rates.candidates).toEqual({});
    });

    it("downgrades aggregate envelopes when candidate metadata differs despite matching suggested values", () => {
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
                            roll_rate: {
                                suggestedValue: 90,
                                min: 90,
                                max: 95,
                                step: 1,
                                reason: "first",
                                evidenceRefs: ["ratesMismatch.roll"],
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
                    rates: {
                        writeableAllowed: true,
                        blockedReason: "",
                        confidence: "high",
                        candidates: {
                            roll_rate: {
                                suggestedValue: 90,
                                min: 88,
                                max: 94,
                                step: 2,
                                reason: "second",
                                evidenceRefs: ["ratesMismatch.roll"],
                            },
                        },
                    },
                },
            },
        ]);

        expect(aggregate.writeEnvelope.rates.writeableAllowed).toBe(false);
        expect(aggregate.writeEnvelope.rates.blockedReason).toBe("conflicting_candidate_values");
        expect(aggregate.writeEnvelope.rates.candidates).toEqual({});
    });

    it("downgrades aggregate envelopes when usable logs disagree on candidate key sets", () => {
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
                            roll_rate: {
                                suggestedValue: 90,
                                min: 90,
                                max: 95,
                                step: 1,
                                reason: "first",
                                evidenceRefs: ["ratesMismatch.roll"],
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
                    rates: {
                        writeableAllowed: true,
                        blockedReason: "",
                        confidence: "high",
                        candidates: {
                            pitch_rate: {
                                suggestedValue: 88,
                                min: 88,
                                max: 92,
                                step: 1,
                                reason: "second",
                                evidenceRefs: ["ratesMismatch.pitch"],
                            },
                        },
                    },
                },
            },
        ]);

        expect(aggregate.writeEnvelope.rates.writeableAllowed).toBe(false);
        expect(aggregate.writeEnvelope.rates.blockedReason).toBe("conflicting_candidate_values");
        expect(aggregate.writeEnvelope.rates.candidates).toEqual({});
    });
});
