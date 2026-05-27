import { describe, expect, it } from "vitest";
import { analyzeBblLog } from "../../../src/js/autotune-ai/blackboxBblAnalysis";

describe("autotune AI ordinary BBL analysis", () => {
    it("classifies a log with strong motor imbalance as usable and reports a motor imbalance diagnostic", () => {
        const result = analyzeBblLog({
            summary: {
                samples: {
                    decodedMainFrames: 1200,
                    corruptFrames: 0,
                    unsupportedEncodedFrames: 0,
                    durationUs: 8_000_000,
                },
                fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true, debug: false } },
                fieldStats: {
                    setpoint: {
                        0: { mean: 18, rms: 22, max: 55, count: 1200 },
                        1: { mean: 20, rms: 24, max: 58, count: 1200 },
                        2: { mean: 12, rms: 18, max: 45, count: 1200 },
                    },
                    motor: {
                        0: { mean: 1600, rms: 1610, max: 1800, count: 1200 },
                        1: { mean: 1590, rms: 1600, max: 1790, count: 1200 },
                        2: { mean: 1450, rms: 1460, max: 1650, count: 1200 },
                        3: { mean: 1440, rms: 1450, max: 1640, count: 1200 },
                    },
                },
            },
            craftContext: { craftType: "long-range", flightStyle: "smooth-cruise", riskPreference: "balanced" },
            staticConfig: { rates: { rates_type: 1, roll_rate: 85, pitch_rate: 85, yaw_rate: 70 } },
        });

        expect(result.quality).toEqual({
            status: "usable",
            reason: "sufficient_required_data",
            evidence: {
                decodedMainFrames: 1200,
                durationUs: 8_000_000,
                corruptFrames: 0,
                unsupportedEncodedFrames: 0,
                missingRequiredColumns: [],
            },
        });
        expect(result.diagnostics).toEqual([
            {
                type: "motor_output_imbalance",
                confidence: "high",
                risk: "elevated",
                explanation: "Average motor outputs show a sustained spread that suggests balance or mechanical asymmetry.",
                evidence: {
                    motorMeans: {
                        0: 1600,
                        1: 1590,
                        2: 1450,
                        3: 1440,
                    },
                    meanSpread: 160,
                    imbalanceRatio: 0.1046,
                },
            },
        ]);
        expect(result.recommendations).toEqual([
            {
                type: "inspect_powertrain_balance",
                group: "mechanical",
                priority: "high",
                actionability: "manual_check",
                explanation: "Check propellers, motor health, frame alignment, and CG before relying on PID changes.",
            },
        ]);
        expect(result.evidenceSummary).toEqual({
            qualityStatus: "usable",
            qualityReason: "sufficient_required_data",
            diagnosticTypes: ["motor_output_imbalance"],
            diagnosticCount: 1,
        });
    });

    it("marks logs with insufficient required fields as unusable", () => {
        const result = analyzeBblLog({
            summary: {
                samples: {
                    decodedMainFrames: 30,
                    corruptFrames: 0,
                    unsupportedEncodedFrames: 0,
                    durationUs: 200_000,
                },
                fields: { requiredColumns: { time: false, gyro: false, setpoint: false, motor: false, debug: false } },
                fieldStats: {},
            },
        });

        expect(result.quality).toEqual({
            status: "unusable",
            reason: "insufficient_required_data",
            evidence: {
                decodedMainFrames: 30,
                durationUs: 200_000,
                corruptFrames: 0,
                unsupportedEncodedFrames: 0,
                missingRequiredColumns: ["time", "gyro", "setpoint", "motor"],
            },
        });
        expect(result.diagnostics).toEqual([]);
        expect(result.recommendations).toEqual([
            {
                type: "collect_better_log",
                group: "data_quality",
                priority: "high",
                actionability: "capture_log",
                explanation:
                    "Capture a longer log with required time, gyro, setpoint, and motor fields before tuning decisions.",
            },
        ]);
        expect(result.evidenceSummary).toEqual({
            qualityStatus: "unusable",
            qualityReason: "insufficient_required_data",
            diagnosticTypes: [],
            diagnosticCount: 0,
        });
    });

    it("reports a rates mismatch diagnostic when configured rates are aggressive for the craft profile", () => {
        const result = analyzeBblLog({
            summary: {
                samples: {
                    decodedMainFrames: 1600,
                    corruptFrames: 0,
                    unsupportedEncodedFrames: 0,
                    durationUs: 12_000_000,
                },
                fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true, debug: false } },
                fieldStats: {
                    setpoint: {
                        0: { mean: 16, rms: 22, max: 40, count: 1600 },
                        1: { mean: 18, rms: 25, max: 42, count: 1600 },
                        2: { mean: 12, rms: 18, max: 34, count: 1600 },
                    },
                    gyroADC: {
                        0: { mean: 20, rms: 28, max: 55, count: 1600 },
                        1: { mean: 18, rms: 26, max: 52, count: 1600 },
                        2: { mean: 14, rms: 20, max: 40, count: 1600 },
                    },
                    motor: {
                        0: { mean: 1500, rms: 1510, max: 1700, count: 1600 },
                        1: { mean: 1505, rms: 1515, max: 1705, count: 1600 },
                        2: { mean: 1495, rms: 1505, max: 1695, count: 1600 },
                        3: { mean: 1500, rms: 1510, max: 1700, count: 1600 },
                    },
                },
            },
            craftContext: { craftType: "long-range", flightStyle: "smooth-cruise", riskPreference: "balanced" },
            staticConfig: { rates: { rates_type: 0, roll_rate: 92, pitch_rate: 88, yaw_rate: 75 } },
        });

        expect(result.quality.status).toBe("usable");
        expect(result.diagnostics).toContainEqual({
            type: "rates_mismatch",
            confidence: "medium",
            risk: "moderate",
            explanation: "Configured rates look aggressive for the declared craft profile and flight style.",
            evidence: {
                ratesType: 0,
                craftType: "long-range",
                flightStyle: "smooth-cruise",
                exceededAxes: [
                    { axis: "roll", configured: 92, recommendedMax: 80 },
                    { axis: "pitch", configured: 88, recommendedMax: 80 },
                    { axis: "yaw", configured: 75, recommendedMax: 65 },
                ],
                runtimeUsage: "low",
            },
        });
        expect(result.recommendations).toContainEqual({
            type: "review_rates_profile",
            group: "rates",
            priority: "medium",
            actionability: "config_review",
            explanation: "Compare configured rates against the long-range use case before tuning.",
            configSnapshot: { rates_type: 0, roll_rate: 92, pitch_rate: 88, yaw_rate: 75 },
        });
    });

    it("does not emit rates mismatch for nonzero rates types", () => {
        const result = analyzeBblLog({
            summary: {
                samples: {
                    decodedMainFrames: 1600,
                    corruptFrames: 0,
                    unsupportedEncodedFrames: 0,
                    durationUs: 12_000_000,
                },
                fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true, debug: false } },
                fieldStats: {
                    setpoint: {
                        0: { mean: 12, rms: 18, max: 32, count: 1600 },
                        1: { mean: 14, rms: 20, max: 34, count: 1600 },
                        2: { mean: 10, rms: 15, max: 28, count: 1600 },
                    },
                    gyroADC: {
                        0: { mean: 16, rms: 22, max: 40, count: 1600 },
                        1: { mean: 14, rms: 21, max: 39, count: 1600 },
                        2: { mean: 12, rms: 18, max: 34, count: 1600 },
                    },
                    motor: {
                        0: { mean: 1500, count: 1600 },
                        1: { mean: 1502, count: 1600 },
                        2: { mean: 1498, count: 1600 },
                        3: { mean: 1501, count: 1600 },
                    },
                },
            },
            craftContext: { craftType: "long-range", flightStyle: "smooth-cruise" },
            staticConfig: { rates: { rates_type: 1, roll_rate: 92, pitch_rate: 88, yaw_rate: 75 } },
        });

        expect(result.diagnostics.find((item) => item.type === "rates_mismatch")).toBeUndefined();
    });

    it("does not emit rates mismatch when runtime setpoint evidence is missing", () => {
        const result = analyzeBblLog({
            summary: {
                samples: {
                    decodedMainFrames: 1600,
                    corruptFrames: 0,
                    unsupportedEncodedFrames: 0,
                    durationUs: 12_000_000,
                },
                fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true, debug: false } },
                fieldStats: {
                    gyroADC: {
                        0: { mean: 16, rms: 22, max: 40, count: 1600 },
                        1: { mean: 14, rms: 21, max: 39, count: 1600 },
                        2: { mean: 12, rms: 18, max: 34, count: 1600 },
                    },
                    motor: {
                        0: { mean: 1500, count: 1600 },
                        1: { mean: 1502, count: 1600 },
                        2: { mean: 1498, count: 1600 },
                        3: { mean: 1501, count: 1600 },
                    },
                },
            },
            craftContext: { craftType: "long-range", flightStyle: "smooth-cruise" },
            staticConfig: { rates: { rates_type: 0, roll_rate: 92, pitch_rate: 88, yaw_rate: 75 } },
        });

        expect(result.diagnostics.find((item) => item.type === "rates_mismatch")).toBeUndefined();
    });

    it("marks otherwise usable logs as degraded when decode issues are present", () => {
        const result = analyzeBblLog({
            summary: {
                samples: {
                    decodedMainFrames: 1200,
                    corruptFrames: 3,
                    unsupportedEncodedFrames: 1,
                    durationUs: 8_000_000,
                },
                fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true, debug: false } },
                fieldStats: {
                    motor: {
                        0: { mean: 1510, count: 1200 },
                        1: { mean: 1508, count: 1200 },
                        2: { mean: 1505, count: 1200 },
                        3: { mean: 1509, count: 1200 },
                    },
                    setpoint: {
                        0: { mean: 18, rms: 22, max: 55, count: 1200 },
                    },
                },
            },
        });

        expect(result.quality).toEqual(
            expect.objectContaining({
                status: "degraded",
                reason: "partial_decode_issues",
            }),
        );
    });

    it("does not report motor imbalance when spread stays below the medium threshold", () => {
        const result = analyzeBblLog({
            summary: {
                samples: {
                    decodedMainFrames: 1200,
                    corruptFrames: 0,
                    unsupportedEncodedFrames: 0,
                    durationUs: 8_000_000,
                },
                fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true, debug: false } },
                fieldStats: {
                    motor: {
                        0: { mean: 1500, count: 1200 },
                        1: { mean: 1505, count: 1200 },
                        2: { mean: 1568, count: 1200 },
                        3: { mean: 1573, count: 1200 },
                    },
                    setpoint: {
                        0: { mean: 20, rms: 25, max: 48, count: 1200 },
                    },
                },
            },
        });

        expect(result.diagnostics.find((item) => item.type === "motor_output_imbalance")).toBeUndefined();
    });

    it("ignores low-sample motor entries when evaluating motor imbalance", () => {
        const result = analyzeBblLog({
            summary: {
                samples: {
                    decodedMainFrames: 1200,
                    corruptFrames: 0,
                    unsupportedEncodedFrames: 0,
                    durationUs: 8_000_000,
                },
                fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true, debug: false } },
                fieldStats: {
                    setpoint: {
                        0: { mean: 18, rms: 22, max: 55, count: 1200 },
                    },
                    motor: {
                        0: { mean: 1500, count: 1200 },
                        1: { mean: 1502, count: 1200 },
                        2: { mean: 1498, count: 1200 },
                        3: { mean: 1780, count: 20 },
                    },
                },
            },
        });

        expect(result.diagnostics.find((item) => item.type === "motor_output_imbalance")).toBeUndefined();
    });
});
