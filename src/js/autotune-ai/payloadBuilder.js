import FC from "../fc";

const MAX_PAYLOAD_BYTES = 20 * 1024;

const FIRMWARE_KEYS = [
    "apiVersion",
    "flightControllerIdentifier",
    "flightControllerVersion",
    "targetName",
    "boardName",
    "manufacturerId",
    "buildKey",
    "gitRevision",
    "sampleRateHz",
    "buildOptions",
];

const PID_ADVANCED_KEYS = ["pid_process_denom", "motorIdle", "debugMode"];

const RATE_KEYS = [
    "RC_RATE",
    "RC_EXPO",
    "roll_rate",
    "pitch_rate",
    "yaw_rate",
    "RC_YAW_EXPO",
    "rcYawRate",
    "rcPitchRate",
    "RC_PITCH_EXPO",
    "roll_rate_limit",
    "pitch_rate_limit",
    "yaw_rate_limit",
    "rates_type",
];

function pick(source, keys) {
    const result = {};
    keys.forEach((key) => {
        if (source?.[key] !== undefined && source?.[key] !== null) {
            result[key] = source[key];
        }
    });
    return result;
}

function stripRawFields(value) {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.map(stripRawFields);
    }
    if (!value || typeof value !== "object") {
        return value;
    }

    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !/^raw/i.test(key) && key !== "rows" && key !== "samples")
            .map(([key, item]) => [key, stripRawFields(item)]),
    );
}

function hasCurrentFc(fc) {
    return Boolean(fc?.CONFIG || fc?.TUNING_SLIDERS || fc?.FILTER_CONFIG || fc?.RC_TUNING);
}

function summarizeAutotuneAnalysis(analysisResult) {
    if (!analysisResult?.axes) {
        return { axes: {} };
    }

    const axes = {};
    Object.entries(analysisResult.axes).forEach(([axis, axisResult]) => {
        axes[axis] = {
            detected: true,
            recommendedPGain: axisResult?.recommendedGains?.p,
            recommendedDGain: axisResult?.recommendedGains?.d,
            coherenceMean: axisResult?.coherenceMean,
            peakFrequencyHz: axisResult?.peakFrequencyHz,
        };
    });

    return { axes: stripRawFields(axes) };
}

function getMetadataSource(currentFcAvailable, cliSummary, csvSummary, bblSummary) {
    const hasCli = Boolean(cliSummary);
    const hasCsv = Boolean(csvSummary);
    const hasBbl = Boolean(bblSummary);

    if (currentFcAvailable && (hasCli || hasCsv || hasBbl)) {
        return "mixed";
    }
    if (currentFcAvailable) {
        return "current-fc";
    }
    if (hasCli) {
        return "cli";
    }
    if (hasCsv) {
        return "csv";
    }
    if (hasBbl) {
        return "bbl";
    }
    return "missing";
}

function enforcePayloadLimit(payload) {
    let compact = payload;
    let serialized = JSON.stringify(compact);

    if (serialized.length <= MAX_PAYLOAD_BYTES) {
        return compact;
    }

    compact = {
        ...payload,
        dynamicAnalysis: { axes: {} },
    };
    serialized = JSON.stringify(compact);

    if (serialized.length <= MAX_PAYLOAD_BYTES) {
        return compact;
    }

    return {
        ...compact,
        staticConfig: {
            ...compact.staticConfig,
            cli: undefined,
        },
    };
}

export function buildAiPayload({
    craftContext = {},
    fc = FC,
    cliSummary = null,
    csvSummary = null,
    bblSummary = null,
    analysisResult = null,
    localBblAnalysis = null,
} = {}) {
    const currentFcAvailable = hasCurrentFc(fc);
    const safeCliSummary = cliSummary ? stripRawFields(cliSummary) : null;
    const safeCsvSummary = csvSummary ? stripRawFields(csvSummary) : null;
    const safeBblSummary = bblSummary ? stripRawFields(bblSummary) : null;
    const safeLocalBblAnalysis = localBblAnalysis
        ? stripRawFields({
              selectedLogIndexes: localBblAnalysis.selectedLogIndexes,
              aggregateQuality: localBblAnalysis.aggregateQuality,
              consensusDiagnostics: localBblAnalysis.consensusDiagnostics,
              conflictingDiagnostics: localBblAnalysis.conflictingDiagnostics,
              aggregateRecommendations: localBblAnalysis.aggregateRecommendations,
          })
        : null;

    const payload = {
        craftContext: stripRawFields(craftContext),
        sourceSummary: {
            hasCurrentFc: currentFcAvailable,
            hasCli: Boolean(cliSummary),
            hasCsv: Boolean(csvSummary),
            hasBbl: Boolean(bblSummary),
            metadataSource: getMetadataSource(currentFcAvailable, cliSummary, csvSummary, bblSummary),
        },
        inputSources: {
            cli: {
                present: Boolean(cliSummary),
                summary: safeCliSummary || undefined,
            },
            csv: {
                present: Boolean(csvSummary),
                summary: safeCsvSummary || undefined,
            },
            bbl: {
                present: Boolean(bblSummary),
                summary: safeBblSummary || undefined,
            },
        },
        staticConfig: {
            firmware: pick(fc?.CONFIG, FIRMWARE_KEYS),
            pid: {
                ...stripRawFields(fc?.TUNING_SLIDERS || {}),
                advanced: pick(fc?.PID_ADVANCED_CONFIG, PID_ADVANCED_KEYS),
            },
            filters: stripRawFields(fc?.FILTER_CONFIG || {}),
            rates: pick(fc?.RC_TUNING, RATE_KEYS),
            features: stripRawFields(fc?.FEATURE_CONFIG || {}),
            cli: safeCliSummary || undefined,
            csv: safeCsvSummary || undefined,
            bbl: safeBblSummary || undefined,
        },
        dynamicAnalysis: summarizeAutotuneAnalysis(analysisResult),
        localAnalysis: safeLocalBblAnalysis || undefined,
        existingRecommendation: {
            pid: {},
            filters: {},
            rates: {},
        },
    };

    return enforcePayloadLimit(payload);
}
