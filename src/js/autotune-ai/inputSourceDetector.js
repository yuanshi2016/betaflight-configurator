import { parseCliConfig } from "./cliConfigParser";

const CLI_EXTENSIONS = new Set(["cli", "dump", "txt"]);
const CSV_EXTENSIONS = new Set(["csv"]);
const BBL_EXTENSIONS = new Set(["bbl"]);
const AXIS_NAMES = ["roll", "pitch", "yaw"];

function getFileExtension(fileName) {
    const match = String(fileName || "")
        .trim()
        .toLowerCase()
        .match(/\.([a-z0-9]+)$/u);
    return match?.[1] || "";
}

function getFirstNonEmptyLine(text) {
    return String(text || "")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find(Boolean);
}

function parseCsvHeader(line) {
    return parseCsvLine(line).filter(Boolean);
}

function parseCsvLine(line) {
    const columns = [];
    let current = "";
    let inQuotes = false;

    const chars = String(line || "").split("");
    for (let index = 0; index < chars.length; index += 1) {
        const char = chars[index];
        if (char === '"' && chars[index + 1] === '"') {
            current += '"';
            index += 1;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
            columns.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }

    columns.push(current.trim());
    return columns.map((item) => item.trim());
}

function cleanCsvToken(value) {
    return String(value || "")
        .trim()
        .replace(/^"(.*)"$/u, "$1")
        .trim();
}

function normalizeColumnName(column) {
    return cleanCsvToken(column).replace(/\s+/gu, "").toLowerCase();
}

function getAxisFieldType(column) {
    const normalized = normalizeColumnName(column);

    if (normalized === "time" || normalized === "time(us)" || normalized === "timeus" || normalized === "looptime") {
        return { type: "time" };
    }

    const axisMatch = normalized.match(/^(gyroadc|axisrate|setpoint|axisd|pidd|debug)\[(\d+)\]$/u);
    if (!axisMatch) {
        return null;
    }

    const axisIndex = Number(axisMatch[2]);
    if (!Number.isInteger(axisIndex) || axisIndex < 0 || axisIndex >= AXIS_NAMES.length) {
        return null;
    }

    const source = axisMatch[1];
    if (source === "gyroadc") {
        return { type: "gyro", axisIndex };
    }
    if (source === "axisrate" || source === "setpoint") {
        return { type: "setpoint", axisIndex };
    }
    if (source === "axisd" || source === "pidd" || source === "debug") {
        return { type: "dterm", axisIndex };
    }

    return null;
}

function toFiniteNumber(value) {
    const parsed = Number.parseFloat(cleanCsvToken(value));
    return Number.isFinite(parsed) ? parsed : null;
}

function buildCsvAnalysisInput(text) {
    const lines = String(text || "")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length) {
        return null;
    }

    const columns = parseCsvHeader(lines[0]);
    const mappings = columns.map((column) => getAxisFieldType(column));
    const axes = Object.fromEntries(
        AXIS_NAMES.map((axisName) => [
            axisName,
            {
                timeUs: [],
                gyro: [],
                setpoint: [],
                dterm: [],
            },
        ]),
    );

    for (const line of lines.slice(1)) {
        const values = parseCsvLine(line);
        const rowTimeUs = toFiniteNumber(values[mappings.findIndex((entry) => entry?.type === "time")]);
        if (!Number.isFinite(rowTimeUs)) {
            continue;
        }

        AXIS_NAMES.forEach((axisName, axisIndex) => {
            const gyroIndex = mappings.findIndex((entry) => entry?.type === "gyro" && entry.axisIndex === axisIndex);
            const setpointIndex = mappings.findIndex(
                (entry) => entry?.type === "setpoint" && entry.axisIndex === axisIndex,
            );
            if (gyroIndex === -1 || setpointIndex === -1) {
                return;
            }

            const gyro = toFiniteNumber(values[gyroIndex]);
            const setpoint = toFiniteNumber(values[setpointIndex]);
            if (!Number.isFinite(gyro) || !Number.isFinite(setpoint)) {
                return;
            }

            const dtermIndex = mappings.findIndex((entry) => entry?.type === "dterm" && entry.axisIndex === axisIndex);
            const dterm = dtermIndex === -1 ? null : toFiniteNumber(values[dtermIndex]);
            axes[axisName].timeUs.push(rowTimeUs);
            axes[axisName].gyro.push(gyro);
            axes[axisName].setpoint.push(setpoint);
            if (Number.isFinite(dterm)) {
                axes[axisName].dterm.push(dterm);
            }
        });
    }

    const compactAxes = Object.fromEntries(
        Object.entries(axes)
            .filter(([, series]) => series.timeUs.length && series.gyro.length === series.timeUs.length)
            .map(([axis, series]) => {
                const nextSeries = {
                    timeUs: series.timeUs,
                    gyro: series.gyro,
                    setpoint: series.setpoint,
                };
                if (series.dterm.length === series.timeUs.length) {
                    nextSeries.dterm = series.dterm;
                }
                return [axis, nextSeries];
            }),
    );

    return Object.keys(compactAxes).length
        ? {
              sourceType: "csv",
              axes: compactAxes,
          }
        : null;
}

function countDataRows(text) {
    return Math.max(
        0,
        String(text || "")
            .split(/\r?\n/u)
            .filter((line) => line.trim()).length - 1,
    );
}

function hasCliMarkers(text) {
    return String(text || "")
        .split(/\r?\n/u)
        .some((rawLine) => {
            const line = rawLine.trim();
            return (
                /^#\s*(dump|diff|version|resource)/iu.test(line) ||
                /^set\s+[a-z0-9_]+\s*=/iu.test(line) ||
                /^profile\s+\d+$/iu.test(line) ||
                /^rateprofile\s+\d+$/iu.test(line) ||
                /^feature\s+-?[A-Z0-9_]+$/u.test(line)
            );
        });
}

function hasCsvMarkers(text) {
    const columns = parseCsvHeader(getFirstNonEmptyLine(text));
    if (columns.length < 3) {
        return false;
    }

    const normalized = columns.map((column) => normalizeColumnName(column));
    const hasTime = normalized.some((column) => /^time\b/u.test(column) || column === "looptime");
    const hasFlightData = normalized.some(
        (column) => column.includes("gyroadc") || column.includes("setpoint") || column.includes("axisrate[") || column.includes("debug["),
    );

    return hasTime && hasFlightData;
}

export function detectAutotuneInputSource({ fileName = "", text = "" } = {}) {
    const extension = getFileExtension(fileName);

    if (BBL_EXTENSIONS.has(extension)) {
        return "bbl";
    }

    const hasCsvExtension = CSV_EXTENSIONS.has(extension) || String(fileName).toLowerCase().endsWith(".bbl.csv");

    if (hasCsvExtension && hasCsvMarkers(text)) {
        return "csv";
    }
    if (CLI_EXTENSIONS.has(extension) && hasCliMarkers(text)) {
        return "cli";
    }
    if (hasCsvMarkers(text)) {
        return "csv";
    }
    if (hasCliMarkers(text)) {
        return "cli";
    }

    return "unknown";
}

export function buildCsvSummary({ fileName = "", text = "" } = {}) {
    const columns = parseCsvHeader(getFirstNonEmptyLine(text));
    const normalized = columns.map((column) => normalizeColumnName(column));
    const analysisInput = buildCsvAnalysisInput(text);

    return {
        fileName,
        rowCountEstimate: countDataRows(text),
        columns,
        requiredColumns: {
            time: normalized.some((column) => /^time\b/u.test(column) || column === "looptime"),
            gyro: normalized.some((column) => column.includes("gyroadc")),
            setpoint: normalized.some((column) => column.includes("setpoint") || column.includes("axisrate")),
            debug: normalized.some((column) => column.includes("debug[")),
            dterm: normalized.some(
                (column) => column.includes("axisd[") || column.includes("pidd[") || column.includes("debug["),
            ),
        },
        analysisInput,
    };
}

export function buildInputSourceSummary({ fileName = "", text = "" } = {}) {
    const type = detectAutotuneInputSource({ fileName, text });

    if (type === "bbl") {
        throw new Error("Binary BBL files must be summarized with the BBL importer.");
    }
    if (type === "cli") {
        return {
            type,
            fileName,
            cliSummary: parseCliConfig(text),
            csvSummary: null,
        };
    }
    if (type === "csv") {
        return {
            type,
            fileName,
            cliSummary: null,
            csvSummary: buildCsvSummary({ fileName, text }),
        };
    }

    throw new Error("Unsupported autotune input file. Upload a Betaflight CLI dump/diff or Blackbox CSV export.");
}
