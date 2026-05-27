import { describe, expect, it } from "vitest";
import { buildBblSummary } from "../../../src/js/autotune-ai/blackboxBblSummary";

function makeBblBytes(headerLines) {
    return new TextEncoder().encode(`${headerLines.map((line) => `H ${line}`).join("\n")}\nP\x00\x01\x02`);
}

function encodeUnsigned(value) {
    const bytes = [];
    let remaining = value >>> 0;
    do {
        let byte = remaining & 0x7f;
        remaining >>>= 7;
        if (remaining) {
            byte |= 0x80;
        }
        bytes.push(byte);
    } while (remaining);
    return bytes;
}

function encodeSigned(value) {
    return encodeUnsigned(value < 0 ? ((-value << 1) - 1) >>> 0 : (value << 1) >>> 0);
}

function makeBblBytesWithFrames(headerLines, frames) {
    const header = new TextEncoder().encode(`${headerLines.map((line) => `H ${line}`).join("\n")}\n`);
    return new Uint8Array([...header, ...frames.flat()]);
}

function makeIFrame(values) {
    return [0x49, ...values.flat()];
}

function makeTag8_8Svb(values) {
    let header = 0;
    const encoded = [];
    values.forEach((value, index) => {
        if (value !== 0) {
            header |= 1 << index;
            encoded.push(...encodeSigned(value));
        }
    });
    return [header, ...encoded];
}

function encodeTag2_3S32(values) {
    return [
        0xc0 | (0 << 0) | (0 << 2) | (0 << 4),
        ...values.flatMap((value) => {
            const normalized = value | 0;
            return [
                normalized & 0xff,
                (normalized >> 8) & 0xff,
                (normalized >> 16) & 0xff,
                (normalized >> 24) & 0xff,
            ];
        }),
    ];
}

function encodeTag2_3SVariable(values) {
    return encodeTag2_3S32(values);
}

function encodeTag8_4S16(values) {
    return [0xaa, ...values.map((value) => value & 0xff)];
}

describe("autotune AI generic BBL summary", () => {
    it("summarizes ordinary Blackbox BBL headers without requiring CHIRP", () => {
        const bytes = makeBblBytes([
            "Product:Blackbox flight data recorder by Nicholas Sherlock",
            "Firmware revision:Betaflight 4.5.0 TEST",
            "Firmware API version:1.46.0",
            "Data version:2",
            "looptime:125",
            "pid_process_denom:2",
            "debug_mode:0",
            "Field I name:time,gyroADC[0],gyroADC[1],gyroADC[2],setpoint[0],setpoint[1],setpoint[2],motor[0],motor[1],debug[0]",
            "Field P predictor:0,0,0,0,0,0,0,0,0,0",
            "Field P encoding:1,0,0,0,0,0,0,0,0,0",
            "Field S name:flightModeFlags,stateFlags,failsafePhase",
        ]);

        const summary = buildBblSummary({ fileName: "normal.bbl", data: bytes });

        expect(summary).toMatchObject({
            fileName: "normal.bbl",
            logCount: 1,
            selectedLogIndex: 0,
            firmware: {
                apiVersion: "1.46.0",
                revision: "Betaflight 4.5.0 TEST",
            },
            timing: {
                looptime: 125,
                pidProcessDenom: 2,
                estimatedSampleRateHz: 4000,
            },
            debug: {
                mode: 0,
                chirpRequired: false,
            },
        });
        expect(summary.fields.requiredColumns).toEqual({
            time: true,
            gyro: true,
            setpoint: true,
            debug: true,
            motor: true,
        });
        expect(summary.fields.loggedFields).toContain("gyroADC[0]");
        expect(JSON.stringify(summary)).not.toContain("P\\u0000");
    });

    it("rejects files without a Blackbox log boundary", () => {
        expect(() => buildBblSummary({ fileName: "not.bbl", data: new Uint8Array([1, 2, 3]) })).toThrow(
            /No valid Blackbox logs/u,
        );
    });

    it("decodes whitelisted main-frame fields into bounded statistics", () => {
        const header = [
            "Product:Blackbox flight data recorder by Nicholas Sherlock",
            "Firmware API version:1.46.0",
            "Data version:2",
            "looptime:1000",
            "pid_process_denom:1",
            "debug_mode:0",
            "Field I name:time,gyroADC[0],gyroADC[1],gyroADC[2],setpoint[0],setpoint[1],setpoint[2],motor[0],debug[0]",
            "Field I predictor:0,0,0,0,0,0,0,0,0",
            "Field I encoding:1,0,0,0,0,0,0,0,0",
        ];
        const data = makeBblBytesWithFrames(header, [
            makeIFrame([
                encodeUnsigned(1000),
                encodeSigned(10),
                encodeSigned(-20),
                encodeSigned(30),
                encodeSigned(100),
                encodeSigned(0),
                encodeSigned(-100),
                encodeSigned(1200),
                encodeSigned(4),
            ]),
            makeIFrame([
                encodeUnsigned(2000),
                encodeSigned(-10),
                encodeSigned(40),
                encodeSigned(50),
                encodeSigned(200),
                encodeSigned(50),
                encodeSigned(-50),
                encodeSigned(1300),
                encodeSigned(8),
            ]),
        ]);

        const summary = buildBblSummary({ fileName: "ordinary.bbl", data });

        expect(summary.samples).toMatchObject({
            decodedMainFrames: 2,
            corruptFrames: 0,
            firstTimeUs: 1000,
            lastTimeUs: 2000,
            durationUs: 1000,
        });
        expect(summary.fieldStats.gyroADC["0"]).toMatchObject({ count: 2, min: -10, max: 10, mean: 0, rms: 10 });
        expect(summary.fieldStats.gyroADC["1"]).toMatchObject({ count: 2, min: -20, max: 40, mean: 10 });
        expect(summary.fieldStats.setpoint["0"]).toMatchObject({ count: 2, min: 100, max: 200, mean: 150 });
        expect(summary.fieldStats.motor["0"]).toMatchObject({ count: 2, min: 1200, max: 1300, mean: 1250 });
        expect(summary.fieldStats.debug["0"]).toMatchObject({ count: 2, min: 4, max: 8, mean: 6 });
        expect(JSON.stringify(summary)).not.toContain("raw");
    });

    it("decodes TAG8_8SVB grouped fields used by ordinary Blackbox logs", () => {
        const header = [
            "Product:Blackbox flight data recorder by Nicholas Sherlock",
            "Data version:2",
            "looptime:1000",
            "pid_process_denom:1",
            "debug_mode:0",
            "Field I name:time,gyroADC[0],gyroADC[1],gyroADC[2],setpoint[0],setpoint[1],setpoint[2],motor[0]",
            "Field I predictor:0,0,0,0,0,0,0,0",
            "Field I encoding:1,6,6,6,6,6,6,0",
        ];
        const data = makeBblBytesWithFrames(header, [
            makeIFrame([encodeUnsigned(1000), makeTag8_8Svb([10, 0, -20, 30, 0, -40]), encodeSigned(1200)]),
        ]);

        const summary = buildBblSummary({ fileName: "tag8.bbl", data });

        expect(summary.samples.decodedMainFrames).toBe(1);
        expect(summary.samples.corruptFrames).toBe(0);
        expect(summary.fieldStats.gyroADC["0"]).toMatchObject({ count: 1, min: 10, max: 10 });
        expect(summary.fieldStats.gyroADC["1"]).toMatchObject({ count: 1, min: 0, max: 0 });
        expect(summary.fieldStats.gyroADC["2"]).toMatchObject({ count: 1, min: -20, max: -20 });
        expect(summary.fieldStats.setpoint["0"]).toMatchObject({ count: 1, min: 30, max: 30 });
        expect(summary.fieldStats.setpoint["2"]).toMatchObject({ count: 1, min: -40, max: -40 });
    });

    it("tracks unsupported encoded frames separately from corrupt frames", () => {
        const header = [
            "Product:Blackbox flight data recorder by Nicholas Sherlock",
            "Data version:2",
            "Field I name:time,gyroADC[0],gyroADC[1],gyroADC[2]",
            "Field I predictor:0,0,0,0",
            "Field I encoding:1,99,99,99",
        ];
        const data = makeBblBytesWithFrames(header, [makeIFrame([encodeUnsigned(1000), 0x00, 0x00, 0x00])]);

        const summary = buildBblSummary({ fileName: "unsupported.bbl", data });

        expect(summary.samples.decodedMainFrames).toBe(0);
        expect(summary.samples.corruptFrames).toBe(0);
        expect(summary.samples.unsupportedEncodedFrames).toBe(1);
    });

    it("decodes TAG2_3S32, TAG8_4S16, and TAG2_3SVARIABLE grouped fields in ordinary BBL logs", () => {
        const header = [
            "Product:Blackbox flight data recorder by Nicholas Sherlock",
            "Data version:2",
            "Field I name:time,gyroADC[0],gyroADC[1],gyroADC[2],setpoint[0],setpoint[1],setpoint[2],motor[0],debug[0],debug[1],debug[2]",
            "Field I predictor:0,0,0,0,0,0,0,0,0,0,0",
            "Field I encoding:1,7,7,7,8,8,8,8,10,10,10",
        ];
        const data = makeBblBytesWithFrames(header, [
            makeIFrame([
                encodeUnsigned(1000),
                encodeTag2_3S32([10, -20, 30]),
                encodeTag8_4S16([40, -50, 60, 70]),
                encodeTag2_3SVariable([5, -6, 7]),
            ]),
        ]);

        const summary = buildBblSummary({ fileName: "grouped.bbl", data });

        expect(summary.samples.decodedMainFrames).toBe(1);
        expect(summary.samples.corruptFrames).toBe(0);
        expect(summary.samples.unsupportedEncodedFrames).toBe(0);
        expect(summary.fieldStats.gyroADC["0"]).toMatchObject({ count: 1, min: 10, max: 10 });
        expect(summary.fieldStats.gyroADC["1"]).toMatchObject({ count: 1, min: -20, max: -20 });
        expect(summary.fieldStats.gyroADC["2"]).toMatchObject({ count: 1, min: 30, max: 30 });
        expect(summary.fieldStats.setpoint["0"]).toMatchObject({ count: 1, min: 40, max: 40 });
        expect(summary.fieldStats.setpoint["1"]).toMatchObject({ count: 1, min: -50, max: -50 });
        expect(summary.fieldStats.setpoint["2"]).toMatchObject({ count: 1, min: 60, max: 60 });
        expect(summary.fieldStats.motor["0"]).toMatchObject({ count: 1, min: 70, max: 70 });
        expect(summary.fieldStats.debug["0"]).toMatchObject({ count: 1, min: 5, max: 5 });
        expect(summary.fieldStats.debug["1"]).toMatchObject({ count: 1, min: -6, max: -6 });
        expect(summary.fieldStats.debug["2"]).toMatchObject({ count: 1, min: 7, max: 7 });
    });

    it("selects the log segment with the most decoded main frames", () => {
        const first = [
            "Product:Blackbox flight data recorder by Nicholas Sherlock",
            "Data version:2",
            "Field I name:time,gyroADC[0]",
            "Field I predictor:0,0",
            "Field I encoding:1,0",
        ];
        const second = [
            "Product:Blackbox flight data recorder by Nicholas Sherlock",
            "Data version:2",
            "Field I name:time,gyroADC[0]",
            "Field I predictor:0,0",
            "Field I encoding:1,0",
        ];
        const data = makeBblBytesWithFrames(first, [makeIFrame([encodeUnsigned(1000), encodeSigned(1)])]);
        const appended = makeBblBytesWithFrames(second, [
            makeIFrame([encodeUnsigned(2000), encodeSigned(2)]),
            makeIFrame([encodeUnsigned(3000), encodeSigned(4)]),
        ]);
        const combined = new Uint8Array([...data, ...appended]);

        const summary = buildBblSummary({ fileName: "multi.bbl", data: combined });

        expect(summary.logCount).toBe(2);
        expect(summary.selectedLogIndex).toBe(1);
        expect(summary.samples.decodedMainFrames).toBe(2);
        expect(summary.fieldStats.gyroADC["0"]).toMatchObject({ min: 2, max: 4, mean: 3 });
    });

    it("caps decoded frames to keep large BBL imports bounded", () => {
        const header = [
            "Product:Blackbox flight data recorder by Nicholas Sherlock",
            "Data version:2",
            "Field I name:time,gyroADC[0]",
            "Field I predictor:0,0",
            "Field I encoding:1,0",
        ];
        const frames = Array.from({ length: 5 }, (_, index) =>
            makeIFrame([encodeUnsigned((index + 1) * 1000), encodeSigned(index + 1)]),
        );
        const data = makeBblBytesWithFrames(header, frames);

        const summary = buildBblSummary({ fileName: "capped.bbl", data, maxDecodedFrames: 3 });

        expect(summary.samples.decodedMainFrames).toBe(3);
        expect(summary.samples.truncated).toBe(true);
        expect(summary.samples.maxDecodedFrames).toBe(3);
        expect(summary.fieldStats.gyroADC["0"]).toMatchObject({ count: 3, min: 1, max: 3 });
    });

    it("allows callers to select a specific log segment for BBL management", () => {
        const first = [
            "Product:Blackbox flight data recorder by Nicholas Sherlock",
            "Data version:2",
            "Field I name:time,gyroADC[0]",
            "Field I predictor:0,0",
            "Field I encoding:1,0",
        ];
        const second = [
            "Product:Blackbox flight data recorder by Nicholas Sherlock",
            "Data version:2",
            "Field I name:time,gyroADC[0]",
            "Field I predictor:0,0",
            "Field I encoding:1,0",
        ];
        const data = new Uint8Array([
            ...makeBblBytesWithFrames(first, [makeIFrame([encodeUnsigned(1000), encodeSigned(1)])]),
            ...makeBblBytesWithFrames(second, [
                makeIFrame([encodeUnsigned(2000), encodeSigned(2)]),
                makeIFrame([encodeUnsigned(3000), encodeSigned(4)]),
            ]),
        ]);

        const summary = buildBblSummary({ fileName: "multi.bbl", data, selectedLogIndex: 0 });

        expect(summary.selectedLogIndex).toBe(0);
        expect(summary.availableLogs).toHaveLength(2);
        expect(summary.availableLogs[0]).toMatchObject({ index: 0, decodedMainFrames: 1 });
        expect(summary.availableLogs[1]).toMatchObject({ index: 1, decodedMainFrames: 2 });
        expect(summary.fieldStats.gyroADC["0"]).toMatchObject({ min: 1, max: 1 });
    });
});
