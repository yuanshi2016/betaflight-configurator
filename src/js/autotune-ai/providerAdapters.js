import { i18n } from "../localization";

const OPENAI_PROVIDER = "deepseek-openai";
const ANTHROPIC_PROVIDERS = new Set(["deepseek-anthropic", "anthropic"]);
const DEEPSEEK_PROVIDERS = new Set(["deepseek-openai", "deepseek-anthropic"]);
const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-pro";
const THINKING_EFFORTS = new Set(["high", "max"]);
const LOCALE_LANGUAGE_NAMES = {
    ca: "Catalan",
    da: "Danish",
    de: "German",
    en: "English",
    es: "Spanish",
    eu: "Basque",
    fr: "French",
    gl: "Galician",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    nl: "Dutch",
    pl: "Polish",
    pt: "Portuguese",
    pt_BR: "Brazilian Portuguese",
    ru: "Russian",
    uk: "Ukrainian",
    zh_CN: "Simplified Chinese",
    zh_TW: "Traditional Chinese",
};

const RESPONSE_CONTRACT = `{
  "summary": "string",
  "overallRisk": "low" | "medium" | "high",
  "groups": {
    "pid": {
      "writeable": boolean,
      "confidence": "low" | "medium" | "high",
      "explanation": "string",
      "values": {}
    },
    "filters": {
      "writeable": boolean,
      "confidence": "low" | "medium" | "high",
      "explanation": "string",
      "values": {}
    },
    "rates": {
      "writeable": boolean,
      "confidence": "low" | "medium" | "high",
      "explanation": "string",
      "values": {}
    }
  },
  "flightTestNotes": "string"
}`;

function getResponseLanguage(locale = i18n.getCurrentLocale()) {
    const normalized = String(locale || "en").replace(/-/gu, "_");

    return LOCALE_LANGUAGE_NAMES[normalized] || LOCALE_LANGUAGE_NAMES[normalized.split("_")[0]] || "English";
}

function createSystemPrompt(locale) {
    const responseLanguage = getResponseLanguage(locale);

    return [
        "You are an assistant for Betaflight tuning analysis.",
        "Use only the structured JSON payload.",
        "Treat localAnalysis as the primary technical evidence for ordinary Blackbox logs.",
        "Do not contradict localAnalysis unless you explicitly state uncertainty and limitations.",
        "Use local diagnostics and local recommendations to explain your conclusion.",
        "If localAnalysis is missing or not usable, do not return writeable recommendations.",
        "Explain the evidence limitation and keep every group writeable=false.",
        "Do not output CLI commands.",
        "Do not recommend raw FC.PIDS writes.",
        "Keep JSON property names and configuration keys exactly as requested.",
        "Return exactly this JSON shape:",
        RESPONSE_CONTRACT,
        "Do not return error fields or diagnostics/recommendations arrays.",
        "Only set writeable=true when localAnalysis provides enough concrete evidence for a specific safe config change.",
        "If localAnalysis only provides direction-only or qualitative evidence, keep writeable=false and explain the limitation.",
        "Use localAnalysis.writeEnvelope as the only source of writeable values.",
        "If localAnalysis.writeEnvelope.<group>.writeableAllowed is false, keep that group non-writeable and explain the limitation.",
        "If you return a value, it must match the candidate suggestedValue exactly.",
        `Respond in ${responseLanguage}.`,
        `Keep all user-facing summary, explanations, and flight test notes in ${responseLanguage}.`,
        "For initial analysis, return only JSON matching the requested response contract.",
        "For follow-up questions, answer in plain text unless you are updating writeable recommendations; updated recommendations must use the same JSON contract.",
    ].join(" ");
}

function trimTrailingSlash(value) {
    return String(value || "").replace(/\/+$/u, "");
}

function createUserPrompt(payload, locale) {
    const responseLanguage = getResponseLanguage(locale);

    return [
        `Analyze this compact Betaflight tuning payload and return JSON with summary, overallRisk, groups.pid, groups.filters, groups.rates, and flightTestNotes. Respond in ${responseLanguage}.`,
        "Return exactly this JSON shape:",
        RESPONSE_CONTRACT,
        "Only use keys and suggested values that already exist in localAnalysis.writeEnvelope.",
        "Do not invent keys or values, and do not interpolate inside min/max.",
        JSON.stringify(payload),
    ].join("\n\n");
}

export function buildFirstTurnUserMessage(payload, locale) {
    return createUserPrompt(payload, locale);
}

function normalizeSettings(settings) {
    const provider = settings?.provider || OPENAI_PROVIDER;
    const thinkingEffort = THINKING_EFFORTS.has(settings?.thinkingEffort) ? settings.thinkingEffort : "high";

    return {
        provider,
        baseUrl: trimTrailingSlash(settings?.baseUrl || "https://api.deepseek.com"),
        model: settings?.model || DEEPSEEK_DEFAULT_MODEL,
        apiKey: settings?.apiKey || "",
        temperature: Number.isFinite(Number(settings?.temperature)) ? Number(settings.temperature) : 0.2,
        maxTokens: Number.isFinite(Number(settings?.maxTokens)) ? Number(settings.maxTokens) : 1200,
        thinkingModeEnabled: DEEPSEEK_PROVIDERS.has(provider) && settings?.thinkingModeEnabled !== false,
        thinkingEffort,
    };
}

function buildMessages(payload, history = null, locale) {
    return history || [{ role: "user", content: createUserPrompt(payload, locale) }];
}

export function buildProviderRequest(settings, payload, history = null, options = {}) {
    const normalized = normalizeSettings(settings);
    const locale = options?.locale;
    const messages = buildMessages(payload, history, locale);
    const systemPrompt = createSystemPrompt(locale);

    if (normalized.provider === OPENAI_PROVIDER) {
        const body = {
            model: normalized.model,
            max_tokens: normalized.maxTokens,
            messages: [{ role: "system", content: systemPrompt }, ...messages],
            thinking: { type: normalized.thinkingModeEnabled ? "enabled" : "disabled" },
        };

        if (!history) {
            body.response_format = { type: "json_object" };
        }

        if (normalized.thinkingModeEnabled) {
            body.reasoning_effort = normalized.thinkingEffort;
        } else {
            body.temperature = normalized.temperature;
        }

        return {
            url: `${normalized.baseUrl}/chat/completions`,
            options: {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${normalized.apiKey}`,
                },
                body: JSON.stringify(body),
            },
        };
    }

    if (ANTHROPIC_PROVIDERS.has(normalized.provider)) {
        const headers = {
            "Content-Type": "application/json",
            "x-api-key": normalized.apiKey,
        };

        if (normalized.provider === "anthropic") {
            headers["anthropic-version"] = "2023-06-01";
        }

        const body = {
            model: normalized.model,
            system: systemPrompt,
            max_tokens: normalized.maxTokens,
            messages,
        };

        if (normalized.provider === "deepseek-anthropic" && normalized.thinkingModeEnabled) {
            body.output_config = { effort: normalized.thinkingEffort };
        } else {
            body.temperature = normalized.temperature;
        }

        return {
            url: `${normalized.baseUrl}/v1/messages`,
            options: {
                method: "POST",
                headers,
                body: JSON.stringify(body),
            },
        };
    }

    throw new Error(`Unsupported AI provider: ${normalized.provider}`);
}

function extractProviderText(responseJson) {
    const openAiText = responseJson?.choices?.[0]?.message?.content;
    if (typeof openAiText === "string") {
        return openAiText;
    }

    const anthropicBlock = responseJson?.content?.find((block) => block?.type === "text" && typeof block.text === "string");
    if (anthropicBlock) {
        return anthropicBlock.text;
    }

    throw new Error("AI provider response did not contain text content.");
}

function createSafeProviderError(status, responseText) {
    const detail = responseText ? `: ${responseText.slice(0, 300)}` : "";
    return new Error(`AI provider request failed with HTTP ${status}${detail}`);
}

export async function explainTuningAnalysis(settings, payload, historyOrFetch = null, fetchImpl = fetch, options = {}) {
    let history = null;
    let resolvedFetchImpl = fetchImpl;

    if (Array.isArray(historyOrFetch)) {
        history = historyOrFetch;
    } else if (typeof historyOrFetch === "function") {
        resolvedFetchImpl = historyOrFetch;
    }

    const request = buildProviderRequest(settings, payload, history, options);
    const response = await resolvedFetchImpl(request.url, request.options);
    const responseText = await response.text?.();

    if (!response.ok) {
        throw createSafeProviderError(response.status, responseText);
    }

    const responseJson = responseText ? JSON.parse(responseText) : await response.json();
    return extractProviderText(responseJson);
}
