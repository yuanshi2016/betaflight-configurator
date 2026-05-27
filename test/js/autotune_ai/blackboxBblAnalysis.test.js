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
            staticConfig: { rates: { roll_rate: 85, pitch_rate: 85, yaw_rate: 70 } },
        });

        expect(result.quality.status).toBe("usable");
        expect(result.quality.reason).toBe("sufficient_required_data");
        expect(result.diagnostics).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: "motor_output_imbalance", confidence: "high" })]),
        );
        expect(result.recommendations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "inspect_powertrain_balance",
                    group: "mechanical",
                    actionability: "manual_check",
                }),
            ]),
        );
        expect(result.evidenceSummary).toEqual(
            expect.objectContaining({
                qualityStatus: "usable",
                qualityReason: "sufficient_required_data",
                diagnosticTypes: expect.arrayContaining(["motor_output_imbalance"]),
            }),
        );
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

        expect(result.quality.status).toBe("unusable");
        expect(result.quality.reason).toBe("insufficient_required_data");
        expect(result.diagnostics).toEqual([]);
        expect(result.recommendations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "collect_better_log",
                    group: "data_quality",
                    actionability: "capture_log",
                }),
            ]),
        );
        expect(result.evidenceSummary).toEqual(
            expect.objectContaining({
                qualityStatus: "unusable",
                qualityReason: "insufficient_required_data",
                diagnosticTypes: [],
                diagnosticCount: 0,
            }),
        );
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
        expect(result.diagnostics).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: "rates_mismatch", confidence: "medium" })]),
        );
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
});
