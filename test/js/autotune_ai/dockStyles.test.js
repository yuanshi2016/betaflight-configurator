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
        const englishMessages = readFileSync("locales/en/messages.json", "utf8");
        const chineseMessages = readFileSync("locales/zh_CN/messages.json", "utf8");
        const traditionalChineseMessages = readFileSync("locales/zh_TW/messages.json", "utf8");

        expect(component).toContain("autotune-ai-source-list");
        expect(component).toContain("autotuneAiCliSourceTitle");
        expect(component).toContain("autotuneAiBblSourceTitle");
        expect(component).toContain("autotuneAiBblLogManager");
        expect(component).toContain("autotuneAiSelectRecommendedLogs");
        expect(component).toContain("autotuneAiBblRecommendationHint");
        expect(component).toContain("autotune-ai-bbl-manager__hint");
        expect(component).toContain("autotuneAiShowOnlyUsableLogs");
        expect(component).toContain("formatLogQualityStatus");
        expect(component).toContain("formatLogQualityReason");
        expect(component).toContain("formatLogEvidenceSummary");
        expect(component).toContain("qualityBadgeClass");
        expect(component).toContain("log.qualityReason");
        expect(component).toContain("log.decodedMainFrames");
        expect(component).toContain("log.corruptFrames");
        expect(component).toContain("log.durationUs");
        expect(component).toContain("autotune-ai-bbl-manager__log-header");
        expect(component).toContain("autotune-ai-bbl-manager__log-badge");
        expect(component).toContain("autotune-ai-bbl-manager__log-evidence");
        expect(component).toContain("filteredBblLogOptions");
        expect(component).toContain("sortBblLogOptions");
        expect(component).toContain("@click=\"selectBblLog");
        expect(store).toContain("selectBblLog");
        expect(store).toContain("selectRecommendedBblLogs");
        expect(store).toContain("MAX_RECOMMENDED_BBL_LOGS");
        expect(store).toContain("bblFileData");
        expect(englishMessages).toContain("autotuneAiBblRecommendationHint");
        expect(chineseMessages).toContain("autotuneAiBblRecommendationHint");
        expect(traditionalChineseMessages).toContain("autotuneAiBblRecommendationHint");
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

    it("localizes local-analysis diagnostics and aggregate recommendations at render time", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");
        const englishMessages = readFileSync("locales/en/messages.json", "utf8");
        const chineseMessages = readFileSync("locales/zh_CN/messages.json", "utf8");
        const traditionalChineseMessages = readFileSync("locales/zh_TW/messages.json", "utf8");

        expect(component).toContain("LOCAL_ANALYSIS_DIAGNOSTIC_TYPE_KEYS");
        expect(component).toContain("LOCAL_ANALYSIS_RECOMMENDATION_TYPE_KEYS");
        expect(component).toContain("LOCAL_ANALYSIS_RECOMMENDATION_GROUP_KEYS");
        expect(component).toContain("LOCAL_ANALYSIS_EXPLANATION_KEYS");
        expect(component).toContain("localizeLocalAnalysisValue(diagnostic?.type, LOCAL_ANALYSIS_DIAGNOSTIC_TYPE_KEYS)");
        expect(component).toContain("localizeLocalAnalysisValue(diagnostic?.explanation, LOCAL_ANALYSIS_EXPLANATION_KEYS)");
        expect(component).toContain("localizeLocalAnalysisValue(recommendation?.group, LOCAL_ANALYSIS_RECOMMENDATION_GROUP_KEYS)");
        expect(component).toContain("localizeLocalAnalysisValue(recommendation?.type, LOCAL_ANALYSIS_RECOMMENDATION_TYPE_KEYS)");
        expect(component).toContain("pid_time_domain");
        expect(component).toContain("motor_output_imbalance");
        expect(component).toContain("inspect_powertrain_balance");
        expect(component).toContain("autotuneAiLocalAnalysisSources");
        expect(component).toContain("autotuneAiLocalAnalysisPriority");

        expect(englishMessages).toContain("autotuneAiLocalAnalysisDiagnosticPidTimeDomain");
        expect(englishMessages).toContain("autotuneAiLocalAnalysisDiagnosticMotorOutputImbalance");
        expect(englishMessages).toContain("autotuneAiLocalAnalysisRecommendationInspectPowertrainBalance");
        expect(englishMessages).toContain("autotuneAiLocalAnalysisExplanationPidTimeDomain");
        expect(englishMessages).toContain("autotuneAiLocalAnalysisExplanationInspectPowertrainBalance");
        expect(englishMessages).toContain("autotuneAiLocalAnalysisPriorityHigh");
        expect(englishMessages).toContain("autotuneAiLocalAnalysisSources");

        expect(chineseMessages).toContain("autotuneAiLocalAnalysisDiagnosticPidTimeDomain");
        expect(chineseMessages).toContain("autotuneAiLocalAnalysisRecommendationInspectPowertrainBalance");
        expect(chineseMessages).toContain("autotuneAiLocalAnalysisExplanationInspectPowertrainBalance");
        expect(chineseMessages).toContain("autotuneAiLocalAnalysisPriorityHigh");
        expect(chineseMessages).toContain("autotuneAiLocalAnalysisSources");

        expect(traditionalChineseMessages).toContain("autotuneAiLocalAnalysisDiagnosticPidTimeDomain");
        expect(traditionalChineseMessages).toContain("autotuneAiLocalAnalysisRecommendationInspectPowertrainBalance");
        expect(traditionalChineseMessages).toContain("autotuneAiLocalAnalysisExplanationInspectPowertrainBalance");
        expect(traditionalChineseMessages).toContain("autotuneAiLocalAnalysisPriorityHigh");
        expect(traditionalChineseMessages).toContain("autotuneAiLocalAnalysisSources");
    });

    it("keeps local-analysis terminology aligned for English and Chinese Betaflight users", () => {
        const englishMessages = JSON.parse(readFileSync("locales/en/messages.json", "utf8"));
        const chineseMessages = JSON.parse(readFileSync("locales/zh_CN/messages.json", "utf8"));
        const traditionalChineseMessages = JSON.parse(readFileSync("locales/zh_TW/messages.json", "utf8"));

        expect(englishMessages.autotuneAiLocalAnalysisSources.message).toBe("Source logs");
        expect(englishMessages.autotuneAiLocalAnalysisPriority.message).toBe("Recommendation priority");
        expect(englishMessages.autotuneAiLocalAnalysisDiagnosticPidTimeDomain.message).toBe(
            "PID time-domain tracking error",
        );
        expect(englishMessages.autotuneAiLocalAnalysisDiagnosticRatesMismatch.message).toBe("Rates profile mismatch");
        expect(englishMessages.autotuneAiLocalAnalysisExplanationPidTimeDomain.message).toBe(
            "Time-domain tracking error indicates how closely the craft follows the requested angular-rate response.",
        );

        expect(chineseMessages.autotuneAiLocalAnalysis.message).toBe("本地黑盒分析");
        expect(chineseMessages.autotuneAiAggregateRecommendations.message).toBe("汇总建议");
        expect(chineseMessages.autotuneAiLocalAnalysisSources.message).toBe("来源日志");
        expect(chineseMessages.autotuneAiLocalAnalysisPriority.message).toBe("建议优先级");
        expect(chineseMessages.autotuneAiLocalAnalysisDiagnosticPidTimeDomain.message).toBe("PID 时域跟踪误差");
        expect(chineseMessages.autotuneAiLocalAnalysisDiagnosticRatesMismatch.message).toBe("Rates 配置不匹配");
        expect(chineseMessages.autotuneAiLocalAnalysisRecommendationInspectPowertrainBalance.message).toBe(
            "检查动力系统平衡",
        );
        expect(chineseMessages.autotuneAiLocalAnalysisExplanationFilterFrequencyDomain.message).toBe(
            "频域能量分布提示存在共振峰，或 D 项高频能量偏高。",
        );

        expect(traditionalChineseMessages.autotuneAiLocalAnalysis.message).toBe("本地黑盒分析");
        expect(traditionalChineseMessages.autotuneAiAggregateRecommendations.message).toBe("彙整建議");
        expect(traditionalChineseMessages.autotuneAiLocalAnalysisSources.message).toBe("來源日誌");
        expect(traditionalChineseMessages.autotuneAiLocalAnalysisPriority.message).toBe("建議優先級");
        expect(traditionalChineseMessages.autotuneAiLocalAnalysisDiagnosticPidTimeDomain.message).toBe(
            "PID 時域追蹤誤差",
        );
        expect(traditionalChineseMessages.autotuneAiLocalAnalysisDiagnosticRatesMismatch.message).toBe(
            "Rates 設定不相符",
        );
        expect(traditionalChineseMessages.autotuneAiLocalAnalysisRecommendationInspectPowertrainBalance.message).toBe(
            "檢查動力系統平衡",
        );
        expect(traditionalChineseMessages.autotuneAiLocalAnalysisExplanationFilterFrequencyDomain.message).toBe(
            "頻域能量分布顯示存在共振峰，或 D 項高頻能量偏高。",
        );
    });

    it("keeps non-writeable recommendation groups visible but blocks FC writes", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");

        expect(component).toContain("group.data.writeable === true");
        expect(component).toContain("autotuneAiLocalAnalysisWriteBlocked");
        expect(component).toContain("aggregateQuality.status !== 'usable'");
        expect(component).toContain("formatAggregateQualityStatus");
        expect(component).toContain("formatAggregateQualityReason");
        expect(component).toContain("autotuneAiAggregateReasonIncludesUnusableLogs");
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

    it("only requires the FC blocks needed by the recommendation values being written", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");

        expect(component).toContain("const needsSliders = Object.keys(values).some((key) => SLIDER_KEYS.has(key))");
        expect(component).toContain("const needsRcTuning = Object.keys(values).some((key) => RC_TUNING_KEYS.has(key))");
        expect(component).toContain("if (needsSliders && !FC.TUNING_SLIDERS)");
        expect(component).toContain("if (needsRcTuning && !FC.RC_TUNING)");
        expect(component).not.toContain("if (!FC.TUNING_SLIDERS || !FC.RC_TUNING)");
    });

    it("renders local write-envelope and effective-plan sections separately from the raw ai response", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");
        const englishMessages = readFileSync("locales/en/messages.json", "utf8");
        const chineseMessages = readFileSync("locales/zh_CN/messages.json", "utf8");
        const traditionalChineseMessages = readFileSync("locales/zh_TW/messages.json", "utf8");

        expect(component).toContain("localWriteEnvelopeGroups");
        expect(component).toContain("effectivePlanGroups");
        expect(component).toContain("autotuneAiLocalWriteEnvelope");
        expect(component).toContain("autotuneAiGuardedPlan");
        expect(component).toContain("autotuneAiLocalCandidates");
        expect(component).toContain("autotuneAiAcceptedByLocalGuard");
        expect(component).toContain("autotuneAiRejectedByLocalGuard");
        expect(component).toContain("formatWriteEnvelopeBlockedReason");
        expect(component).toContain("formatWriteEnvelopeCandidateReason");
        expect(component).toContain("formatWriteEnvelopeEvidenceRefs");
        expect(component).toContain("autotuneAiCandidateReason");
        expect(component).toContain("autotuneAiCandidateEvidence");
        expect(component).toContain("autotuneAiBlockedReasonMechanicalImbalance");
        expect(component).toContain("autotuneAiBlockedReasonConflictingValues");
        expect(component).toContain("autotuneAiCandidateReasonGyroFilter");
        expect(component).toContain("autotuneAiCandidateReasonDtermFilter");
        expect(component).toContain("getEffectivePlanCandidate");
        expect(component).toContain("sessionState.localWriteEnvelope");
        expect(component).toContain("sessionState.effectivePlan");

        expect(englishMessages).toContain("autotuneAiLocalWriteEnvelope");
        expect(englishMessages).toContain("autotuneAiGuardedPlan");
        expect(englishMessages).toContain("autotuneAiLocalCandidates");
        expect(englishMessages).toContain("autotuneAiAcceptedByLocalGuard");
        expect(englishMessages).toContain("autotuneAiRejectedByLocalGuard");
        expect(englishMessages).toContain("autotuneAiBlockedReasonMechanicalImbalance");
        expect(englishMessages).toContain("autotuneAiBlockedReasonConflictingValues");
        expect(englishMessages).toContain("autotuneAiCandidateReason");
        expect(englishMessages).toContain("autotuneAiCandidateEvidence");
        expect(englishMessages).toContain("autotuneAiCandidateReasonGyroFilter");
        expect(englishMessages).toContain("autotuneAiCandidateReasonDtermFilter");
        expect(englishMessages).toContain("autotuneAiExplainOnly");

        expect(chineseMessages).toContain("autotuneAiLocalWriteEnvelope");
        expect(chineseMessages).toContain("autotuneAiGuardedPlan");
        expect(chineseMessages).toContain("autotuneAiLocalCandidates");
        expect(chineseMessages).toContain("autotuneAiAcceptedByLocalGuard");
        expect(chineseMessages).toContain("autotuneAiRejectedByLocalGuard");
        expect(chineseMessages).toContain("autotuneAiBlockedReasonMechanicalImbalance");
        expect(chineseMessages).toContain("autotuneAiBlockedReasonConflictingValues");
        expect(chineseMessages).toContain("autotuneAiCandidateReason");
        expect(chineseMessages).toContain("autotuneAiCandidateEvidence");
        expect(chineseMessages).toContain("autotuneAiCandidateReasonGyroFilter");
        expect(chineseMessages).toContain("autotuneAiCandidateReasonDtermFilter");
        expect(chineseMessages).toContain("autotuneAiExplainOnly");

        expect(traditionalChineseMessages).toContain("autotuneAiLocalWriteEnvelope");
        expect(traditionalChineseMessages).toContain("autotuneAiGuardedPlan");
        expect(traditionalChineseMessages).toContain("autotuneAiLocalCandidates");
        expect(traditionalChineseMessages).toContain("autotuneAiAcceptedByLocalGuard");
        expect(traditionalChineseMessages).toContain("autotuneAiRejectedByLocalGuard");
        expect(traditionalChineseMessages).toContain("autotuneAiBlockedReasonMechanicalImbalance");
        expect(traditionalChineseMessages).toContain("autotuneAiBlockedReasonConflictingValues");
        expect(traditionalChineseMessages).toContain("autotuneAiCandidateReason");
        expect(traditionalChineseMessages).toContain("autotuneAiCandidateEvidence");
        expect(traditionalChineseMessages).toContain("autotuneAiCandidateReasonGyroFilter");
        expect(traditionalChineseMessages).toContain("autotuneAiCandidateReasonDtermFilter");
        expect(traditionalChineseMessages).toContain("autotuneAiExplainOnly");
    });

    it("routes FC writes through the effective plan instead of the raw ai response", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");
        const writePath = component.slice(
            component.indexOf("const canWrite = computed"),
            component.indexOf("async function runAnalysis"),
        );
        const effectivePlanSection = component.slice(
            component.indexOf('v-if="sessionState.effectivePlan"'),
            component.indexOf('<section class="autotune-ai-section">', component.indexOf('v-if="sessionState.effectivePlan"') + 1),
        );
        const rawAiSection = component.slice(
            component.indexOf('v-if="sessionState.aiResponse"'),
            component.indexOf('v-else class="rounded border border-neutral-500/30 p-3 text-sm text-dimmed"'),
        );

        expect(writePath).toContain("effectivePlanGroups.value");
        expect(writePath).toContain("sessionState.effectivePlan?.groups?.[groupKey]");
        expect(writePath).not.toContain("recommendationGroups.value");
        expect(writePath).not.toContain("sessionState.aiResponse?.groups?.[groupKey]");
        expect(effectivePlanSection).toContain('@click="writeGroup(group.key)"');
        expect(rawAiSection).not.toContain('@click="writeGroup(group.key)"');
    });

    it("renders candidate reason and evidence for guarded effective-plan values", () => {
        const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");
        const effectivePlanSection = component.slice(
            component.indexOf('v-if="sessionState.effectivePlan"'),
            component.indexOf('<section class="autotune-ai-section">', component.indexOf('v-if="sessionState.effectivePlan"') + 1),
        );

        expect(effectivePlanSection).toContain("getEffectivePlanCandidate");
        expect(effectivePlanSection).toContain('$t("autotuneAiCandidateReason")');
        expect(effectivePlanSection).toContain('$t("autotuneAiCandidateEvidence")');
        expect(effectivePlanSection).toContain("formatWriteEnvelopeCandidateReason");
        expect(effectivePlanSection).toContain("formatWriteEnvelopeEvidenceRefs");
    });
});
