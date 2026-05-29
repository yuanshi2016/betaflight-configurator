import { describe, expect, it } from "vitest";
import { parseCliConfig } from "../../../src/js/autotune-ai/cliConfigParser";

describe("autotune AI CLI config parser", () => {
    it("extracts tuning keys from diff all and ignores unsupported commands", () => {
        const summary = parseCliConfig(`
# diff all
profile 1
rateprofile 2
set p_pitch = 58
set dyn_notch_count = 3
set roll_rc_rate = 8
set osd_units = IMPERIAL
feature RPM_FILTER
feature GPS
save
`);

        expect(summary.profiles).toEqual({ profile: 1, rateprofile: 2 });
        expect(summary.pid).toEqual({ p_pitch: 58 });
        expect(summary.filters).toEqual({ dyn_notch_count: 3 });
        expect(summary.rates).toEqual({ roll_rc_rate: 8 });
        expect(summary.features).toEqual({ RPM_FILTER: true });
        expect(summary.unsupportedLineCount).toBeGreaterThan(0);
        expect(JSON.stringify(summary)).not.toContain("osd_units");
        expect(JSON.stringify(summary)).not.toContain("save");
    });
});
