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
\`\`\``);

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
});
