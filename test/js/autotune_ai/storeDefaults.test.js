import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
    defaultSessionState,
    estimateConversationTokens,
    MAX_HISTORY_TOKENS,
    PROVIDER_PRESETS,
    trimConversationHistoryToTokenBudget,
    useAutotuneAiStore,
} from "../../../src/stores/autotuneAi";

describe("autotune AI store defaults", () => {
    it("defaults the DeepSeek presets to V4 Pro", () => {
        const deepSeekPresets = PROVIDER_PRESETS.filter((preset) => preset.value.startsWith("deepseek"));

        expect(deepSeekPresets).toHaveLength(2);
        expect(deepSeekPresets.every((preset) => preset.model === "deepseek-v4-pro")).toBe(true);
    });

    it("keeps CLI and BBL input state as independent sources", () => {
        const storeSource = readFileSync("src/stores/autotuneAi.js", "utf8");

        expect(storeSource).toContain("parsedCliSummary: null");
        expect(storeSource).toContain("bblSummary: null");
        expect(storeSource).toContain("bblFileData: null");
        expect(storeSource).toContain("conversationHistory: []");
        expect(storeSource).toContain("followUpInput: \"\"");
        expect(storeSource).toContain("followUpState: \"idle\"");
        expect(storeSource).toContain("MAX_HISTORY_TOKENS = 6000");
        expect(storeSource).toContain("CRAFT_CONTEXT_PROFILES_KEY");
        expect(storeSource).toContain("craftContextProfiles");
        expect(storeSource).toContain("applyCraftContextProfile");
        expect(storeSource).toContain("saveCraftContextProfile");
        expect(storeSource).toContain("inputSourceSummary");
        expect(storeSource).not.toContain("sessionState.bblSummary = null;\n        sessionState.sourceFileName = cliText");
        expect(storeSource).not.toContain("sessionState.parsedCliSummary = imported.cliSummary");
    });

    it("tracks selected bbl logs and local analysis state", () => {
        const storeSource = readFileSync("src/stores/autotuneAi.js", "utf8");

        expect(storeSource).toContain("selectedBblLogIndexes");
        expect(storeSource).toContain("localBblAnalysis");
        expect(storeSource).toContain("localBblAnalysesByLog");
        expect(storeSource).toContain("function refreshLocalBblAnalysis()");
        expect(storeSource).toContain("function toggleBblLogSelection(index)");
        expect(storeSource).toContain("refreshLocalBblAnalysis();");
        expect(storeSource).toContain("localBblAnalysis: sessionState.localBblAnalysis");
    });

    it("defaults local bbl analysis state to empty values", () => {
        expect(defaultSessionState()).toMatchObject({
            selectedBblLogIndexes: [],
            localBblAnalysesByLog: {},
            localBblAnalysis: null,
        });
    });

    it("clears stale persisted local bbl analysis when no valid bbl is loaded", () => {
        sessionStorage.setItem(
            "AutotuneAiPanelState",
            JSON.stringify({
                AutotuneAiPanelState: {
                    bblSummary: null,
                    selectedBblLogIndexes: [1, 2],
                    localBblAnalysesByLog: { 1: { logIndex: 1 } },
                    localBblAnalysis: { selectedLogIndexes: [1, 2] },
                },
            }),
        );

        setActivePinia(createPinia());
        const store = useAutotuneAiStore();

        expect(store.sessionState.bblSummary).toBeNull();
        expect(store.sessionState.selectedBblLogIndexes).toEqual([]);
        expect(store.sessionState.localBblAnalysesByLog).toEqual({});
        expect(store.sessionState.localBblAnalysis).toBeNull();
    });

    it("trims conversation history by estimated token budget while keeping context anchors", () => {
        const history = [
            { role: "user", content: `initial payload ${"a".repeat(120)}` },
            { role: "assistant", content: `initial response ${"b".repeat(80)}` },
            { role: "user", content: `old follow up ${"c".repeat(80)}` },
            { role: "assistant", content: `old answer ${"d".repeat(80)}` },
            { role: "user", content: `recent follow up ${"e".repeat(80)}` },
            { role: "assistant", content: `recent answer ${"f".repeat(80)}` },
        ];

        const result = trimConversationHistoryToTokenBudget(history, 140);

        expect(result.trimmed).toBe(true);
        expect(result.history[0]).toEqual(history[0]);
        expect(result.history).toContain(history.at(-1));
        expect(result.history).not.toContain(history[2]);
        expect(estimateConversationTokens(result.history)).toBeLessThanOrEqual(140);
    });

    it("uses a token budget for conversation history", () => {
        expect(MAX_HISTORY_TOKENS).toBe(6000);
    });
});
