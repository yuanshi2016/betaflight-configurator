const LOG_BOUNDARY = "H Product:Blackbox flight data recorder by Nicholas Sherlock";

const HEADER_KEYS = {
    firmwareRevision: "Firmware revision",
    firmwareApiVersion: "Firmware API version",
    dataVersion: "Data version",
    looptime: "looptime",
    pidProcessDenom: "pid_process_denom",
    debugMode: "debug_mode",
    blackboxHighResolution: "blackbox_high_resolution",
};

const FRAME_TYPE_I = 0x49;
const FRAME_TYPE_P = 0x50;
const FRAME_TYPE_E = 0x45;
const FRAME_TYPE_G = 0x47;
const FRAME_TYPE_H = 0x48;

const ENCODING_SIGNED_VB = 0;
const ENCODING_UNSIGNED_VB = 1;
const ENCODING_NEG_14BIT = 3;
const ENCODING_TAG8_8SVB = 6;
const ENCODING_TAG2_3S32 = 7;
const ENCODING_TAG8_4S16 = 8;
const ENCODING_NULL = 9;
const ENCODING_TAG2_3SVARIABLE = 10;

const DEFAULT_MAX_DECODED_FRAMES = 20000;

const PREDICTOR_0 = 0;
const PREDICTOR_PREVIOUS = 1;
const PREDICTOR_STRAIGHT_LINE = 2;
const PREDICTOR_AVERAGE_2 = 3;
const PREDICTOR_MINTHROTTLE = 4;
const PREDICTOR_MOTOR_0 = 5;
const PREDICTOR_INC = 6;
const PREDICTOR_1500 = 8;
const PREDICTOR_VBATREF = 9;
const PREDICTOR_LAST_MAIN_FRAME_TIME = 10;
const PREDICTOR_MINMOTOR = 11;

function asciiNeedle(text) {
    return new TextEncoder().encode(text);
}

function findBytes(data, needle, startFrom = 0) {
    for (let index = startFrom; index <= data.length - needle.length; index += 1) {
        if (data[index] !== needle[0]) {
            continue;
        }

        let found = true;
        for (let offset = 1; offset < needle.length; offset += 1) {
            if (data[index + offset] !== needle[offset]) {
                found = false;
                break;
            }
        }
        if (found) {
            return index;
        }
    }

    return -1;
}

function findLogBoundaries(data) {
    const needle = asciiNeedle(LOG_BOUNDARY);
    const boundaries = [];
    let offset = 0;

    while (offset < data.length) {
        const start = findBytes(data, needle, offset);
        if (start === -1) {
            break;
        }

        const nextStart = findBytes(data, needle, start + needle.length);
        const end = nextStart === -1 ? data.length : nextStart;
        boundaries.push({ start, end });
        offset = end;
    }

    return boundaries;
}

function parseHeaderText(data, start, end) {
    const bytes = [];
    let index = start;

    while (index < end) {
        if (data[index] !== 0x48 || data[index + 1] !== 0x20) {
            break;
        }

        while (index < end) {
            const byte = data[index];
            bytes.push(byte);
            index += 1;
            if (byte === 0x0a) {
                break;
            }
        }
    }

    return new TextDecoder().decode(new Uint8Array(bytes));
}

function parseHeaderLines(headerText) {
    const headers = {};
    const frameFields = { I: [], P: [], S: [] };
    const frameDefs = {
        I: { name: [], predictor: [], encoding: [], count: 0 },
        P: { name: [], predictor: [], encoding: [], count: 0 },
        S: { name: [], predictor: [], encoding: [], count: 0 },
    };

    String(headerText || "")
        .split(/\r?\n/u)
        .forEach((rawLine) => {
            const line = rawLine.startsWith("H ") ? rawLine.slice(2) : rawLine;
            const colonIndex = line.indexOf(":");
            if (colonIndex === -1) {
                return;
            }

            const key = line.slice(0, colonIndex);
            const value = line.slice(colonIndex + 1);
            const fieldMatch = key.match(/^Field ([IPS]) (\w+)$/u);
            if (fieldMatch) {
                const [, frameType, property] = fieldMatch;
                const parts = value.split(",").filter((part) => part !== "");
                if (property === "name") {
                    frameFields[frameType] = parts;
                    frameDefs[frameType].name = parts;
                    frameDefs[frameType].count = parts.length;
                } else if (property === "predictor" || property === "encoding") {
                    frameDefs[frameType][property] = parts.map(Number);
                }
                return;
            }

            headers[key] = value.trim();
        });

    if (!frameDefs.P.name.length) {
        frameDefs.P.name = frameDefs.I.name;
        frameDefs.P.count = frameDefs.I.count;
    }
    if (!frameDefs.P.predictor.length) {
        frameDefs.P.predictor = frameDefs.I.predictor;
    }
    if (!frameDefs.P.encoding.length) {
        frameDefs.P.encoding = frameDefs.I.encoding;
    }

    return { headers, frameFields, frameDefs };
}

function toInt(value, fallback = null) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function hasIndexedField(fields, prefix) {
    return fields.some((field) => field === prefix || field.startsWith(`${prefix}[`));
}

function summarizeFields(frameFields) {
    const loggedFields = frameFields.I || [];

    return {
        loggedFields,
        stateFields: frameFields.S || [],
        requiredColumns: {
            time: loggedFields.includes("time"),
            gyro: hasIndexedField(loggedFields, "gyroADC"),
            setpoint: hasIndexedField(loggedFields, "setpoint"),
            debug: hasIndexedField(loggedFields, "debug"),
            motor: hasIndexedField(loggedFields, "motor"),
        },
    };
}

function estimateSampleRate(headers) {
    const looptime = toInt(headers[HEADER_KEYS.looptime]);
    const pidProcessDenom = toInt(headers[HEADER_KEYS.pidProcessDenom], 1);
    if (!looptime || !pidProcessDenom) {
        return null;
    }

    return Math.round(1e6 / (looptime * pidProcessDenom));
}

function readUnsignedVB(data, state) {
    let shift = 0;
    let result = 0;

    for (let index = 0; index < 5 && state.pos < state.end; index += 1) {
        const byte = data[state.pos];
        state.pos += 1;
        result |= (byte & 0x7f) << shift;
        if (byte < 128) {
            return result >>> 0;
        }
        shift += 7;
    }

    return 0;
}

function readSignedVB(data, state) {
    const unsigned = readUnsignedVB(data, state);
    return (unsigned >>> 1) ^ -(unsigned & 1);
}

function signExtend14Bit(word) {
    return word & 0x2000 ? word | 0xffffc000 : word;
}

function signExtend(word, bits) {
    const shift = 32 - bits;
    return (word << shift) >> shift;
}

function consecutiveEncodingRun(frameDef, index, encoding) {
    let count = 0;
    while (index + count < frameDef.count && frameDef.encoding[index + count] === encoding) {
        count += 1;
    }
    return count;
}

function readTag8_8Svb(data, state, count) {
    const values = new Array(count).fill(0);
    if (count === 1) {
        values[0] = readSignedVB(data, state);
        return values;
    }

    let header = data[state.pos] || 0;
    state.pos += 1;
    for (let index = 0; index < count; index += 1, header >>= 1) {
        values[index] = header & 0x01 ? readSignedVB(data, state) : 0;
    }
    return values;
}

function readTag2_3S_case3(data, state, values, leadByte) {
    for (let index = 0; index < 3; index += 1) {
        switch (leadByte & 0x03) {
            case 0:
                values[index] = signExtend(data[state.pos], 8);
                state.pos += 1;
                break;
            case 1: {
                const word = data[state.pos] | (data[state.pos + 1] << 8);
                values[index] = signExtend(word, 16);
                state.pos += 2;
                break;
            }
            case 2: {
                const word = data[state.pos] | (data[state.pos + 1] << 8) | (data[state.pos + 2] << 16);
                values[index] = signExtend(word, 24);
                state.pos += 3;
                break;
            }
            case 3: {
                const word =
                    data[state.pos] |
                    (data[state.pos + 1] << 8) |
                    (data[state.pos + 2] << 16) |
                    (data[state.pos + 3] << 24);
                values[index] = word;
                state.pos += 4;
                break;
            }
        }
        leadByte >>= 2;
    }
}

function readTag2_3S32(data, state) {
    const values = [0, 0, 0];
    let leadByte = data[state.pos];
    state.pos += 1;

    switch (leadByte >> 6) {
        case 0:
            values[0] = signExtend((leadByte >> 4) & 0x03, 2);
            values[1] = signExtend((leadByte >> 2) & 0x03, 2);
            values[2] = signExtend(leadByte & 0x03, 2);
            break;
        case 1:
            values[0] = signExtend(leadByte & 0x0f, 4);
            leadByte = data[state.pos];
            state.pos += 1;
            values[1] = signExtend(leadByte >> 4, 4);
            values[2] = signExtend(leadByte & 0x0f, 4);
            break;
        case 2:
            values[0] = signExtend(leadByte & 0x3f, 6);
            values[1] = signExtend(data[state.pos] & 0x3f, 6);
            state.pos += 1;
            values[2] = signExtend(data[state.pos] & 0x3f, 6);
            state.pos += 1;
            break;
        case 3:
            readTag2_3S_case3(data, state, values, leadByte);
            break;
    }

    return values;
}

function readTag2_3SVariable(data, state) {
    const values = [0, 0, 0];
    let leadByte = data[state.pos];
    state.pos += 1;

    switch (leadByte >> 6) {
        case 0:
            values[0] = signExtend((leadByte >> 4) & 0x03, 2);
            values[1] = signExtend((leadByte >> 2) & 0x03, 2);
            values[2] = signExtend(leadByte & 0x03, 2);
            break;
        case 1: {
            values[0] = signExtend((leadByte & 0x3e) >> 1, 5);
            const leadByte2 = data[state.pos];
            state.pos += 1;
            values[1] = signExtend(((leadByte & 0x01) << 4) | ((leadByte2 & 0xf0) >> 4), 5);
            values[2] = signExtend(leadByte2 & 0x0f, 4);
            break;
        }
        case 2: {
            const leadByte2 = data[state.pos];
            state.pos += 1;
            values[0] = signExtend(((leadByte & 0x3f) << 2) | ((leadByte2 & 0xc0) >> 6), 8);
            const leadByte3 = data[state.pos];
            state.pos += 1;
            values[1] = signExtend(((leadByte2 & 0x3f) << 1) | ((leadByte3 & 0x80) >> 7), 7);
            values[2] = signExtend(leadByte3 & 0x7f, 7);
            break;
        }
        case 3:
            readTag2_3S_case3(data, state, values, leadByte);
            break;
    }

    return values;
}

function readTag8_4S16_v1(data, state) {
    const values = [0, 0, 0, 0];
    let selector = data[state.pos];
    state.pos += 1;

    for (let index = 0; index < 4; index += 1) {
        switch (selector & 0x03) {
            case 0:
                values[index] = 0;
                break;
            case 1: {
                const combinedChar = data[state.pos];
                state.pos += 1;
                values[index] = signExtend(combinedChar & 0x0f, 4);
                index += 1;
                selector >>= 2;
                if (index < 4) {
                    values[index] = signExtend(combinedChar >> 4, 4);
                }
                break;
            }
            case 2:
                values[index] = signExtend(data[state.pos], 8);
                state.pos += 1;
                break;
            case 3: {
                const word = data[state.pos] | (data[state.pos + 1] << 8);
                values[index] = signExtend(word, 16);
                state.pos += 2;
                break;
            }
        }
        selector >>= 2;
    }

    return values;
}

function readTag8_4S16_v2(data, state) {
    const values = [0, 0, 0, 0];
    let selector = data[state.pos];
    state.pos += 1;
    let nibbleIndex = 0;
    let buffer = 0;

    for (let index = 0; index < 4; index += 1) {
        switch (selector & 0x03) {
            case 0:
                values[index] = 0;
                break;
            case 1:
                if (nibbleIndex === 0) {
                    buffer = data[state.pos];
                    state.pos += 1;
                    values[index] = signExtend(buffer >> 4, 4);
                    nibbleIndex = 1;
                } else {
                    values[index] = signExtend(buffer & 0x0f, 4);
                    nibbleIndex = 0;
                }
                break;
            case 2:
                if (nibbleIndex === 0) {
                    values[index] = signExtend(data[state.pos], 8);
                    state.pos += 1;
                } else {
                    let byte = (buffer & 0x0f) << 4;
                    buffer = data[state.pos];
                    state.pos += 1;
                    byte |= buffer >> 4;
                    values[index] = signExtend(byte, 8);
                }
                break;
            case 3:
                if (nibbleIndex === 0) {
                    const word = (data[state.pos] << 8) | data[state.pos + 1];
                    values[index] = signExtend(word, 16);
                    state.pos += 2;
                } else {
                    const byte1 = data[state.pos];
                    const byte2 = data[state.pos + 1];
                    values[index] = signExtend(((buffer & 0x0f) << 12) | (byte1 << 4) | (byte2 >> 4), 16);
                    buffer = byte2;
                    state.pos += 2;
                }
                break;
        }
        selector >>= 2;
    }

    return values;
}

function makeUnsupportedEncodingError(encoding) {
    const error = new Error(`Unsupported Blackbox field encoding: ${encoding}`);
    error.code = "UNSUPPORTED_ENCODING";
    return error;
}

function readFieldValue(data, state, encoding, dataVersion = 2) {
    switch (encoding) {
        case ENCODING_SIGNED_VB:
            return readSignedVB(data, state);
        case ENCODING_UNSIGNED_VB:
            return readUnsignedVB(data, state);
        case ENCODING_NEG_14BIT:
            return -signExtend14Bit(readUnsignedVB(data, state));
        case ENCODING_TAG2_3S32:
            return readTag2_3S32(data, state);
        case ENCODING_TAG8_4S16:
            return dataVersion >= 2 ? readTag8_4S16_v2(data, state) : readTag8_4S16_v1(data, state);
        case ENCODING_TAG8_8SVB:
            return readTag8_8Svb(data, state, 1)[0];
        case ENCODING_TAG2_3SVARIABLE:
            return readTag2_3SVariable(data, state);
        case ENCODING_NULL:
            return 0;
        default:
            throw makeUnsupportedEncodingError(encoding);
    }
}

function applyPrediction(fieldIndex, predictor, raw, current, previous, previous2, sysConfig, motor0Index, lastMainFrameTime) {
    switch (predictor) {
        case PREDICTOR_0:
            return raw;
        case PREDICTOR_PREVIOUS:
            return raw + (previous ? previous[fieldIndex] : 0);
        case PREDICTOR_STRAIGHT_LINE:
            if (previous && previous2) {
                return raw + 2 * previous[fieldIndex] - previous2[fieldIndex];
            }
            return raw + (previous ? previous[fieldIndex] : 0);
        case PREDICTOR_AVERAGE_2:
            if (previous && previous2) {
                return raw + Math.trunc((previous[fieldIndex] + previous2[fieldIndex]) / 2);
            }
            return raw + (previous ? previous[fieldIndex] : 0);
        case PREDICTOR_MINTHROTTLE:
            return raw + sysConfig.minthrottle;
        case PREDICTOR_MOTOR_0:
            return raw + (motor0Index >= 0 ? current[motor0Index] : 0);
        case PREDICTOR_INC:
            return (previous ? previous[fieldIndex] : 0) + 1;
        case PREDICTOR_1500:
            return raw + 1500;
        case PREDICTOR_VBATREF:
            return raw + sysConfig.vbatref;
        case PREDICTOR_LAST_MAIN_FRAME_TIME:
            return raw + lastMainFrameTime;
        case PREDICTOR_MINMOTOR:
            return raw + sysConfig.motorOutputMin;
        default:
            return raw;
    }
}

function decodeFrame(data, state, frameDef, previous, previous2, sysConfig, motor0Index, lastMainFrameTime) {
    if (!frameDef?.count) {
        return null;
    }

    const current = new Int32Array(frameDef.count);
    for (let index = 0; index < frameDef.count; index += 1) {
        const predictor = frameDef.predictor[index] ?? PREDICTOR_0;
        if (predictor === PREDICTOR_INC) {
            current[index] = (previous ? previous[index] : 0) + 1;
            continue;
        }

        const encoding = frameDef.encoding[index] ?? ENCODING_SIGNED_VB;
        if (
            encoding === ENCODING_TAG8_8SVB ||
            encoding === ENCODING_TAG2_3S32 ||
            encoding === ENCODING_TAG8_4S16 ||
            encoding === ENCODING_TAG2_3SVARIABLE
        ) {
            const groupSize =
                encoding === ENCODING_TAG8_8SVB
                    ? Math.min(consecutiveEncodingRun(frameDef, index, ENCODING_TAG8_8SVB), 8)
                    : Math.min(
                          consecutiveEncodingRun(frameDef, index, encoding),
                          encoding === ENCODING_TAG8_4S16 ? 4 : 3,
                      );
            const rawGroup = readFieldValue(data, state, encoding, sysConfig.dataVersion);
            const rawValues = Array.isArray(rawGroup) ? rawGroup : [rawGroup];
            for (let groupIndex = 0; groupIndex < groupSize; groupIndex += 1) {
                const fieldIndex = index + groupIndex;
                current[fieldIndex] = applyPrediction(
                    fieldIndex,
                    frameDef.predictor[fieldIndex] ?? PREDICTOR_0,
                    rawValues[groupIndex],
                    current,
                    previous,
                    previous2,
                    sysConfig,
                    motor0Index,
                    lastMainFrameTime,
                );
            }
            index += groupSize - 1;
            continue;
        }

        const raw = readFieldValue(data, state, encoding, sysConfig.dataVersion);
        current[index] = applyPrediction(
            index,
            predictor,
            raw,
            current,
            previous,
            previous2,
            sysConfig,
            motor0Index,
            lastMainFrameTime,
        );
    }

    return current;
}

function decodeFrameWithStatus(data, state, frameDef, previous, previous2, sysConfig, motor0Index, lastMainFrameTime) {
    try {
        return {
            frame: decodeFrame(data, state, frameDef, previous, previous2, sysConfig, motor0Index, lastMainFrameTime),
            unsupported: false,
        };
    } catch (error) {
        if (error?.code === "UNSUPPORTED_ENCODING") {
            return { frame: null, unsupported: true };
        }
        throw error;
    }
}

function createAccumulator() {
    return { count: 0, min: Infinity, max: -Infinity, sum: 0, sumSquares: 0 };
}

function addStat(stats, group, axis, value) {
    if (!stats[group]) {
        stats[group] = {};
    }
    const key = String(axis);
    if (!stats[group][key]) {
        stats[group][key] = createAccumulator();
    }

    const stat = stats[group][key];
    stat.count += 1;
    stat.min = Math.min(stat.min, value);
    stat.max = Math.max(stat.max, value);
    stat.sum += value;
    stat.sumSquares += value * value;
}

function normalizeStats(stats) {
    return Object.fromEntries(
        Object.entries(stats).map(([group, groupStats]) => [
            group,
            Object.fromEntries(
                Object.entries(groupStats).map(([axis, stat]) => [
                    axis,
                    {
                        count: stat.count,
                        min: stat.min,
                        max: stat.max,
                        mean: stat.count ? stat.sum / stat.count : 0,
                        rms: stat.count ? Math.sqrt(stat.sumSquares / stat.count) : 0,
                    },
                ]),
            ),
        ]),
    );
}

function parseIndexedFieldName(name) {
    const match = String(name || "").match(/^(gyroADC|setpoint|motor|debug)\[(\d+)\]$/u);
    if (!match) {
        return null;
    }
    return { group: match[1], axis: match[2] };
}

function collectFrameStats(frame, frameDef, stats) {
    frameDef.name.forEach((name, index) => {
        const parsed = parseIndexedFieldName(name);
        if (parsed) {
            addStat(stats, parsed.group, parsed.axis, frame[index]);
        }
    });
}

function skipToNextFrame(data, state) {
    while (state.pos < state.end) {
        const byte = data[state.pos];
        if ([FRAME_TYPE_I, FRAME_TYPE_P, FRAME_TYPE_E, FRAME_TYPE_G, FRAME_TYPE_H].includes(byte)) {
            return;
        }
        state.pos += 1;
    }
}

function decodeMainFrameSummary(data, boundary, dataStart, frameDefs, headers, { maxDecodedFrames } = {}) {
    const state = { pos: dataStart, end: boundary.end };
    const sysConfig = {
        dataVersion: toInt(headers[HEADER_KEYS.dataVersion], 2),
        minthrottle: toInt(headers.minthrottle, 0),
        vbatref: toInt(headers.vbatref, 0),
        motorOutputMin: 0,
    };
    const motor0Index = frameDefs.I.name.indexOf("motor[0]");
    const timeIndex = frameDefs.I.name.indexOf("time");
    const stats = {};
    const samples = {
        decodedMainFrames: 0,
        corruptFrames: 0,
        unsupportedEncodedFrames: 0,
        skippedEventFrames: 0,
        firstTimeUs: null,
        lastTimeUs: null,
        durationUs: null,
        truncated: false,
        maxDecodedFrames,
    };

    let previous = null;
    let previous2 = null;
    let lastIFrame = null;
    let lastMainFrameTime = 0;

    while (state.pos < state.end && samples.decodedMainFrames < maxDecodedFrames) {
        const frameType = data[state.pos];
        state.pos += 1;
        let frame = null;

        try {
            if (frameType === FRAME_TYPE_I) {
                const decoded = decodeFrameWithStatus(
                    data,
                    state,
                    frameDefs.I,
                    lastIFrame,
                    null,
                    sysConfig,
                    motor0Index,
                    lastMainFrameTime,
                );
                if (decoded.unsupported) {
                    samples.unsupportedEncodedFrames += 1;
                    skipToNextFrame(data, state);
                    continue;
                }
                frame = decoded.frame;
                lastIFrame = frame;
            } else if (frameType === FRAME_TYPE_P && previous) {
                const decoded = decodeFrameWithStatus(
                    data,
                    state,
                    frameDefs.P,
                    previous,
                    previous2,
                    sysConfig,
                    motor0Index,
                    lastMainFrameTime,
                );
                if (decoded.unsupported) {
                    samples.unsupportedEncodedFrames += 1;
                    skipToNextFrame(data, state);
                    continue;
                }
                frame = decoded.frame;
            } else if ([FRAME_TYPE_E, FRAME_TYPE_G, FRAME_TYPE_H].includes(frameType)) {
                samples.skippedEventFrames += 1;
                skipToNextFrame(data, state);
                continue;
            } else {
                samples.corruptFrames += 1;
                skipToNextFrame(data, state);
                continue;
            }
        } catch {
            samples.corruptFrames += 1;
            skipToNextFrame(data, state);
            continue;
        }

        if (!frame) {
            continue;
        }

        previous2 = previous;
        previous = frame;
        samples.decodedMainFrames += 1;
        collectFrameStats(frame, frameDefs.I, stats);

        if (timeIndex >= 0) {
            const time = frame[timeIndex];
            if (samples.firstTimeUs === null) {
                samples.firstTimeUs = time;
            }
            samples.lastTimeUs = time;
            lastMainFrameTime = time;
        }
    }

    if (state.pos < state.end && samples.decodedMainFrames >= maxDecodedFrames) {
        samples.truncated = true;
    }

    if (samples.firstTimeUs !== null && samples.lastTimeUs !== null) {
        samples.durationUs = samples.lastTimeUs - samples.firstTimeUs;
    }

    return { samples, fieldStats: normalizeStats(stats) };
}

function parseLogAtBoundary(data, boundary, index, maxDecodedFrames) {
    const headerText = parseHeaderText(data, boundary.start, boundary.end);
    const { headers, frameFields, frameDefs } = parseHeaderLines(headerText);
    const dataStart = boundary.start + new TextEncoder().encode(headerText).length;
    const decoded = decodeMainFrameSummary(data, boundary, dataStart, frameDefs, headers, { maxDecodedFrames });

    return {
        index,
        headers,
        frameFields,
        frameDefs,
        decoded,
    };
}

function summarizeAvailableLog(log) {
    const samples = log.decoded.samples;

    return {
        index: log.index,
        decodedMainFrames: samples.decodedMainFrames,
        corruptFrames: samples.corruptFrames,
        unsupportedEncodedFrames: samples.unsupportedEncodedFrames,
        skippedEventFrames: samples.skippedEventFrames,
        firstTimeUs: samples.firstTimeUs,
        lastTimeUs: samples.lastTimeUs,
        durationUs: samples.durationUs,
        truncated: samples.truncated,
        requiredColumns: summarizeFields(log.frameFields).requiredColumns,
    };
}

export function buildBblSummary({
    fileName = "",
    data,
    maxDecodedFrames = DEFAULT_MAX_DECODED_FRAMES,
    selectedLogIndex = null,
} = {}) {
    if (!ArrayBuffer.isView(data) || data.BYTES_PER_ELEMENT !== 1) {
        throw new Error("BBL summary requires Uint8Array data.");
    }

    const boundaries = findLogBoundaries(data);
    if (!boundaries.length) {
        throw new Error("No valid Blackbox logs found in this BBL file.");
    }

    const parsedLogs = boundaries.map((boundary, index) => parseLogAtBoundary(data, boundary, index, maxDecodedFrames));
    const bestLog = parsedLogs.reduce((best, candidate) =>
        candidate.decoded.samples.decodedMainFrames > best.decoded.samples.decodedMainFrames ? candidate : best,
    );
    const requestedLog = Number.isInteger(selectedLogIndex)
        ? parsedLogs.find((candidate) => candidate.index === selectedLogIndex)
        : null;
    const selectedLog = requestedLog || bestLog;
    const resolvedSelectedLogIndex = selectedLog.index;
    const { headers, frameFields } = selectedLog;
    const looptime = toInt(headers[HEADER_KEYS.looptime]);
    const pidProcessDenom = toInt(headers[HEADER_KEYS.pidProcessDenom]);
    const { decoded } = selectedLog;

    return {
        fileName,
        type: "bbl",
        logCount: boundaries.length,
        selectedLogIndex: resolvedSelectedLogIndex,
        availableLogs: parsedLogs.map(summarizeAvailableLog),
        firmware: {
            revision: headers[HEADER_KEYS.firmwareRevision] || "",
            apiVersion: headers[HEADER_KEYS.firmwareApiVersion] || "",
            dataVersion: toInt(headers[HEADER_KEYS.dataVersion]),
        },
        timing: {
            looptime,
            pidProcessDenom,
            estimatedSampleRateHz: estimateSampleRate(headers),
        },
        debug: {
            mode: toInt(headers[HEADER_KEYS.debugMode], -1),
            blackboxHighResolution: toInt(headers[HEADER_KEYS.blackboxHighResolution]),
            chirpRequired: false,
        },
        fields: summarizeFields(frameFields),
        samples: decoded.samples,
        fieldStats: decoded.fieldStats,
    };
}
