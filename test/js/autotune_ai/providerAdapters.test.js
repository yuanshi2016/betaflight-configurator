import { describe, expect, it, vi } from "vitest";
import { buildProviderRequest, explainTuningAnalysis } from "../../../src/js/autotune-ai/providerAdapters";

const payload = {
    craftContext: { craftType: "freestyle" },
    sourceSummary: { hasCurrentFc: true, hasCli: false, hasCsv: false, metadataSource: "current-fc" },
};

describe("autotune AI provider adapters", () => {
    it("builds a DeepSeek OpenAI-compatible chat request without leaking the API key into the body", () => {
        const request = buildProviderRequest(
            {
                provider: "deepseek-openai",
                baseUrl: "https://api.deepseek.com/",
                model: "deepseek-v4-pro",
                apiKey: "secret-key",
                temperature: 0.2,
                maxTokens: 900,
                thinkingModeEnabled: true,
                thinkingEffort: "max",
            },
            payload,
        );

        expect(request.url).toBe("https://api.deepseek.com/chat/completions");
        expect(request.options.method).toBe("POST");
        expect(request.options.headers.Authorization).toBe("Bearer secret-key");

        const body = JSON.parse(request.options.body);
        expect(body.model).toBe("deepseek-v4-pro");
        expect(body.thinking).toEqual({ type: "enabled" });
        expect(body.reasoning_effort).toBe("max");
        expect(body.temperature).toBeUndefined();
        expect(body.max_tokens).toBe(900);
        expect(body.messages).toHaveLength(2);
        expect(request.options.body).not.toContain("secret-key");
    });

    it("uses the DeepSeek V4 Pro model and high thinking effort by default", () => {
        const request = buildProviderRequest({ apiKey: "secret-key" }, payload);
        const body = JSON.parse(request.options.body);

        expect(body.model).toBe("deepseek-v4-pro");
        expect(body.thinking).toEqual({ type: "enabled" });
        expect(body.reasoning_effort).toBe("high");
    });

    it("instructs the model to answer in simplified Chinese when the locale is zh_CN", () => {
        const request = buildProviderRequest(
            {
                provider: "deepseek-openai",
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-pro",
                apiKey: "secret-key",
            },
            payload,
            null,
            { locale: "zh_CN" },
        );
        const body = JSON.parse(request.options.body);

        expect(body.messages[0].content).toContain("Simplified Chinese");
        expect(body.messages[1].content).toContain("Respond in Simplified Chinese");
        expect(body.messages[0].content).toContain("Treat localAnalysis as the primary technical evidence for ordinary Blackbox logs.");
        expect(body.messages[0].content).toContain("Do not contradict localAnalysis unless you explicitly state uncertainty and limitations.");
        expect(body.messages[0].content).toContain("Use local diagnostics and local recommendations to explain your conclusion.");
    });

    it("keeps temperature when DeepSeek OpenAI-compatible thinking mode is disabled", () => {
        const request = buildProviderRequest(
            {
                provider: "deepseek-openai",
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-pro",
                apiKey: "secret-key",
                temperature: 0.3,
                thinkingModeEnabled: false,
            },
            payload,
        );
        const body = JSON.parse(request.options.body);

        expect(body.thinking).toEqual({ type: "disabled" });
        expect(body.reasoning_effort).toBeUndefined();
        expect(body.temperature).toBe(0.3);
    });

    it("builds DeepSeek Anthropic-compatible and Anthropic Messages requests", () => {
        const deepSeek = buildProviderRequest(
            {
                provider: "deepseek-anthropic",
                baseUrl: "https://api.deepseek.com/anthropic",
                model: "deepseek-reasoner",
                apiKey: "deepseek-key",
                temperature: 0.1,
                maxTokens: 1000,
            },
            payload,
        );
        const anthropic = buildProviderRequest(
            {
                provider: "anthropic",
                baseUrl: "https://api.anthropic.com",
                model: "claude-sonnet-4-5",
                apiKey: "anthropic-key",
                temperature: 0.1,
                maxTokens: 1000,
            },
            payload,
        );

        expect(deepSeek.url).toBe("https://api.deepseek.com/anthropic/v1/messages");
        expect(deepSeek.options.headers["x-api-key"]).toBe("deepseek-key");
        expect(deepSeek.options.headers["anthropic-version"]).toBeUndefined();

        expect(anthropic.url).toBe("https://api.anthropic.com/v1/messages");
        expect(anthropic.options.headers["x-api-key"]).toBe("anthropic-key");
        expect(anthropic.options.headers["anthropic-version"]).toBeTruthy();
    });

    it("returns provider text from an OpenAI-compatible response", async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ choices: [{ message: { content: "{\"summary\":\"ok\"}" } }] }),
        });

        const text = await explainTuningAnalysis(
            {
                provider: "deepseek-openai",
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-chat",
                apiKey: "secret-key",
            },
            payload,
            fetchImpl,
        );

        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(text).toBe("{\"summary\":\"ok\"}");
    });

    it("passes conversation history through for follow-up requests", () => {
        const history = [
            { role: "user", content: "Initial request" },
            { role: "assistant", content: "{\"summary\":\"ok\"}" },
            { role: "user", content: "Roll still oscillates." },
        ];

        const request = buildProviderRequest(
            {
                provider: "deepseek-openai",
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-pro",
                apiKey: "secret-key",
            },
            null,
            history,
        );
        const body = JSON.parse(request.options.body);

        expect(body.messages).toEqual([
            expect.objectContaining({ role: "system" }),
            ...history,
        ]);
        expect(body.response_format).toBeUndefined();
    });

    it("supports history as the third explainTuningAnalysis argument", async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve("{\"choices\":[{\"message\":{\"content\":\"plain reply\"}}]}"),
        });
        const history = [{ role: "user", content: "Explain D gain." }];

        const text = await explainTuningAnalysis(
            {
                provider: "deepseek-openai",
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-pro",
                apiKey: "secret-key",
            },
            null,
            history,
            fetchImpl,
        );
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);

        expect(body.messages.at(-1)).toEqual(history[0]);
        expect(text).toBe("plain reply");
    });

    it("keeps the locale instruction on follow-up requests", () => {
        const history = [{ role: "user", content: "请解释 D 增益。" }];
        const request = buildProviderRequest(
            {
                provider: "deepseek-openai",
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-pro",
                apiKey: "secret-key",
            },
            null,
            history,
            { locale: "zh_CN" },
        );
        const body = JSON.parse(request.options.body);

        expect(body.messages[0].content).toContain("Simplified Chinese");
    });
});
