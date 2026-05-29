import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const advisorComponent = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");
const zhMessages = JSON.parse(readFileSync("locales/zh_CN/messages.json", "utf8"));

const craftContextHelpKeys = [
    "autotuneAiCraftTypeHelp",
    "autotuneAiFrameSizeHelp",
    "autotuneAiAllUpWeightHelp",
    "autotuneAiPropHelp",
    "autotuneAiMotorKvHelp",
    "autotuneAiBatteryHelp",
    "autotuneAiFlightStyleHelp",
    "autotuneAiRiskPreferenceHelp",
    "autotuneAiFcModelHelp",
    "autotuneAiGyroModelHelp",
    "autotuneAiEscProtocolHelp",
    "autotuneAiMotorOutputLimitHelp",
    "autotuneAiNotesHelp",
];

describe("autotune AI craft context help", () => {
    it("uses prop model wording in Simplified Chinese", () => {
        expect(zhMessages.autotuneAiProp.message).toBe("桨叶型号");
    });

    it("renders help icons for craft context labels", () => {
        expect(advisorComponent).toContain("i-lucide-circle-alert");
        expect(advisorComponent).toContain('v-if="field.helpKey"');
        expect(advisorComponent).toContain("$t(field.helpKey)");
    });

    it("defines help text for every craft context field shown in the advisor", () => {
        craftContextHelpKeys.forEach((key) => {
            expect(advisorComponent).toContain(`helpKey: "${key}"`);
            expect(zhMessages[key]?.message).toEqual(expect.any(String));
            expect(zhMessages[key].message.length).toBeGreaterThan(8);
        });
    });
});
