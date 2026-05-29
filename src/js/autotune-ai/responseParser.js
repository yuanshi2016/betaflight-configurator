const GROUPS = ["pid", "filters", "rates"];
const RISKS = new Set(["low", "medium", "high"]);
const CONFIDENCE = new Set(["low", "medium", "high"]);

const VALUE_KEYS = {
    pid: new Set([
        "slider_pids_mode",
        "slider_d_gain",
        "slider_pi_gain",
        "slider_feedforward_gain",
        "slider_dmax_gain",
        "slider_i_gain",
        "slider_roll_pitch_ratio",
        "slider_pitch_pi_gain",
        "slider_master_multiplier",
    ]),
    filters: new Set([
        "slider_gyro_filter",
        "slider_gyro_filter_multiplier",
        "slider_dterm_filter",
        "slider_dterm_filter_multiplier",
    ]),
    rates: new Set([
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
    ]),
};

function stripMarkdownFence(text) {
    const trimmed = String(text || "").trim();
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
    return match ? match[1].trim() : trimmed;
}

function asString(value) {
    return typeof value === "string" ? value : "";
}

function isSafePrimitive(value) {
    return ["number", "boolean"].includes(typeof value);
}

function normalizeValues(group, values) {
    if (!values || typeof values !== "object" || Array.isArray(values)) {
        return {};
    }

    const allowed = VALUE_KEYS[group];
    return Object.fromEntries(
        Object.entries(values).filter(([key, value]) => allowed.has(key) && isSafePrimitive(value)),
    );
}

function normalizeGroup(group, candidate) {
    const source = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
    return {
        writeable: source.writeable === true,
        confidence: CONFIDENCE.has(source.confidence) ? source.confidence : "low",
        explanation: asString(source.explanation),
        values: normalizeValues(group, source.values),
    };
}

function getLocalAnalysisGating(payload) {
    if (payload === undefined) {
        return {
            writeableAllowed: true,
            reason: "",
        };
    }

    const localAnalysis = payload?.localAnalysis;
    if (!localAnalysis) {
        return {
            writeableAllowed: false,
            reason: "Local BBL evidence is missing, so writeable recommendations are blocked.",
        };
    }

    const aggregateQuality = localAnalysis?.aggregateQuality;
    if (aggregateQuality?.status !== "usable") {
        return {
            writeableAllowed: false,
            reason: `Local BBL evidence is ${aggregateQuality?.status || "unusable"}, so writeable recommendations are blocked.`,
        };
    }

    return {
        writeableAllowed: true,
        reason: "",
    };
}

function applyWriteabilityGating(groups, payload) {
    const gating = getLocalAnalysisGating(payload);
    if (gating.writeableAllowed) {
        return groups;
    }

    return Object.fromEntries(
        Object.entries(groups).map(([groupName, groupValue]) => [
            groupName,
            {
                ...groupValue,
                writeable: false,
                explanation: groupValue.explanation
                    ? `${gating.reason} ${groupValue.explanation}`.trim()
                    : gating.reason,
            },
        ]),
    );
}

function getLocalWriteEnvelope(payload) {
    return payload?.localAnalysis?.writeEnvelope || {};
}

function getEnvelopeGroup(payload, groupName) {
    const envelope = getLocalWriteEnvelope(payload)?.[groupName];
    return envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope : null;
}

function reconcileGroupWithEnvelope(groupName, groupValue, payload) {
    const envelope = getEnvelopeGroup(payload, groupName);
    if (!envelope) {
        return {
            ...groupValue,
            writeable: false,
            explanation: groupValue.explanation
                ? `Missing local envelope. ${groupValue.explanation}`.trim()
                : "Missing local envelope.",
            values: {},
        };
    }

    if (envelope.writeableAllowed !== true) {
        return {
            ...groupValue,
            writeable: false,
            explanation: groupValue.explanation
                ? `${envelope.blockedReason || "Local group gate blocked writes."} ${groupValue.explanation}`.trim()
                : envelope.blockedReason || "Local group gate blocked writes.",
            values: {},
        };
    }

    const acceptedValues = Object.fromEntries(
        Object.entries(groupValue.values || {}).filter(([key, value]) => {
            const candidate = envelope.candidates?.[key];
            return candidate && candidate.suggestedValue === value;
        }),
    );

    if (!Object.keys(acceptedValues).length) {
        return {
            ...groupValue,
            writeable: false,
            explanation: groupValue.explanation
                ? `No values matched local suggestedValue. ${groupValue.explanation}`.trim()
                : "No values matched local suggestedValue.",
            values: {},
        };
    }

    return {
        ...groupValue,
        writeable: groupValue.writeable === true,
        values: acceptedValues,
    };
}

function reconcileGroups(groups, payload) {
    const envelope = getLocalWriteEnvelope(payload);
    if (!envelope || !Object.keys(envelope).length) {
        return groups;
    }

    return Object.fromEntries(
        Object.entries(groups).map(([groupName, groupValue]) => [
            groupName,
            reconcileGroupWithEnvelope(groupName, groupValue, payload),
        ]),
    );
}

export function parseAiResponse(responseText, payload = undefined) {
    let parsed;

    try {
        parsed = JSON.parse(stripMarkdownFence(responseText));
    } catch {
        throw new Error("AI response was not valid JSON.");
    }

    const groups = {};
    GROUPS.forEach((group) => {
        if (parsed?.groups?.[group] !== undefined) {
            groups[group] = normalizeGroup(group, parsed.groups[group]);
        }
    });

    const gatedGroups = applyWriteabilityGating(groups, payload);
    const reconciledGroups = reconcileGroups(gatedGroups, payload);

    return {
        summary: asString(parsed?.summary),
        overallRisk: RISKS.has(parsed?.overallRisk) ? parsed.overallRisk : "medium",
        groups: reconciledGroups,
        effectivePlan: {
            groups: reconciledGroups,
        },
        flightTestNotes: asString(parsed?.flightTestNotes),
    };
}
