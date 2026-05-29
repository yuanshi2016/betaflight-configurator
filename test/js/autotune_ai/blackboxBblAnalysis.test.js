import { describe, expect, it } from "vitest";
import { analyzeBblLog } from "../../../src/js/autotune-ai/blackboxBblAnalysis";

function buildAxisSeries({ length, sampleRateHz, setpointValue, gyroValue, dtermValue = 0, peakHz = null, peakAmplitude = 0 }) {
    const dtUs = Math.round(1_000_000 / sampleRateHz);
    return {
        timeUs: Array.from({ length }, (_, index) => index * dtUs),
        setpoint: Array.from({ length }, (_, index) => {
            if (index < length / 4) {
                return 0;
            }
            if (index < length / 2) {
                return setpointValue;
            }
            return 0;
        }),
        gyro: Array.from({ length }, (_, index) => {
            const sinusoid = peakHz ? Math.sin((2 * Math.PI * peakHz * index) / sampleRateHz) * peakAmplitude : 0;
            if (index < length / 4) {
                return sinusoid;
            }
            if (index < length / 2) {
                return gyroValue + sinusoid;
            }
            return sinusoid;
        }),
        dterm: Array.from({ length }, (_, index) => {
            const highFreq = Math.sin((2 * Math.PI * 220 * index) / sampleRateHz) * dtermValue;
            return highFreq;
        }),
    };
}

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
                    imbalanceRatio: 0.1053,
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

    it("does not allow rate writes for degraded or unusable logs", () => {
        const degradedResult = analyzeBblLog({
            summary: {
                samples: { decodedMainFrames: 1400, corruptFrames: 2, unsupportedEncodedFrames: 0, durationUs: 8_000_000 },
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

        const unusableResult = analyzeBblLog({
            summary: {
                samples: { decodedMainFrames: 80, corruptFrames: 0, unsupportedEncodedFrames: 0, durationUs: 150_000 },
                fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true } },
                fieldStats: {
                    setpoint: {
                        0: { mean: 4, rms: 18, max: 50 },
                        1: { mean: 3, rms: 16, max: 46 },
                        2: { mean: 2, rms: 14, max: 40 },
                    },
                    motor: {
                        0: { mean: 1500, rms: 1510, max: 1700, count: 80 },
                        1: { mean: 1498, rms: 1508, max: 1690, count: 80 },
                        2: { mean: 1502, rms: 1512, max: 1710, count: 80 },
                        3: { mean: 1499, rms: 1509, max: 1695, count: 80 },
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

        expect(degradedResult.quality.status).toBe("degraded");
        expect(degradedResult.writeEnvelope.rates.writeableAllowed).toBe(false);
        expect(degradedResult.diagnostics.find((item) => item.type === "rates_mismatch")).toBeUndefined();
        expect(degradedResult.recommendations.find((item) => item.type === "review_rates_profile")).toBeUndefined();
        expect(unusableResult.quality.status).toBe("unusable");
        expect(unusableResult.writeEnvelope.rates.writeableAllowed).toBe(false);
        expect(unusableResult.diagnostics.find((item) => item.type === "rates_mismatch")).toBeUndefined();
        expect(unusableResult.recommendations.find((item) => item.type === "review_rates_profile")).toBeUndefined();
    });

    it("builds conservative filter candidates but keeps single-log filter writes explain-only", () => {
        const result = analyzeBblLog({
            summary: {
                samples: { decodedMainFrames: 1400, corruptFrames: 0, unsupportedEncodedFrames: 0, durationUs: 8_000_000 },
                fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true } },
                analysisInput: {
                    axes: {
                        roll: buildAxisSeries({
                            length: 256,
                            sampleRateHz: 1000,
                            setpointValue: 100,
                            gyroValue: 55,
                            dtermValue: 20,
                            peakHz: 180,
                            peakAmplitude: 35,
                        }),
                    },
                },
            },
            craftContext: { craftType: "freestyle", frameSize: "5寸" },
            staticConfig: {
                rates: { rates_type: 0 },
                filters: {
                    slider_gyro_filter_multiplier: 100,
                    slider_dterm_filter_multiplier: 100,
                },
            },
        });

        expect(result.writeEnvelope.filters.writeableAllowed).toBe(false);
        expect(result.writeEnvelope.filters.blockedReason).toBe("single_log_filter_evidence_requires_confirmation");
        expect(result.writeEnvelope.filters.candidates).toEqual({
            slider_gyro_filter_multiplier: expect.objectContaining({
                suggestedValue: 95,
                min: 95,
                max: 100,
                step: 1,
            }),
            slider_dterm_filter_multiplier: expect.objectContaining({
                suggestedValue: 92,
                min: 92,
                max: 100,
                step: 1,
            }),
        });
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

    it("keeps rates write envelopes explain-only when the log quality is degraded", () => {
        const result = analyzeBblLog({
            summary: {
                samples: {
                    decodedMainFrames: 1400,
                    corruptFrames: 2,
                    unsupportedEncodedFrames: 1,
                    durationUs: 8_000_000,
                },
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

        expect(result.quality.status).toBe("degraded");
        expect(result.writeEnvelope.rates.writeableAllowed).toBe(false);
        expect(result.writeEnvelope.rates.blockedReason).toBe("insufficient_rates_evidence");
        expect(result.writeEnvelope.rates.candidates).toEqual({});
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

    it("computes axis time-domain and frequency-domain advice from unified series input", () => {
        const result = analyzeBblLog({
            summary: {
                samples: {
                    decodedMainFrames: 256,
                    corruptFrames: 0,
                    unsupportedEncodedFrames: 0,
                    durationUs: 255_000,
                },
                fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true, debug: true } },
                fieldStats: {
                    motor: {
                        0: { mean: 1500, count: 256 },
                        1: { mean: 1501, count: 256 },
                        2: { mean: 1499, count: 256 },
                        3: { mean: 1500, count: 256 },
                    },
                },
                analysisInput: {
                    sourceType: "bbl",
                    craftClass: "5-6in",
                    axes: {
                        roll: buildAxisSeries({
                            length: 256,
                            sampleRateHz: 1000,
                            setpointValue: 100,
                            gyroValue: 55,
                            dtermValue: 20,
                            peakHz: 180,
                            peakAmplitude: 35,
                        }),
                    },
                },
            },
            craftContext: { craftType: "freestyle", frameSize: "5" },
        });

        expect(result.axes.roll.timeDomain).toMatchObject({
            rmsError: expect.any(Number),
            maxError: expect.any(Number),
            meanErrMoving: expect.any(Number),
            meanErrSteady: expect.any(Number),
        });
        expect(result.axes.roll.timeDomain.meanErrMoving).toBeGreaterThan(40);
        expect(result.axes.roll.timeDomain.meanErrSteady).toBeLessThan(5);
        expect(result.axes.roll.frequencyDomain).toMatchObject({
            fftUsable: true,
            sampleRateHz: expect.any(Number),
            gyroPeakFreqHz: expect.any(Number),
            gyroPeakMagnitude: expect.any(Number),
            dtermHighFreqAvg: expect.any(Number),
        });
        expect(result.axes.roll.frequencyDomain.gyroPeakFreqHz).toBeGreaterThan(160);
        expect(result.axes.roll.frequencyDomain.gyroPeakFreqHz).toBeLessThan(200);
        expect(result.axes.roll.pidAdvice).toMatchObject({
            p: expect.objectContaining({ direction: "increase" }),
            i: expect.objectContaining({ direction: "healthy" }),
            d: expect.objectContaining({ direction: "increase" }),
            ff: expect.objectContaining({ direction: expect.any(String) }),
        });
        expect(result.axes.roll.filterAdvice).toMatchObject({
            gyroNotch: expect.objectContaining({ direction: "enable" }),
            dtermLowpass: expect.objectContaining({ direction: "lower" }),
        });
        expect(result.diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "pid_time_domain" }),
                expect.objectContaining({ type: "filter_frequency_domain" }),
            ]),
        );
    });

    it("returns unusable FFT status without filter advice when the series is too short", () => {
        const result = analyzeBblLog({
            summary: {
                samples: {
                    decodedMainFrames: 40,
                    corruptFrames: 0,
                    unsupportedEncodedFrames: 0,
                    durationUs: 39_000,
                },
                fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true, debug: true } },
                fieldStats: {
                    motor: {
                        0: { mean: 1500, count: 40 },
                        1: { mean: 1500, count: 40 },
                    },
                },
                analysisInput: {
                    sourceType: "csv",
                    axes: {
                        roll: {
                            timeUs: Array.from({ length: 40 }, (_, index) => index * 1000),
                            gyro: Array.from({ length: 40 }, () => 5),
                            setpoint: Array.from({ length: 40 }, () => 10),
                        },
                    },
                },
            },
        });

        expect(result.axes.roll.frequencyDomain).toEqual({
            fftUsable: false,
            reason: "insufficient_samples",
        });
        expect(result.axes.roll.filterAdvice).toEqual({});
        expect(result.diagnostics.find((item) => item.type === "filter_frequency_domain")).toBeUndefined();
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
