# AI Advisor 优化计划 v2

> **下一个会话直接按此文档执行。** 每个 Task 独立，可以单独实现和测试。不要扩展范围，不要改动本文档未提及的文件。

---

## 背景

当前 AI Advisor 已完成 Phase 1（静态分析展示）和 Phase 4 初版（一键写入）。
本文档覆盖两类优化：

1. **Bug 修复**（4 个已知问题，必须先做）
2. **持续对话**（多轮 AI 交互，核心功能升级）

---

## Part A：Bug 修复

### A1. writeAll 写了 N 次 EEPROM

**问题**
`writeAll()` 顺序调用 `writeGroup()`，每个 group 内部都会执行一次 `MSP_EEPROM_WRITE`。
写 3 个 group 就写 3 次 EEPROM，不必要且有风险。

**修复方案**
重构 `writeGroup` 接受一个 `{ skipEeprom: boolean }` 选项。
`writeAll` 自己负责最后统一写一次 EEPROM 和 `validateTuningSliders`。

```js
// writeGroup 签名改为：
async function writeGroup(groupKey, { skipEeprom = false } = {})

// writeAll 改为：
async function writeAll() {
    const groups = recommendationGroups.value
        .filter((g) => sessionState.selectedGroups[g.key] && g.values.length)
        .map((g) => g.key);

    let needsSliders = false;
    for (const key of groups) {
        const wroteSliders = await writeGroup(key, { skipEeprom: true });
        if (wroteSliders) needsSliders = true;
    }

    await MSP.promise(MSPCodes.MSP_EEPROM_WRITE);
    if (needsSliders) await validateTuningSliders();

    // 统一把所有 group 状态设为 done
    groups.forEach((key) => {
        writeState[key] = "done";
        setTimeout(() => { writeState[key] = "idle"; }, 3000);
    });
}
```

**涉及文件**
- `src/components/tabs/autotune/AiAdvisor.vue`

---

### A2. canWrite 响应性问题

**问题**
`FC.TUNING_SLIDERS !== null` 和 `FC.RC_TUNING !== null` 不是 Vue 响应式数据，
`computed` 不会在 FC 数据加载后自动更新，导致按钮可能永远是禁用状态。

**修复方案**
`canWrite` 只依赖 `connectionStore.connectionValid`。
连上飞控后 FC 数据必然已加载，不需要额外检查。
写入时在函数内部做一次防御性检查即可（不影响响应性）。

```js
// 改为：
const canWrite = computed(() => connectionStore.connectionValid);

// writeGroup 内部保留防御检查：
if (!FC.TUNING_SLIDERS || !FC.RC_TUNING) {
    throw new Error("FC data not loaded.");
}
```

**涉及文件**
- `src/components/tabs/autotune/AiAdvisor.vue`

---

### A3. 错误状态不自动清除

**问题**
写入成功后 3 秒自动回 idle，但写入失败后错误状态永久挂着，
用户必须重新点击才能清除，体验不一致。

**修复方案**
失败后同样 5 秒自动回 idle（比成功稍长，让用户有时间看到错误）。

```js
writeState[groupKey] = "error";
writeError[groupKey] = err?.message || "Write failed.";
setTimeout(() => {
    writeState[groupKey] = "idle";
    writeError[groupKey] = "";
}, 5000);
```

**涉及文件**
- `src/components/tabs/autotune/AiAdvisor.vue`

---

### A4. 写入成功后 PID 页面 slider 不更新

**问题**
AI Advisor 写入 `FC.TUNING_SLIDERS` 后，如果用户同时开着 PID 页面，
那边的 slider 显示不会刷新，因为 `usePidTuningStore` 不知道数据变了。

**分析**
查看 `src/stores/pidTuning.js`，它有 `markChanged()` 方法用于标记数据已变更。
PID 页面的 `forceUpdateSliders` 方法在 `PidTuningTab.vue` 中通过 ref 暴露。

**修复方案**
写入成功后调用 `usePidTuningStore().markChanged()`，
让 PID 页面下次激活时知道需要重新读取数据。

```js
import { usePidTuningStore } from "@/stores/pidTuning";
const pidTuningStore = usePidTuningStore();

// writeGroup 成功后：
if (needsSliders) {
    await validateTuningSliders();
    pidTuningStore.markChanged();   // 通知 PID 页面数据已变
}
```

先确认 `usePidTuningStore` 确实有 `markChanged`，如果没有则改为直接触发
`pidTuningStore.$patch({ hasUnsavedChanges: true })` 或等价操作。

**涉及文件**
- `src/components/tabs/autotune/AiAdvisor.vue`
- `src/stores/pidTuning.js`（只读，确认接口，不修改）

---

## Part B：持续对话（多轮 AI 交互）

### B0. 为什么需要持续对话

当前流程是单次问答：用户填表 → 点分析 → 看结果 → 写入。
实际调参场景中，用户需要：

- "我试飞了，roll 轴还是有点振，能更激进一点吗？"
- "解释一下为什么建议降低 gyro filter？"
- "我的电机是 2306，重新评估一下 PID"
- "只改 D gain，其他不动"

这些都是自然语言的追问，单次问答无法支持。
持续对话让 AI 保持上下文，用户可以迭代调参，而不是每次重新填表。

---

### B1. 数据结构设计

在 `sessionState` 中增加 `conversationHistory` 字段：

```js
// defaultSessionState() 中新增：
conversationHistory: [],   // { role: "user"|"assistant", content: string }[]
followUpInput: "",         // 当前输入框内容
followUpState: "idle",     // "idle" | "loading" | "error"
```

`conversationHistory` 存储完整的多轮消息，格式与 OpenAI / Anthropic Messages API 一致，
方便直接传给 provider。

**持久化**：存入 `SessionStorage`（与现有 `sessionState` 一起），不存 `ConfigStorage`，
对话历史只在当前 app session 内有效。

---

### B2. 首次分析如何初始化对话

首次点"分析"时，`analyze()` 函数在收到 AI 响应后：

```js
// 把首次分析的 user prompt 和 assistant 回复存入历史
sessionState.conversationHistory = [
    { role: "user", content: buildFirstTurnUserMessage(payload) },
    { role: "assistant", content: rawResponse },
];
```

`buildFirstTurnUserMessage` 是一个纯函数，把 payload 序列化为 AI 能理解的文本，
与现有 `buildAiPayload` 分离，后者只负责构建结构化数据。

---

### B3. 追问流程

用户在对话输入框输入追问，点发送后：

```js
async function sendFollowUp() {
    const userMessage = sessionState.followUpInput.trim();
    if (!userMessage) return;

    // 立即追加到历史，UI 立刻显示
    sessionState.conversationHistory.push({ role: "user", content: userMessage });
    sessionState.followUpInput = "";
    sessionState.followUpState = "loading";

    try {
        // 把完整历史传给 provider
        const rawResponse = await explainTuningAnalysis(
            providerSettings,
            null,                              // payload 为 null，表示追问模式
            sessionState.conversationHistory,  // 完整历史
        );

        sessionState.conversationHistory.push({ role: "assistant", content: rawResponse });

        // 尝试解析新的建议（AI 可能在追问中更新建议）
        try {
            sessionState.aiResponse = parseAiResponse(rawResponse);
        } catch {
            // 追问回复不一定是 JSON，忽略解析失败
        }

        sessionState.followUpState = "idle";
    } catch (err) {
        sessionState.followUpState = "error";
        sessionState.lastError = err?.message || "Follow-up failed.";
        // 移除刚追加的 user message，避免历史污染
        sessionState.conversationHistory.pop();
    }
}
```

---

### B4. providerAdapters.js 修改

`explainTuningAnalysis` 需要支持两种调用模式：

```js
// 首次分析（现有行为）
explainTuningAnalysis(settings, payload, null)

// 追问（新增）
explainTuningAnalysis(settings, null, conversationHistory)
```

内部逻辑：

```js
export async function explainTuningAnalysis(settings, payload, history = null) {
    const messages = history
        ? history   // 追问：直接用完整历史
        : [{ role: "user", content: buildSystemPrompt() + "\n\n" + JSON.stringify(payload) }];

    return callProvider(settings, messages);
}
```

`callProvider` 是现有的 provider 分发函数，只需要接受 `messages` 数组即可，
OpenAI-compatible 和 Anthropic 格式都原生支持 messages 数组。

**涉及文件**
- `src/js/autotune-ai/providerAdapters.js`
- `src/stores/autotuneAi.js`（新增 `sendFollowUp` action）

---

### B5. UI 设计

在建议区下方增加对话区域，结构如下：

```
┌─────────────────────────────────────────┐
│ 建议区（现有 PID/Filters/Rates 卡片）     │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ 对话历史                                 │
│  [user] 我试飞了，roll 还是有振           │
│  [ai]   建议降低 slider_d_gain 到 85...  │
│  [user] 能更保守一点吗                   │
│  [ai]   好的，建议改为 80...             │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ [输入框]                    [发送]       │
└─────────────────────────────────────────┘
```

**显示规则**
- 对话区只在 `conversationHistory.length > 0` 时显示
- 历史消息中 assistant 的 JSON 块折叠显示（只展示 summary 字段），不展示原始 JSON
- 追问时 AI 如果返回了新的 JSON 建议，自动更新上方建议卡片
- 追问时 AI 如果只返回文字解释，建议卡片不变

**新增 i18n key（三个语言文件同步）**

```
autotuneAiFollowUpPlaceholder  → "继续追问，例如：roll 轴还有振，能更激进一点吗"
autotuneAiFollowUpSend         → "发送"
autotuneAiFollowUpSending      → "发送中..."
autotuneAiConversationTitle    → "对话历史"
autotuneAiClearConversation    → "清除对话"
autotuneAiFollowUpHint         → "AI 会保持上下文，可以直接描述试飞结果或追问细节"
```

---

### B6. 清除对话

"清除对话"按钮（放在对话区 header 右侧）：

```js
function clearConversation() {
    sessionState.conversationHistory = [];
    sessionState.followUpInput = "";
    sessionState.followUpState = "idle";
    // 不清除 aiResponse，建议卡片保留
}
```

重新点"分析"时自动清除旧对话，开始新一轮。

---

### B7. 对话历史长度限制

防止历史过长导致 token 超限：

- 最多保留最近 20 条消息（10 轮对话）
- 超出时从头部截断，保留最新的 20 条
- 截断时在 UI 上显示"早期对话已省略"提示

```js
const MAX_HISTORY_MESSAGES = 20;

function trimHistory() {
    if (sessionState.conversationHistory.length > MAX_HISTORY_MESSAGES) {
        sessionState.conversationHistory = sessionState.conversationHistory.slice(-MAX_HISTORY_MESSAGES);
    }
}
```

---

## 实现顺序

```
A1 → A2 → A3 → A4   （先修 bug，独立可测）
B1 → B4 → B3 → B5 → B6 → B7   （持续对话，按依赖顺序）
```

A 部分可以在一个会话内完成。
B 部分建议分两个会话：B1+B4+B3 一个会话，B5+B6+B7 一个会话。

---

## 涉及文件汇总

| 文件 | 改动类型 |
|------|---------|
| `src/components/tabs/autotune/AiAdvisor.vue` | A1 A2 A3 A4 B5 B6 |
| `src/stores/autotuneAi.js` | B1 B3 B6 B7 |
| `src/js/autotune-ai/providerAdapters.js` | B4 |
| `src/stores/pidTuning.js` | A4（只读确认接口）|
| `locales/en/messages.json` | B5 |
| `locales/zh_CN/messages.json` | B5 |
| `locales/zh_TW/messages.json` | B5 |

---

## 安全约束（不变）

- 对话历史不存 `ConfigStorage`，只存 `SessionStorage`
- API key 不进入任何消息内容
- AI 追问回复同样经过 `parseAiResponse` 白名单过滤后才能写入
- 追问不能绕过 `canWrite` 检查直接写入
