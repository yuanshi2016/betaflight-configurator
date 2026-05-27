import { describe, expect, it } from "vitest";
import { aggregateBblAnalyses } from "../../../src/js/autotune-ai/blackboxBblAggregate";

describe("autotune AI multi-log BBL aggregation", () => {
    it("boosts confidence for repeated diagnostics and lowers it for conflicting results", () => {
        const aggregate = aggregateBblAnalyses([
            {
                logIndex: 0,
                quality: { status: "usable" },
                diagnostics: [{ type: "motor_output_imbalance", confidence: "medium" }],
            },
            {
                logIndex: 1,
                quality: { status: "usable" },
                diagnostics: [{ type: "motor_output_imbalance", confidence: "high" }],
            },
            {
                logIndex: 2,
                quality: { status: "usable" },
                diagnostics: [{ type: "rates_mismatch", confidence: "medium" }],
            },
        ]);

        expect(aggregate.consensusDiagnostics).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: "motor_output_imbalance", confidence: "high" })]),
        );
        expect(aggregate.conflictingDiagnostics).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: "rates_mismatch" })]),
        );
        expect(aggregate.aggregateQuality.status).toBe("usable");
    });

    it("uses conservative recommendation values across selected logs", () => {
        const aggregate = aggregateBblAnalyses([
            {
                logIndex: 0,
                quality: { status: "usable" },
                recommendations: { rates: { values: { roll_rate: 70 } } },
                diagnostics: [],
            },
            {
                logIndex: 1,
                quality: { status: "usable" },
                recommendations: { rates: { values: { roll_rate: 65 } } },
                diagnostics: [],
            },
        ]);

        expect(aggregate.aggregateRecommendations.rates.values.roll_rate).toBe(65);
    });

    it("excludes unusable logs from the selected set and aggregate quality", () => {
        const aggregate = aggregateBblAnalyses([
            {
                logIndex: 0,
                quality: { status: "unusable" },
                diagnostics: [{ type: "motor_output_imbalance", confidence: "high" }],
                recommendations: { rates: { values: { roll_rate: 80 } } },
            },
            {
                logIndex: 1,
                quality: { status: "degraded" },
                diagnostics: [],
                recommendations: {},
            },
        ]);

        expect(aggregate.selectedLogIndexes).toEqual([1]);
        expect(aggregate.aggregateQuality.status).toBe("degraded");
        expect(aggregate.consensusDiagnostics).toEqual([]);
    });
});
