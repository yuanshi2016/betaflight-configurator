import { describe, expect, it } from "vitest";
import { buildAiPayload } from "../../../src/js/autotune-ai/payloadBuilder";

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
                aggregateQuality: { status: "usable" },
                consensusDiagnostics: [{ type: "motor_output_imbalance", confidence: "high" }],
                conflictingDiagnostics: [{ type: "frame_resonance", reason: "insufficient_data" }],
                aggregateRecommendations: [
                    { type: "review_rates_profile", group: "rates", actionability: "config_review" },
                ],
                rawSamples: [{ axis: "roll", values: [1, 2, 3] }],
            },
        });

        expect(payload.inputSources.bbl.summary.selectedLogIndex).toBe(1);
        expect(payload.localAnalysis).toEqual({
            selectedLogIndexes: [1, 2],
            aggregateQuality: { status: "usable" },
            consensusDiagnostics: [{ type: "motor_output_imbalance", confidence: "high" }],
            conflictingDiagnostics: [{ type: "frame_resonance", reason: "insufficient_data" }],
            aggregateRecommendations: [
                { type: "review_rates_profile", group: "rates", actionability: "config_review" },
            ],
        });
        expect(JSON.stringify(payload)).not.toContain("rawSamples");
    });
});
