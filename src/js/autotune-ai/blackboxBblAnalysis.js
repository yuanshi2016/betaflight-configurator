const QUALITY_STATUS = {
    UNUSABLE: "unusable",
    DEGRADED: "degraded",
    USABLE: "usable",
};

const MIN_REQUIRED_FRAMES = 100;
const MIN_REQUIRED_DURATION_US = 500_000;
const HIGH_IMBALANCE_RATIO = 0.08;
const MEDIUM_IMBALANCE_RATIO = 0.05;
const MIN_MOTOR_SAMPLE_COUNT = 100;
const MAX_LOW_USAGE_ABS_MEAN = 25;
const MAX_LOW_USAGE_RMS = 35;
const MAX_LOW_USAGE_PEAK = 80;

function getRequiredColumns(summary) {
    return summary?.fields?.requiredColumns || {};
}

function getSampleStats(summary) {
    return summary?.samples || {};
}

function countMissingRequiredColumns(requiredColumns) {
    return ["time", "gyro", "setpoint", "motor"].filter((key) => !requiredColumns?.[key]);
}

export function classifyLogQuality(summary = {}) {
    const requiredColumns = getRequiredColumns(summary);
    const samples = getSampleStats(summary);
    const missingColumns = countMissingRequiredColumns(requiredColumns);
    const decodedMainFrames = samples.decodedMainFrames || 0;
    const durationUs = samples.durationUs || 0;
    const corruptFrames = samples.corruptFrames || 0;
    const unsupportedEncodedFrames = samples.unsupportedEncodedFrames || 0;
    const evidence = {
        decodedMainFrames,
        durationUs,
        corruptFrames,
        unsupportedEncodedFrames,
        missingRequiredColumns: missingColumns,
    };

    if (missingColumns.length || decodedMainFrames < MIN_REQUIRED_FRAMES || durationUs < MIN_REQUIRED_DURATION_US) {
        return {
            status: QUALITY_STATUS.UNUSABLE,
            reason: "insufficient_required_data",
            evidence,
        };
    }

    if (corruptFrames > 0 || unsupportedEncodedFrames > 0) {
        return {
            status: QUALITY_STATUS.DEGRADED,
            reason: "partial_decode_issues",
            evidence,
        };
    }

    return {
        status: QUALITY_STATUS.USABLE,
        reason: "sufficient_required_data",
        evidence,
    };
}

function buildMotorImbalanceEvidence(entries, ratio, spread) {
    return {
        motorMeans: Object.fromEntries(entries.map(([index, stats]) => [index, stats.mean])),
        meanSpread: spread,
        imbalanceRatio: Number(ratio.toFixed(4)),
    };
}

export function detectMotorImbalance(summary = {}) {
    const motorStats = summary?.fieldStats?.motor;
    const entries = Object.entries(motorStats || {}).filter(
        ([, stats]) => Number.isFinite(stats?.mean) && (stats?.count || 0) >= MIN_MOTOR_SAMPLE_COUNT,
    );
    if (entries.length < 2) {
        return [];
    }

    const means = entries.map(([, stats]) => stats.mean);
    const minMean = Math.min(...means);
    const maxMean = Math.max(...means);
    const averageMean = means.reduce((sum, value) => sum + value, 0) / means.length;
    const spread = maxMean - minMean;
    const ratio = averageMean > 0 ? spread / averageMean : 0;

    if (ratio < MEDIUM_IMBALANCE_RATIO) {
        return [];
    }

    const confidence = ratio >= HIGH_IMBALANCE_RATIO ? "high" : "medium";
    return [
        {
            type: "motor_output_imbalance",
            confidence,
            risk: confidence === "high" ? "elevated" : "moderate",
            explanation: "Average motor outputs show a sustained spread that suggests balance or mechanical asymmetry.",
            evidence: buildMotorImbalanceEvidence(entries, ratio, spread),
        },
    ];
}

function getCraftRateLimits(craftContext = {}) {
    const craftType = craftContext.craftType || "generic";
    const flightStyle = craftContext.flightStyle || "generic";

    if (craftType === "long-range" && flightStyle === "smooth-cruise") {
        return { roll: 80, pitch: 80, yaw: 65 };
    }

    if (craftType === "cinematic") {
        return { roll: 75, pitch: 75, yaw: 60 };
    }

    return { roll: 95, pitch: 95, yaw: 80 };
}

function hasLowRuntimeRateUsage(fieldStats = {}) {
    const setpointEntries = Object.values(fieldStats?.setpoint || {}).filter(
        (stats) => Number.isFinite(stats?.mean) && Number.isFinite(stats?.rms) && Number.isFinite(stats?.max),
    );
    if (!setpointEntries.length) {
        return false;
    }

    return setpointEntries.every(
        (stats) =>
            Math.abs(stats.mean) <= MAX_LOW_USAGE_ABS_MEAN &&
            stats.rms <= MAX_LOW_USAGE_RMS &&
            Math.abs(stats.max) <= MAX_LOW_USAGE_PEAK,
    );
}

export function detectRatesMismatch(summary = {}, craftContext = {}, staticConfig = {}) {
    if (!summary?.fields?.requiredColumns?.setpoint) {
        return [];
    }

    const rates = staticConfig?.rates || {};
    const ratesType = rates.rates_type ?? 0;
    if (ratesType !== 0) {
        return [];
    }

    if (!hasLowRuntimeRateUsage(summary?.fieldStats)) {
        return [];
    }

    const limits = getCraftRateLimits(craftContext);
    const exceededAxes = [];

    if (Number.isFinite(rates.roll_rate) && rates.roll_rate > limits.roll) {
        exceededAxes.push({ axis: "roll", configured: rates.roll_rate, recommendedMax: limits.roll });
    }
    if (Number.isFinite(rates.pitch_rate) && rates.pitch_rate > limits.pitch) {
        exceededAxes.push({ axis: "pitch", configured: rates.pitch_rate, recommendedMax: limits.pitch });
    }
    if (Number.isFinite(rates.yaw_rate) && rates.yaw_rate > limits.yaw) {
        exceededAxes.push({ axis: "yaw", configured: rates.yaw_rate, recommendedMax: limits.yaw });
    }

    if (!exceededAxes.length) {
        return [];
    }

    return [
        {
            type: "rates_mismatch",
            confidence: "medium",
            risk: "moderate",
            explanation: "Configured rates look aggressive for the declared craft profile and flight style.",
            evidence: {
                ratesType,
                craftType: craftContext.craftType || "generic",
                flightStyle: craftContext.flightStyle || "generic",
                exceededAxes,
                runtimeUsage: "low",
            },
        },
    ];
}

export function buildRecommendations({ diagnostics = [], craftContext = {}, staticConfig = {}, quality = {} } = {}) {
    const recommendations = [];

    if (quality.status === QUALITY_STATUS.UNUSABLE) {
        recommendations.push({
            type: "collect_better_log",
            group: "data_quality",
            priority: "high",
            actionability: "capture_log",
            explanation: "Capture a longer log with required time, gyro, setpoint, and motor fields before tuning decisions.",
        });
    }

    diagnostics.forEach((diagnostic) => {
        if (diagnostic.type === "motor_output_imbalance") {
            recommendations.push({
                type: "inspect_powertrain_balance",
                group: "mechanical",
                priority: diagnostic.confidence === "high" ? "high" : "medium",
                actionability: "manual_check",
                explanation: "Check propellers, motor health, frame alignment, and CG before relying on PID changes.",
            });
        }

        if (diagnostic.type === "rates_mismatch") {
            recommendations.push({
                type: "review_rates_profile",
                group: "rates",
                priority: "medium",
                actionability: "config_review",
                explanation: `Compare configured rates against the ${craftContext.craftType || "current"} use case before tuning.`,
                configSnapshot: staticConfig?.rates || {},
            });
        }
    });

    return recommendations;
}

export function buildEvidenceSummary({ quality = {}, diagnostics = [] } = {}) {
    return {
        qualityStatus: quality.status || QUALITY_STATUS.UNUSABLE,
        qualityReason: quality.reason || "missing_quality",
        diagnosticTypes: diagnostics.map((diagnostic) => diagnostic.type),
        diagnosticCount: diagnostics.length,
    };
}

export function analyzeBblLog({ summary, craftContext = {}, staticConfig = {} } = {}) {
    const quality = classifyLogQuality(summary);
    const diagnostics = [];

    if (quality.status !== QUALITY_STATUS.UNUSABLE) {
        diagnostics.push(...detectMotorImbalance(summary));
        diagnostics.push(...detectRatesMismatch(summary, craftContext, staticConfig));
    }

    return {
        quality,
        diagnostics,
        recommendations: buildRecommendations({ diagnostics, craftContext, staticConfig, quality }),
        evidenceSummary: buildEvidenceSummary({ quality, diagnostics }),
    };
}
