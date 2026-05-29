# BBL 本地分析实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为普通 `.bbl` 日志增加本地调参分析、多日志勾选聚合、AI 基于本地证据解释，以及完整对话内容展示。

**Architecture:** 保持现有 CHIRP Autotune 路径独立，新增普通 BBL 的本地分析模块与聚合模块，由 `autotuneAi` store 统一管理选中日志、本地分析缓存与 AI payload。UI 先展示本地证据和建议，再展示 AI 解释与完整对话内容。

**Tech Stack:** Vue 3、Pinia、Vitest、现有 Blackbox 解码逻辑、现有 AI advisor 组件与 store

---

## 文件结构

本次实现涉及的核心文件与职责：

- 修改：`src/js/autotune-ai/blackboxBblSummary.js`
  - 补齐普通 BBL 解码支持，区分坏帧与不支持编码帧，补充日志质量摘要
- 新建：`src/js/autotune-ai/blackboxBblAnalysis.js`
  - 负责单日志本地分析：质量评分、诊断结果、建议生成
- 新建：`src/js/autotune-ai/blackboxBblAggregate.js`
  - 负责多日志结果聚合：一致结论、冲突结论、保守建议合成
- 修改：`src/js/autotune-ai/payloadBuilder.js`
  - 把本地分析结果、选中日志信息接入 AI payload
- 修改：`src/stores/autotuneAi.js`
  - 管理多日志勾选、本地分析缓存、聚合结果、AI 请求输入
- 修改：`src/components/tabs/autotune/AiAdvisor.vue`
  - 新增多日志勾选 UI、本地分析展示区、完整对话展示
- 修改：`src/js/autotune-ai/providerAdapters.js`
  - 调整系统提示，让 AI 以本地分析结果为主要技术证据
- 修改：`test/js/autotune_ai/blackboxBblSummary.test.js`
  - 覆盖解码扩展和质量字段
- 新建：`test/js/autotune_ai/blackboxBblAnalysis.test.js`
  - 覆盖单日志质量评分、诊断与建议逻辑
- 新建：`test/js/autotune_ai/blackboxBblAggregate.test.js`
  - 覆盖多日志聚合逻辑
- 修改：`test/js/autotune_ai/payloadBuilder.test.js`
  - 覆盖本地分析结果进入 payload
- 修改：`test/js/autotune_ai/storeDefaults.test.js`
  - 覆盖新状态字段
- 修改：`test/js/autotune_ai/dockStyles.test.js`
  - 覆盖 UI 中多日志和完整对话相关关键结构
- 修改：`test/js/autotune_ai/providerAdapters.test.js`
  - 覆盖 AI 系统提示对本地分析的约束

## 任务 1：补齐普通 BBL 解码能力与质量字段

**Files:**
- Modify: `src/js/autotune-ai/blackboxBblSummary.js`
- Test: `test/js/autotune_ai/blackboxBblSummary.test.js`

- [ ] **Step 1: 写失败测试，锁定不支持编码与坏帧分离**

```js
it("tracks unsupported encoded frames separately from corrupt frames", () => {
    const header = [
        "Product:Blackbox flight data recorder by Nicholas Sherlock",
        "Data version:2",
        "Field I name:time,gyroADC[0],gyroADC[1],gyroADC[2]",
        "Field I predictor:0,0,0,0",
        "Field I encoding:1,7,7,7",
    ];
    const data = makeBblBytesWithFrames(header, [makeIFrame([encodeUnsigned(1000), 0x00, 0x00, 0x00])]);

    const summary = buildBblSummary({ fileName: "unsupported.bbl", data });

    expect(summary.samples.decodedMainFrames).toBe(0);
    expect(summary.samples.corruptFrames).toBe(0);
    expect(summary.samples.unsupportedEncodedFrames).toBe(1);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run test/js/autotune_ai/blackboxBblSummary.test.js`
Expected: FAIL，提示 `unsupportedEncodedFrames` 未定义或编码 7/8/10 未支持

- [ ] **Step 3: 在普通 BBL 解码器中补齐分组编码支持，并区分计数**

```js
const ENCODING_TAG2_3S32 = 7;
const ENCODING_TAG8_4S16 = 8;
const ENCODING_TAG2_3SVARIABLE = 10;

function decodeFrameWithStatus(...) {
    try {
        return { frame: decodeFrame(...), unsupported: false };
    } catch (error) {
        if (error?.code === "UNSUPPORTED_ENCODING") {
            return { frame: null, unsupported: true };
        }
        throw error;
    }
}
```

- [ ] **Step 4: 扩展摘要结果，暴露新的质量字段**

```js
samples: {
    decodedMainFrames,
    corruptFrames,
    unsupportedEncodedFrames,
    skippedEventFrames,
    firstTimeUs,
    lastTimeUs,
    durationUs,
    truncated,
    maxDecodedFrames,
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run test/js/autotune_ai/blackboxBblSummary.test.js`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/js/autotune-ai/blackboxBblSummary.js test/js/autotune_ai/blackboxBblSummary.test.js
git commit -m "feat: extend ordinary bbl decode quality reporting"
```

## 任务 2：新增单日志本地分析模块

**Files:**
- Create: `src/js/autotune-ai/blackboxBblAnalysis.js`
- Test: `test/js/autotune_ai/blackboxBblAnalysis.test.js`

- [ ] **Step 1: 写失败测试，锁定质量评分与基础诊断**

```js
it("classifies a log with strong motor imbalance as usable and reports a motor imbalance diagnostic", () => {
    const result = analyzeBblLog({
        summary: {
            samples: { decodedMainFrames: 1200, corruptFrames: 0, unsupportedEncodedFrames: 0, durationUs: 8_000_000 },
            fields: { requiredColumns: { time: true, gyro: true, setpoint: true, motor: true, debug: false } },
            fieldStats: {
                motor: {
                    0: { mean: 1600, rms: 1610, max: 1800, count: 1200 },
                    1: { mean: 1590, rms: 1600, max: 1790, count: 1200 },
                    2: { mean: 1450, rms: 1460, max: 1650, count: 1200 },
                    3: { mean: 1440, rms: 1450, max: 1640, count: 1200 },
                },
            },
        },
        craftContext: { craftType: "long-range", flightStyle: "smooth-cruise", riskPreference: "balanced" },
        staticConfig: { rates: { roll_rate: 85, pitch_rate: 85, yaw_rate: 70 } },
    });

    expect(result.quality.status).toBe("usable");
    expect(result.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "motor_output_imbalance", confidence: "high" })]),
    );
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run test/js/autotune_ai/blackboxBblAnalysis.test.js`
Expected: FAIL，提示模块不存在

- [ ] **Step 3: 写最小实现，先完成质量评分与基础诊断框架**

```js
export function analyzeBblLog({ summary, craftContext = {}, staticConfig = {} } = {}) {
    const quality = classifyLogQuality(summary);
    const diagnostics = [];

    if (quality.status !== "unusable") {
        diagnostics.push(...detectMotorImbalance(summary));
        diagnostics.push(...detectRatesMismatch(summary, craftContext, staticConfig));
    }

    return {
        quality,
        diagnostics,
        recommendations: buildRecommendations({ diagnostics, craftContext, staticConfig, quality }),
        evidenceSummary: buildEvidenceSummary({ quality, diagnostics }),
    };
}
```

- [ ] **Step 4: 增补测试，锁定 rates 不匹配与不可用日志**

```js
it("marks logs with insufficient required fields as unusable", () => {
    const result = analyzeBblLog({
        summary: {
            samples: { decodedMainFrames: 30, corruptFrames: 0, unsupportedEncodedFrames: 0, durationUs: 200_000 },
            fields: { requiredColumns: { time: false, gyro: false, setpoint: false, motor: false, debug: false } },
            fieldStats: {},
        },
    });

    expect(result.quality.status).toBe("unusable");
    expect(result.diagnostics).toEqual([]);
});
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run test/js/autotune_ai/blackboxBblAnalysis.test.js`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/js/autotune-ai/blackboxBblAnalysis.js test/js/autotune_ai/blackboxBblAnalysis.test.js
git commit -m "feat: add ordinary bbl local log analysis"
```

## 任务 3：新增多日志聚合模块

**Files:**
- Create: `src/js/autotune-ai/blackboxBblAggregate.js`
- Test: `test/js/autotune_ai/blackboxBblAggregate.test.js`

- [ ] **Step 1: 写失败测试，锁定一致结论与冲突结论**

```js
it("boosts confidence for repeated diagnostics and lowers it for conflicting results", () => {
    const aggregate = aggregateBblAnalyses([
        { logIndex: 0, quality: { status: "usable" }, diagnostics: [{ type: "motor_output_imbalance", confidence: "medium" }] },
        { logIndex: 1, quality: { status: "usable" }, diagnostics: [{ type: "motor_output_imbalance", confidence: "high" }] },
        { logIndex: 2, quality: { status: "usable" }, diagnostics: [{ type: "rates_mismatch", confidence: "medium" }] },
    ]);

    expect(aggregate.consensusDiagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "motor_output_imbalance", confidence: "high" })]),
    );
    expect(aggregate.aggregateQuality.status).toBe("usable");
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run test/js/autotune_ai/blackboxBblAggregate.test.js`
Expected: FAIL，提示模块不存在

- [ ] **Step 3: 写最小实现，按结果级聚合而不是合并原始样本**

```js
export function aggregateBblAnalyses(results = []) {
    const usable = results.filter((result) => result?.quality?.status !== "unusable");
    const groups = groupDiagnosticsByType(usable);

    return {
        selectedLogIndexes: usable.map((result) => result.logIndex),
        consensusDiagnostics: buildConsensus(groups),
        conflictingDiagnostics: buildConflicts(groups),
        aggregateRecommendations: buildAggregateRecommendations(usable),
        aggregateQuality: summarizeAggregateQuality(usable),
    };
}
```

- [ ] **Step 4: 增补测试，锁定保守建议合成**

```js
it("uses conservative recommendation values across selected logs", () => {
    const aggregate = aggregateBblAnalyses([
        { logIndex: 0, quality: { status: "usable" }, recommendations: { rates: { values: { roll_rate: 70 } } }, diagnostics: [] },
        { logIndex: 1, quality: { status: "usable" }, recommendations: { rates: { values: { roll_rate: 65 } } }, diagnostics: [] },
    ]);

    expect(aggregate.aggregateRecommendations.rates.values.roll_rate).toBe(65);
});
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run test/js/autotune_ai/blackboxBblAggregate.test.js`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/js/autotune-ai/blackboxBblAggregate.js test/js/autotune_ai/blackboxBblAggregate.test.js
git commit -m "feat: add multi-log bbl aggregate analysis"
```

## 任务 4：把本地分析接入 payload 与 AI 提示

**Files:**
- Modify: `src/js/autotune-ai/payloadBuilder.js`
- Modify: `src/js/autotune-ai/providerAdapters.js`
- Test: `test/js/autotune_ai/payloadBuilder.test.js`
- Test: `test/js/autotune_ai/providerAdapters.test.js`

- [ ] **Step 1: 写失败测试，锁定 payload 中的本地分析字段**

```js
it("includes selected log indexes and local analysis summaries in the payload", () => {
    const payload = buildAiPayload({
        craftContext: { craftType: "long-range" },
        bblSummary: { fileName: "flight.bbl", logCount: 3, selectedLogIndex: 1, fields: { loggedFields: ["gyroADC[0]"] } },
        localBblAnalysis: {
            selectedLogIndexes: [1, 2],
            aggregateQuality: { status: "usable" },
            consensusDiagnostics: [{ type: "motor_output_imbalance", confidence: "high" }],
            aggregateRecommendations: { rates: { values: { roll_rate: 65 } } },
        },
    });

    expect(payload.inputSources.bbl.summary.selectedLogIndex).toBe(1);
    expect(payload.localAnalysis.selectedLogIndexes).toEqual([1, 2]);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run test/js/autotune_ai/payloadBuilder.test.js test/js/autotune_ai/providerAdapters.test.js`
Expected: FAIL，提示 `localAnalysis` 缺失，或系统提示未提到本地证据

- [ ] **Step 3: 修改 payload builder，把本地分析摘要接入**

```js
const payload = {
    ...existingPayload,
    localAnalysis: localBblAnalysis
        ? {
              selectedLogIndexes: localBblAnalysis.selectedLogIndexes,
              aggregateQuality: localBblAnalysis.aggregateQuality,
              consensusDiagnostics: localBblAnalysis.consensusDiagnostics,
              conflictingDiagnostics: localBblAnalysis.conflictingDiagnostics,
              aggregateRecommendations: localBblAnalysis.aggregateRecommendations,
          }
        : undefined,
};
```

- [ ] **Step 4: 修改 providerAdapters 系统提示，明确本地分析优先**

```js
"Treat localAnalysis as the primary technical evidence for ordinary Blackbox logs.",
"Do not contradict localAnalysis unless you explicitly state uncertainty and limitations.",
"Use local diagnostics and local recommendations to explain your conclusion.",
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run test/js/autotune_ai/payloadBuilder.test.js test/js/autotune_ai/providerAdapters.test.js`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/js/autotune-ai/payloadBuilder.js src/js/autotune-ai/providerAdapters.js test/js/autotune_ai/payloadBuilder.test.js test/js/autotune_ai/providerAdapters.test.js
git commit -m "feat: send local bbl analysis to ai provider"
```

## 任务 5：扩展 autotuneAi store，支持多日志勾选与本地分析状态

**Files:**
- Modify: `src/stores/autotuneAi.js`
- Test: `test/js/autotune_ai/storeDefaults.test.js`

- [ ] **Step 1: 写失败测试，锁定新状态字段**

```js
it("tracks selected bbl logs and local analysis state", () => {
    const storeSource = readFileSync("src/stores/autotuneAi.js", "utf8");

    expect(storeSource).toContain("selectedBblLogIndexes");
    expect(storeSource).toContain("localBblAnalysis");
    expect(storeSource).toContain("localBblAnalysesByLog");
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run test/js/autotune_ai/storeDefaults.test.js`
Expected: FAIL，提示状态字段不存在

- [ ] **Step 3: 增加 store 状态、选择逻辑与分析缓存**

```js
function defaultSessionState() {
    return {
        ...existingState,
        selectedBblLogIndexes: [],
        localBblAnalysesByLog: {},
        localBblAnalysis: null,
    };
}

function toggleBblLogSelection(index) {
    const selected = new Set(sessionState.selectedBblLogIndexes);
    if (selected.has(index)) selected.delete(index);
    else selected.add(index);
    sessionState.selectedBblLogIndexes = [...selected].sort((a, b) => a - b);
    refreshLocalBblAnalysis();
}
```

- [ ] **Step 4: 在导入 BBL 和切换日志时触发本地分析**

```js
function refreshLocalBblAnalysis() {
    const selectedIndexes = sessionState.selectedBblLogIndexes.length
        ? sessionState.selectedBblLogIndexes
        : [sessionState.bblSummary?.selectedLogIndex].filter(Number.isInteger);

    const perLog = selectedIndexes.map((index) => analyzeSelectedBblLog(index));
    sessionState.localBblAnalysesByLog = Object.fromEntries(perLog.map((item) => [item.logIndex, item]));
    sessionState.localBblAnalysis = aggregateBblAnalyses(perLog);
}
```

- [ ] **Step 5: 在 AI analyze 调用中传入本地分析结果**

```js
const payload = buildAiPayload({
    craftContext,
    cliSummary: sessionState.parsedCliSummary,
    csvSummary: sessionState.csvSummary,
    bblSummary: sessionState.bblSummary,
    analysisResult,
    localBblAnalysis: sessionState.localBblAnalysis,
});
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `npx vitest run test/js/autotune_ai/storeDefaults.test.js`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/stores/autotuneAi.js test/js/autotune_ai/storeDefaults.test.js
git commit -m "feat: track selected bbl logs and local analysis state"
```

## 任务 6：更新 AI 顾问 UI，展示多日志勾选、本地分析与完整对话

**Files:**
- Modify: `src/components/tabs/autotune/AiAdvisor.vue`
- Test: `test/js/autotune_ai/dockStyles.test.js`

- [ ] **Step 1: 写失败测试，锁定多日志 UI 与完整对话元素**

```js
it("renders bbl multi-select and preserves raw conversation content", () => {
    const component = readFileSync("src/components/tabs/autotune/AiAdvisor.vue", "utf8");

    expect(component).toContain("selectedBblLogIndexes");
    expect(component).toContain("localBblAnalysis");
    expect(component).toContain("autotune-ai-local-analysis");
    expect(component).toContain("message.content");
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run test/js/autotune_ai/dockStyles.test.js`
Expected: FAIL，提示关键结构不存在

- [ ] **Step 3: 增加多日志勾选区与本地分析展示区**

```vue
<div v-if="bblLogOptions.length" class="autotune-ai-bbl-manager">
  <UCheckbox
    v-for="log in bblLogOptions"
    :key="log.index"
    :model-value="sessionState.selectedBblLogIndexes.includes(log.index)"
    :label="log.label"
    @update:model-value="toggleBblLogSelection(log.index)"
  />
</div>

<section v-if="sessionState.localBblAnalysis" class="autotune-ai-local-analysis">
  <div class="autotune-ai-local-analysis__quality">{{ sessionState.localBblAnalysis.aggregateQuality.status }}</div>
</section>
```

- [ ] **Step 4: 调整对话渲染，保留完整原文**

```vue
<pre v-if="message.role === 'user' && isInitialPayloadMessage(message)" class="autotune-ai-message__raw">
{{ message.content }}
</pre>
<pre v-else class="autotune-ai-message__raw">{{ message.content }}</pre>
```

- [ ] **Step 5: 保留结构化卡片，但不再用摘要替代原始消息**

```js
function displayConversationMessage(message) {
    return message.content;
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `npx vitest run test/js/autotune_ai/dockStyles.test.js`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/components/tabs/autotune/AiAdvisor.vue test/js/autotune_ai/dockStyles.test.js
git commit -m "feat: show local bbl analysis and full ai conversation"
```

## 任务 7：做一轮集成验证并补最小文案

**Files:**
- Modify: `locales/en/messages.json`
- Modify: `locales/zh_CN/messages.json`
- Modify: `locales/zh_TW/messages.json`
- Test: `test/js/autotune_ai/blackboxBblSummary.test.js`
- Test: `test/js/autotune_ai/blackboxBblAnalysis.test.js`
- Test: `test/js/autotune_ai/blackboxBblAggregate.test.js`
- Test: `test/js/autotune_ai/payloadBuilder.test.js`
- Test: `test/js/autotune_ai/providerAdapters.test.js`
- Test: `test/js/autotune_ai/storeDefaults.test.js`
- Test: `test/js/autotune_ai/dockStyles.test.js`

- [ ] **Step 1: 增加最小 i18n 文案键**

```json
"autotuneAiLocalAnalysis": { "message": "本地分析" },
"autotuneAiDataQuality": { "message": "数据质量" },
"autotuneAiDiagnostics": { "message": "诊断结果" },
"autotuneAiSelectedLogs": { "message": "已选日志" },
"autotuneAiUnsupportedEncoding": { "message": "存在暂不支持的编码字段" }
```

- [ ] **Step 2: 跑相关测试集**

Run: `npx vitest run test/js/autotune_ai/blackboxBblSummary.test.js test/js/autotune_ai/blackboxBblAnalysis.test.js test/js/autotune_ai/blackboxBblAggregate.test.js test/js/autotune_ai/payloadBuilder.test.js test/js/autotune_ai/providerAdapters.test.js test/js/autotune_ai/storeDefaults.test.js test/js/autotune_ai/dockStyles.test.js`
Expected: PASS

- [ ] **Step 3: 如果依赖环境仍缺 Rollup 可选包，记录阻塞并做最小静态校验**

Run: `npm install`
Expected: 若环境正常则完成依赖；若仍因现有 `node_modules` 脏状态失败，则记录为环境阻塞，并补做 `git diff --check`

- [ ] **Step 4: 提交**

```bash
git add locales/en/messages.json locales/zh_CN/messages.json locales/zh_TW/messages.json
git commit -m "feat: add copy for local bbl analysis workflow"
```

## 自检

- spec 覆盖检查：
  - 普通 `.bbl` 本地分析：任务 1、2
  - 多日志勾选与聚合：任务 3、5、6
  - 本地结果先于 AI：任务 4、6
  - 完整对话展示：任务 6
  - 区分编码不支持与真实损坏：任务 1、7
- 占位词检查：计划中未使用 `TBD`、`TODO`、`implement later` 等占位语
- 命名一致性检查：
  - 本地单日志分析统一使用 `analyzeBblLog`
  - 多日志聚合统一使用 `aggregateBblAnalyses`
  - store 聚合状态统一使用 `localBblAnalysis`

