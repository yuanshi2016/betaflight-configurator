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
    TUNING_SLIDERS: null,
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
        mockFc.TUNING_SLIDERS = null;
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
        expect(storeSource).toContain("selectRecommendedBblLogs");
        expect(storeSource).toContain("function refreshLocalBblAnalysis()");
        expect(storeSource).toContain("function toggleBblLogSelection(index)");
        expect(storeSource).toContain("localBblAnalysis: sessionState.localBblAnalysis");
    });

    it("tracks local write envelopes and the reconciled effective plan", () => {
        const storeSource = readFileSync("src/stores/autotuneAi.js", "utf8");

        expect(storeSource).toContain("localWriteEnvelope");
        expect(storeSource).toContain("effectivePlan");
        expect(storeSource).toContain("sessionState.localWriteEnvelope");
        expect(storeSource).toContain("sessionState.effectivePlan");
    });

    it("defaults local bbl analysis state to empty values", () => {
        expect(defaultSessionState()).toMatchObject({
            selectedBblLogIndexes: [],
            localBblAnalysesByLog: {},
            localBblAnalysis: null,
        });
    });

    it("defaults local write envelope and effective plan state to empty values", () => {
        expect(defaultSessionState()).toMatchObject({
            localWriteEnvelope: null,
            effectivePlan: null,
        });
    });

    it("clears stale persisted local bbl analysis when no valid bbl is loaded", () => {
        sessionStorage.setItem(
            "AutotuneAiPanelState",
            JSON.stringify({
                AutotuneAiPanelState: {
                    sourceType: "bbl",
                    bblSummary: null,
                    selectedBblLogIndexes: [1, 2],
                    localBblAnalysesByLog: { 1: { logIndex: 1 } },
                    localBblAnalysis: { selectedLogIndexes: [1, 2] },
                    localWriteEnvelope: { rates: { writeableAllowed: true } },
                    effectivePlan: { groups: { rates: { writeable: true, values: { roll_rate: 90 } } } },
                    aiResponse: { summary: "stale" },
                    lastPayload: { sourceSummary: { hasBbl: true } },
                    conversationHistory: [{ role: "assistant", content: "stale" }],
                },
            }),
        );

        const store = useAutotuneAiStore();

        expect(store.sessionState.bblSummary).toBeNull();
        expect(store.sessionState.selectedBblLogIndexes).toEqual([]);
        expect(store.sessionState.localBblAnalysesByLog).toEqual({});
        expect(store.sessionState.localBblAnalysis).toBeNull();
        expect(store.sessionState.localWriteEnvelope).toBeNull();
        expect(store.sessionState.effectivePlan).toBeNull();
        expect(store.sessionState.aiResponse).toBeNull();
        expect(store.sessionState.lastPayload).toBeNull();
        expect(store.sessionState.conversationHistory).toEqual([]);
    });

    it("clears stale persisted bbl-backed ai state when only bbl metadata survives a reload", () => {
        sessionStorage.setItem(
            "AutotuneAiPanelState",
            JSON.stringify({
                AutotuneAiPanelState: {
                    sourceType: "bbl",
                    sourceFileName: "logs.bbl",
                    bblSummary: createBblSummary(),
                    bblFileData: {
                        fileName: "logs.bbl",
                        retainedInMemory: true,
                        byteLength: 3,
                    },
                    selectedBblLogIndexes: [0],
                    localBblAnalysesByLog: { 0: { logIndex: 0 } },
                    localBblAnalysis: { selectedLogIndexes: [0] },
                    localWriteEnvelope: { rates: { writeableAllowed: true } },
                    effectivePlan: { groups: { rates: { writeable: true, values: { roll_rate: 90 } } } },
                    aiResponse: { summary: "stale" },
                    lastPayload: { sourceSummary: { hasBbl: true } },
                    conversationHistory: [{ role: "assistant", content: "stale" }],
                },
            }),
        );

        const store = useAutotuneAiStore();

        expect(store.sessionState.bblSummary).toBeNull();
        expect(store.sessionState.bblFileData).toBeNull();
        expect(store.sessionState.selectedBblLogIndexes).toEqual([]);
        expect(store.sessionState.localBblAnalysesByLog).toEqual({});
        expect(store.sessionState.localBblAnalysis).toBeNull();
        expect(store.sessionState.localWriteEnvelope).toBeNull();
        expect(store.sessionState.effectivePlan).toBeNull();
        expect(store.sessionState.aiResponse).toBeNull();
        expect(store.sessionState.lastPayload).toBeNull();
        expect(store.sessionState.conversationHistory).toEqual([]);
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

    it("selects recommended bbl logs by preferring usable logs over degraded ones", async () => {
        const store = useAutotuneAiStore();
        mockDetectAutotuneInputSource.mockReturnValue("bbl");
        mockBuildBblSummary.mockImplementation(({ fileName = "logs.bbl", selectedLogIndex }) =>
            createBblSummary({
                fileName,
                selectedLogIndex: selectedLogIndex ?? 0,
                availableIndexes: [0, 1, 2, 3, 4, 5],
                marker: `stats-${selectedLogIndex ?? 0}`,
            }),
        );
        mockAnalyzeBblLog.mockImplementation(({ summary }) => ({
            quality: {
                status:
                    summary.selectedLogIndex === 0
                        ? "unusable"
                        : summary.selectedLogIndex === 1 ? "degraded" : "usable",
                reason: `quality-${summary.selectedLogIndex}`,
            },
            diagnostics: [],
            recommendations: [],
        }));

        await store.importInputFile(createBblFile());

        expect(store.selectRecommendedBblLogs()).toEqual([3, 4, 5]);
        expect(store.sessionState.selectedBblLogIndexes).toEqual([3, 4, 5]);
    });

    it("prefers longer usable bbl logs when choosing the recommended subset", async () => {
        const store = useAutotuneAiStore();
        mockDetectAutotuneInputSource.mockReturnValue("bbl");
        mockBuildBblSummary.mockImplementation(({ fileName = "logs.bbl", selectedLogIndex }) => ({
            ...createBblSummary({
                fileName,
                selectedLogIndex: selectedLogIndex ?? 0,
                availableIndexes: [0, 1, 2, 3, 4],
                marker: `stats-${selectedLogIndex ?? 0}`,
            }),
            availableLogs: [
                { index: 0, decodedMainFrames: 100, durationUs: 300_000, requiredColumns: { time: true, gyro: true, setpoint: true, motor: true } },
                { index: 1, decodedMainFrames: 100, durationUs: 900_000, requiredColumns: { time: true, gyro: true, setpoint: true, motor: true } },
                { index: 2, decodedMainFrames: 100, durationUs: 600_000, requiredColumns: { time: true, gyro: true, setpoint: true, motor: true } },
                { index: 3, decodedMainFrames: 100, durationUs: 1_200_000, requiredColumns: { time: true, gyro: true, setpoint: true, motor: true } },
                { index: 4, decodedMainFrames: 100, durationUs: 400_000, requiredColumns: { time: true, gyro: true, setpoint: true, motor: true } },
            ],
        }));
        mockAnalyzeBblLog.mockImplementation(({ summary }) => ({
            quality: {
                status: summary.selectedLogIndex === 4 ? "degraded" : "usable",
                reason: `quality-${summary.selectedLogIndex}`,
            },
            diagnostics: [],
            recommendations: [],
        }));

        await store.importInputFile(createBblFile());

        expect(store.selectRecommendedBblLogs()).toEqual([1, 2, 3]);
        expect(store.sessionState.selectedBblLogIndexes).toEqual([1, 2, 3]);
    });

    it("prefers healthier decode ratios over raw duration when ranking usable bbl logs", async () => {
        const store = useAutotuneAiStore();
        mockDetectAutotuneInputSource.mockReturnValue("bbl");
        mockBuildBblSummary.mockImplementation(({ fileName = "logs.bbl", selectedLogIndex }) => ({
            ...createBblSummary({
                fileName,
                selectedLogIndex: selectedLogIndex ?? 0,
                availableIndexes: [0, 1, 2, 3],
                marker: `stats-${selectedLogIndex ?? 0}`,
            }),
            availableLogs: [
                {
                    index: 0,
                    decodedMainFrames: 10_000,
                    corruptFrames: 9_000,
                    durationUs: 2_000_000,
                    requiredColumns: { time: true, gyro: true, setpoint: true, motor: true },
                },
                {
                    index: 1,
                    decodedMainFrames: 10_000,
                    corruptFrames: 500,
                    durationUs: 1_000_000,
                    requiredColumns: { time: true, gyro: true, setpoint: true, motor: true },
                },
                {
                    index: 2,
                    decodedMainFrames: 10_000,
                    corruptFrames: 1_000,
                    durationUs: 1_500_000,
                    requiredColumns: { time: true, gyro: true, setpoint: true, motor: true },
                },
                {
                    index: 3,
                    decodedMainFrames: 10_000,
                    corruptFrames: 0,
                    durationUs: 800_000,
                    requiredColumns: { time: true, gyro: true, setpoint: true, motor: true },
                },
            ],
        }));
        mockAnalyzeBblLog.mockImplementation(({ summary }) => ({
            quality: {
                status: "usable",
                reason: `quality-${summary.selectedLogIndex}`,
            },
            diagnostics: [],
            recommendations: [],
        }));

        await store.importInputFile(createBblFile());

        expect(store.selectRecommendedBblLogs()).toEqual([1, 2, 3]);
        expect(store.sessionState.selectedBblLogIndexes).toEqual([1, 2, 3]);
    });

    it("falls back to degraded bbl logs when no usable logs are available", async () => {
        const store = useAutotuneAiStore();
        mockDetectAutotuneInputSource.mockReturnValue("bbl");
        mockBuildBblSummary.mockImplementation(({ fileName = "logs.bbl", selectedLogIndex }) =>
            createBblSummary({
                fileName,
                selectedLogIndex: selectedLogIndex ?? 0,
                availableIndexes: [0, 1],
                marker: `stats-${selectedLogIndex ?? 0}`,
            }),
        );
        mockAnalyzeBblLog.mockImplementation(({ summary }) => ({
            quality: {
                status: summary.selectedLogIndex === 0 ? "unusable" : "degraded",
                reason: `quality-${summary.selectedLogIndex}`,
            },
            diagnostics: [],
            recommendations: [],
        }));

        await store.importInputFile(createBblFile());

        expect(store.selectRecommendedBblLogs()).toEqual([1]);
        expect(store.sessionState.selectedBblLogIndexes).toEqual([1]);
    });

    it("uses current FC rates before parsed CLI rates for local analysis config", async () => {
        mockFc.RC_TUNING = {
            roll_rate: 900,
            pitch_rate: 800,
        };
        mockFc.TUNING_SLIDERS = {
            slider_gyro_filter_multiplier: 97,
            slider_dterm_filter_multiplier: 94,
        };

        const store = useAutotuneAiStore();
        store.sessionState.parsedCliSummary = {
            rates: { roll_rate: 700 },
            filters: {
                simplified_gyro_filter_multiplier: 90,
                simplified_dterm_filter_multiplier: 88,
            },
        };
        mockDetectAutotuneInputSource.mockReturnValue("bbl");

        await store.importInputFile(createBblFile());

        const [{ staticConfig }] = mockAnalyzeBblLog.mock.calls.at(-1);
        expect(staticConfig).toEqual({
            rates: {
                roll_rate: 900,
                pitch_rate: 800,
            },
            filters: {
                slider_gyro_filter_multiplier: 97,
                slider_dterm_filter_multiplier: 94,
            },
        });
    });

    it("falls back to parsed CLI filter sliders when current FC filter sliders are unavailable", async () => {
        const store = useAutotuneAiStore();
        store.sessionState.parsedCliSummary = {
            rates: { roll_rate: 700, pitch_rate: 680 },
            filters: {
                simplified_gyro_filter_multiplier: 93,
                simplified_dterm_filter_multiplier: 91,
            },
        };
        mockDetectAutotuneInputSource.mockReturnValue("bbl");

        await store.importInputFile(createBblFile());

        const [{ staticConfig }] = mockAnalyzeBblLog.mock.calls.at(-1);
        expect(staticConfig).toEqual({
            rates: {
                roll_rate: 700,
                pitch_rate: 680,
            },
            filters: {
                slider_gyro_filter_multiplier: 93,
                slider_dterm_filter_multiplier: 91,
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
        store.sessionState.lastPayload = { sourceSummary: { hasBbl: false } };
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
        expect(store.sessionState.conversationHistory[0].content).toBe(firstTurn);
        expect(store.sessionState.conversationHistory[1].content).toBe(assistantReply);
        expect(Array.isArray(providerHistory)).toBe(true);
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

    it("passes the built payload into response parsing so writeability gating can use local analysis quality", async () => {
        const store = useAutotuneAiStore();
        mockParseAiResponse.mockReturnValue({
            summary: "parsed",
            overallRisk: "medium",
            groups: {},
            flightTestNotes: "",
        });
        mockBuildAiPayload.mockReturnValue({
            craftContext: { craftType: "long-range" },
            localAnalysis: {
                aggregateQuality: {
                    status: "degraded",
                    reason: "includes_unusable_logs",
                },
            },
        });
        mockExplainTuningAnalysis.mockResolvedValue(
            JSON.stringify({
                summary: "Lower filtering.",
                overallRisk: "medium",
                groups: {
                    filters: {
                        writeable: true,
                        confidence: "high",
                        explanation: "Model wants to write filters.",
                        values: {
                            slider_gyro_filter_multiplier: 80,
                        },
                    },
                },
            }),
        );

        Object.assign(store.craftContext, {
            craftType: "long-range",
            frameSize: "8",
            allUpWeight: "2000",
            prop: "8x3.7x3",
            motorKv: "1100",
            battery: "6S",
            flightStyle: "smooth",
            riskPreference: "balanced",
        });
        store.providerSettings.apiKey = "secret";

        await store.analyze();

        expect(mockParseAiResponse).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                localAnalysis: {
                    aggregateQuality: {
                        status: "degraded",
                        reason: "includes_unusable_logs",
                    },
                },
            }),
        );
    });

    it("stores the local write envelope and effective plan after a successful ai analysis", async () => {
        const store = useAutotuneAiStore();
        const localWriteEnvelope = {
            rates: {
                writeableAllowed: true,
                blockedReason: "",
                confidence: "high",
                candidates: {
                    roll_rate: {
                        suggestedValue: 90,
                        min: 90,
                        max: 95,
                        step: 1,
                        reason: "runtime low usage",
                    },
                },
            },
        };
        const effectivePlan = {
            groups: {
                rates: {
                    writeable: true,
                    confidence: "high",
                    explanation: "Use the local rate rollback.",
                    values: { roll_rate: 90 },
                },
            },
        };

        Object.assign(store.craftContext, {
            craftType: "long-range",
            frameSize: "8",
            allUpWeight: "2000",
            prop: "8x3.7x3",
            motorKv: "1100",
            battery: "6S",
            flightStyle: "smooth",
            riskPreference: "balanced",
        });
        store.providerSettings.apiKey = "secret";
        store.sessionState.localBblAnalysis = {
            aggregateQuality: { status: "usable", reason: "all_selected_logs_usable" },
            writeEnvelope: localWriteEnvelope,
        };
        store.sessionState.bblSummary = createBblSummary();
        mockBuildAiPayload.mockReturnValue({
            sourceSummary: { hasBbl: true },
            localAnalysis: store.sessionState.localBblAnalysis,
        });
        mockExplainTuningAnalysis.mockResolvedValue(
            JSON.stringify({
                summary: "ok",
                overallRisk: "medium",
                groups: effectivePlan.groups,
                flightTestNotes: "test hover",
            }),
        );
        mockParseAiResponse.mockReturnValue({
            summary: "ok",
            overallRisk: "medium",
            groups: effectivePlan.groups,
            effectivePlan,
            flightTestNotes: "test hover",
        });

        await store.analyze();

        expect(store.sessionState.localWriteEnvelope).toEqual(localWriteEnvelope);
        expect(store.sessionState.effectivePlan).toEqual(effectivePlan);
    });

    it("preserves the local write envelope and refreshes effective plan on structured follow-up updates", async () => {
        const store = useAutotuneAiStore();
        const localWriteEnvelope = {
            rates: {
                writeableAllowed: true,
                blockedReason: "",
                confidence: "high",
                candidates: {
                    roll_rate: {
                        suggestedValue: 90,
                        min: 90,
                        max: 95,
                        step: 1,
                        reason: "runtime low usage",
                    },
                },
            },
        };
        const previousEffectivePlan = {
            groups: {
                rates: {
                    writeable: true,
                    confidence: "medium",
                    explanation: "Previous plan.",
                    values: { roll_rate: 92 },
                },
            },
        };
        const updatedEffectivePlan = {
            groups: {
                rates: {
                    writeable: true,
                    confidence: "high",
                    explanation: "Use the local rate rollback.",
                    values: { roll_rate: 90 },
                },
            },
        };

        store.sessionState.lastPayload = {
            sourceSummary: { hasBbl: true },
            localAnalysis: {
                aggregateQuality: { status: "usable", reason: "all_selected_logs_usable" },
                writeEnvelope: localWriteEnvelope,
            },
        };
        store.sessionState.localWriteEnvelope = localWriteEnvelope;
        store.sessionState.effectivePlan = previousEffectivePlan;
        store.sessionState.aiResponse = {
            summary: "previous",
            overallRisk: "medium",
            groups: previousEffectivePlan.groups,
            effectivePlan: previousEffectivePlan,
            flightTestNotes: "previous note",
        };
        store.sessionState.conversationHistory = [
            { role: "user", content: "Initial analysis payload." },
            { role: "assistant", content: "{\"summary\":\"previous\"}" },
        ];
        store.sessionState.followUpInput = "Can you tighten the rates recommendation?";

        mockExplainTuningAnalysis.mockResolvedValueOnce(
            JSON.stringify({
                summary: "updated",
                overallRisk: "medium",
                groups: updatedEffectivePlan.groups,
                flightTestNotes: "test hover",
            }),
        );
        mockParseAiResponse.mockReturnValueOnce({
            summary: "updated",
            overallRisk: "medium",
            groups: updatedEffectivePlan.groups,
            effectivePlan: updatedEffectivePlan,
            flightTestNotes: "test hover",
        });

        await store.sendFollowUp();

        expect(store.sessionState.localWriteEnvelope).toEqual(localWriteEnvelope);
        expect(store.sessionState.effectivePlan).toEqual(updatedEffectivePlan);
    });

    it("clears the effective plan when a structured follow-up parse omits it", async () => {
        const store = useAutotuneAiStore();
        const localWriteEnvelope = {
            rates: {
                writeableAllowed: true,
                blockedReason: "",
                confidence: "high",
                candidates: {
                    roll_rate: {
                        suggestedValue: 90,
                        min: 90,
                        max: 95,
                        step: 1,
                        reason: "runtime low usage",
                    },
                },
            },
        };
        const previousEffectivePlan = {
            groups: {
                rates: {
                    writeable: true,
                    confidence: "medium",
                    explanation: "Previous plan.",
                    values: { roll_rate: 92 },
                },
            },
        };

        store.sessionState.lastPayload = {
            sourceSummary: { hasBbl: true },
            localAnalysis: {
                aggregateQuality: { status: "usable", reason: "all_selected_logs_usable" },
                writeEnvelope: localWriteEnvelope,
            },
        };
        store.sessionState.localWriteEnvelope = localWriteEnvelope;
        store.sessionState.effectivePlan = previousEffectivePlan;
        store.sessionState.aiResponse = {
            summary: "previous",
            overallRisk: "medium",
            groups: previousEffectivePlan.groups,
            effectivePlan: previousEffectivePlan,
            flightTestNotes: "previous note",
        };
        store.sessionState.conversationHistory = [
            { role: "user", content: "Initial analysis payload." },
            { role: "assistant", content: "{\"summary\":\"previous\"}" },
        ];
        store.sessionState.followUpInput = "What if we keep it explain-only?";

        mockExplainTuningAnalysis.mockResolvedValueOnce(
            JSON.stringify({
                summary: "updated",
                overallRisk: "medium",
                groups: previousEffectivePlan.groups,
                flightTestNotes: "test hover",
            }),
        );
        mockParseAiResponse.mockReturnValueOnce({
            summary: "updated",
            overallRisk: "medium",
            groups: previousEffectivePlan.groups,
            flightTestNotes: "test hover",
        });

        await store.sendFollowUp();

        expect(store.sessionState.localWriteEnvelope).toEqual(localWriteEnvelope);
        expect(store.sessionState.effectivePlan).toBeNull();
    });

    it("does not send a follow-up without a lastPayload context", async () => {
        const store = useAutotuneAiStore();
        store.sessionState.lastPayload = null;
        store.sessionState.conversationHistory = [
            { role: "user", content: "Initial analysis payload." },
            { role: "assistant", content: "{\"summary\":\"previous\"}" },
        ];
        store.sessionState.followUpInput = "Need more detail";

        await expect(store.sendFollowUp()).resolves.toBeNull();
        expect(mockExplainTuningAnalysis).not.toHaveBeenCalled();
        expect(store.sessionState.conversationHistory).toEqual([
            { role: "user", content: "Initial analysis payload." },
            { role: "assistant", content: "{\"summary\":\"previous\"}" },
        ]);
    });

    it("blocks AI requests before sending when local bbl analysis quality is degraded", async () => {
        const store = useAutotuneAiStore();
        Object.assign(store.craftContext, {
            craftType: "long-range",
            frameSize: "8",
            allUpWeight: "2000",
            prop: "8x3.7x3",
            motorKv: "1100",
            battery: "6S",
            flightStyle: "smooth",
            riskPreference: "balanced",
        });
        store.providerSettings.apiKey = "secret";
        store.sessionState.localBblAnalysis = {
            aggregateQuality: {
                status: "degraded",
                reason: "includes_unusable_logs",
            },
            selectedLogIndexes: [0, 1],
        };
        store.sessionState.bblSummary = createBblSummary();

        await expect(store.analyze()).rejects.toThrow("Selected BBL logs include unusable local evidence.");
        expect(mockExplainTuningAnalysis).not.toHaveBeenCalled();
        expect(mockBuildAiPayload).not.toHaveBeenCalled();
        expect(store.sessionState.requestState).toBe("error");
        expect(store.sessionState.lastError).toBe(
            "Selected BBL logs include unusable local evidence. Re-select cleaner logs before AI analysis.",
        );
    });

    it("blocks AI requests when a BBL source is present but localAnalysis is missing from the payload", async () => {
        const store = useAutotuneAiStore();
        Object.assign(store.craftContext, {
            craftType: "long-range",
            frameSize: "8",
            allUpWeight: "2000",
            prop: "8x3.7x3",
            motorKv: "1100",
            battery: "6S",
            flightStyle: "smooth",
            riskPreference: "balanced",
        });
        store.providerSettings.apiKey = "secret";
        store.sessionState.bblSummary = createBblSummary();
        store.sessionState.localBblAnalysis = {
            aggregateQuality: { status: "usable", reason: "all_selected_logs_usable" },
            selectedLogIndexes: [0],
        };
        mockBuildAiPayload.mockReturnValue({
            sourceSummary: {
                hasBbl: true,
                hasCli: true,
            },
            inputSources: {
                cli: { present: true },
                bbl: { present: true },
            },
            localAnalysis: undefined,
        });

        await expect(store.analyze()).rejects.toThrow(
            "Local BBL analysis was not preserved in the AI payload. Reduce payload size or reselect logs.",
        );
        expect(mockExplainTuningAnalysis).not.toHaveBeenCalled();
        expect(store.sessionState.lastError).toBe(
            "Local BBL analysis was not preserved in the AI payload. Reduce payload size or reselect logs.",
        );
    });
});
