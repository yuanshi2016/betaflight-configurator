import { computed, reactive, ref, watch } from "vue";
import { defineStore } from "pinia";
import { get as getConfig, set as setConfig } from "../js/ConfigStorage";
import { get as getSession, set as setSession } from "../js/SessionStorage";
import { i18n } from "../js/localization";
import { buildAiPayload } from "../js/autotune-ai/payloadBuilder";
import { buildBblSummary } from "../js/autotune-ai/blackboxBblSummary";
import { analyzeBblLog } from "../js/autotune-ai/blackboxBblAnalysis";
import { aggregateBblAnalyses } from "../js/autotune-ai/blackboxBblAggregate";
import { parseCliConfig } from "../js/autotune-ai/cliConfigParser";
import { buildInputSourceSummary, detectAutotuneInputSource } from "../js/autotune-ai/inputSourceDetector";
import { buildFirstTurnUserMessage, explainTuningAnalysis } from "../js/autotune-ai/providerAdapters";
import { parseAiResponse } from "../js/autotune-ai/responseParser";
import FC from "../js/fc";

const PROVIDER_SETTINGS_KEY = "AutotuneAiProviderSettings";
const CRAFT_CONTEXT_KEY = "AutotuneAiCraftContext";
const CRAFT_CONTEXT_PROFILES_KEY = "AutotuneAiCraftContextProfiles";
const SESSION_STATE_KEY = "AutotuneAiPanelState";
export const MAX_HISTORY_TOKENS = 6000;
const HISTORY_ANCHOR_MESSAGES = 2;
const PREFERRED_RECENT_MESSAGES = 4;
const MAX_RECOMMENDED_BBL_LOGS = 3;

const REQUIRED_CONTEXT_FIELDS = [
    "craftType",
    "frameSize",
    "allUpWeight",
    "prop",
    "motorKv",
    "battery",
    "flightStyle",
    "riskPreference",
];
const DEPRECATED_CRAFT_CONTEXT_FIELDS = [
    "isWhoop",
    "knownMechanicalIssues",
    "environmentNotes",
    "mainSymptom",
    "tuningGoal",
];
const CRAFT_PROFILE_FIELDS = Object.keys(defaultCraftContext());

export const PROVIDER_PRESETS = [
    {
        labelKey: "autotuneAiProviderDeepseekOpenai",
        value: "deepseek-openai",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
    },
    {
        labelKey: "autotuneAiProviderDeepseekAnthropic",
        value: "deepseek-anthropic",
        baseUrl: "https://api.deepseek.com/anthropic",
        model: "deepseek-v4-pro",
    },
    {
        labelKey: "autotuneAiProviderAnthropic",
        value: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-5",
    },
];

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function estimateTextTokens(text) {
    return Array.from(String(text || "")).reduce((tokens, character) => {
        if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(character)) {
            return tokens + 1;
        }

        if (character.codePointAt(0) > 0x7f) {
            return tokens + 0.5;
        }

        return tokens + 0.25;
    }, 0);
}

function estimateMessageTokens(message) {
    return 4 + estimateTextTokens(message?.role) + estimateTextTokens(message?.content);
}

function takeEstimatedTokens(text, maxTokens, fromEnd = false) {
    const characters = Array.from(String(text || ""));
    const source = fromEnd ? [...characters].reverse() : characters;
    let tokens = 0;
    const result = [];

    for (const character of source) {
        const nextTokens = estimateTextTokens(character);
        if (tokens + nextTokens > maxTokens) {
            break;
        }
        tokens += nextTokens;
        result.push(character);
    }

    const sliced = fromEnd ? [...result].reverse() : result;
    return sliced.join("");
}

function trimMessageContentToTokenBudget(message, maxTokens) {
    const content = String(message?.content || "");
    if (estimateMessageTokens(message) <= maxTokens) {
        return message;
    }

    const omission = "\n\n[Earlier content omitted to keep this conversation within the token budget.]\n\n";
    const contentBudget = Math.max(32, maxTokens - estimateTextTokens(message?.role) - estimateTextTokens(omission) - 4);
    const headBudget = Math.max(16, Math.floor(contentBudget * 0.55));
    const tailBudget = Math.max(16, contentBudget - headBudget);

    return {
        ...message,
        content: `${takeEstimatedTokens(content, headBudget)}${omission}${takeEstimatedTokens(content, tailBudget, true)}`,
    };
}

export function estimateConversationTokens(messages) {
    return Math.ceil((messages || []).reduce((total, message) => total + estimateMessageTokens(message), 3));
}

export function trimConversationHistoryToTokenBudget(messages, maxTokens = MAX_HISTORY_TOKENS) {
    const history = Array.isArray(messages) ? messages : [];
    if (estimateConversationTokens(history) <= maxTokens) {
        return { history, trimmed: false };
    }

    const anchor = history.slice(0, HISTORY_ANCHOR_MESSAGES);
    let recent = history.slice(HISTORY_ANCHOR_MESSAGES);
    const protectedRecentCount = Math.min(recent.length, recent.length >= 2 ? 2 : 1);

    const buildHistory = (anchorMessages = anchor) => [...anchorMessages, ...recent];
    const preferredRecentCount = Math.max(protectedRecentCount, Math.min(PREFERRED_RECENT_MESSAGES, recent.length));

    while (recent.length > preferredRecentCount && estimateConversationTokens(buildHistory()) > maxTokens) {
        recent = recent.slice(1);
    }

    while (recent.length > protectedRecentCount && estimateConversationTokens(buildHistory()) > maxTokens) {
        recent = recent.slice(1);
    }

    let trimmedHistory = buildHistory();

    if (estimateConversationTokens(trimmedHistory) > maxTokens && anchor.length > 1) {
        trimmedHistory = buildHistory([anchor[0]]);
    }

    while (
        recent.length > protectedRecentCount &&
        estimateConversationTokens(trimmedHistory) > maxTokens &&
        anchor.length
    ) {
        recent = recent.slice(1);
        trimmedHistory = [anchor[0], ...recent];
    }

    if (estimateConversationTokens(trimmedHistory) > maxTokens) {
        const messageBudget = Math.max(96, Math.floor(maxTokens / Math.max(1, trimmedHistory.length)));
        trimmedHistory = trimmedHistory.map((message) => trimMessageContentToTokenBudget(message, messageBudget));
    }

    return {
        history: trimmedHistory,
        trimmed: trimmedHistory.length < history.length || estimateConversationTokens(history) > estimateConversationTokens(trimmedHistory),
    };
}

function defaultProviderSettings() {
    const preset = PROVIDER_PRESETS[0];
    return {
        provider: preset.value,
        baseUrl: preset.baseUrl,
        model: preset.model,
        apiKey: "",
        temperature: 0.2,
        maxTokens: 1200,
        thinkingModeEnabled: true,
        thinkingEffort: "high",
    };
}

function defaultCraftContext() {
    return {
        craftType: "freestyle",
        frameSize: "",
        allUpWeight: "",
        prop: "",
        motorKv: "",
        battery: "",
        flightStyle: "",
        riskPreference: "balanced",
        flightControllerModel: "",
        gyroModel: "",
        escProtocol: "",
        motorOutputLimit: "",
        notes: "",
    };
}

export function defaultSessionState() {
    return {
        cliText: "",
        parsedCliSummary: null,
        csvSummary: null,
        bblSummary: null,
        bblFileData: null,
        selectedBblLogIndexes: [],
        localBblAnalysesByLog: {},
        localBblAnalysis: null,
        localWriteEnvelope: null,
        sourceFileName: "",
        sourceType: "",
        sourceSummary: null,
        aiResponse: null,
        effectivePlan: null,
        selectedGroups: {
            pid: true,
            filters: true,
            rates: false,
        },
        requestState: "idle",
        lastError: "",
        lastPayload: null,
        panelOpen: true,
        aiConfigOpen: false,
        conversationHistory: [],
        conversationTrimmed: false,
        followUpInput: "",
        followUpState: "idle",
    };
}

function loadStoredValue(key, defaults, storageGet) {
    const stored = storageGet(key)?.[key];
    return {
        ...clone(defaults),
        ...(stored || {}),
    };
}

function loadCraftContext() {
    const value = loadStoredValue(CRAFT_CONTEXT_KEY, defaultCraftContext(), getConfig);
    DEPRECATED_CRAFT_CONTEXT_FIELDS.forEach((field) => {
        delete value[field];
    });
    return value;
}

function sanitizeCraftContextProfile(profile) {
    return CRAFT_PROFILE_FIELDS.reduce((result, field) => {
        result[field] = String(profile?.[field] || "");
        return result;
    }, {});
}

function createCraftContextProfileName(profile) {
    const parts = [profile.frameSize, profile.prop, profile.motorKv ? `${profile.motorKv}KV` : "", profile.battery]
        .map((part) => String(part || "").trim())
        .filter(Boolean);
    return parts.join(" / ") || "Craft profile";
}

function normalizeCraftContextProfiles(value) {
    return (Array.isArray(value) ? value : [])
        .filter((profile) => profile && typeof profile === "object")
        .map((profile) => ({
            id: String(profile.id || crypto.randomUUID()),
            name: String(profile.name || createCraftContextProfileName(profile.context || profile)).trim(),
            context: sanitizeCraftContextProfile(profile.context || profile),
            updatedAt: Number(profile.updatedAt) || Date.now(),
        }))
        .filter((profile) => profile.name);
}

function loadCraftContextProfiles() {
    return normalizeCraftContextProfiles(getConfig(CRAFT_CONTEXT_PROFILES_KEY)?.[CRAFT_CONTEXT_PROFILES_KEY]);
}

function sameValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

export const useAutotuneAiStore = defineStore("autotuneAi", () => {
    const providerSettings = reactive(loadStoredValue(PROVIDER_SETTINGS_KEY, defaultProviderSettings(), getConfig));
    const craftContext = reactive(loadCraftContext());
    const craftContextProfiles = ref(loadCraftContextProfiles());
    const sessionState = reactive(loadStoredValue(SESSION_STATE_KEY, defaultSessionState(), getSession));
    const initialized = ref(false);
    const bblFileData = ref(null);

    const requiredContextComplete = computed(() =>
        REQUIRED_CONTEXT_FIELDS.every((field) => String(craftContext[field] || "").trim().length > 0),
    );
    const canAnalyze = computed(
        () =>
            requiredContextComplete.value &&
            Boolean(providerSettings.apiKey) &&
            sessionState.requestState !== "loading",
    );
    const hasRecommendation = computed(() => Boolean(sessionState.aiResponse));
    const inputSourceSummary = computed(() => ({
        cli: {
            present: Boolean(sessionState.parsedCliSummary),
            fileName: sessionState.parsedCliSummary ? sessionState.sourceFileName || "CLI text" : "",
        },
        csv: {
            present: Boolean(sessionState.csvSummary),
            fileName: sessionState.csvSummary?.fileName || "",
        },
        bbl: {
            present: Boolean(sessionState.bblSummary),
            fileName: sessionState.bblSummary?.fileName || "",
            selectedLogIndex: sessionState.bblSummary?.selectedLogIndex ?? null,
            logCount: sessionState.bblSummary?.logCount ?? 0,
        },
    }));

    watch(
        providerSettings,
        (value) => {
            setConfig({ [PROVIDER_SETTINGS_KEY]: clone(value) });
        },
        { deep: true },
    );

    watch(
        craftContext,
        (value) => {
            setConfig({ [CRAFT_CONTEXT_KEY]: clone(value) });
        },
        { deep: true },
    );

    watch(
        craftContextProfiles,
        (value) => {
            setConfig({ [CRAFT_CONTEXT_PROFILES_KEY]: clone(value) });
        },
        { deep: true },
    );

    watch(
        sessionState,
        (value) => {
            setSession({ [SESSION_STATE_KEY]: clone(value) });
        },
        { deep: true },
    );

    function clearBblDerivedState() {
        sessionState.bblSummary = null;
        sessionState.bblFileData = null;
        sessionState.selectedBblLogIndexes = [];
        sessionState.localBblAnalysesByLog = {};
        sessionState.localBblAnalysis = null;
        sessionState.localWriteEnvelope = null;
        sessionState.effectivePlan = null;
        bblFileData.value = null;
    }

    function invalidateAiOutput() {
        sessionState.aiResponse = null;
        sessionState.lastPayload = null;
        sessionState.localWriteEnvelope = null;
        sessionState.effectivePlan = null;
        clearConversation();
    }

    function initialize() {
        refreshLocalBblAnalysis();
        initialized.value = true;
    }

    function applyProviderPreset(provider) {
        const preset = PROVIDER_PRESETS.find((item) => item.value === provider);
        providerSettings.provider = provider;

        if (preset) {
            providerSettings.baseUrl = preset.baseUrl;
            providerSettings.model = preset.model;
            providerSettings.thinkingModeEnabled = provider.startsWith("deepseek");
            providerSettings.thinkingEffort = "high";
        }
    }

    function applyCraftContextProfile(profileId) {
        const profile = craftContextProfiles.value.find((item) => item.id === profileId);
        if (!profile) {
            return null;
        }

        Object.assign(craftContext, sanitizeCraftContextProfile(profile.context));
        return profile;
    }

    function saveCraftContextProfile(name = "") {
        const context = sanitizeCraftContextProfile(craftContext);
        const profileName = String(name || createCraftContextProfileName(context)).trim();
        const existingIndex = craftContextProfiles.value.findIndex((profile) => profile.name === profileName);
        const profile = {
            id: existingIndex === -1 ? crypto.randomUUID() : craftContextProfiles.value[existingIndex].id,
            name: profileName,
            context,
            updatedAt: Date.now(),
        };

        if (existingIndex === -1) {
            craftContextProfiles.value = [profile, ...craftContextProfiles.value];
        } else {
            craftContextProfiles.value.splice(existingIndex, 1, profile);
        }

        return profile;
    }

    function parseCliInput() {
        const cliText = String(sessionState.cliText || "").trim();
        const nextParsedCliSummary = cliText ? parseCliConfig(cliText) : null;
        const nextSourceFileName = cliText ? "CLI text" : "";
        const nextSourceType = cliText ? "cli" : "";
        const nextSourceSummary = nextParsedCliSummary || sessionState.csvSummary || sessionState.bblSummary || null;
        const sourceChanged =
            !sameValue(sessionState.parsedCliSummary, nextParsedCliSummary) ||
            sessionState.sourceFileName !== nextSourceFileName ||
            sessionState.sourceType !== nextSourceType ||
            !sameValue(sessionState.sourceSummary, nextSourceSummary);

        sessionState.parsedCliSummary = nextParsedCliSummary;
        sessionState.sourceFileName = nextSourceFileName;
        sessionState.sourceType = nextSourceType;
        sessionState.sourceSummary = nextSourceSummary;

        if (sourceChanged) {
            invalidateAiOutput();
        }
        return nextParsedCliSummary;
    }

    function buildLocalAnalysisStaticConfig() {
        if (FC?.RC_TUNING && Object.keys(FC.RC_TUNING).length) {
            return {
                rates: { ...FC.RC_TUNING },
            };
        }

        if (sessionState.parsedCliSummary?.rates && Object.keys(sessionState.parsedCliSummary.rates).length) {
            return {
                rates: { ...sessionState.parsedCliSummary.rates },
            };
        }

        return {};
    }

    function analyzeSelectedBblLog(index) {
        if (!bblFileData.value || !sessionState.bblSummary?.fileName) {
            return null;
        }

        const summary = buildBblSummary({
            fileName: sessionState.bblSummary.fileName,
            data: bblFileData.value,
            selectedLogIndex: index,
        });

        return {
            logIndex: summary.selectedLogIndex,
            ...analyzeBblLog({
                summary,
                craftContext,
                staticConfig: buildLocalAnalysisStaticConfig(),
            }),
        };
    }

    function refreshLocalBblAnalysis() {
        if (sessionState.bblSummary && !bblFileData.value) {
            clearBblDerivedState();
            if (sessionState.sourceType === "bbl") {
                sessionState.aiResponse = null;
                sessionState.lastPayload = null;
                clearConversation();
            }
            return null;
        }

        if (!sessionState.bblSummary?.availableLogs?.length) {
            sessionState.selectedBblLogIndexes = [];
            sessionState.localBblAnalysesByLog = {};
            sessionState.localBblAnalysis = null;
            sessionState.localWriteEnvelope = null;
            sessionState.effectivePlan = null;
            if (sessionState.sourceType === "bbl") {
                sessionState.aiResponse = null;
                sessionState.lastPayload = null;
                clearConversation();
            }
            return null;
        }

        const availableIndexes = new Set(
            (sessionState.bblSummary.availableLogs || []).map((log) => log.index).filter(Number.isInteger),
        );
        const validSelectedIndexes = sessionState.selectedBblLogIndexes.filter((index) => availableIndexes.has(index));
        const fallbackIndexes =
            !validSelectedIndexes.length && availableIndexes.has(sessionState.bblSummary.selectedLogIndex)
                ? [sessionState.bblSummary.selectedLogIndex]
                : validSelectedIndexes;

        sessionState.selectedBblLogIndexes = fallbackIndexes;

        const perLog = fallbackIndexes.map((index) => analyzeSelectedBblLog(index)).filter(Boolean);
        sessionState.localBblAnalysesByLog = Object.fromEntries(perLog.map((item) => [item.logIndex, item]));
        sessionState.localBblAnalysis = perLog.length ? aggregateBblAnalyses(perLog) : null;
        return sessionState.localBblAnalysis;
    }

    async function importInputFile(file) {
        if (!file) {
            return null;
        }

        sessionState.lastError = "";

        try {
            const fileName = file.name || "";
            const sourceType = detectAutotuneInputSource({ fileName });
            let imported;
            if (sourceType === "bbl") {
                bblFileData.value = new Uint8Array(await file.arrayBuffer());
                imported = {
                    type: "bbl",
                    fileName,
                    cliSummary: null,
                    csvSummary: null,
                    bblSummary: buildBblSummary({
                        fileName,
                        data: bblFileData.value,
                    }),
                };
            } else {
                imported = buildInputSourceSummary({
                    fileName,
                    text: await file.text(),
                });
            }

            invalidateAiOutput();
            sessionState.sourceFileName = imported.fileName;
            sessionState.sourceType = imported.type;
            if (imported.type === "cli") {
                clearBblDerivedState();
                const cliSummary = imported.cliSummary;
                sessionState.cliText = "";
                sessionState.parsedCliSummary = cliSummary;
            } else if (imported.type === "csv") {
                clearBblDerivedState();
                sessionState.csvSummary = imported.csvSummary;
            } else if (imported.type === "bbl") {
                sessionState.bblSummary = imported.bblSummary;
                sessionState.bblFileData = {
                    fileName,
                    retainedInMemory: true,
                    byteLength: bblFileData.value.byteLength,
                };
                sessionState.selectedBblLogIndexes = Number.isInteger(imported.bblSummary?.selectedLogIndex)
                    ? [imported.bblSummary.selectedLogIndex]
                    : [];
                refreshLocalBblAnalysis();
            }
            sessionState.sourceSummary =
                sessionState.parsedCliSummary || sessionState.csvSummary || sessionState.bblSummary || null;
            return imported;
        } catch (error) {
            sessionState.sourceFileName = file.name || "";
            sessionState.sourceType = "unknown";
            sessionState.lastError = error?.message || "Unsupported autotune input file.";
            throw error;
        }
    }

    function selectBblLog(index) {
        if (!bblFileData.value || !sessionState.bblSummary) {
            return null;
        }

        const previousSelectedLogIndex = sessionState.bblSummary.selectedLogIndex;
        const previousSelectedIndexes = [...sessionState.selectedBblLogIndexes];
        sessionState.bblSummary = buildBblSummary({
            fileName: sessionState.bblSummary.fileName,
            data: bblFileData.value,
            selectedLogIndex: index,
        });
        sessionState.sourceType = "bbl";
        sessionState.sourceFileName = sessionState.bblSummary.fileName;
        sessionState.sourceSummary =
            sessionState.parsedCliSummary || sessionState.csvSummary || sessionState.bblSummary || null;
        sessionState.selectedBblLogIndexes = [sessionState.bblSummary.selectedLogIndex];
        if (
            previousSelectedLogIndex !== sessionState.bblSummary.selectedLogIndex ||
            !sameValue(previousSelectedIndexes, sessionState.selectedBblLogIndexes)
        ) {
            invalidateAiOutput();
        }
        refreshLocalBblAnalysis();
        return sessionState.bblSummary;
    }

    function setSelectedBblLogIndexes(indexes) {
        const validIndexes = [...new Set((Array.isArray(indexes) ? indexes : []).filter(Number.isInteger))].sort(
            (left, right) => left - right,
        );
        const changed = !sameValue(sessionState.selectedBblLogIndexes, validIndexes);
        sessionState.selectedBblLogIndexes = validIndexes;
        if (changed) {
            invalidateAiOutput();
        }
        refreshLocalBblAnalysis();
        return sessionState.selectedBblLogIndexes;
    }

    function toggleBblLogSelection(index) {
        if (!Number.isInteger(index)) {
            return sessionState.selectedBblLogIndexes;
        }

        const selected = new Set(sessionState.selectedBblLogIndexes);
        if (selected.has(index)) {
            selected.delete(index);
        } else {
            selected.add(index);
        }

        const nextSelectedIndexes = [...selected].sort((left, right) => left - right);
        const changed = !sameValue(sessionState.selectedBblLogIndexes, nextSelectedIndexes);
        sessionState.selectedBblLogIndexes = nextSelectedIndexes;
        if (changed) {
            invalidateAiOutput();
        }
        refreshLocalBblAnalysis();
        return sessionState.selectedBblLogIndexes;
    }

    function selectRecommendedBblLogs() {
        const logMetaByIndex = Object.fromEntries(
            (sessionState.bblSummary?.availableLogs || []).map((log) => [
                log.index,
                {
                    durationUs: Number(log.durationUs) || 0,
                    decodedMainFrames: Number(log.decodedMainFrames) || 0,
                    corruptFrames: Number(log.corruptFrames) || 0,
                },
            ]),
        );
        const availableIndexes = (sessionState.bblSummary?.availableLogs || [])
            .map((log) => log.index)
            .filter(Number.isInteger);
        const perLogEntries = availableIndexes.map((index) => {
            return sessionState.localBblAnalysesByLog[index] || analyzeSelectedBblLog(index);
        });
        const getDecodeHealthScore = (index) => {
            const meta = logMetaByIndex[index] || {};
            const decoded = meta.decodedMainFrames || 0;
            const corrupt = meta.corruptFrames || 0;
            const total = decoded + corrupt;
            if (total <= 0) {
                return 0;
            }

            return decoded / total;
        };
        const sortRecommendedIndexes = (left, right) => {
            const healthDelta = getDecodeHealthScore(right) - getDecodeHealthScore(left);
            if (healthDelta !== 0) {
                return healthDelta;
            }

            const durationDelta = (logMetaByIndex[right]?.durationUs || 0) - (logMetaByIndex[left]?.durationUs || 0);
            if (durationDelta !== 0) {
                return durationDelta;
            }

            return left - right;
        };

        const usable = perLogEntries
            .filter((entry) => entry?.quality?.status === "usable" && Number.isInteger(entry?.logIndex))
            .map((entry) => entry.logIndex)
            .sort(sortRecommendedIndexes)
            .slice(0, MAX_RECOMMENDED_BBL_LOGS);

        if (usable.length) {
            return setSelectedBblLogIndexes(usable);
        }

        const degraded = perLogEntries
            .filter((entry) => entry?.quality?.status === "degraded" && Number.isInteger(entry?.logIndex))
            .map((entry) => entry.logIndex)
            .sort(sortRecommendedIndexes)
            .slice(0, MAX_RECOMMENDED_BBL_LOGS);

        if (degraded.length) {
            return setSelectedBblLogIndexes(degraded);
        }

        return sessionState.selectedBblLogIndexes;
    }

    function resetResponse() {
        sessionState.aiResponse = null;
        sessionState.effectivePlan = null;
        sessionState.localWriteEnvelope = sessionState.localBblAnalysis?.writeEnvelope || null;
        sessionState.lastPayload = null;
        sessionState.lastError = "";
        sessionState.requestState = "idle";
    }

    function trimHistory() {
        const result = trimConversationHistoryToTokenBudget(sessionState.conversationHistory);
        sessionState.conversationTrimmed = result.trimmed;
        return result.history;
    }

    function clearConversation() {
        sessionState.conversationHistory = [];
        sessionState.conversationTrimmed = false;
        sessionState.followUpInput = "";
        sessionState.followUpState = "idle";
    }

    function getLocalBblAnalysisErrorMessage() {
        const reason = sessionState.localBblAnalysis?.aggregateQuality?.reason;

        if (reason === "includes_unusable_logs") {
            return "Selected BBL logs include unusable local evidence. Re-select cleaner logs before AI analysis.";
        }
        if (reason === "includes_degraded_logs") {
            return "Selected BBL logs include degraded local evidence. Re-select cleaner logs before AI analysis.";
        }
        if (reason === "no_usable_logs") {
            return "Selected BBL logs did not produce usable local evidence. Re-select cleaner logs before AI analysis.";
        }

        return "Local BBL evidence is not usable enough for AI recommendations.";
    }

    function assertPayloadRetainsRequiredLocalAnalysis(payload) {
        if (!payload?.sourceSummary?.hasBbl) {
            return;
        }

        if (!payload?.localAnalysis) {
            throw new Error("Local BBL analysis was not preserved in the AI payload. Reduce payload size or reselect logs.");
        }
    }

    function assertLocalBblEvidenceUsableForAi() {
        if (!sessionState.bblSummary || !sessionState.localBblAnalysis) {
            return;
        }

        if (sessionState.localBblAnalysis.aggregateQuality?.status !== "usable") {
            throw new Error(getLocalBblAnalysisErrorMessage());
        }
    }

    async function analyze({ analysisResult = null } = {}) {
        if (!requiredContextComplete.value) {
            throw new Error("Fill the required craft context fields before analysis.");
        }
        if (!providerSettings.apiKey) {
            throw new Error("Enter an AI provider API key before analysis.");
        }

        sessionState.requestState = "loading";
        sessionState.lastError = "";
        clearConversation();

        try {
            assertLocalBblEvidenceUsableForAi();
            const payload = buildAiPayload({
                craftContext,
                cliSummary: sessionState.parsedCliSummary,
                csvSummary: sessionState.csvSummary,
                bblSummary: sessionState.bblSummary,
                analysisResult,
                localBblAnalysis: sessionState.localBblAnalysis,
            });
            assertPayloadRetainsRequiredLocalAnalysis(payload);
            const locale = i18n.getCurrentLocale();
            const rawResponse = await explainTuningAnalysis(providerSettings, payload, null, undefined, { locale });
            const parsedResponse = parseAiResponse(rawResponse, payload);

            sessionState.lastPayload = payload;
            sessionState.localWriteEnvelope = payload?.localAnalysis?.writeEnvelope || null;
            sessionState.conversationHistory = [
                { role: "user", content: buildFirstTurnUserMessage(payload, locale) },
                { role: "assistant", content: rawResponse },
            ];
            sessionState.aiResponse = parsedResponse;
            sessionState.effectivePlan = parsedResponse?.effectivePlan || null;
            sessionState.requestState = "done";
            return sessionState.aiResponse;
        } catch (error) {
            sessionState.requestState = "error";
            sessionState.lastError = error?.message || "AI analysis failed.";
            throw error;
        }
    }

    async function sendFollowUp() {
        const userMessage = String(sessionState.followUpInput || "").trim();
        if (!userMessage || sessionState.followUpState === "loading") {
            return null;
        }

        if (!sessionState.lastPayload) {
            return null;
        }

        const previousHistory = [...sessionState.conversationHistory];
        const previousTrimmed = sessionState.conversationTrimmed;

        sessionState.conversationHistory.push({ role: "user", content: userMessage });
        sessionState.followUpInput = "";
        sessionState.followUpState = "loading";
        sessionState.lastError = "";
        const providerHistory = trimHistory();

        try {
            const payload = sessionState.lastPayload || null;
            const rawResponse = await explainTuningAnalysis(
                providerSettings,
                null,
                providerHistory,
                undefined,
                { locale: i18n.getCurrentLocale() },
            );
            sessionState.conversationHistory.push({ role: "assistant", content: rawResponse });
            trimHistory();

            try {
                const parsedResponse = parseAiResponse(rawResponse, payload);
                sessionState.aiResponse = parsedResponse;
                sessionState.effectivePlan = parsedResponse?.effectivePlan || null;
            } catch {
                // Follow-up replies may be conversational text instead of a JSON recommendation update.
            }

            sessionState.followUpState = "idle";
            return rawResponse;
        } catch (error) {
            sessionState.followUpState = "error";
            sessionState.lastError = error?.message || "Follow-up failed.";
            sessionState.conversationHistory = previousHistory;
            sessionState.conversationTrimmed = previousTrimmed;
            throw error;
        }
    }

    initialize();

    return {
        providerSettings,
        craftContext,
        craftContextProfiles,
        sessionState,
        initialized,
        requiredContextComplete,
        canAnalyze,
        hasRecommendation,
        inputSourceSummary,
        initialize,
        applyProviderPreset,
        applyCraftContextProfile,
        saveCraftContextProfile,
        parseCliInput,
        importInputFile,
        selectBblLog,
        setSelectedBblLogIndexes,
        toggleBblLogSelection,
        selectRecommendedBblLogs,
        refreshLocalBblAnalysis,
        resetResponse,
        clearConversation,
        analyze,
        sendFollowUp,
    };
});
