import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";

const mockBuildBblSummary = vi.fn();
const mockAnalyzeBblLog = vi.fn();
const mockAggregateBblAnalyses = vi.fn((results) => ({
    selectedLogIndexes: results.map((result) => result.logIndex),
    aggregateQuality: { status: "usable", reason: "mocked" },
}));
const mockBuildInputSourceSummary = vi.fn();
const mockDetectAutotuneInputSource = vi.fn();
const mockExplainTuningAnalysis = vi.fn();
const mockParseAiResponse = vi.fn();
const mockBuildAiPayload = vi.fn();
const mockParseCliConfig = vi.fn();
const mockFc = {
    RC_TUNING: null,
};

vi.mock("../../../src/js/autotune-ai/blackboxBblSummary", () => ({
    buildBblSummary: mockBuildBblSummary,
}));

vi.mock("../../../src/js/autotune-ai/blackboxBblAnalysis", () => ({
    analyzeBblLog: mockAnalyzeBblLog,
}));

vi.mock("../../../src/js/autotune-ai/blackboxBblAggregate", () => ({
    aggregateBblAnalyses: mockAggregateBblAnalyses,
}));

vi.mock("../../../src/js/autotune-ai/inputSourceDetector", () => ({
    buildInputSourceSummary: mockBuildInputSourceSummary,
    detectAutotuneInputSource: mockDetectAutotuneInputSource,
}));

vi.mock("../../../src/js/autotune-ai/cliConfigParser", () => ({
    parseCliConfig: mockParseCliConfig,
}));

vi.mock("../../../src/js/autotune-ai/providerAdapters", () => ({
    buildFirstTurnUserMessage: vi.fn(),
    explainTuningAnalysis: mockExplainTuningAnalysis,
}));

vi.mock("../../../src/js/autotune-ai/responseParser", () => ({
    parseAiResponse: mockParseAiResponse,
}));

vi.mock("../../../src/js/autotune-ai/payloadBuilder", () => ({
    buildAiPayload: mockBuildAiPayload,
}));

vi.mock("../../../src/js/fc", () => ({
    default: mockFc,
}));

const autotuneStoreModule = await import("../../../src/stores/autotuneAi");
const {
    defaultSessionState,
    estimateConversationTokens,
    MAX_HISTORY_TOKENS,
    PROVIDER_PRESETS,
    trimConversationHistoryToTokenBudget,
    useAutotuneAiStore,
} = autotuneStoreModule;

function createBblSummary({ fileName = "logs.bbl", selectedLogIndex = 0, availableIndexes = [0, 1], marker = null } = {}) {
    return {
        fileName,
        type: "bbl",
        selectedLogIndex,
        logCount: availableIndexes.length,
        availableLogs: availableIndexes.map((index) => ({
            index,
            decodedMainFrames: 100 + index,
            durationUs: 1_000_000 + index,
            requiredColumns: { time: true, gyro: true, setpoint: true, motor: true },
        })),
        fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true } },
        samples: { decodedMainFrames: 1000 + selectedLogIndex, durationUs: 2_000_000 + selectedLogIndex },
        fieldStats: { marker: marker || `stats-${selectedLogIndex}` },
    };
}

function createBblFile(array = [1, 2, 3]) {
    return {
        name: "logs.bbl",
        async arrayBuffer() {
            return Uint8Array.from(array).buffer;
        },
        async text() {
            return "";
        },
    };
}

describe("autotune AI store defaults", () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        setActivePinia(createPinia());
        vi.clearAllMocks();

        mockBuildBblSummary.mockImplementation(({ fileName = "logs.bbl", selectedLogIndex = 0 }) =>
            createBblSummary({ fileName, selectedLogIndex }),
        );
        mockAnalyzeBblLog.mockImplementation(({ summary, staticConfig }) => ({
            quality: { status: "usable", reason: summary.fieldStats.marker },
            diagnostics: [{ type: summary.fieldStats.marker, config: staticConfig }],
            recommendations: [],
        }));
        mockBuildInputSourceSummary.mockReturnValue({
            type: "cli",
            fileName: "dump.txt",
            cliSummary: { rates: { roll_rate: 700 } },
            csvSummary: null,
            bblSummary: null,
        });
        mockDetectAutotuneInputSource.mockReturnValue("cli");
        mockBuildAiPayload.mockReturnValue({});
        mockFc.RC_TUNING = null;
        mockParseCliConfig.mockReturnValue(null);
    });

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
    });

    it("tracks selected bbl logs and local analysis state", () => {
        const storeSource = readFileSync("src/stores/autotuneAi.js", "utf8");

        expect(storeSource).toContain("selectedBblLogIndexes");
        expect(storeSource).toContain("localBblAnalysis");
        expect(storeSource).toContain("localBblAnalysesByLog");
        expect(storeSource).toContain("function refreshLocalBblAnalysis()");
        expect(storeSource).toContain("function toggleBblLogSelection(index)");
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

        const store = useAutotuneAiStore();

        expect(store.sessionState.bblSummary).toBeNull();
        expect(store.sessionState.selectedBblLogIndexes).toEqual([]);
        expect(store.sessionState.localBblAnalysesByLog).toEqual({});
        expect(store.sessionState.localBblAnalysis).toBeNull();
    });

    it("refreshes local analysis with true per-log summaries for each selected log", async () => {
        const store = useAutotuneAiStore();
        mockDetectAutotuneInputSource.mockReturnValue("bbl");
        mockBuildBblSummary.mockImplementation(({ fileName = "logs.bbl", selectedLogIndex }) =>
            createBblSummary({
                fileName,
                selectedLogIndex: selectedLogIndex ?? 0,
                marker: `stats-${selectedLogIndex ?? 0}`,
            }),
        );

        await store.importInputFile(createBblFile());
        mockAnalyzeBblLog.mockClear();
        mockAggregateBblAnalyses.mockClear();

        store.setSelectedBblLogIndexes([0, 1]);

        expect(mockBuildBblSummary).toHaveBeenCalledWith({
            fileName: "logs.bbl",
            data: expect.any(Uint8Array),
            selectedLogIndex: 0,
        });
        expect(mockBuildBblSummary).toHaveBeenCalledWith({
            fileName: "logs.bbl",
            data: expect.any(Uint8Array),
            selectedLogIndex: 1,
        });
        expect(mockAnalyzeBblLog.mock.calls.map(([input]) => input.summary.fieldStats.marker)).toEqual([
            "stats-0",
            "stats-1",
        ]);
        expect(store.sessionState.localBblAnalysesByLog[0].quality.reason).toBe("stats-0");
        expect(store.sessionState.localBblAnalysesByLog[1].quality.reason).toBe("stats-1");
        expect(mockAggregateBblAnalyses).toHaveBeenCalledWith([
            expect.objectContaining({ logIndex: 0 }),
            expect.objectContaining({ logIndex: 1 }),
        ]);
    });

    it("sanitizes selected log indexes against available logs", async () => {
        const store = useAutotuneAiStore();
        mockDetectAutotuneInputSource.mockReturnValue("bbl");
        mockBuildBblSummary.mockImplementation(({ fileName = "logs.bbl", selectedLogIndex }) =>
            createBblSummary({
                fileName,
                selectedLogIndex: selectedLogIndex ?? 2,
                availableIndexes: [2, 4],
                marker: `stats-${selectedLogIndex ?? 2}`,
            }),
        );

        await store.importInputFile(createBblFile());
        mockAnalyzeBblLog.mockClear();

        store.setSelectedBblLogIndexes([1, 4, 7]);

        expect(store.sessionState.selectedBblLogIndexes).toEqual([4]);
        expect(mockAnalyzeBblLog).toHaveBeenCalledTimes(1);
        expect(mockAnalyzeBblLog).toHaveBeenCalledWith(
            expect.objectContaining({
                summary: expect.objectContaining({
                    selectedLogIndex: 4,
                }),
            }),
        );
    });

    it("falls back to the resolved selected log index when requested BBL log is invalid", async () => {
        const store = useAutotuneAiStore();
        mockDetectAutotuneInputSource.mockReturnValue("bbl");
        mockBuildBblSummary.mockImplementation(({ fileName = "logs.bbl", selectedLogIndex }) => {
            if (selectedLogIndex === undefined) {
                return createBblSummary({ fileName, selectedLogIndex: 1, availableIndexes: [1, 2] });
            }

            return createBblSummary({
                fileName,
                selectedLogIndex: selectedLogIndex === 99 ? 2 : selectedLogIndex,
                availableIndexes: [1, 2],
                marker: `stats-${selectedLogIndex === 99 ? 2 : selectedLogIndex}`,
            });
        });

        await store.importInputFile(createBblFile());
        store.setSelectedBblLogIndexes([]);

        const summary = store.selectBblLog(99);

        expect(summary.selectedLogIndex).toBe(2);
        expect(store.sessionState.selectedBblLogIndexes).toEqual([2]);
    });

    it("uses current FC rates before parsed CLI rates for local analysis config", async () => {
        mockFc.RC_TUNING = {
            roll_rate: 900,
            pitch_rate: 800,
        };

        const store = useAutotuneAiStore();
        store.sessionState.parsedCliSummary = { rates: { roll_rate: 700 } };
        mockDetectAutotuneInputSource.mockReturnValue("bbl");

        await store.importInputFile(createBblFile());

        const [{ staticConfig }] = mockAnalyzeBblLog.mock.calls.at(-1);
        expect(staticConfig).toEqual({
            rates: {
                roll_rate: 900,
                pitch_rate: 800,
            },
        });
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

    it("keeps raw conversation history intact when follow-up requests need trimming", async () => {
        const store = useAutotuneAiStore();
        const longMessage = "x".repeat(9000);
        const firstTurn = `Analyze this compact Betaflight tuning payload\n${longMessage}`;
        const assistantReply = `assistant reply ${longMessage}`;
        const followUpReply = `follow up reply ${longMessage}`;

        mockExplainTuningAnalysis.mockResolvedValueOnce(followUpReply);
        mockParseAiResponse.mockImplementation(() => ({ summary: "parsed" }));

        store.sessionState.conversationHistory = [
            { role: "user", content: firstTurn },
            { role: "assistant", content: assistantReply },
        ];
        store.sessionState.followUpInput = "Need more detail";

        await store.sendFollowUp();

        expect(store.sessionState.conversationHistory[0].content).toBe(firstTurn);
        expect(store.sessionState.conversationHistory[1].content).toBe(assistantReply);
        expect(store.sessionState.conversationHistory[2]).toEqual({ role: "user", content: "Need more detail" });
        expect(store.sessionState.conversationHistory[3]).toEqual({ role: "assistant", content: followUpReply });
        expect(store.sessionState.conversationTrimmed).toBe(true);
        expect(mockExplainTuningAnalysis).toHaveBeenCalledWith(
            expect.anything(),
            null,
            expect.any(Array),
            undefined,
            expect.anything(),
        );
        const providerHistory = mockExplainTuningAnalysis.mock.calls[0][2];
        expect(providerHistory.length).toBeLessThanOrEqual(store.sessionState.conversationHistory.length);
        expect(providerHistory[0].content).not.toBe(store.sessionState.conversationHistory[0].content);
    });

    it("clears stale AI output when importing a new input file", async () => {
        const store = useAutotuneAiStore();
        store.sessionState.aiResponse = { summary: "stale" };
        store.sessionState.lastPayload = { source: "old" };
        store.sessionState.conversationHistory = [{ role: "assistant", content: "old answer" }];
        store.sessionState.conversationTrimmed = true;
        store.sessionState.followUpInput = "old question";
        store.sessionState.followUpState = "error";

        await store.importInputFile(createBblFile([9, 9, 9]));

        expect(store.sessionState.aiResponse).toBeNull();
        expect(store.sessionState.lastPayload).toBeNull();
        expect(store.sessionState.conversationHistory).toEqual([]);
        expect(store.sessionState.conversationTrimmed).toBe(false);
        expect(store.sessionState.followUpInput).toBe("");
        expect(store.sessionState.followUpState).toBe("idle");
    });

    it("clears stale AI output when the selected BBL logs change", async () => {
        const store = useAutotuneAiStore();
        mockDetectAutotuneInputSource.mockReturnValue("bbl");
        await store.importInputFile(createBblFile());

        store.sessionState.aiResponse = { summary: "stale" };
        store.sessionState.lastPayload = { source: "old" };
        store.sessionState.conversationHistory = [{ role: "assistant", content: "old answer" }];
        store.sessionState.conversationTrimmed = true;
        store.sessionState.followUpInput = "old question";
        store.sessionState.followUpState = "error";

        store.setSelectedBblLogIndexes([0, 1]);

        expect(store.sessionState.aiResponse).toBeNull();
        expect(store.sessionState.lastPayload).toBeNull();
        expect(store.sessionState.conversationHistory).toEqual([]);
        expect(store.sessionState.conversationTrimmed).toBe(false);
        expect(store.sessionState.followUpInput).toBe("");
        expect(store.sessionState.followUpState).toBe("idle");
    });

    it("clears stale AI output when parsed CLI input changes the source summary", async () => {
        const store = useAutotuneAiStore();
        store.sessionState.aiResponse = { summary: "stale" };
        store.sessionState.lastPayload = { source: "old" };
        store.sessionState.conversationHistory = [{ role: "assistant", content: "old answer" }];
        store.sessionState.conversationTrimmed = true;
        store.sessionState.followUpInput = "old question";
        store.sessionState.followUpState = "error";

        mockParseCliConfig.mockReturnValue({ rates: { roll_rate: 700 } });
        store.sessionState.cliText = "set roll_rate = 700";
        store.parseCliInput();
        await nextTick();

        expect(store.sessionState.aiResponse).toBeNull();
        expect(store.sessionState.lastPayload).toBeNull();
        expect(store.sessionState.conversationHistory).toEqual([]);
        expect(store.sessionState.conversationTrimmed).toBe(false);
        expect(store.sessionState.followUpInput).toBe("");
        expect(store.sessionState.followUpState).toBe("idle");
    });
});
