import { ComplexFFT } from "../blackbox/fft.js";

const QUALITY_STATUS = {
    UNUSABLE: "unusable",
    DEGRADED: "degraded",
    USABLE: "usable",
};

const MIN_REQUIRED_FRAMES = 100;
const MIN_REQUIRED_DURATION_US = 200_000;
const HIGH_IMBALANCE_RATIO = 0.08;
const MEDIUM_IMBALANCE_RATIO = 0.05;
const MIN_MOTOR_SAMPLE_COUNT = 100;
const MAX_LOW_USAGE_ABS_MEAN = 25;
const MAX_LOW_USAGE_RMS = 35;
const MAX_LOW_USAGE_PEAK = 80;
const AXIS_NAMES = ["roll", "pitch", "yaw"];
const MIN_FFT_SAMPLES = 64;
const MIN_MOVING_SETPOINT = 20;
const MAX_STEADY_SETPOINT = 5;
const MIN_VALID_DT_US = 10;

const THRESHOLDS_BY_CRAFT_CLASS = {
    "1-4in": {
        pThresholdMid: 18,
        pThresholdHigh: 32,
        iThresholdMid: 4,
        iThresholdHigh: 8,
        dThresholdMid: 30,
        dThresholdHigh: 55,
        ffThresholdMid: 15,
        ffThresholdHigh: 28,
        gyroPeakMagnitudeThreshold: 200,
        dtermHighFreqThreshold: 5,
    },
    "5-6in": {
        pThresholdMid: 22,
        pThresholdHigh: 38,
        iThresholdMid: 4,
        iThresholdHigh: 9,
        dThresholdMid: 35,
        dThresholdHigh: 65,
        ffThresholdMid: 18,
        ffThresholdHigh: 32,
        gyroPeakMagnitudeThreshold: 220,
        dtermHighFreqThreshold: 6,
    },
    "7-10in": {
        pThresholdMid: 26,
        pThresholdHigh: 42,
        iThresholdMid: 5,
        iThresholdHigh: 10,
        dThresholdMid: 40,
        dThresholdHigh: 70,
        ffThresholdMid: 20,
        ffThresholdHigh: 36,
        gyroPeakMagnitudeThreshold: 240,
        dtermHighFreqThreshold: 7,
    },
    "11-22in": {
        pThresholdMid: 30,
        pThresholdHigh: 48,
        iThresholdMid: 6,
        iThresholdHigh: 12,
        dThresholdMid: 45,
        dThresholdHigh: 80,
        ffThresholdMid: 22,
        ffThresholdHigh: 40,
        gyroPeakMagnitudeThreshold: 260,
        dtermHighFreqThreshold: 8,
    },
};

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

function getCraftClass(craftContext = {}, analysisInput = {}) {
    if (analysisInput?.craftClass) {
        return analysisInput.craftClass;
    }

    const frameSize = Number.parseFloat(String(craftContext?.frameSize || "").replace(/[^0-9.]/gu, ""));
    if (Number.isFinite(frameSize)) {
        if (frameSize <= 4) {
            return "1-4in";
        }
        if (frameSize <= 6) {
            return "5-6in";
        }
        if (frameSize <= 10) {
            return "7-10in";
        }
        return "11-22in";
    }

    return "5-6in";
}

function median(values) {
    const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
    if (!sorted.length) {
        return null;
    }
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rms(values) {
    return values.length ? Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) : 0;
}

function nextPowerOfTwoFloor(value) {
    let size = 1;
    while (size * 2 <= value) {
        size *= 2;
    }
    return size;
}

function createAdvice(direction, confidence, reason, extra = {}) {
    return {
        direction,
        confidence,
        reason,
        ...extra,
    };
}

function getConfidenceLevel(confidence) {
    return ["low", "medium", "high"].indexOf(confidence);
}

function boostConfidence(confidence, count) {
    const level = getConfidenceLevel(confidence);
    if (level === -1 || count < 2) {
        return confidence;
    }
    return ["low", "medium", "high"][Math.min(level + 1, 2)];
}

function createThresholdAdvice(value, midThreshold, highThreshold, reasonBase) {
    if (!Number.isFinite(value)) {
        return createAdvice("unknown", "low", `${reasonBase}_missing`);
    }
    if (value >= highThreshold) {
        return createAdvice("increase", "high", `${reasonBase}_high`, { metric: Number(value.toFixed(2)) });
    }
    if (value >= midThreshold) {
        return createAdvice("tune", "medium", `${reasonBase}_mid`, { metric: Number(value.toFixed(2)) });
    }
    return createAdvice("healthy", "medium", `${reasonBase}_healthy`, { metric: Number(value.toFixed(2)) });
}

function analyzeTimeDomain(axisSeries = {}, craftClass) {
    const timeUs = Array.isArray(axisSeries?.timeUs) ? axisSeries.timeUs : [];
    const gyro = Array.isArray(axisSeries?.gyro) ? axisSeries.gyro : [];
    const setpoint = Array.isArray(axisSeries?.setpoint) ? axisSeries.setpoint : [];
    if (!timeUs.length || gyro.length !== timeUs.length || setpoint.length !== timeUs.length) {
        return {
            metrics: null,
            pidAdvice: {},
            diagnostics: [],
        };
    }

    const errors = setpoint.map((value, index) => value - gyro[index]);
    const movingErrors = [];
    const steadyErrors = [];

    setpoint.forEach((value, index) => {
        if (Math.abs(value) >= MIN_MOVING_SETPOINT) {
            movingErrors.push(errors[index]);
            return;
        }

        if (Math.abs(value) <= MAX_STEADY_SETPOINT) {
            steadyErrors.push(errors[index]);
        }
    });

    const metrics = {
        rmsError: Number(rms(errors).toFixed(2)),
        maxError: Number(Math.max(...errors.map((value) => Math.abs(value))).toFixed(2)),
        meanErrMoving: Number(mean(movingErrors.map((value) => Math.abs(value))).toFixed(2)),
        meanErrSteady: Number(Math.abs(mean(steadyErrors)).toFixed(2)),
    };

    const thresholds = THRESHOLDS_BY_CRAFT_CLASS[craftClass] || THRESHOLDS_BY_CRAFT_CLASS["5-6in"];
    const pidAdvice = {
        p: createThresholdAdvice(
            metrics.meanErrMoving,
            thresholds.pThresholdMid,
            thresholds.pThresholdHigh,
            "moving_error",
        ),
        i: createThresholdAdvice(
            metrics.meanErrSteady,
            thresholds.iThresholdMid,
            thresholds.iThresholdHigh,
            "steady_error",
        ),
        d: createThresholdAdvice(metrics.maxError, thresholds.dThresholdMid, thresholds.dThresholdHigh, "peak_error"),
        ff: createThresholdAdvice(
            metrics.meanErrMoving,
            thresholds.ffThresholdMid,
            thresholds.ffThresholdHigh,
            "feedforward_error",
        ),
    };

    return {
        metrics,
        pidAdvice,
        diagnostics: [
            {
                type: "pid_time_domain",
                confidence: pidAdvice.p.confidence,
                risk: pidAdvice.d.direction === "increase" ? "moderate" : "low",
                explanation: "Time-domain tracking error indicates how far the craft is from the requested rate response.",
                evidence: {
                    craftClass,
                    rmsError: metrics.rmsError,
                    maxError: metrics.maxError,
                    meanErrMoving: metrics.meanErrMoving,
                    meanErrSteady: metrics.meanErrSteady,
                },
            },
        ],
    };
}

function computeFrequencySpectrum(values, sampleRateHz) {
    const size = nextPowerOfTwoFloor(values.length);
    const segment = values.slice(0, size);
    const average = mean(segment);
    const windowed = new Float64Array(size);
    for (let index = 0; index < size; index += 1) {
        const window = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1)));
        windowed[index] = (segment[index] - average) * window;
    }

    const fft = new ComplexFFT(size, false);
    const output = new Float64Array(size * 2);
    fft.simple(output, windowed, "real");

    const bins = [];
    for (let index = 1; index <= Math.floor(size / 2); index += 1) {
        const real = output[index * 2];
        const imaginary = output[index * 2 + 1];
        bins.push({
            frequencyHz: (index * sampleRateHz) / size,
            magnitude: Math.hypot(real, imaginary),
        });
    }
    return bins;
}

function analyzeFrequencyDomain(axisSeries = {}, craftClass) {
    const timeUs = Array.isArray(axisSeries?.timeUs) ? axisSeries.timeUs : [];
    const gyro = Array.isArray(axisSeries?.gyro) ? axisSeries.gyro : [];
    if (timeUs.length < MIN_FFT_SAMPLES || gyro.length !== timeUs.length) {
        return {
            metrics: { fftUsable: false, reason: "insufficient_samples" },
            filterAdvice: {},
            diagnostics: [],
        };
    }

    const deltas = [];
    for (let index = 1; index < timeUs.length; index += 1) {
        deltas.push(timeUs[index] - timeUs[index - 1]);
    }
    const dtUsMedian = median(deltas);
    if (!Number.isFinite(dtUsMedian) || dtUsMedian < MIN_VALID_DT_US) {
        return {
            metrics: { fftUsable: false, reason: "invalid_sample_timing" },
            filterAdvice: {},
            diagnostics: [],
        };
    }

    const sampleRateHz = 1_000_000 / dtUsMedian;
    const gyroBins = computeFrequencySpectrum(gyro, sampleRateHz).filter(
        (bin) => bin.frequencyHz >= 80 && bin.frequencyHz <= 400,
    );
    if (!gyroBins.length) {
        return {
            metrics: { fftUsable: false, reason: "no_valid_frequency_bins" },
            filterAdvice: {},
            diagnostics: [],
        };
    }

    const gyroPeak = gyroBins.reduce((best, current) => (current.magnitude > best.magnitude ? current : best), gyroBins[0]);
    let dtermHighFreqAvg;
    if (Array.isArray(axisSeries?.dterm) && axisSeries.dterm.length === timeUs.length) {
        const dtermBins = computeFrequencySpectrum(axisSeries.dterm, sampleRateHz).filter((bin) => bin.frequencyHz > 150);
        dtermHighFreqAvg = dtermBins.length ? mean(dtermBins.map((bin) => bin.magnitude)) : 0;
    }

    const metrics = {
        fftUsable: true,
        sampleRateHz: Number(sampleRateHz.toFixed(2)),
        gyroPeakFreqHz: Number(gyroPeak.frequencyHz.toFixed(2)),
        gyroPeakMagnitude: Number(gyroPeak.magnitude.toFixed(2)),
    };
    if (Number.isFinite(dtermHighFreqAvg)) {
        metrics.dtermHighFreqAvg = Number(dtermHighFreqAvg.toFixed(2));
    }

    const thresholds = THRESHOLDS_BY_CRAFT_CLASS[craftClass] || THRESHOLDS_BY_CRAFT_CLASS["5-6in"];
    const filterAdvice = {};
    if (gyroPeak.magnitude >= thresholds.gyroPeakMagnitudeThreshold) {
        filterAdvice.gyroNotch = createAdvice("enable", "medium", "gyro_peak_detected", {
            targetHz: metrics.gyroPeakFreqHz,
            magnitude: metrics.gyroPeakMagnitude,
        });
    }
    if (Number.isFinite(dtermHighFreqAvg) && dtermHighFreqAvg >= thresholds.dtermHighFreqThreshold) {
        filterAdvice.dtermLowpass = createAdvice("lower", "medium", "dterm_high_frequency_energy", {
            metric: metrics.dtermHighFreqAvg,
        });
    }

    const diagnostics = Object.keys(filterAdvice).length
        ? [
              {
                  type: "filter_frequency_domain",
                  confidence: "medium",
                  risk: filterAdvice.dtermLowpass ? "moderate" : "low",
                  explanation: "Frequency-domain energy highlights resonant peaks and high-frequency D-term content.",
                  evidence: {
                      craftClass,
                      sampleRateHz: metrics.sampleRateHz,
                      gyroPeakFreqHz: metrics.gyroPeakFreqHz,
                      gyroPeakMagnitude: metrics.gyroPeakMagnitude,
                      dtermHighFreqAvg: metrics.dtermHighFreqAvg,
                  },
              },
          ]
        : [];

    return { metrics, filterAdvice, diagnostics };
}

function analyzeAxes(analysisInput, craftContext) {
    const craftClass = getCraftClass(craftContext, analysisInput);
    const axes = {};
    const diagnostics = [];

    AXIS_NAMES.forEach((axisName) => {
        const axisSeries = analysisInput?.axes?.[axisName];
        if (!axisSeries) {
            return;
        }

        const timeDomain = analyzeTimeDomain(axisSeries, craftClass);
        const frequencyDomain = analyzeFrequencyDomain(axisSeries, craftClass);
        axes[axisName] = {
            timeDomain: timeDomain.metrics,
            frequencyDomain: frequencyDomain.metrics,
            pidAdvice: timeDomain.pidAdvice,
            filterAdvice: frequencyDomain.filterAdvice,
            quality: {
                craftClass,
                fftUsable: Boolean(frequencyDomain.metrics?.fftUsable),
            },
        };
        diagnostics.push(
            ...timeDomain.diagnostics.map((item) => ({ ...item, evidence: { axis: axisName, ...item.evidence } })),
            ...frequencyDomain.diagnostics.map((item) => ({ ...item, evidence: { axis: axisName, ...item.evidence } })),
        );
    });

    return { axes, diagnostics };
}

export function buildRecommendations({ diagnostics = [], craftContext = {}, staticConfig = {}, quality = {}, axes = {} } = {}) {
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

    Object.entries(axes).forEach(([axisName, axisResult]) => {
        const pidAdvice = axisResult?.pidAdvice || {};
        const filterAdvice = axisResult?.filterAdvice || {};

        if (pidAdvice.p?.direction === "increase") {
            recommendations.push({
                type: `increase_p_${axisName}`,
                group: "pid",
                priority: pidAdvice.p.confidence === "high" ? "high" : "medium",
                actionability: "config_review",
                explanation: `Increase ${axisName} P because moving error remains elevated under stick demand.`,
            });
        }

        if (filterAdvice.gyroNotch?.direction === "enable") {
            recommendations.push({
                type: `review_gyro_notch_${axisName}`,
                group: "filters",
                priority: "medium",
                actionability: "config_review",
                explanation: `Review ${axisName} gyro notch placement around the detected spectral peak.`,
            });
        }
    });

    return recommendations;
}

export function buildEvidenceSummary({ quality = {}, diagnostics = [], axes = {} } = {}) {
    const summary = {
        qualityStatus: quality.status || QUALITY_STATUS.UNUSABLE,
        qualityReason: quality.reason || "missing_quality",
        diagnosticTypes: diagnostics.map((diagnostic) => diagnostic.type),
        diagnosticCount: diagnostics.length,
    };

    const analyzedAxes = Object.keys(axes);
    if (analyzedAxes.length) {
        summary.analyzedAxes = analyzedAxes;
    }

    return summary;
}

export function analyzeBblLog({ summary, craftContext = {}, staticConfig = {} } = {}) {
    const quality = classifyLogQuality(summary);
    const diagnostics = [];
    let axes = {};

    if (summary?.analysisInput?.axes) {
        const axisAnalysis = analyzeAxes(summary?.analysisInput, craftContext);
        axes = axisAnalysis.axes;
        diagnostics.push(...axisAnalysis.diagnostics);
    }

    if (quality.status !== QUALITY_STATUS.UNUSABLE) {
        diagnostics.push(...detectMotorImbalance(summary));
        diagnostics.push(...detectRatesMismatch(summary, craftContext, staticConfig));
    }

    return {
        quality,
        axes,
        diagnostics,
        recommendations: buildRecommendations({ diagnostics, craftContext, staticConfig, quality, axes }),
        evidenceSummary: buildEvidenceSummary({ quality, diagnostics, axes }),
    };
}
