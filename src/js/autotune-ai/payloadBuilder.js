import FC from "../fc";

const MAX_PAYLOAD_BYTES = 20 * 1024;
const MAX_LOCAL_ANALYSIS_ITEMS = 5;
const MAX_DIAGNOSTIC_EXPLANATION_LENGTH = 240;
const MAX_RECOMMENDATION_EXPLANATION_LENGTH = 240;
const MAX_QUALITY_REASON_LENGTH = 160;
const MAX_SOURCE_ITEMS = 4;
const MAX_EVIDENCE_KEYS = 6;
const MAX_CONFIG_SNAPSHOT_KEYS = 8;
const MAX_NESTED_TEXT_LENGTH = 120;
const MAX_NESTED_ARRAY_ITEMS = 4;

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
        return value.map(stripRawFields).filter((item) => item !== undefined);
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

function trimText(value, maxLength) {
    if (typeof value !== "string") {
        return undefined;
    }

    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function compactNestedValue(value) {
    if (typeof value === "string") {
        return trimText(value, MAX_NESTED_TEXT_LENGTH);
    }

    if (Array.isArray(value)) {
        const items = value
            .slice(0, MAX_NESTED_ARRAY_ITEMS)
            .map((item) => compactNestedValue(item))
            .filter((item) => item !== undefined);
        return items.length ? items : undefined;
    }

    if (!value || typeof value !== "object") {
        return value;
    }

    const compactObject = Object.fromEntries(
        Object.entries(value)
            .map(([key, item]) => [key, compactNestedValue(item)])
            .filter(([, item]) => item !== undefined),
    );

    return Object.keys(compactObject).length ? compactObject : undefined;
}

function pickBoundedObject(source, maxKeys) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        return undefined;
    }

    const entries = Object.entries(stripRawFields(source) || {})
        .slice(0, maxKeys)
        .map(([key, value]) => [key, compactNestedValue(value)])
        .filter(([, value]) => value !== undefined);

    return entries.length ? Object.fromEntries(entries) : undefined;
}

function summarizeDiagnosticItem(item, { includeConflict = false } = {}) {
    if (!item || typeof item !== "object") {
        return undefined;
    }

    const summary = {
        type: item.type,
        confidence: item.confidence,
        risk: item.risk,
        classification: item.classification,
        explanation: trimText(item.explanation, MAX_DIAGNOSTIC_EXPLANATION_LENGTH),
        evidence: pickBoundedObject(item.evidence, MAX_EVIDENCE_KEYS),
    };

    if (includeConflict) {
        summary.conflict = item.conflict;
        summary.sources = Array.isArray(item.sources)
            ? item.sources.slice(0, MAX_SOURCE_ITEMS).map((value) => String(value))
            : item.sources;
    }

    return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined));
}

function summarizeRecommendationItem(item) {
    if (!item || typeof item !== "object") {
        return undefined;
    }

    return Object.fromEntries(
        Object.entries({
            type: item.type,
            group: item.group,
            priority: item.priority,
            actionability: item.actionability,
            explanation: trimText(item.explanation, MAX_RECOMMENDATION_EXPLANATION_LENGTH),
            configSnapshot: pickBoundedObject(item.configSnapshot, MAX_CONFIG_SNAPSHOT_KEYS),
        }).filter(([, value]) => value !== undefined),
    );
}

function summarizeLocalBblAnalysis(localBblAnalysis) {
    if (!localBblAnalysis || typeof localBblAnalysis !== "object") {
        return null;
    }

    const aggregateQuality =
        localBblAnalysis.aggregateQuality && typeof localBblAnalysis.aggregateQuality === "object"
            ? Object.fromEntries(
                  Object.entries({
                      status: localBblAnalysis.aggregateQuality.status,
                      reason: trimText(localBblAnalysis.aggregateQuality.reason, MAX_QUALITY_REASON_LENGTH),
                  }).filter(([, value]) => value !== undefined),
              )
            : undefined;

    const summary = {
        selectedLogIndexes: Array.isArray(localBblAnalysis.selectedLogIndexes) ? [...localBblAnalysis.selectedLogIndexes] : undefined,
        aggregateQuality,
        consensusDiagnostics: Array.isArray(localBblAnalysis.consensusDiagnostics)
            ? localBblAnalysis.consensusDiagnostics
                  .slice(0, MAX_LOCAL_ANALYSIS_ITEMS)
                  .map((item) => summarizeDiagnosticItem(item))
                  .filter((item) => item && Object.keys(item).length > 0)
            : undefined,
        conflictingDiagnostics: Array.isArray(localBblAnalysis.conflictingDiagnostics)
            ? localBblAnalysis.conflictingDiagnostics
                  .slice(0, MAX_LOCAL_ANALYSIS_ITEMS)
                  .map((item) => summarizeDiagnosticItem(item, { includeConflict: true }))
                  .filter((item) => item && Object.keys(item).length > 0)
            : undefined,
        aggregateRecommendations: Array.isArray(localBblAnalysis.aggregateRecommendations)
            ? localBblAnalysis.aggregateRecommendations
                  .slice(0, MAX_LOCAL_ANALYSIS_ITEMS)
                  .map((item) => summarizeRecommendationItem(item))
                  .filter((item) => item && Object.keys(item).length > 0)
            : undefined,
    };

    return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined));
}

function enforcePayloadLimit(payload) {
    const candidates = [
        payload,
        {
            ...payload,
            dynamicAnalysis: { axes: {} },
        },
        {
            ...payload,
            dynamicAnalysis: { axes: {} },
            localAnalysis: payload.localAnalysis
                ? {
                      selectedLogIndexes: payload.localAnalysis.selectedLogIndexes,
                      aggregateQuality: payload.localAnalysis.aggregateQuality,
                  }
                : undefined,
        },
        {
            ...payload,
            dynamicAnalysis: { axes: {} },
            localAnalysis: undefined,
            staticConfig: {
                ...payload.staticConfig,
                cli: undefined,
            },
            inputSources: {
                ...payload.inputSources,
                cli: {
                    ...payload.inputSources?.cli,
                    summary: undefined,
                },
            },
        },
        {
            ...payload,
            dynamicAnalysis: { axes: {} },
            localAnalysis: undefined,
            staticConfig: {
                ...payload.staticConfig,
                cli: undefined,
                csv: undefined,
            },
            inputSources: {
                ...payload.inputSources,
                cli: {
                    ...payload.inputSources?.cli,
                    summary: undefined,
                },
                csv: {
                    ...payload.inputSources?.csv,
                    summary: undefined,
                },
            },
        },
        {
            ...payload,
            dynamicAnalysis: { axes: {} },
            localAnalysis: undefined,
            staticConfig: {
                ...payload.staticConfig,
                cli: undefined,
                csv: undefined,
                bbl: undefined,
            },
            inputSources: {
                ...payload.inputSources,
                cli: {
                    ...payload.inputSources?.cli,
                    summary: undefined,
                },
                csv: {
                    ...payload.inputSources?.csv,
                    summary: undefined,
                },
                bbl: {
                    ...payload.inputSources?.bbl,
                    summary: undefined,
                },
            },
        },
    ];

    let smallest = candidates[0];
    let smallestSize = JSON.stringify(smallest).length;

    for (const candidate of candidates) {
        const serialized = JSON.stringify(candidate);
        const size = serialized.length;

        if (size < smallestSize) {
            smallest = candidate;
            smallestSize = size;
        }

        if (size <= MAX_PAYLOAD_BYTES) {
            return candidate;
        }
    }

    return smallest;
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
    const safeLocalBblAnalysis = summarizeLocalBblAnalysis(localBblAnalysis);

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
