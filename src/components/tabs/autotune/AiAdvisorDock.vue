<template>
    <aside v-if="store.sessionState.panelOpen" id="autotune-ai-dock" :aria-label="$t('autotuneAiTitle')">
        <div class="autotune-ai-dock__header">
            <div class="flex items-center gap-2 min-w-0">
                <UIcon name="i-lucide-sparkles" class="size-4 text-primary shrink-0" />
                <span class="font-semibold truncate">{{ $t("autotuneAiTitle") }}</span>
            </div>
            <UTooltip :text="$t('autotuneAiCloseDock')" :delay-duration="300">
                <UButton
                    icon="i-lucide-panel-right-close"
                    variant="ghost"
                    color="neutral"
                    square
                    size="xs"
                    :aria-label="$t('autotuneAiCloseDock')"
                    @click="store.sessionState.panelOpen = false"
                />
            </UTooltip>
        </div>
        <div class="autotune-ai-dock__body">
            <AiAdvisor />
        </div>
    </aside>
    <UTooltip v-else :text="$t('autotuneAiOpenDock')" :delay-duration="300">
        <UButton
            id="autotune-ai-dock-toggle"
            icon="i-lucide-sparkles"
            color="primary"
            variant="solid"
            square
            :aria-label="$t('autotuneAiOpenDock')"
            @click="store.sessionState.panelOpen = true"
        />
    </UTooltip>
</template>

<script setup>
import AiAdvisor from "./AiAdvisor.vue";
import { useAutotuneAiStore } from "@/stores/autotuneAi";

const store = useAutotuneAiStore();
</script>
