const PID_KEYS = new Set([
    "p_roll",
    "i_roll",
    "d_roll",
    "f_roll",
    "p_pitch",
    "i_pitch",
    "d_pitch",
    "f_pitch",
    "p_yaw",
    "i_yaw",
    "d_yaw",
    "f_yaw",
    "d_min_roll",
    "d_min_pitch",
    "d_min_yaw",
    "feedforward_transition",
    "iterm_relax",
    "iterm_relax_cutoff",
    "iterm_windup",
    "anti_gravity_gain",
    "anti_gravity_cutoff_hz",
    "throttle_boost",
    "pidsum_limit",
    "pidsum_limit_yaw",
    "simplified_pids_mode",
    "simplified_master_multiplier",
    "simplified_i_gain",
    "simplified_d_gain",
    "simplified_pi_gain",
    "simplified_dmax_gain",
    "simplified_feedforward_gain",
    "simplified_pitch_d_gain",
    "simplified_pitch_pi_gain",
]);

const FILTER_KEYS = new Set([
    "gyro_lowpass_hz",
    "gyro_lowpass_dyn_min_hz",
    "gyro_lowpass_dyn_max_hz",
    "gyro_lowpass_type",
    "gyro_lowpass2_hz",
    "gyro_lowpass2_type",
    "gyro_notch_hz",
    "gyro_notch_cutoff",
    "gyro_notch2_hz",
    "gyro_notch2_cutoff",
    "dterm_lowpass_hz",
    "dterm_lowpass_dyn_min_hz",
    "dterm_lowpass_dyn_max_hz",
    "dterm_lowpass_type",
    "dterm_lowpass2_hz",
    "dterm_lowpass2_type",
    "dterm_notch_hz",
    "dterm_notch_cutoff",
    "yaw_lowpass_hz",
    "dyn_lpf_curve_expo",
    "dyn_notch_count",
    "dyn_notch_q",
    "dyn_notch_min_hz",
    "dyn_notch_max_hz",
    "dyn_notch_width_percent",
    "dyn_notch_range",
    "gyro_rpm_notch_harmonics",
    "gyro_rpm_notch_min_hz",
    "gyro_rpm_notch_q",
    "gyro_rpm_notch_fade_range_hz",
    "simplified_gyro_filter",
    "simplified_gyro_filter_multiplier",
    "simplified_dterm_filter",
    "simplified_dterm_filter_multiplier",
]);

const RATE_KEYS = new Set([
    "rates_type",
    "roll_rc_rate",
    "pitch_rc_rate",
    "yaw_rc_rate",
    "roll_expo",
    "pitch_expo",
    "yaw_expo",
    "roll_rate",
    "pitch_rate",
    "yaw_rate",
    "roll_rate_limit",
    "pitch_rate_limit",
    "yaw_rate_limit",
    "rc_rate",
    "rc_expo",
    "rc_yaw_expo",
    "rc_yaw_rate",
    "rc_pitch_rate",
    "rc_pitch_expo",
]);

const FEATURE_KEYS = new Set(["RPM_FILTER", "DYNAMIC_FILTER", "AIRMODE", "ANTI_GRAVITY", "BLACKBOX"]);

function parseCliValue(rawValue) {
    const value = String(rawValue || "").trim();
    if (/^-?\d+$/u.test(value)) {
        return Number.parseInt(value, 10);
    }
    if (/^-?\d+\.\d+$/u.test(value)) {
        return Number.parseFloat(value);
    }
    if (value === "ON") {
        return true;
    }
    if (value === "OFF") {
        return false;
    }
    return value;
}

function setGroupValue(summary, key, value) {
    if (PID_KEYS.has(key)) {
        summary.pid[key] = value;
        return true;
    }
    if (FILTER_KEYS.has(key)) {
        summary.filters[key] = value;
        return true;
    }
    if (RATE_KEYS.has(key)) {
        summary.rates[key] = value;
        return true;
    }
    return false;
}

export function parseCliConfig(cliText) {
    const summary = {
        profiles: {},
        pid: {},
        filters: {},
        rates: {},
        features: {},
        unsupportedLineCount: 0,
    };

    String(cliText || "")
        .split(/\r?\n/u)
        .forEach((rawLine) => {
            const line = rawLine.trim();

            if (!line || line.startsWith("#")) {
                return;
            }

            const profileMatch = line.match(/^profile\s+(\d+)$/iu);
            if (profileMatch) {
                summary.profiles.profile = Number.parseInt(profileMatch[1], 10);
                return;
            }

            const rateProfileMatch = line.match(/^rateprofile\s+(\d+)$/iu);
            if (rateProfileMatch) {
                summary.profiles.rateprofile = Number.parseInt(rateProfileMatch[1], 10);
                return;
            }

            const setMatch = line.match(/^set\s+([a-z0-9_]+)\s*=\s*(.+)$/iu);
            if (setMatch) {
                const key = setMatch[1].toLowerCase();
                const accepted = setGroupValue(summary, key, parseCliValue(setMatch[2]));
                summary.unsupportedLineCount += accepted ? 0 : 1;
                return;
            }

            const featureMatch = line.match(/^feature\s+(-?)([A-Z0-9_]+)$/u);
            if (featureMatch && FEATURE_KEYS.has(featureMatch[2])) {
                summary.features[featureMatch[2]] = featureMatch[1] !== "-";
                return;
            }

            summary.unsupportedLineCount += 1;
        });

    return summary;
}

