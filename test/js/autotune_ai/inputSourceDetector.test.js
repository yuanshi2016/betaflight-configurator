import { describe, expect, it } from "vitest";
import {
    buildInputSourceSummary,
    buildCsvSummary,
    detectAutotuneInputSource,
} from "../../../src/js/autotune-ai/inputSourceDetector";

describe("autotune AI input source detector", () => {
    it("detects CLI dump or diff text and returns a parsed CLI summary", () => {
        const text = `
# diff all
profile 0
rateprofile 0
set p_pitch = 58
set dyn_notch_count = 3
`;

        expect(detectAutotuneInputSource({ fileName: "dump.txt", text })).toBe("cli");

        const summary = buildInputSourceSummary({ fileName: "dump.txt", text });

        expect(summary.type).toBe("cli");
        expect(summary.cliSummary.pid.p_pitch).toBe(58);
        expect(summary.cliSummary.filters.dyn_notch_count).toBe(3);
        expect(summary.csvSummary).toBeNull();
    });

    it("detects Betaflight Blackbox CSV exports and returns only compact metadata", () => {
        const text = [
            "time (us),gyroADC[0],gyroADC[1],setpoint[0],debug[0],debug[1]",
            "1000,1,2,3,4,5",
            "2000,2,3,4,5,6",
        ].join("\n");

        expect(detectAutotuneInputSource({ fileName: "flight.csv", text })).toBe("csv");

        const summary = buildCsvSummary({ fileName: "flight.csv", text });

        expect(summary.fileName).toBe("flight.csv");
        expect(summary.rowCountEstimate).toBe(2);
        expect(summary.columns).toEqual(["time (us)", "gyroADC[0]", "gyroADC[1]", "setpoint[0]", "debug[0]", "debug[1]"]);
        expect(summary.requiredColumns).toEqual({
            time: true,
            gyro: true,
            setpoint: true,
            debug: true,
            dterm: true,
        });
        expect(JSON.stringify(summary)).not.toContain("1000,1,2,3,4,5");
    });

    it("parses CSV axis series with cleaned quotes, whitespace, and invalid-row filtering", () => {
        const text = [
            '" time "," gyroADC[0] ","axisRate[0]"," pidD[0] "',
            '"1000"," 10 "," 40 "," 7 "',
            '"2000","bad","41","8"',
            '"3000","12"," 42 "," 9 "',
        ].join("\n");

        const summary = buildCsvSummary({ fileName: "flight.csv", text });

        expect(summary.requiredColumns).toEqual({
            time: true,
            gyro: true,
            setpoint: true,
            debug: false,
            dterm: true,
        });
        expect(summary.analysisInput).toMatchObject({
            sourceType: "csv",
            axes: {
                roll: {
                    timeUs: [1000, 3000],
                    gyro: [10, 12],
                    setpoint: [40, 42],
                    dterm: [7, 9],
                },
            },
        });
        expect(summary.analysisInput.axes.pitch).toBeUndefined();
        expect(summary.analysisInput.axes.yaw).toBeUndefined();
    });

    it("rejects unknown input files instead of guessing", () => {
        expect(detectAutotuneInputSource({ fileName: "notes.md", text: "just some notes" })).toBe("unknown");
        expect(() => buildInputSourceSummary({ fileName: "notes.md", text: "just some notes" })).toThrow(
            /Unsupported autotune input file/u,
        );
    });

    it("accepts binary BBL files as a generic Blackbox source", () => {
        expect(detectAutotuneInputSource({ fileName: "flight.bbl" })).toBe("bbl");
    });
});
