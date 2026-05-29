const QUALITY_STATUS = {
    UNUSABLE: "unusable",
    DEGRADED: "degraded",
    USABLE: "usable",
};

const ENVELOPE_GROUPS = ["pid", "filters", "rates"];
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

function getHighestConfidence(entries) {
    return entries.reduce((highest, entry) => {
        const currentLevel = getConfidenceLevel(entry?.advice?.confidence);
        const highestLevel = getConfidenceLevel(highest);
        return currentLevel > highestLevel ? entry.advice.confidence : highest;
    }, "low");
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

function getHighestEnvelopeConfidence(entries = []) {
    return entries.reduce((highest, entry) => {
        const current = entry?.confidence || "low";
        return getConfidenceLevel(current) > getConfidenceLevel(highest) ? current : highest;
    }, "low");
}

function getEnvelopeGroup(result, groupName) {
    return result?.writeEnvelope?.[groupName] || null;
}

function pickDominantBlockedReason(reasons = []) {
    if (!reasons.length) {
        return "insufficient_group_evidence";
    }

    const counts = new Map();
    reasons.forEach((reason) => {
        counts.set(reason, (counts.get(reason) || 0) + 1);
    });

    return [...counts.entries()].sort((left, right) => {
        if (right[1] !== left[1]) {
            return right[1] - left[1];
        }

        return left[0].localeCompare(right[0]);
    })[0][0];
}

function mergeCandidatesForGroup(entries = []) {
    if (!entries.length) {
        return {};
    }

    const firstKeys = Object.keys(entries[0]?.candidates || {}).sort();
    const sameKeySet = entries.every((entry) => {
        const candidateKeys = Object.keys(entry?.candidates || {}).sort();
        return JSON.stringify(candidateKeys) === JSON.stringify(firstKeys);
    });
    if (!sameKeySet) {
        return {};
    }

    const merged = {};
    Object.entries(entries[0]?.candidates || {}).forEach(([key, candidate]) => {
        const allSame = entries.every((entry) => {
            const nextCandidate = entry?.candidates?.[key];
            if (!nextCandidate) {
                return false;
            }

            return (
                nextCandidate.suggestedValue === candidate.suggestedValue &&
                nextCandidate.min === candidate.min &&
                nextCandidate.max === candidate.max &&
                nextCandidate.step === candidate.step
            );
        });
        if (!allSame) {
            return;
        }

        const reasons = [...new Set(entries.map((entry) => entry?.candidates?.[key]?.reason).filter(Boolean))];
        const evidenceRefs = [...new Set(entries.flatMap((entry) => entry?.candidates?.[key]?.evidenceRefs || []))];
        merged[key] = {
            ...cloneValue(candidate),
            reason: reasons.join(" | ") || candidate.reason,
            evidenceRefs,
        };
    });

    return merged;
}

function buildAggregateEnvelopeForGroup(groupName, usableResults = [], aggregateQuality = {}) {
    const entries = usableResults.map((result) => getEnvelopeGroup(result, groupName)).filter(Boolean);
    if (!entries.length) {
        return {
            writeableAllowed: false,
            blockedReason: "no_group_envelope",
            confidence: "low",
            candidates: {},
        };
    }

    if (aggregateQuality?.status !== QUALITY_STATUS.USABLE) {
        return {
            writeableAllowed: false,
            blockedReason: "aggregate_quality_not_usable",
            confidence: getHighestEnvelopeConfidence(entries),
            candidates: {},
        };
    }

    const writeableEntries = entries.filter((entry) => entry.writeableAllowed === true);
    if (writeableEntries.length < 2) {
        return {
            writeableAllowed: false,
            blockedReason: pickDominantBlockedReason(entries.map((entry) => entry.blockedReason).filter(Boolean)),
            confidence: getHighestEnvelopeConfidence(entries),
            candidates: {},
        };
    }

    const candidates = mergeCandidatesForGroup(writeableEntries);
    if (!Object.keys(candidates).length) {
        return {
            writeableAllowed: false,
            blockedReason: "conflicting_candidate_values",
            confidence: "medium",
            candidates: {},
        };
    }

    return {
        writeableAllowed: true,
        blockedReason: "",
        confidence: boostConfidence(getHighestEnvelopeConfidence(writeableEntries), writeableEntries.length),
        candidates,
    };
}

function groupAxisAdvice(results, axisName, category, adviceKey, filterFn = () => true) {
    const grouped = new Map();

    results.forEach((result) => {
        const axis = result?.axes?.[axisName];
        const advice = axis?.[category]?.[adviceKey];
        if (!advice || !filterFn(axis, advice)) {
            return;
        }

        const groupKey = `${axisName}|${category}|${adviceKey}|${advice.direction || "unknown"}`;
        if (!grouped.has(groupKey)) {
            grouped.set(groupKey, []);
        }
        grouped.get(groupKey).push({ advice, logIndex: result.logIndex });
    });

    return grouped;
}

function pickDominantAdvice(groupedEntries) {
    return [...groupedEntries].sort((left, right) => right[1].length - left[1].length)[0];
}

function summarizeAxisAdvice(results) {
    const axes = {};
    const axisConflicts = [];
    const categories = [
        { key: "pidAdvice", adviceKeys: ["p", "i", "d", "ff"] },
        {
            key: "filterAdvice",
            adviceKeys: ["gyroNotch", "dtermLowpass"],
            filterFn: (axis) => axis?.frequencyDomain?.fftUsable !== false,
        },
    ];

    ["roll", "pitch", "yaw"].forEach((axisName) => {
        const axisSummary = { pidAdvice: {}, filterAdvice: {} };
        let hasAxisData = false;

        categories.forEach(({ key, adviceKeys, filterFn }) => {
            adviceKeys.forEach((adviceKey) => {
                const grouped = groupAxisAdvice(results, axisName, key, adviceKey, filterFn);
                if (!grouped.size) {
                    return;
                }

                const dominant = pickDominantAdvice(grouped.entries());
                const dominantEntries = dominant[1];
                const conflictingDirections = [...new Set([...grouped.keys()].map((entry) => entry.split("|").at(-1)))];
                const representative = cloneValue(dominantEntries[0].advice);
                representative.supportCount = dominantEntries.length;
                representative.conflictCount = grouped.size > 1 ? [...grouped.values()].reduce((sum, entries) => sum + entries.length, 0) - dominantEntries.length : 0;
                representative.sources = dominantEntries.map((entry) => entry.logIndex);
                representative.confidence = boostConfidence(getHighestConfidence(dominantEntries), dominantEntries.length);
                axisSummary[key][adviceKey] = representative;
                hasAxisData = true;

                if (conflictingDirections.length > 1) {
                    axisConflicts.push({
                        axis: axisName,
                        advicePath: `${key}.${adviceKey}`,
                        conflictingDirections: conflictingDirections.sort(),
                    });
                }
            });
        });

        if (hasAxisData) {
            axes[axisName] = axisSummary;
        }
    });

    return { axes, axisConflicts };
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
    const axisSummary = summarizeAxisAdvice(usable);
    const aggregateQuality = summarizeAggregateQuality(results, usable);

    return {
        selectedLogIndexes: results.map((result) => result.logIndex),
        usableLogIndexes: usable.map((result) => result.logIndex),
        consensusDiagnostics: buildConsensus(groups),
        conflictingDiagnostics: buildConflictingDiagnostics(groups),
        aggregateRecommendations: buildAggregateRecommendations(usable),
        aggregateQuality,
        axes: axisSummary.axes,
        axisConflicts: axisSummary.axisConflicts,
        writeEnvelope: Object.fromEntries(
            ENVELOPE_GROUPS.map((groupName) => [groupName, buildAggregateEnvelopeForGroup(groupName, usable, aggregateQuality)]),
        ),
    };
}
