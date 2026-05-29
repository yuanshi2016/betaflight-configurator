import { describe, expect, it } from "vitest";
import { parseAiResponse } from "../../../src/js/autotune-ai/responseParser";

describe("autotune AI response parser", () => {
    it("normalizes allowed groups and removes untrusted fields", () => {
        const parsed = parseAiResponse(`\`\`\`json
{
  "summary": "Reduce filter delay.",
  "overallRisk": "medium",
  "groups": {
    "pid": {
      "writeable": true,
      "confidence": "high",
      "explanation": "Use sliders.",
      "values": {
        "slider_master_multiplier": 105,
        "FC.PIDS": [1, 2, 3],
        "cli": "set p_pitch = 90"
      }
    },
    "filters": {
      "writeable": true,
      "confidence": "medium",
      "explanation": "Slightly less filtering.",
      "values": { "slider_gyro_filter_multiplier": 95, "dyn_notch_count": 4 }
    },
    "rates": {
      "writeable": true,
      "confidence": "low",
      "explanation": "Pilot feel.",
      "values": { "roll_rate": 75, "rates_type": 1 }
    },
    "motors": { "writeable": true, "values": { "motor_output_limit": 90 } }
  },
  "flightTestNotes": "Short hover, then propwash checks.",
  "unknown": "ignored"
}
\`\`\``, {
            localAnalysis: {
                aggregateQuality: {
                    status: "usable",
                },
                writeEnvelope: {
                    pid: {
                        writeableAllowed: true,
                        blockedReason: "",
                        confidence: "high",
                        candidates: {
                            slider_master_multiplier: {
                                suggestedValue: 105,
                                min: 100,
                                max: 110,
                                step: 1,
                                reason: "pid balance",
                            },
                        },
                    },
                    filters: {
                        writeableAllowed: true,
                        blockedReason: "",
                        confidence: "medium",
                        candidates: {
                            slider_gyro_filter_multiplier: {
                                suggestedValue: 95,
                                min: 90,
                                max: 100,
                                step: 1,
                                reason: "filter delay",
                            },
                        },
                    },
                    rates: {
                        writeableAllowed: true,
                        blockedReason: "",
                        confidence: "low",
                        candidates: {
                            roll_rate: {
                                suggestedValue: 75,
                                min: 70,
                                max: 80,
                                step: 1,
                                reason: "pilot feel",
                            },
                        },
                    },
                },
            },
        });

        expect(parsed.summary).toBe("Reduce filter delay.");
        expect(parsed.overallRisk).toBe("medium");
        expect(parsed.groups.pid.values).toEqual({ slider_master_multiplier: 105 });
        expect(parsed.groups.filters.values).toEqual({ slider_gyro_filter_multiplier: 95 });
        expect(parsed.groups.rates.values).toEqual({ roll_rate: 75 });
        expect(parsed.groups.motors).toBeUndefined();
        expect(parsed.flightTestNotes).toContain("propwash");
    });

    it("throws a clear error for invalid JSON", () => {
        expect(() => parseAiResponse("not json")).toThrow("AI response was not valid JSON");
    });

    it("treats non-boolean writeable values as false", () => {
        const parsed = parseAiResponse(
            JSON.stringify({
                summary: "Lower rates.",
                overallRisk: "medium",
                groups: {
                    rates: {
                        writeable: "true",
                        confidence: "medium",
                        explanation: "String writeable must not pass.",
                        values: {
                            roll_rate: 75,
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
                                roll_rate: {
                                    suggestedValue: 75,
                                    min: 70,
                                    max: 80,
                                    step: 1,
                                    reason: "runtime low usage",
                                },
                            },
                        },
                    },
                },
            },
        );

        expect(parsed.groups.rates.writeable).toBe(false);
        expect(parsed.groups.rates.values).toEqual({ roll_rate: 75 });
    });

    it("skips envelope reconciliation when localAnalysis is usable but no writeEnvelope exists", () => {
        const parsed = parseAiResponse(
            JSON.stringify({
                summary: "Leave rates alone.",
                overallRisk: "medium",
                groups: {
                    rates: {
                        writeable: true,
                        confidence: "medium",
                        explanation: "No envelope present.",
                        values: {
                            roll_rate: 75,
                        },
                    },
                },
            }),
            {
                localAnalysis: {
                    aggregateQuality: { status: "usable" },
                },
            },
        );

        expect(parsed.groups.rates.writeable).toBe(true);
        expect(parsed.groups.rates.values).toEqual({ roll_rate: 75 });
    });

    it("forces recommendation groups non-writeable when local bbl evidence is missing", () => {
        const parsed = parseAiResponse(
            JSON.stringify({
                summary: "Lower rates.",
                overallRisk: "medium",
                groups: {
                    pid: {
                        writeable: true,
                        confidence: "high",
                        explanation: "Template guess.",
                        values: {
                            slider_master_multiplier: 90,
                        },
                    },
                    rates: {
                        writeable: true,
                        confidence: "medium",
                        explanation: "Lower rates.",
                        values: {
                            roll_rate_limit: 800,
                        },
                    },
                },
            }),
            {
                localAnalysis: undefined,
            },
        );

        expect(parsed.groups.pid.writeable).toBe(false);
        expect(parsed.groups.rates.writeable).toBe(false);
        expect(parsed.groups.pid.explanation).toContain("Local BBL evidence is missing");
    });

    it("forces recommendation groups non-writeable when local bbl quality is degraded or unusable", () => {
        const parsed = parseAiResponse(
            JSON.stringify({
                summary: "Enable more filtering.",
                overallRisk: "medium",
                groups: {
                    filters: {
                        writeable: true,
                        confidence: "high",
                        explanation: "Use stronger filtering.",
                        values: {
                            slider_gyro_filter_multiplier: 80,
                        },
                    },
                },
            }),
            {
                localAnalysis: {
                    aggregateQuality: {
                        status: "degraded",
                        reason: "includes_unusable_logs",
                    },
                },
            },
        );

        expect(parsed.groups.filters.writeable).toBe(false);
        expect(parsed.groups.filters.explanation).toContain("Local BBL evidence is degraded");
    });

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
                                roll_rate: {
                                    suggestedValue: 90,
                                    min: 90,
                                    max: 95,
                                    step: 1,
                                    reason: "runtime low usage",
                                },
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
                                slider_dterm_filter_multiplier: {
                                    suggestedValue: 92,
                                    min: 92,
                                    max: 95,
                                    step: 1,
                                    reason: "fft evidence",
                                },
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

    it("exposes an effectivePlan with reconciled groups for successful parses", () => {
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
                            roll_rate: 90,
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
                                roll_rate: {
                                    suggestedValue: 90,
                                    min: 90,
                                    max: 95,
                                    step: 1,
                                    reason: "runtime low usage",
                                },
                            },
                        },
                    },
                },
            },
        );

        expect(parsed.groups.rates.writeable).toBe(true);
        expect(parsed.groups.rates.values).toEqual({ roll_rate: 90 });
        expect(parsed.effectivePlan).toEqual({
            groups: {
                rates: parsed.groups.rates,
            },
        });
    });
});
