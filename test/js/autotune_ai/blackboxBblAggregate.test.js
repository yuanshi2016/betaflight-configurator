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
});
