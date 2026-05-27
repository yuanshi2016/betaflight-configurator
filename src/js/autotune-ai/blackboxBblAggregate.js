const QUALITY_STATUS = {
    UNUSABLE: "unusable",
    DEGRADED: "degraded",
    USABLE: "usable",
};

const CONFIDENCE_LEVELS = ["low", "medium", "high"];
const PRIORITY_LEVELS = ["low", "medium", "high"];

function getConfidenceLevel(confidence) {
    const index = CONFIDENCE_LEVELS.indexOf(confidence);
    return index >= 0 ? index : 0;
}

function cloneValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => cloneValue(item));
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
    }

    return value;
}

function boostConfidence(confidence, count) {
    const level = getConfidenceLevel(confidence);
    if (count < 2) {
        return confidence;
    }

    return CONFIDENCE_LEVELS[Math.min(level + 1, CONFIDENCE_LEVELS.length - 1)];
}

function buildRatesMismatchFingerprint(diagnostic) {
    const evidence = diagnostic?.evidence || {};
    const axes = Array.isArray(evidence.exceededAxes)
        ? evidence.exceededAxes.map((entry) => entry.axis).sort().join(",")
        : "";

    return [
        diagnostic?.type || "",
        evidence.ratesType ?? "",
        evidence.craftType || "",
        evidence.flightStyle || "",
        evidence.runtimeUsage || "",
        axes,
    ].join("|");
}

function getDiagnosticFingerprint(diagnostic) {
    if (!diagnostic?.type) {
        return "";
    }

    if (diagnostic.type === "rates_mismatch") {
        return buildRatesMismatchFingerprint(diagnostic);
    }

    return diagnostic.type;
}

function getRecommendationKey(recommendation) {
    if (!recommendation?.type) {
        return "";
    }

    return [recommendation?.type || "", recommendation?.group || "", recommendation?.actionability || ""].join("|");
}

function mergePriority(currentPriority, nextPriority) {
    const currentLevel = PRIORITY_LEVELS.indexOf(currentPriority);
    const nextLevel = PRIORITY_LEVELS.indexOf(nextPriority);

    if (currentLevel === -1) {
        return nextPriority;
    }

    if (nextLevel === -1) {
        return currentPriority;
    }

    return PRIORITY_LEVELS[Math.max(currentLevel, nextLevel)];
}

function pickPreferredText(currentValue, nextValue) {
    if (!currentValue) {
        return nextValue;
    }

    if (!nextValue) {
        return currentValue;
    }

    return nextValue.length > currentValue.length ? nextValue : currentValue;
}

function mergeConfigSnapshots(currentSnapshot = {}, nextSnapshot = {}) {
    const merged = { ...cloneValue(currentSnapshot) };

    Object.entries(nextSnapshot).forEach(([key, value]) => {
        const currentValue = merged[key];
        if (typeof currentValue === "number" && typeof value === "number") {
            merged[key] = Math.min(currentValue, value);
            return;
        }

        if (currentValue === undefined) {
            merged[key] = cloneValue(value);
        }
    });

    return merged;
}

function groupDiagnostics(results) {
    const groups = new Map();

    results.forEach((result) => {
        (result?.diagnostics || []).forEach((diagnostic) => {
            const fingerprint = getDiagnosticFingerprint(diagnostic);
            if (!fingerprint) {
                return;
            }

            if (!groups.has(fingerprint)) {
                groups.set(fingerprint, []);
            }

            groups.get(fingerprint).push(diagnostic);
        });
    });

    return groups;
}

function buildConsensus(groups) {
    return Array.from(groups.values())
        .filter((diagnostics) => diagnostics.length > 1)
        .map((diagnostics) => {
            const representative = cloneValue(
                diagnostics.reduce((selected, current) => {
                    if (!selected) {
                        return current;
                    }

                    return getConfidenceLevel(current?.confidence) > getConfidenceLevel(selected?.confidence)
                        ? current
                        : selected;
                }, null),
            );

            representative.confidence = boostConfidence(
                diagnostics.reduce((highest, diagnostic) => {
                    return getConfidenceLevel(diagnostic?.confidence) > getConfidenceLevel(highest)
                        ? diagnostic.confidence
                        : highest;
                }, "low"),
                diagnostics.length,
            );
            representative.sources = diagnostics.length;
            return representative;
        });
}

function buildConflictingDiagnostics(groups) {
    return Array.from(groups.values())
        .filter((diagnostics) => diagnostics.length === 1)
        .map((diagnostics) => {
            const representative = cloneValue(diagnostics[0]);
            representative.sources = 1;
            representative.classification = "singleton";
            representative.conflict = false;
            return representative;
        });
}

function mergeRecommendation(existing, incoming) {
    const merged = cloneValue(existing);

    merged.type = existing.type || incoming.type;
    merged.group = existing.group || incoming.group;
    merged.priority = mergePriority(existing.priority, incoming.priority);
    merged.actionability = existing.actionability || incoming.actionability;
    merged.explanation = pickPreferredText(existing.explanation, incoming.explanation);
    merged.configSnapshot = mergeConfigSnapshots(existing.configSnapshot, incoming.configSnapshot);
    merged.sources = (existing.sources || 1) + 1;

    return merged;
}

function buildAggregateRecommendations(results) {
    const grouped = new Map();

    results.forEach((result) => {
        (result?.recommendations || []).forEach((recommendation) => {
            const key = getRecommendationKey(recommendation);
            if (!key) {
                return;
            }

            if (!grouped.has(key)) {
                grouped.set(key, { ...cloneValue(recommendation), sources: 1 });
                return;
            }

            grouped.set(key, mergeRecommendation(grouped.get(key), recommendation));
        });
    });

    return Array.from(grouped.values());
}

function summarizeAggregateQuality(selectedResults, usableResults) {
    if (!selectedResults.length) {
        return {
            status: QUALITY_STATUS.UNUSABLE,
            reason: "no_usable_logs",
        };
    }

    if (!usableResults.length) {
        return {
            status: QUALITY_STATUS.UNUSABLE,
            reason: "includes_unusable_logs",
        };
    }

    if (usableResults.length !== selectedResults.length) {
        return {
            status: QUALITY_STATUS.DEGRADED,
            reason: "includes_unusable_logs",
        };
    }

    if (usableResults.some((result) => result?.quality?.status === QUALITY_STATUS.DEGRADED)) {
        return {
            status: QUALITY_STATUS.DEGRADED,
            reason: "includes_degraded_logs",
        };
    }

    return {
        status: QUALITY_STATUS.USABLE,
        reason: "all_selected_logs_usable",
    };
}

export function aggregateBblAnalyses(results = []) {
    const usable = results.filter((result) => result?.quality?.status !== QUALITY_STATUS.UNUSABLE);
    const groups = groupDiagnostics(usable);

    return {
        selectedLogIndexes: results.map((result) => result.logIndex),
        usableLogIndexes: usable.map((result) => result.logIndex),
        consensusDiagnostics: buildConsensus(groups),
        conflictingDiagnostics: buildConflictingDiagnostics(groups),
        aggregateRecommendations: buildAggregateRecommendations(usable),
        aggregateQuality: summarizeAggregateQuality(results, usable),
    };
}
