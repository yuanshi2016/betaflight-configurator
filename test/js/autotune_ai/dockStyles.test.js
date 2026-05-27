import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("autotune AI dock styles", () => {
    it("allows users to select and copy advisor text despite the global user-select reset", () => {
        const css = readFileSync("src/css/main.less", "utf8");

        expect(css).toContain(".autotune-ai-advisor");
        expect(css).toMatch(/\.autotune-ai-advisor[\s\S]*user-select:\s*text/u);
    });

    it("keeps the AI configuration parameters in a compact collapsible panel", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");

        expect(component).toContain("autotune-ai-section--collapsed");
        expect(component).toContain('role="button"');
        expect(component).toContain('@keydown.enter.space.prevent="toggleAiConfig"');
        expect(component).toContain('v-show="sessionState.aiConfigOpen"');
    });

    it("keeps AI advisor select menus above the right dock when portaled", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");

        expect(component).toContain('content: "z-[2101]"');
        expect((component.match(/:ui="selectPortalUi"/gu) || []).length).toBeGreaterThanOrEqual(3);
    });

    it("supports preset and custom frame sizes, whoop as a craft type, and battery cell count choices", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");
        const store = readFileSync("src/stores/autotuneAi.js", "utf8");
        const requiredFields = store.match(/const REQUIRED_CONTEXT_FIELDS = \[[\s\S]*?\];/u)?.[0] || "";
        const defaultContext = store.match(/function defaultCraftContext\(\) \{[\s\S]*?\n\}/u)?.[0] || "";

        expect(component).toContain("UInputMenu");
        expect(component).toContain('create-item="always"');
        expect(component).toContain('@create="setFrameSize"');
        expect(component).toContain("frameSizeOptions");
        expect(component).toContain('"65mm"');
        expect(component).toContain('"8寸"');
        expect(component).toContain("autotuneAiCraftWhoop");
        expect(component).toContain("batteryCellOptions");
        expect(component).toContain('"1S"');
        expect(component).toContain('"8S"');
        expect(component).not.toContain("autotuneAiIsWhoop");
        expect(component).not.toContain("knownMechanicalIssues");
        expect(component).not.toContain("environmentNotes");
        expect(requiredFields).not.toContain("isWhoop");
        expect(defaultContext).not.toContain("isWhoop");
    });

    it("keeps tuning intent out of craft information and uses file upload for input source", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");
        const store = readFileSync("src/stores/autotuneAi.js", "utf8");
        const requiredFields = store.match(/const REQUIRED_CONTEXT_FIELDS = \[[\s\S]*?\];/u)?.[0] || "";
        const defaultContext = store.match(/function defaultCraftContext\(\) \{[\s\S]*?\n\}/u)?.[0] || "";

        expect(requiredFields).not.toContain("mainSymptom");
        expect(requiredFields).not.toContain("tuningGoal");
        expect(defaultContext).not.toContain("mainSymptom");
        expect(defaultContext).not.toContain("tuningGoal");
        expect(component).not.toContain("autotuneAiMainSymptom");
        expect(component).not.toContain("autotuneAiTuningGoal");
        expect(component).toContain('type="file"');
        expect(component).toContain('accept=".txt,.cli,.dump,.csv,.bbl,.BBL"');
        expect(component).toContain("@change=\"onInputFileSelected\"");
        expect(component).not.toContain("autotuneAiCliPlaceholder");
        expect(component).not.toContain("autotuneAiParseCli");
    });

    it("shows separate input source slots and a BBL log manager", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");
        const store = readFileSync("src/stores/autotuneAi.js", "utf8");

        expect(component).toContain("autotune-ai-source-list");
        expect(component).toContain("autotuneAiCliSourceTitle");
        expect(component).toContain("autotuneAiBblSourceTitle");
        expect(component).toContain("autotuneAiBblLogManager");
        expect(component).toContain("@click=\"selectBblLog");
        expect(store).toContain("selectBblLog");
        expect(store).toContain("bblFileData");
    });

    it("keeps the input upload action additive after one source is loaded", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");

        expect(component).toContain("autotuneAiAddInputFile");
        expect(component).not.toContain("sessionState.sourceFileName ? 'autotuneAiChangeInputFile'");
    });

    it("renders bbl multi-select and preserves raw conversation content", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");

        expect(component).toContain("selectedBblLogIndexes");
        expect(component).toContain("localBblAnalysis");
        expect(component).toContain("autotune-ai-local-analysis");
        expect(component).toContain("message.content");
    });

    it("keeps non-writeable recommendation groups visible but blocks FC writes", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");

        expect(component).toContain("group.data.writeable === true");
        expect(component).toContain("formatAggregateQualityStatus");
        expect(component).toContain("formatAggregateQualityReason");
        expect(component).toContain('autotuneAiLocalAnalysis');
        expect(component).toContain('autotuneAiDiagnostics');
        expect(component).toContain('autotuneAiSelectedLogs');
        expect(component).toContain('autotuneAiDataQuality');
        expect(component).toContain('autotuneAiUserRole');
        expect(component).toContain('autotuneAiAssistantRole');
        expect(component).not.toContain('"Singleton diagnostics"');
        expect(component).not.toContain('"User"');
        expect(component).not.toContain('"AI"');
        expect(component).toContain("diagnostic?.sources");
        expect(component).toContain("recommendation?.priority");
    });
});
