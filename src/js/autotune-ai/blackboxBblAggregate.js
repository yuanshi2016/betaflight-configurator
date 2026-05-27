const QUALITY_STATUS = {
    UNUSABLE: "unusable",
    DEGRADED: "degraded",
    USABLE: "usable",
};

const CONFIDENCE_LEVELS = ["low", "medium", "high"];

function getConfidenceLevel(confidence) {
    const index = CONFIDENCE_LEVELS.indexOf(confidence);
    return index >= 0 ? index : 0;
}

function getHighestConfidence(diagnostics) {
    return diagnostics.reduce((highest, diagnostic) => {
        if (getConfidenceLevel(diagnostic?.confidence) > getConfidenceLevel(highest)) {
            return diagnostic.confidence;
        }

        return highest;
    }, "low");
}

function boostConfidence(confidence, count) {
    const level = getConfidenceLevel(confidence);
    if (count < 2) {
        return confidence;
    }

    return CONFIDENCE_LEVELS[Math.min(level + 1, CONFIDENCE_LEVELS.length - 1)];
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

function mergeConservativeValues(currentValue, nextValue) {
    if (typeof currentValue === "number" && typeof nextValue === "number") {
        return Math.min(currentValue, nextValue);
    }

    if (Array.isArray(currentValue) && Array.isArray(nextValue)) {
        return currentValue.length >= nextValue.length ? cloneValue(currentValue) : cloneValue(nextValue);
    }

    if (currentValue && typeof currentValue === "object" && nextValue && typeof nextValue === "object") {
        const merged = { ...cloneValue(currentValue) };
        Object.entries(nextValue).forEach(([key, value]) => {
            if (key in merged) {
                merged[key] = mergeConservativeValues(merged[key], value);
            } else {
                merged[key] = cloneValue(value);
            }
        });
        return merged;
    }

    if (currentValue === undefined) {
        return cloneValue(nextValue);
    }

    return cloneValue(currentValue);
}

function groupDiagnosticsByType(results) {
    return results.reduce((groups, result) => {
        (result?.diagnostics || []).forEach((diagnostic) => {
            if (!diagnostic?.type) {
                return;
            }

            if (!groups[diagnostic.type]) {
                groups[diagnostic.type] = [];
            }

            groups[diagnostic.type].push(diagnostic);
        });

        return groups;
    }, {});
}

function buildConsensus(groups) {
    return Object.entries(groups)
        .filter(([, diagnostics]) => diagnostics.length > 1)
        .map(([type, diagnostics]) => {
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

            representative.type = type;
            representative.confidence = boostConfidence(getHighestConfidence(diagnostics), diagnostics.length);
            representative.sources = diagnostics.length;
            return representative;
        });
}

function buildConflicts(groups) {
    return Object.entries(groups)
        .filter(([, diagnostics]) => diagnostics.length === 1)
        .map(([type, diagnostics]) => {
            const representative = cloneValue(diagnostics[0]);
            representative.type = type;
            representative.sources = 1;
            return representative;
        });
}

function buildAggregateRecommendations(results) {
    return results.reduce((aggregate, result) => {
        const recommendations = result?.recommendations;
        if (!recommendations || typeof recommendations !== "object" || Array.isArray(recommendations)) {
            return aggregate;
        }

        return mergeConservativeValues(aggregate, recommendations);
    }, {});
}

function summarizeAggregateQuality(results) {
    if (!results.length) {
        return {
            status: QUALITY_STATUS.UNUSABLE,
            reason: "no_usable_logs",
        };
    }

    if (results.some((result) => result?.quality?.status === QUALITY_STATUS.DEGRADED)) {
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
    const groups = groupDiagnosticsByType(usable);

    return {
        selectedLogIndexes: usable.map((result) => result.logIndex),
        consensusDiagnostics: buildConsensus(groups),
        conflictingDiagnostics: buildConflicts(groups),
        aggregateRecommendations: buildAggregateRecommendations(usable),
        aggregateQuality: summarizeAggregateQuality(usable),
    };
}
