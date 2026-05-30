<template>
    <div class="autotune-ai-advisor">
        <section
            class="autotune-ai-section"
            :class="{ 'autotune-ai-section--collapsed': !sessionState.aiConfigOpen }"
        >
            <header
                class="autotune-ai-section__header autotune-ai-section__header--interactive"
                role="button"
                tabindex="0"
                :aria-expanded="sessionState.aiConfigOpen"
                @click="toggleAiConfig"
                @keydown.enter.space.prevent="toggleAiConfig"
            >
                <div class="autotune-ai-section__title">
                    <UIcon name="i-lucide-sliders-horizontal" class="size-4" />
                    <h3>{{ $t("autotuneAiSectionAiConfig") }}</h3>
                </div>
                <UButton
                    size="xs"
                    variant="ghost"
                    square
                    :icon="sessionState.aiConfigOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    :aria-label="
                        $t(sessionState.aiConfigOpen ? 'autotuneAiCollapseAiConfig' : 'autotuneAiExpandAiConfig')
                    "
                    @click.stop="toggleAiConfig"
                />
            </header>
            <div v-show="sessionState.aiConfigOpen" class="autotune-ai-field-grid">
                <label class="autotune-ai-field autotune-ai-field--wide">
                    <span>{{ $t("autotuneAiProvider") }}</span>
                    <USelect
                        v-model="providerSettings.provider"
                        :items="providerOptions"
                        size="sm"
                        :ui="selectPortalUi"
                        @update:model-value="store.applyProviderPreset"
                    />
                </label>
                <label class="autotune-ai-field">
                    <span>{{ $t("autotuneAiModel") }}</span>
                    <UInput v-model="providerSettings.model" size="sm" />
                </label>
                <label class="autotune-ai-field autotune-ai-field--switch">
                    <span>{{ $t("autotuneAiThinkingMode") }}</span>
                    <USwitch
                        v-model="providerSettings.thinkingModeEnabled"
                        size="sm"
                        :disabled="!supportsThinkingMode"
                    />
                    <small>
                        {{
                            $t(
                                supportsThinkingMode
                                    ? "autotuneAiThinkingModeHint"
                                    : "autotuneAiThinkingModeUnsupported",
                            )
                        }}
                    </small>
                </label>
                <label class="autotune-ai-field">
                    <span>{{ $t("autotuneAiThinkingEffort") }}</span>
                    <USelect
                        v-model="providerSettings.thinkingEffort"
                        :items="thinkingEffortOptions"
                        size="sm"
                        :ui="selectPortalUi"
                        :disabled="!supportsThinkingMode || !providerSettings.thinkingModeEnabled"
                    />
                </label>
                <label class="autotune-ai-field autotune-ai-field--wide">
                    <span>{{ $t("autotuneAiBaseUrl") }}</span>
                    <UInput v-model="providerSettings.baseUrl" size="sm" />
                </label>
                <label class="autotune-ai-field autotune-ai-field--wide">
                    <span>{{ $t("autotuneAiApiKey") }}</span>
                    <UInput v-model="providerSettings.apiKey" type="password" size="sm" autocomplete="off" />
                </label>
                <label class="autotune-ai-field">
                    <span>{{ $t("autotuneAiTemperature") }}</span>
                    <UInputNumber
                        v-model="providerSettings.temperature"
                        :min="0"
                        :max="1"
                        :step="0.1"
                        size="sm"
                        :disabled="thinkingTemperatureDisabled"
                    />
                    <small v-if="thinkingTemperatureDisabled">{{ $t("autotuneAiThinkingTemperatureHint") }}</small>
                </label>
                <label class="autotune-ai-field">
                    <span>{{ $t("autotuneAiMaxTokens") }}</span>
                    <UInputNumber
                        v-model="maxTokensK"
                        :min="0.5"
                        :max="1000"
                        :step="1"
                        size="sm"
                    />
                </label>
            </div>
        </section>

        <section class="autotune-ai-section">
            <header class="autotune-ai-section__header">
                <div class="autotune-ai-section__title">
                    <UIcon name="i-lucide-drone" class="size-4" />
                    <h3>{{ $t("autotuneAiSectionCraftContext") }}</h3>
                </div>
                <span class="autotune-ai-section__badge">{{ $t("autotuneAiRequiredBadge") }}</span>
            </header>
            <div class="autotune-ai-profile-bar">
                <label class="autotune-ai-field">
                    <span>{{ $t("autotuneAiCraftProfileSelect") }}</span>
                    <USelect
                        v-model="selectedCraftProfileId"
                        :items="craftContextProfileOptions"
                        size="sm"
                        :ui="selectPortalUi"
                        :disabled="!craftContextProfileOptions.length"
                        @update:model-value="onCraftProfileSelected"
                    />
                </label>
                <label class="autotune-ai-field">
                    <span>{{ $t("autotuneAiCraftProfileName") }}</span>
                    <UInput
                        v-model="craftProfileName"
                        size="sm"
                        :placeholder="$t('autotuneAiCraftProfileNamePlaceholder')"
                    />
                </label>
                <UButton
                    class="autotune-ai-profile-bar__save"
                    size="sm"
                    variant="soft"
                    icon="i-lucide-save"
                    :label="$t('autotuneAiSaveCraftProfile')"
                    @click="saveCraftProfile"
                />
            </div>
            <div class="autotune-ai-field-grid">
                <label v-for="field in requiredFields" :key="field.key" class="autotune-ai-field">
                    <span class="autotune-ai-field__label">
                        {{ $t(field.labelKey) }}
                        <UTooltip v-if="field.helpKey" :delay-duration="0" arrow :content="{ side: 'right' }">
                            <UIcon name="i-lucide-circle-alert" class="autotune-ai-field__help-icon text-dimmed" />
                            <template #content>
                                <div>{{ $t(field.helpKey) }}</div>
                            </template>
                        </UTooltip>
                    </span>
                    <USelect
                        v-if="field.options && !field.custom"
                        v-model="craftContext[field.key]"
                        :items="field.options"
                        size="sm"
                        :ui="selectPortalUi"
                    />
                    <UInputMenu
                        v-else-if="field.custom"
                        v-model="craftContext[field.key]"
                        :items="field.options"
                        size="sm"
                        autocomplete
                        open-on-click
                        open-on-focus
                        create-item="always"
                        :ui="selectPortalUi"
                        @create="setFrameSize"
                    />
                    <UInput v-else v-model="craftContext[field.key]" size="sm" />
                    <small v-if="field.hintKey">{{ $t(field.hintKey) }}</small>
                </label>
            </div>
            <div class="autotune-ai-subsection-title">{{ $t("autotuneAiSectionOptionalContext") }}</div>
            <div class="autotune-ai-field-grid">
                <label v-for="field in optionalFields" :key="field.key" class="autotune-ai-field">
                    <span class="autotune-ai-field__label">
                        {{ $t(field.labelKey) }}
                        <UTooltip v-if="field.helpKey" :delay-duration="0" arrow :content="{ side: 'right' }">
                            <UIcon name="i-lucide-circle-alert" class="autotune-ai-field__help-icon text-dimmed" />
                            <template #content>
                                <div>{{ $t(field.helpKey) }}</div>
                            </template>
                        </UTooltip>
                    </span>
                    <UInput v-model="craftContext[field.key]" size="sm" />
                </label>
                <label class="autotune-ai-field autotune-ai-field--wide">
                    <span class="autotune-ai-field__label">
                        {{ $t(notesField.labelKey) }}
                        <UTooltip :delay-duration="0" arrow :content="{ side: 'right' }">
                            <UIcon name="i-lucide-circle-alert" class="autotune-ai-field__help-icon text-dimmed" />
                            <template #content>
                                <div>{{ $t(notesField.helpKey) }}</div>
                            </template>
                        </UTooltip>
                    </span>
                    <UTextarea v-model="craftContext.notes" :rows="3" size="sm" />
                </label>
            </div>
        </section>

        <section class="autotune-ai-section">
            <header class="autotune-ai-section__header">
                <div class="autotune-ai-section__title">
                    <UIcon name="i-lucide-file-input" class="size-4" />
                    <h3>{{ $t("autotuneAiSectionInputSource") }}</h3>
                </div>
                <UButton
                    size="xs"
                    variant="soft"
                    icon="i-lucide-upload"
                    :label="$t('autotuneAiAddInputFile')"
                    @click="openInputFilePicker"
                />
            </header>
            <input
                ref="inputFileRef"
                type="file"
                accept=".txt,.cli,.dump,.csv,.bbl,.BBL"
                class="sr-only"
                @change="onInputFileSelected"
            />
            <div class="autotune-ai-source-list">
                <div v-for="source in inputSources" :key="source.key" class="autotune-ai-source-row">
                    <UIcon :name="source.icon" class="autotune-ai-source-row__icon" />
                    <div class="autotune-ai-source-row__body">
                        <div class="autotune-ai-source-row__title">{{ $t(source.titleKey) }}</div>
                        <div class="autotune-ai-source-row__meta">{{ source.meta }}</div>
                    </div>
                </div>
            </div>
            <div v-if="bblLogOptions.length" class="autotune-ai-bbl-manager">
                <div class="autotune-ai-bbl-manager__header">
                    <div class="autotune-ai-bbl-manager__title">{{ $t("autotuneAiBblLogManager") }}</div>
                    <div class="autotune-ai-bbl-manager__controls">
                        <UCheckbox
                            v-model="showOnlyUsableLogs"
                            :label="$t('autotuneAiShowOnlyUsableLogs')"
                        />
                        <div class="autotune-ai-bbl-manager__recommend">
                            <UButton
                                size="xs"
                                variant="soft"
                                icon="i-lucide-wand-sparkles"
                                :label="$t('autotuneAiSelectRecommendedLogs')"
                                @click="selectRecommendedBblLogs"
                            />
                            <div class="autotune-ai-bbl-manager__hint">
                                {{ $t("autotuneAiBblRecommendationHint") }}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="autotune-ai-bbl-manager__multi-select">
                    <UCheckbox
                        v-for="log in filteredBblLogOptions"
                        :key="`multi-${log.index}`"
                        :model-value="sessionState.selectedBblLogIndexes.includes(log.index)"
                        :label="log.label"
                        @update:model-value="toggleBblLogSelection(log.index)"
                    />
                </div>
                <div class="autotune-ai-bbl-manager__grid">
                    <div
                        v-for="log in filteredBblLogOptions"
                        :key="log.index"
                        class="autotune-ai-bbl-manager__log-card"
                    >
                        <div class="autotune-ai-bbl-manager__log-header">
                            <UButton
                                size="xs"
                                :variant="log.selected ? 'solid' : 'soft'"
                                :color="log.selected ? 'primary' : 'neutral'"
                                :label="log.label"
                                @click="selectBblLog(log.index)"
                            />
                            <span
                                class="autotune-ai-bbl-manager__log-badge"
                                :class="qualityBadgeClass(log.qualityStatus)"
                            >
                                {{ formatLogQualityStatus(log.qualityStatus) }}
                            </span>
                        </div>
                        <div class="autotune-ai-bbl-manager__log-reason">
                            {{ formatLogQualityReason(log.qualityReason) }}
                        </div>
                        <div class="autotune-ai-bbl-manager__log-evidence">
                            {{ formatLogEvidenceSummary(log) }}
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <section class="autotune-ai-actions">
            <UButton
                icon="i-lucide-sparkles"
                :label="$t('autotuneAiAnalyze')"
                :loading="sessionState.requestState === 'loading'"
                :disabled="!store.canAnalyze"
                @click="runAnalysis"
            />
            <UButton
                icon="i-lucide-rotate-ccw"
                :label="$t('autotuneAiClearResult')"
                variant="soft"
                :disabled="!store.hasRecommendation"
                @click="store.resetResponse"
            />
            <span v-if="!store.requiredContextComplete" class="text-xs text-warning">
                {{ $t("autotuneAiContextRequired") }}
            </span>
            <span v-else-if="!providerSettings.apiKey" class="text-xs text-warning">
                {{ $t("autotuneAiApiKeyRequired") }}
            </span>
        </section>

        <div v-if="sessionState.lastError" class="text-sm text-red-500 font-semibold">
            {{ sessionState.lastError }}
        </div>

        <section v-if="sessionState.localBblAnalysis" class="autotune-ai-section autotune-ai-local-analysis">
            <header class="autotune-ai-section__header">
                <div class="autotune-ai-section__title">
                    <UIcon name="i-lucide-file-chart-column" class="size-4" />
                    <h3>{{ $t("autotuneAiLocalAnalysis") }}</h3>
                </div>
            </header>

            <div class="autotune-ai-local-analysis__summary">
                <div class="autotune-ai-local-analysis__reason">
                    {{ $t("autotuneAiSelectedLogs") }}: {{ formatSelectedLogs(sessionState.localBblAnalysis.selectedLogIndexes) }}
                </div>
                <div class="autotune-ai-local-analysis__quality">
                    {{
                        $t("autotuneAiDataQuality")
                    }}: {{ formatAggregateQualityStatus(sessionState.localBblAnalysis.aggregateQuality.status) }}
                </div>
                <div class="autotune-ai-local-analysis__reason">
                    {{ formatAggregateQualityReason(sessionState.localBblAnalysis.aggregateQuality.reason) }}
                </div>
                <div
                    v-if="sessionState.bblSummary?.samples?.unsupportedEncodedFrames > 0"
                    class="autotune-ai-local-analysis__reason"
                >
                    {{ $t("autotuneAiUnsupportedEncoding") }}
                </div>
                <div
                    v-if="sessionState.localBblAnalysis.aggregateQuality.status !== 'usable'"
                    class="autotune-ai-local-analysis__reason text-warning"
                >
                    {{ $t("autotuneAiLocalAnalysisWriteBlocked") }}
                </div>
            </div>

            <div v-if="sessionState.localBblAnalysis.consensusDiagnostics.length" class="autotune-ai-local-analysis__group">
                <h4 class="autotune-ai-local-analysis__heading">{{ $t("autotuneAiDiagnostics") }}</h4>
                <ul class="autotune-ai-local-analysis__list">
                    <li
                        v-for="(diagnostic, index) in sessionState.localBblAnalysis.consensusDiagnostics"
                        :key="`consensus-${index}`"
                    >
                        {{ formatDiagnosticSummary(diagnostic) }}
                    </li>
                </ul>
            </div>

            <div v-if="sessionState.localBblAnalysis.conflictingDiagnostics.length" class="autotune-ai-local-analysis__group">
                <h4 class="autotune-ai-local-analysis__heading">{{ $t("autotuneAiSingletonDiagnostics") }}</h4>
                <ul class="autotune-ai-local-analysis__list">
                    <li
                        v-for="(diagnostic, index) in sessionState.localBblAnalysis.conflictingDiagnostics"
                        :key="`conflict-${index}`"
                    >
                        {{ formatDiagnosticSummary(diagnostic) }}
                    </li>
                </ul>
            </div>

            <div
                v-if="sessionState.localBblAnalysis.aggregateRecommendations.length"
                class="autotune-ai-local-analysis__group"
            >
                <h4 class="autotune-ai-local-analysis__heading">{{ $t("autotuneAiAggregateRecommendations") }}</h4>
                <ul class="autotune-ai-local-analysis__list">
                    <li
                        v-for="(recommendation, index) in sessionState.localBblAnalysis.aggregateRecommendations"
                        :key="`recommendation-${index}`"
                    >
                        {{ formatAggregateRecommendation(recommendation) }}
                    </li>
                </ul>
            </div>
        </section>

        <section v-if="sessionState.localWriteEnvelope" class="autotune-ai-section">
            <header class="autotune-ai-section__header">
                <div class="autotune-ai-section__title">
                    <UIcon name="i-lucide-shield-check" class="size-4" />
                    <h3>{{ $t("autotuneAiLocalWriteEnvelope") }}</h3>
                </div>
            </header>

            <div class="flex flex-col gap-3">
                <div
                    v-for="group in localWriteEnvelopeGroups"
                    :key="`envelope-${group.key}`"
                    class="rounded border border-neutral-500/30 p-3"
                >
                    <div class="flex items-center justify-between gap-2">
                        <h3 class="text-sm font-semibold">{{ $t(group.labelKey) }}</h3>
                        <span class="text-xs">
                            {{
                                group.data.writeableAllowed
                                    ? $t("autotuneAiLocalCandidates")
                                    : $t("autotuneAiExplainOnly")
                            }}
                        </span>
                    </div>
                    <p class="text-sm mt-2">
                        {{
                            group.data.writeableAllowed
                                ? $t("autotuneAiLocalCandidates")
                                : formatWriteEnvelopeBlockedReason(group.data.blockedReason)
                        }}
                    </p>
                    <dl class="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
                        <template v-for="item in group.candidates" :key="item.key">
                            <dt class="text-dimmed">{{ item.key }}</dt>
                            <dd class="font-mono">{{ item.value.suggestedValue }}</dd>
                            <dt class="text-dimmed">{{ $t("autotuneAiCandidateReason") }}</dt>
                            <dd>{{ formatWriteEnvelopeCandidateReason(item.value.reason) }}</dd>
                            <dt v-if="item.value.evidenceRefs?.length" class="text-dimmed">
                                {{ $t("autotuneAiCandidateEvidence") }}
                            </dt>
                            <dd v-if="item.value.evidenceRefs?.length" class="font-mono">
                                {{ formatWriteEnvelopeEvidenceRefs(item.value.evidenceRefs) }}
                            </dd>
                        </template>
                    </dl>
                    <div v-if="!group.candidates.length" class="text-xs text-dimmed mt-2">
                        {{ $t("autotuneAiNoWriteableValues") }}
                    </div>
                </div>
            </div>
        </section>

        <section v-if="sessionState.effectivePlan" class="autotune-ai-section">
            <header class="autotune-ai-section__header">
                <div class="autotune-ai-section__title">
                    <UIcon name="i-lucide-shield" class="size-4" />
                    <h3>{{ $t("autotuneAiGuardedPlan") }}</h3>
                </div>
            </header>

            <div class="flex flex-col gap-3">
                <div
                    v-for="group in effectivePlanGroups"
                    :key="`effective-${group.key}`"
                    class="rounded border border-neutral-500/30 p-3"
                >
                    <div class="flex items-center justify-between gap-2">
                        <h3 class="text-sm font-semibold">{{ $t(group.labelKey) }}</h3>
                        <div class="flex items-center gap-2">
                            <span
                                v-if="writeState[group.key] === 'done'"
                                class="text-xs text-green-500"
                            >{{ $t("autotuneAiWriteSuccess") }}</span>
                            <span
                                v-else-if="writeState[group.key] === 'error'"
                                class="text-xs text-red-500"
                                :title="writeError[group.key]"
                            >{{ $t("autotuneAiWriteError") }}</span>
                            <span v-else class="text-xs">
                                {{
                                    group.data.writeable
                                        ? $t("autotuneAiAcceptedByLocalGuard")
                                        : $t("autotuneAiRejectedByLocalGuard")
                                }}
                            </span>
                            <UButton
                                v-if="group.values.length && group.data.writeable === true"
                                size="xs"
                                variant="ghost"
                                icon="i-lucide-upload"
                                :label="$t('autotuneAiWriteGroup')"
                                :disabled="!canWrite"
                                :loading="writeState[group.key] === 'loading'"
                                @click="writeGroup(group.key)"
                            />
                        </div>
                    </div>
                    <p class="text-sm mt-2">
                        {{
                            group.data.writeable
                                ? group.data.explanation
                                : $t("autotuneAiRejectedByLocalGuard")
                        }}
                    </p>
                    <dl class="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
                        <template v-for="item in group.values" :key="item.key">
                            <dt class="text-dimmed">{{ item.key }}</dt>
                            <dd class="font-mono">{{ item.value }}</dd>
                            <template v-if="getEffectivePlanCandidate(group.key, item.key)">
                                <dt class="text-dimmed">{{ $t("autotuneAiCandidateReason") }}</dt>
                                <dd>{{ formatWriteEnvelopeCandidateReason(getEffectivePlanCandidate(group.key, item.key).reason) }}</dd>
                                <dt v-if="getEffectivePlanCandidate(group.key, item.key).evidenceRefs?.length" class="text-dimmed">
                                    {{ $t("autotuneAiCandidateEvidence") }}
                                </dt>
                                <dd v-if="getEffectivePlanCandidate(group.key, item.key).evidenceRefs?.length" class="font-mono">
                                    {{ formatWriteEnvelopeEvidenceRefs(getEffectivePlanCandidate(group.key, item.key).evidenceRefs) }}
                                </dd>
                            </template>
                        </template>
                    </dl>
                    <div v-if="!group.values.length" class="text-xs text-dimmed mt-2">
                        {{ $t("autotuneAiNoWriteableValues") }}
                    </div>
                </div>
            </div>
        </section>

        <section class="autotune-ai-section">
            <header class="autotune-ai-section__header">
                <div class="autotune-ai-section__title">
                    <UIcon name="i-lucide-list-checks" class="size-4" />
                    <h3>{{ $t("autotuneAiSectionRecommendations") }}</h3>
                </div>
                <UButton
                    v-if="store.hasRecommendation"
                    size="xs"
                    variant="soft"
                    icon="i-lucide-upload"
                    :label="$t('autotuneAiWriteAll')"
                    :disabled="!canWrite || !hasWriteableSelectedGroups"
                    :loading="isWritingAny"
                    @click="writeAll"
                />
            </header>
            <div class="autotune-ai-group-toggle">
                <USwitch v-model="sessionState.selectedGroups.pid" :label="$t('autotuneAiGroupPid')" size="sm" />
                <USwitch
                    v-model="sessionState.selectedGroups.filters"
                    :label="$t('autotuneAiGroupFilters')"
                    size="sm"
                />
                <USwitch v-model="sessionState.selectedGroups.rates" :label="$t('autotuneAiGroupRates')" size="sm" />
            </div>

            <div v-if="sessionState.aiResponse" class="flex flex-col gap-3">
                <div class="rounded border border-neutral-500/30 p-3">
                    <div class="flex items-center justify-between gap-2">
                        <h3 class="text-base font-semibold">{{ $t("autotuneAiExplanation") }}</h3>
                        <span class="text-xs uppercase">
                            {{ $t(riskLabelKey(sessionState.aiResponse.overallRisk)) }}
                        </span>
                    </div>
                    <p class="text-sm mt-2">{{ sessionState.aiResponse.summary }}</p>
                </div>

                <div
                    v-for="group in recommendationGroups"
                    :key="group.key"
                    class="rounded border border-neutral-500/30 p-3"
                >
                    <div class="flex items-center justify-between gap-2">
                        <h3 class="text-sm font-semibold">{{ $t(group.labelKey) }}</h3>
                        <span class="text-xs">{{ $t(confidenceLabelKey(group.data.confidence)) }}</span>
                    </div>
                    <p class="text-sm mt-2">{{ group.data.explanation }}</p>
                    <dl class="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
                        <template v-for="item in group.values" :key="item.key">
                            <dt class="text-dimmed">{{ item.key }}</dt>
                            <dd class="font-mono">{{ item.value }}</dd>
                        </template>
                    </dl>
                    <div v-if="!group.values.length" class="text-xs text-dimmed mt-2">
                        {{ $t("autotuneAiNoWriteableValues") }}
                    </div>
                </div>

                <div class="rounded border border-neutral-500/30 p-3 text-sm">
                    <span class="font-semibold">{{ $t("autotuneAiFlightTestNotes") }}</span>
                    <p class="mt-1">{{ sessionState.aiResponse.flightTestNotes }}</p>
                </div>
            </div>

            <div v-else class="rounded border border-neutral-500/30 p-3 text-sm text-dimmed">
                {{ $t("autotuneAiEmptyState") }}
            </div>
        </section>

        <section v-if="sessionState.conversationHistory.length" class="autotune-ai-section">
            <header class="autotune-ai-section__header">
                <div class="autotune-ai-section__title">
                    <UIcon name="i-lucide-messages-square" class="size-4" />
                    <h3>{{ $t("autotuneAiConversationTitle") }}</h3>
                </div>
                <UButton
                    size="xs"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    :label="$t('autotuneAiClearConversation')"
                    @click="store.clearConversation"
                />
            </header>

            <div v-if="sessionState.conversationTrimmed" class="autotune-ai-conversation__trimmed">
                {{ $t("autotuneAiConversationTrimmed") }}
            </div>

            <div class="autotune-ai-conversation">
                <article
                    v-for="(message, index) in sessionState.conversationHistory"
                    :key="`${message.role}-${index}`"
                    class="autotune-ai-message"
                    :class="`autotune-ai-message--${message.role}`"
                >
                    <div class="autotune-ai-message__role">
                        {{ message.role === "user" ? $t("autotuneAiUserRole") : $t("autotuneAiAssistantRole") }}
                    </div>
                    <pre class="autotune-ai-message__raw">{{ message.content }}</pre>
                </article>
            </div>

            <form class="autotune-ai-followup" @submit.prevent="sendFollowUp">
                <div class="autotune-ai-followup__body">
                    <USelect
                        v-model="sessionState.followUpScope"
                        :items="followUpScopeOptions"
                        size="sm"
                        :ui="selectPortalUi"
                        :disabled="sessionState.followUpState === 'loading'"
                    />
                    <UInput
                        v-model="sessionState.followUpInput"
                        size="sm"
                        :placeholder="$t('autotuneAiFollowUpPlaceholder')"
                        :disabled="sessionState.followUpState === 'loading'"
                    />
                    <small>{{ $t("autotuneAiFollowUpHint") }}</small>
                </div>
                <UButton
                    type="submit"
                    size="sm"
                    icon="i-lucide-send"
                    :label="
                        sessionState.followUpState === 'loading'
                            ? $t('autotuneAiFollowUpSending')
                            : $t('autotuneAiFollowUpSend')
                    "
                    :loading="sessionState.followUpState === 'loading'"
                    :disabled="!sessionState.followUpInput.trim() || sessionState.followUpState === 'loading'"
                />
            </form>
        </section>
    </div>
</template>

<script setup>
import { computed, reactive, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { PROVIDER_PRESETS, useAutotuneAiStore } from "@/stores/autotuneAi";
import { useAutotuneStore } from "@/stores/autotune";
import { useConnectionStore } from "@/stores/connection";
import { usePidTuningStore } from "@/stores/pidTuning";
import FC from "@/js/fc";
import MSP from "@/js/msp";
import MSPCodes from "@/js/msp/MSPCodes";
import { mspHelper } from "@/js/msp/MSPHelper";
import { validateTuningSliders } from "@/composables/useTuningSliders";

const store = useAutotuneAiStore();
const autotuneStore = useAutotuneStore();
const connectionStore = useConnectionStore();
const pidTuningStore = usePidTuningStore();
const { providerSettings, craftContext, sessionState } = store;
const { t } = useTranslation();
const selectPortalUi = { content: "z-[2101]" };
const inputFileRef = ref(null);
const selectedCraftProfileId = ref("");
const craftProfileName = ref("");
const showOnlyUsableLogs = ref(false);

// Write-to-FC state
const writeState = reactive({ pid: "idle", filters: "idle", rates: "idle" });
const writeError = reactive({ pid: "", filters: "", rates: "" });
const frameSizeOptions = [
    "65mm",
    "75mm",
    "1寸",
    "1.6寸",
    "2寸",
    "2.5寸",
    "3寸",
    "3.5寸",
    "4寸",
    "5寸",
    "6寸",
    "7寸",
    "8寸",
];
const batteryCellOptions = ["1S", "2S", "3S", "4S", "5S", "6S", "7S", "8S"];
const LOCAL_ANALYSIS_DIAGNOSTIC_TYPE_KEYS = {
    pid_time_domain: "autotuneAiLocalAnalysisDiagnosticPidTimeDomain",
    motor_output_imbalance: "autotuneAiLocalAnalysisDiagnosticMotorOutputImbalance",
    rates_mismatch: "autotuneAiLocalAnalysisDiagnosticRatesMismatch",
    filter_frequency_domain: "autotuneAiLocalAnalysisDiagnosticFilterFrequencyDomain",
};
const LOCAL_ANALYSIS_RECOMMENDATION_GROUP_KEYS = {
    data_quality: "autotuneAiDataQuality",
    mechanical: "autotuneAiMechanicalIssues",
    rates: "autotuneAiGroupRates",
    pid: "autotuneAiGroupPid",
    filters: "autotuneAiGroupFilters",
};
const LOCAL_ANALYSIS_RECOMMENDATION_TYPE_KEYS = {
    collect_better_log: "autotuneAiLocalAnalysisRecommendationCollectBetterLog",
    inspect_powertrain_balance: "autotuneAiLocalAnalysisRecommendationInspectPowertrainBalance",
    review_rates_profile: "autotuneAiLocalAnalysisRecommendationReviewRatesProfile",
};
const LOCAL_ANALYSIS_EXPLANATION_KEYS = {
    "Average motor outputs show a sustained spread that suggests balance or mechanical asymmetry.":
        "autotuneAiLocalAnalysisExplanationMotorOutputImbalance",
    "Configured rates look aggressive for the declared craft profile and flight style.":
        "autotuneAiLocalAnalysisExplanationRatesMismatch",
    "Time-domain tracking error indicates how far the craft is from the requested rate response.":
        "autotuneAiLocalAnalysisExplanationPidTimeDomain",
    "Frequency-domain energy highlights resonant peaks and high-frequency D-term content.":
        "autotuneAiLocalAnalysisExplanationFilterFrequencyDomain",
    "Capture a longer log with required time, gyro, setpoint, and motor fields before tuning decisions.":
        "autotuneAiLocalAnalysisExplanationCollectBetterLog",
    "Check propellers, motor health, frame alignment, and CG before relying on PID changes.":
        "autotuneAiLocalAnalysisExplanationInspectPowertrainBalance",
};
const WRITE_ENVELOPE_CANDIDATE_REASON_KEYS = {
    "Repeated frequency-domain gyro peaks suggest stronger gyro filtering.": "autotuneAiCandidateReasonGyroFilter",
    "Repeated high-frequency D-term energy suggests stronger D-term filtering.": "autotuneAiCandidateReasonDtermFilter",
    "Repeated roll/pitch under-tracking supports a small master multiplier increase.": "autotuneAiCandidateReasonPidMaster",
    "Repeated moving-error under stick demand supports a small feedforward increase.": "autotuneAiCandidateReasonPidFeedforward",
    "Repeated steady-state tracking error supports a small I gain increase.": "autotuneAiCandidateReasonPidI",
    "Repeated peak-error evidence with no competing filter risk supports a small D gain increase.": "autotuneAiCandidateReasonPidD",
};
const LOCAL_ANALYSIS_PRIORITY_KEYS = {
    low: "autotuneAiLocalAnalysisPriorityLow",
    medium: "autotuneAiLocalAnalysisPriorityMedium",
    high: "autotuneAiLocalAnalysisPriorityHigh",
};

const providerOptions = computed(() =>
    PROVIDER_PRESETS.map((preset) => ({
        label: t(preset.labelKey),
        value: preset.value,
    })),
);

const craftContextProfileOptions = computed(() =>
    store.craftContextProfiles.map((profile) => ({
        label: profile.name,
        value: profile.id,
    })),
);

const craftTypes = computed(() => [
    { label: t("autotuneAiCraftFreestyle"), value: "freestyle" },
    { label: t("autotuneAiCraftRacing"), value: "racing" },
    { label: t("autotuneAiCraftCinematic"), value: "cinematic" },
    { label: t("autotuneAiCraftLongRange"), value: "long-range" },
    { label: t("autotuneAiCraftWhoop"), value: "whoop" },
    { label: t("autotuneAiCraftOther"), value: "other" },
]);

const riskOptions = computed(() => [
    { label: t("autotuneAiRiskConservative"), value: "conservative" },
    { label: t("autotuneAiRiskBalanced"), value: "balanced" },
    { label: t("autotuneAiRiskAggressive"), value: "aggressive" },
]);

const thinkingEffortOptions = computed(() => [
    { label: t("autotuneAiThinkingEffortHigh"), value: "high" },
    { label: t("autotuneAiThinkingEffortMax"), value: "max" },
]);

const followUpScopeOptions = computed(() => [
    { label: t("autotuneAiFollowUpScopeAll"), value: "all" },
    { label: t("autotuneAiFollowUpScopePid"), value: "pid" },
    { label: t("autotuneAiFollowUpScopeFilters"), value: "filters" },
    { label: t("autotuneAiFollowUpScopeRates"), value: "rates" },
]);

const supportsThinkingMode = computed(() => providerSettings.provider.startsWith("deepseek"));
const thinkingTemperatureDisabled = computed(
    () => supportsThinkingMode.value && Boolean(providerSettings.thinkingModeEnabled),
);
const maxTokensK = computed({
    get: () => Number((Number(providerSettings.maxTokens || 0) / 1000).toFixed(1)),
    set: (value) => {
        const numericValue = Number(value);
        providerSettings.maxTokens = Number.isFinite(numericValue) ? Math.round(numericValue * 1000) : 1200;
    },
});

const requiredFields = computed(() => [
    { key: "craftType", labelKey: "autotuneAiCraftType", helpKey: "autotuneAiCraftTypeHelp", options: craftTypes.value },
    {
        key: "frameSize",
        labelKey: "autotuneAiFrameSize",
        helpKey: "autotuneAiFrameSizeHelp",
        options: frameSizeOptions,
        custom: true,
    },
    {
        key: "allUpWeight",
        labelKey: "autotuneAiAllUpWeight",
        helpKey: "autotuneAiAllUpWeightHelp",
        hintKey: "autotuneAiAllUpWeightHint",
    },
    { key: "prop", labelKey: "autotuneAiProp", helpKey: "autotuneAiPropHelp" },
    { key: "motorKv", labelKey: "autotuneAiMotorKv", helpKey: "autotuneAiMotorKvHelp" },
    { key: "battery", labelKey: "autotuneAiBattery", helpKey: "autotuneAiBatteryHelp", options: batteryCellOptions },
    { key: "flightStyle", labelKey: "autotuneAiFlightStyle", helpKey: "autotuneAiFlightStyleHelp" },
    {
        key: "riskPreference",
        labelKey: "autotuneAiRiskPreference",
        helpKey: "autotuneAiRiskPreferenceHelp",
        options: riskOptions.value,
    },
]);

const optionalFields = [
    { key: "flightControllerModel", labelKey: "autotuneAiFcModel", helpKey: "autotuneAiFcModelHelp" },
    { key: "gyroModel", labelKey: "autotuneAiGyroModel", helpKey: "autotuneAiGyroModelHelp" },
    { key: "escProtocol", labelKey: "autotuneAiEscProtocol", helpKey: "autotuneAiEscProtocolHelp" },
    { key: "motorOutputLimit", labelKey: "autotuneAiMotorOutputLimit", helpKey: "autotuneAiMotorOutputLimitHelp" },
];
const notesField = { key: "notes", labelKey: "autotuneAiNotes", helpKey: "autotuneAiNotesHelp" };

const parsedCliCount = computed(() => {
    const summary = sessionState.parsedCliSummary;
    if (!summary) {
        return 0;
    }

    return ["pid", "filters", "rates", "features"].reduce(
        (count, group) => count + Object.keys(summary[group] || {}).length,
        0,
    );
});

const cliSourceStatus = computed(() => {
    if (sessionState.parsedCliSummary) {
        return t("autotuneAiCliParsed", {
            count: parsedCliCount.value,
            unsupported: sessionState.parsedCliSummary.unsupportedLineCount,
        });
    }

    return t("autotuneAiInputFileHint");
});

const csvSourceStatus = computed(() => {
    if (sessionState.csvSummary) {
        return t("autotuneAiCsvParsed", {
            count: sessionState.csvSummary.rowCountEstimate,
            columns: sessionState.csvSummary.columns.length,
        });
    }

    return t("autotuneAiNoInputFile");
});

const bblSourceStatus = computed(() => {
    if (sessionState.bblSummary) {
        return t("autotuneAiBblParsed", {
            logs: sessionState.bblSummary.logCount,
            fields: sessionState.bblSummary.fields.loggedFields.length,
        });
    }

    if (sessionState.sourceType === "unknown") {
        return t("autotuneAiInputFileUnsupported");
    }

    return t("autotuneAiNoInputFile");
});

const inputSources = computed(() => [
    {
        key: "cli",
        icon: "i-lucide-terminal",
        titleKey: "autotuneAiCliSourceTitle",
        meta: cliSourceStatus.value,
    },
    {
        key: "csv",
        icon: "i-lucide-table",
        titleKey: "autotuneAiCsvSourceTitle",
        meta: csvSourceStatus.value,
    },
    {
        key: "bbl",
        icon: "i-lucide-file-chart-column",
        titleKey: "autotuneAiBblSourceTitle",
        meta: bblSourceStatus.value,
    },
]);

const bblLogOptions = computed(() =>
    (sessionState.bblSummary?.availableLogs || []).map((log) => ({
        index: log.index,
        selected: log.index === sessionState.bblSummary.selectedLogIndex,
        qualityStatus: sessionState.localBblAnalysesByLog?.[log.index]?.quality?.status || "unknown",
        qualityReason: sessionState.localBblAnalysesByLog?.[log.index]?.quality?.reason || "missing_quality",
        decodedMainFrames: log.decodedMainFrames,
        corruptFrames: log.corruptFrames,
        durationUs: log.durationUs,
        label: t("autotuneAiBblLogOption", {
            index: log.index + 1,
            frames: log.decodedMainFrames,
            seconds: log.durationUs === null ? "-" : (log.durationUs / 1e6).toFixed(1),
        }),
    })),
);

function sortBblLogOptions(left, right) {
    const rank = {
        usable: 0,
        degraded: 1,
        unusable: 2,
        unknown: 3,
    };

    const leftRank = rank[left?.qualityStatus] ?? rank.unknown;
    const rightRank = rank[right?.qualityStatus] ?? rank.unknown;
    if (leftRank !== rightRank) {
        return leftRank - rightRank;
    }

    return (left?.index ?? 0) - (right?.index ?? 0);
}

const filteredBblLogOptions = computed(() => {
    const sorted = [...bblLogOptions.value].sort(sortBblLogOptions);
    if (!showOnlyUsableLogs.value) {
        return sorted;
    }

    return sorted.filter((log) => log.qualityStatus === "usable");
});

function selectBblLog(index) {
    store.selectBblLog(index);
}

function toggleBblLogSelection(index) {
    store.toggleBblLogSelection(index);
}

function selectRecommendedBblLogs() {
    store.selectRecommendedBblLogs();
}

function onCraftProfileSelected(profileId) {
    const profile = store.applyCraftContextProfile(profileId);
    if (profile) {
        selectedCraftProfileId.value = profile.id;
        craftProfileName.value = profile.name;
    }
}

function saveCraftProfile() {
    const profile = store.saveCraftContextProfile(craftProfileName.value);
    selectedCraftProfileId.value = profile.id;
    craftProfileName.value = profile.name;
}

const recommendationGroups = computed(() => {
    const groups = sessionState.aiResponse?.groups || {};
    return [
        { key: "pid", labelKey: "autotuneAiGroupPid", data: groups.pid },
        { key: "filters", labelKey: "autotuneAiGroupFilters", data: groups.filters },
        { key: "rates", labelKey: "autotuneAiGroupRates", data: groups.rates },
    ]
        .filter((group) => group.data)
        .map((group) => ({
            ...group,
            values: Object.entries(group.data.values || {}).map(([key, value]) => ({ key, value })),
        }));
});

const localWriteEnvelopeGroups = computed(() => {
    const groups = sessionState.localWriteEnvelope || {};
    return [
        { key: "pid", labelKey: "autotuneAiGroupPid", data: groups.pid },
        { key: "filters", labelKey: "autotuneAiGroupFilters", data: groups.filters },
        { key: "rates", labelKey: "autotuneAiGroupRates", data: groups.rates },
    ]
        .filter((group) => group.data)
        .map((group) => ({
            ...group,
            candidates: Object.entries(group.data.candidates || {}).map(([key, value]) => ({ key, value })),
        }));
});

const effectivePlanGroups = computed(() => {
    const groups = sessionState.effectivePlan?.groups || {};
    return [
        { key: "pid", labelKey: "autotuneAiGroupPid", data: groups.pid },
        { key: "filters", labelKey: "autotuneAiGroupFilters", data: groups.filters },
        { key: "rates", labelKey: "autotuneAiGroupRates", data: groups.rates },
    ]
        .filter((group) => group.data)
        .map((group) => ({
            ...group,
            values: Object.entries(group.data.values || {}).map(([key, value]) => ({ key, value })),
        }));
});

// PID/filter slider keys that map to FC.TUNING_SLIDERS
const SLIDER_KEYS = new Set([
    "slider_pids_mode",
    "slider_d_gain",
    "slider_pi_gain",
    "slider_feedforward_gain",
    "slider_dmax_gain",
    "slider_i_gain",
    "slider_roll_pitch_ratio",
    "slider_pitch_pi_gain",
    "slider_master_multiplier",
    "slider_gyro_filter",
    "slider_gyro_filter_multiplier",
    "slider_dterm_filter",
    "slider_dterm_filter_multiplier",
]);

// RC_TUNING keys that map to FC.RC_TUNING
const RC_TUNING_KEYS = new Set([
    "RC_RATE",
    "RC_EXPO",
    "roll_rate",
    "pitch_rate",
    "yaw_rate",
    "RC_YAW_EXPO",
    "rcYawRate",
    "rcPitchRate",
    "RC_PITCH_EXPO",
    "roll_rate_limit",
    "pitch_rate_limit",
    "yaw_rate_limit",
]);

const canWrite = computed(() => connectionStore.connectionValid);
const hasWriteableSelectedGroups = computed(() =>
    effectivePlanGroups.value.some(
        (group) =>
            sessionState.selectedGroups[group.key] &&
            group.data.writeable === true &&
            group.values.length,
    ),
);

const isWritingAny = computed(() => Object.values(writeState).some((s) => s === "loading"));

async function writeGroup(groupKey, { skipEeprom = false } = {}) {
    const group = sessionState.effectivePlan?.groups?.[groupKey];
    if (!group || group.writeable !== true || !Object.keys(group.values || {}).length) {
        return false;
    }

    writeState[groupKey] = "loading";
    writeError[groupKey] = "";

    try {
        const values = group.values;
        const needsSliders = Object.keys(values).some((key) => SLIDER_KEYS.has(key));
        const needsRcTuning = Object.keys(values).some((key) => RC_TUNING_KEYS.has(key));

        if (needsSliders && !FC.TUNING_SLIDERS) {
            throw new Error("FC tuning sliders not loaded.");
        }
        if (needsRcTuning && !FC.RC_TUNING) {
            throw new Error("FC RC tuning not loaded.");
        }

        for (const [key, value] of Object.entries(values)) {
            if (SLIDER_KEYS.has(key)) {
                FC.TUNING_SLIDERS[key] = value;
            } else if (RC_TUNING_KEYS.has(key)) {
                FC.RC_TUNING[key] = value;
            }
        }

        if (needsSliders) {
            await MSP.promise(MSPCodes.MSP_SET_SIMPLIFIED_TUNING, mspHelper.crunch(MSPCodes.MSP_SET_SIMPLIFIED_TUNING));
        }
        if (needsRcTuning) {
            await MSP.promise(MSPCodes.MSP_SET_RC_TUNING, mspHelper.crunch(MSPCodes.MSP_SET_RC_TUNING));
        }

        if (!skipEeprom) {
            await MSP.promise(MSPCodes.MSP_EEPROM_WRITE);
        }

        if (needsSliders && !skipEeprom) {
            await validateTuningSliders();
            pidTuningStore.hasChanges = true;
        }

        if (!skipEeprom) {
            writeState[groupKey] = "done";
            setTimeout(() => {
                writeState[groupKey] = "idle";
            }, 3000);
        }

        return needsSliders;
    } catch (err) {
        writeState[groupKey] = "error";
        writeError[groupKey] = err?.message || "Write failed.";
        setTimeout(() => {
            writeState[groupKey] = "idle";
            writeError[groupKey] = "";
        }, 5000);
        if (skipEeprom) {
            throw err;
        }
        return false;
    }
}

async function writeAll() {
    const groups = effectivePlanGroups.value
        .filter((g) => sessionState.selectedGroups[g.key] && g.data.writeable === true && g.values.length)
        .map((g) => g.key);

    if (!groups.length) {
        return;
    }

    try {
        let needsSliders = false;
        for (const key of groups) {
            const wroteSliders = await writeGroup(key, { skipEeprom: true });
            if (wroteSliders) {
                needsSliders = true;
            }
        }

        await MSP.promise(MSPCodes.MSP_EEPROM_WRITE);

        if (needsSliders) {
            await validateTuningSliders();
            pidTuningStore.hasChanges = true;
        }

        groups.forEach((key) => {
            writeState[key] = "done";
            setTimeout(() => {
                writeState[key] = "idle";
            }, 3000);
        });
    } catch (err) {
        groups.forEach((key) => {
            if (writeState[key] === "loading") {
                writeState[key] = "error";
                writeError[key] = err?.message || "Write failed.";
                setTimeout(() => {
                    writeState[key] = "idle";
                    writeError[key] = "";
                }, 5000);
            }
        });
    }
}

async function runAnalysis() {
    await store.analyze({ analysisResult: autotuneStore.analysisResult });
}

function toggleAiConfig() {
    sessionState.aiConfigOpen = !sessionState.aiConfigOpen;
}

function openInputFilePicker() {
    inputFileRef.value?.click();
}

async function onInputFileSelected(event) {
    const file = event.target.files?.[0];
    if (file) {
        try {
            await store.importInputFile(file);
        } catch {
            // The store records the user-facing error in sessionState.lastError.
        }
    }
    event.target.value = "";
}

function setFrameSize(value) {
    craftContext.frameSize = String(value || "").trim();
}

function riskLabelKey(risk) {
    return {
        low: "autotuneAiRiskLow",
        medium: "autotuneAiRiskMedium",
        high: "autotuneAiRiskHigh",
    }[risk || "medium"];
}

function confidenceLabelKey(confidence) {
    return {
        low: "autotuneAiConfidenceLow",
        medium: "autotuneAiConfidenceMedium",
        high: "autotuneAiConfidenceHigh",
    }[confidence || "low"];
}

function formatAggregateQualityStatus(status) {
    return t(
        {
            usable: "autotuneAiAggregateQualityUsable",
            degraded: "autotuneAiAggregateQualityDegraded",
            unusable: "autotuneAiAggregateQualityUnusable",
        }[status] || "autotuneAiAggregateQualityUnknown",
    );
}

function formatLogQualityStatus(status) {
    return formatAggregateQualityStatus(status);
}

function formatLogQualityReason(reason) {
    return {
        insufficient_required_data: t("autotuneAiLogReasonInsufficientRequiredData"),
        partial_decode_issues: t("autotuneAiLogReasonPartialDecodeIssues"),
        sufficient_required_data: t("autotuneAiLogReasonSufficientRequiredData"),
        missing_quality: t("autotuneAiLogReasonMissingQuality"),
    }[reason] || t("autotuneAiAggregateReasonFallback");
}

function formatWriteEnvelopeBlockedReason(reason) {
    return (
        {
            insufficient_filter_evidence: t("autotuneAiBlockedReasonInsufficientFilterEvidence"),
            insufficient_pid_evidence: t("autotuneAiBlockedReasonInsufficientPidEvidence"),
            insufficient_rates_evidence: t("autotuneAiBlockedReasonInsufficientRatesEvidence"),
            no_rates_mismatch_detected: t("autotuneAiBlockedReasonNoRatesMismatch"),
            single_log_filter_evidence_requires_confirmation: t("autotuneAiBlockedReasonSingleLogFilterConfirmation"),
            single_log_pid_requires_multi_log_confirmation: t("autotuneAiBlockedReasonSingleLogPidConfirmation"),
            mechanical_imbalance_detected: t("autotuneAiBlockedReasonMechanicalImbalance"),
            conflicting_candidate_values: t("autotuneAiBlockedReasonConflictingValues"),
            aggregate_quality_not_usable: t("autotuneAiBlockedReasonAggregateQuality"),
            no_group_envelope: t("autotuneAiBlockedReasonNoGroupEnvelope"),
        }[reason] || reason || t("autotuneAiExplainOnly")
    );
}

function formatWriteEnvelopeCandidateReason(reason) {
    const translationKey = WRITE_ENVELOPE_CANDIDATE_REASON_KEYS[reason];
    if (!translationKey) {
        return reason || "";
    }

    const translated = t(translationKey);
    return translated === translationKey ? reason : translated;
}

function formatWriteEnvelopeEvidenceRefs(evidenceRefs = []) {
    return (Array.isArray(evidenceRefs) ? evidenceRefs : []).join(" · ");
}

function getEffectivePlanCandidate(groupKey, candidateKey) {
    return sessionState.localWriteEnvelope?.[groupKey]?.candidates?.[candidateKey] || null;
}

function formatLogEvidenceSummary(log) {
    const decoded = Number(log?.decodedMainFrames) || 0;
    const corrupt = Number(log?.corruptFrames) || 0;
    const seconds = Number.isFinite(Number(log?.durationUs)) ? (Number(log.durationUs) / 1e6).toFixed(1) : "-";

    return `decoded ${decoded} · corrupt ${corrupt} · ${seconds}s`;
}

function qualityBadgeClass(status) {
    return {
        usable: "autotune-ai-bbl-manager__log-badge--usable",
        degraded: "autotune-ai-bbl-manager__log-badge--degraded",
        unusable: "autotune-ai-bbl-manager__log-badge--unusable",
        unknown: "autotune-ai-bbl-manager__log-badge--unknown",
    }[status || "unknown"];
}

function formatAggregateQualityReason(reason) {
    return t(
        {
            all_selected_logs_usable: "autotuneAiAggregateReasonAllSelectedLogsUsable",
            includes_unusable_logs: "autotuneAiAggregateReasonIncludesUnusableLogs",
            includes_degraded_logs: "autotuneAiAggregateReasonIncludesDegradedLogs",
            no_usable_logs: "autotuneAiAggregateReasonNoUsableLogs",
        }[reason] || "autotuneAiAggregateReasonFallback",
    );
}

function formatSelectedLogs(indexes = []) {
    if (!Array.isArray(indexes) || !indexes.length) {
        return "-";
    }

    return indexes.map((index) => index + 1).join(", ");
}

function localizeLocalAnalysisValue(value, keyMap) {
    if (!value) {
        return "";
    }

    const translationKey = keyMap?.[value];
    if (!translationKey) {
        return value;
    }

    const translated = t(translationKey);
    return translated === translationKey ? value : translated;
}

function formatLocalAnalysisPriority(priority) {
    const localizedPriority = localizeLocalAnalysisValue(priority, LOCAL_ANALYSIS_PRIORITY_KEYS);
    if (!localizedPriority) {
        return "";
    }

    return `${t("autotuneAiLocalAnalysisPriority")}: ${localizedPriority}`;
}

function formatLocalAnalysisSources(sources) {
    return `${t("autotuneAiLocalAnalysisSources")}: ${sources}`;
}

function formatDiagnosticSummary(diagnostic) {
    const parts = [
        localizeLocalAnalysisValue(diagnostic?.type, LOCAL_ANALYSIS_DIAGNOSTIC_TYPE_KEYS),
        localizeLocalAnalysisValue(diagnostic?.explanation, LOCAL_ANALYSIS_EXPLANATION_KEYS),
        diagnostic?.confidence ? t(confidenceLabelKey(diagnostic.confidence)) : "",
    ].filter(Boolean);

    if (diagnostic?.sources) {
        parts.push(formatLocalAnalysisSources(diagnostic.sources));
    }

    return parts.join(" - ");
}

function formatAggregateRecommendation(recommendation) {
    const parts = [
        localizeLocalAnalysisValue(recommendation?.group, LOCAL_ANALYSIS_RECOMMENDATION_GROUP_KEYS),
        localizeLocalAnalysisValue(recommendation?.type, LOCAL_ANALYSIS_RECOMMENDATION_TYPE_KEYS),
    ].filter(Boolean);

    if (recommendation?.priority) {
        parts.push(formatLocalAnalysisPriority(recommendation.priority));
    }
    if (recommendation?.explanation) {
        parts.push(localizeLocalAnalysisValue(recommendation?.explanation, LOCAL_ANALYSIS_EXPLANATION_KEYS));
    }

    return parts.join(" - ");
}

async function sendFollowUp() {
    try {
        await store.sendFollowUp();
    } catch {
        // The store records the user-facing error in sessionState.lastError.
    }
}
</script>

<style scoped>
.autotune-ai-advisor {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
}

.autotune-ai-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.875rem;
    border: 1px solid var(--surface-300);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--surface-200) 72%, transparent);
}

.autotune-ai-section--collapsed {
    gap: 0;
    padding-block: 0.625rem;
    background: var(--surface-100);
}

.autotune-ai-section__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
}

.autotune-ai-section__header--interactive {
    cursor: pointer;
    user-select: none;
}

.autotune-ai-section__header--interactive:hover .autotune-ai-section__title {
    color: var(--primary-600);
}

.autotune-ai-section__title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    color: var(--text);
}

.autotune-ai-section__title h3 {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.2;
    font-weight: 700;
}

.autotune-ai-section__badge {
    flex: 0 0 auto;
    padding: 0.125rem 0.375rem;
    border-radius: 999px;
    background: var(--primary-transparent-2);
    color: var(--primary-600);
    font-size: 0.7rem;
    font-weight: 700;
}

.autotune-ai-subsection-title {
    margin-top: 0.25rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--surface-300);
    color: var(--surface-700);
    font-size: 0.75rem;
    font-weight: 700;
}

.autotune-ai-field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.625rem;
}

.autotune-ai-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    font-size: 0.75rem;
}

.autotune-ai-field--wide {
    grid-column: 1 / -1;
}

.autotune-ai-field--switch {
    align-items: flex-start;
}

.autotune-ai-field__label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
}

.autotune-ai-field__help-icon {
    width: 1rem;
    height: 1rem;
    cursor: help;
}

.autotune-ai-field span {
    color: var(--surface-800);
    font-weight: 700;
}

.autotune-ai-field small {
    color: var(--surface-700);
    font-size: 0.68rem;
    line-height: 1.3;
}

.autotune-ai-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.125rem;
}

.autotune-ai-source-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem;
}

.autotune-ai-profile-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    align-items: end;
    gap: 0.5rem;
    padding: 0.625rem;
    border: 1px solid var(--surface-300);
    border-radius: 0.5rem;
    background: var(--surface-100);
}

.autotune-ai-profile-bar__save {
    align-self: end;
}

.autotune-ai-source-row,
.autotune-ai-upload-panel {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--surface-300);
    border-radius: 0.5rem;
    background: var(--surface-100);
}

.autotune-ai-source-row__icon,
.autotune-ai-upload-panel__icon {
    flex: 0 0 auto;
    width: 1.25rem;
    height: 1.25rem;
    color: var(--primary-600);
}

.autotune-ai-source-row__body,
.autotune-ai-upload-panel__body {
    min-width: 0;
}

.autotune-ai-source-row__title,
.autotune-ai-upload-panel__title {
    overflow: hidden;
    font-size: 0.82rem;
    font-weight: 700;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.autotune-ai-source-row__meta,
.autotune-ai-upload-panel__meta {
    margin-top: 0.2rem;
    color: var(--surface-700);
    font-size: 0.72rem;
    line-height: 1.35;
}

.autotune-ai-bbl-manager {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--surface-300);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--surface-100) 82%, var(--primary-transparent-2));
}

.autotune-ai-bbl-manager__title {
    color: var(--surface-800);
    font-size: 0.76rem;
    font-weight: 700;
}

.autotune-ai-bbl-manager__header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem 0.75rem;
}

.autotune-ai-bbl-manager__controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: flex-end;
    gap: 0.5rem 0.75rem;
}

.autotune-ai-bbl-manager__recommend {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.2rem;
}

.autotune-ai-bbl-manager__hint {
    max-width: 18rem;
    color: var(--surface-700);
    font-size: 0.68rem;
    line-height: 1.35;
    text-align: right;
}

.autotune-ai-bbl-manager__grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
}

.autotune-ai-bbl-manager__log-card {
    display: flex;
    min-width: 14rem;
    flex: 1 1 14rem;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    border: 1px solid var(--surface-300);
    border-radius: 0.5rem;
    background: var(--surface-100);
}

.autotune-ai-bbl-manager__log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
}

.autotune-ai-bbl-manager__log-badge {
    flex: 0 0 auto;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    font-size: 0.66rem;
    font-weight: 700;
    line-height: 1.2;
    text-transform: uppercase;
}

.autotune-ai-bbl-manager__log-badge--usable {
    background: color-mix(in srgb, #1f9d55 18%, transparent);
    color: #1f9d55;
}

.autotune-ai-bbl-manager__log-badge--degraded {
    background: color-mix(in srgb, #d97706 18%, transparent);
    color: #d97706;
}

.autotune-ai-bbl-manager__log-badge--unusable {
    background: color-mix(in srgb, #dc2626 18%, transparent);
    color: #dc2626;
}

.autotune-ai-bbl-manager__log-badge--unknown {
    background: var(--surface-200);
    color: var(--surface-700);
}

.autotune-ai-bbl-manager__log-evidence {
    color: var(--surface-800);
    font-size: 0.7rem;
    font-family: var(--font-mono, monospace);
}

.autotune-ai-bbl-manager__multi-select {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.5rem;
}

.autotune-ai-local-analysis {
    gap: 0.875rem;
}

.autotune-ai-local-analysis__summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
}

.autotune-ai-local-analysis__quality {
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    background: var(--primary-transparent-2);
    color: var(--primary-600);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
}

.autotune-ai-local-analysis__reason {
    color: var(--surface-700);
    font-size: 0.75rem;
}

.autotune-ai-local-analysis__group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
}

.autotune-ai-local-analysis__heading {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--surface-800);
}

.autotune-ai-local-analysis__list {
    margin: 0;
    padding-left: 1rem;
    color: var(--surface-900);
    font-size: 0.75rem;
    line-height: 1.4;
}

.autotune-ai-group-toggle {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
    padding: 0.625rem;
    border: 1px solid var(--surface-300);
    border-radius: 0.5rem;
    background: var(--surface-100);
}

.autotune-ai-conversation {
    display: flex;
    max-height: 18rem;
    flex-direction: column;
    gap: 0.5rem;
    overflow: auto;
    padding-right: 0.125rem;
}

.autotune-ai-conversation__trimmed {
    color: var(--surface-700);
    font-size: 0.72rem;
}

.autotune-ai-message {
    display: grid;
    grid-template-columns: 2.5rem minmax(0, 1fr);
    gap: 0.625rem;
    padding: 0.625rem;
    border: 1px solid var(--surface-300);
    border-radius: 0.5rem;
    background: var(--surface-100);
}

.autotune-ai-message--assistant {
    background: color-mix(in srgb, var(--surface-100) 84%, var(--primary-transparent-2));
}

.autotune-ai-message__role {
    color: var(--surface-700);
    font-size: 0.68rem;
    font-weight: 700;
    line-height: 1.35;
    text-transform: uppercase;
}

.autotune-ai-message__raw {
    margin: 0;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--surface-900);
    font-size: 0.78rem;
    line-height: 1.45;
}

.autotune-ai-followup {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.5rem;
}

.autotune-ai-followup__body {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.25rem;
}

.autotune-ai-followup__body small {
    color: var(--surface-700);
    font-size: 0.68rem;
    line-height: 1.35;
}

@container main-wrapper (max-width: 575px) {
    .autotune-ai-field-grid {
        grid-template-columns: 1fr;
    }

    .autotune-ai-profile-bar {
        grid-template-columns: 1fr;
    }

    .autotune-ai-bbl-manager__controls,
    .autotune-ai-bbl-manager__recommend {
        align-items: flex-start;
        justify-content: flex-start;
    }

    .autotune-ai-bbl-manager__hint {
        max-width: none;
        text-align: left;
    }

    .autotune-ai-followup {
        grid-template-columns: 1fr;
    }
}
</style>
