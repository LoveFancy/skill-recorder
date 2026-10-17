# 批次 F：事件脱敏与证据保全

日期：2026-10-15。环境：macOS、本机 Claude Code 2.1.251。方法：复用 `/private/tmp/claude-task-audit.py` 的回环模拟模型；仅合成邮件地址、合成 token 和临时文件。真实模型与业务系统未调用。

结论：原生会话文件及 CLI 输出会保留工具参数/结果；应用事件必须在落盘和发送 UI 之前脱敏。应用事件脱敏不能追溯阻止 CLI 已写入的原生会话。完整 JSON 值的现有脱敏函数可复用，但逐个增量独立脱敏、动态对象键和值一视同仁的假设均不成立。原生架构的日志治理仍未实现，不能判产品通过。

## 1. 优先参考 OpenDesign 的位置

源码根：`/Users/qinxiao/WorkSpace/htworkbench/open-design`，调查版本 `282416ccd85bf92267e3f2e28cbd522e9c3e6e73`。

| OpenDesign 已有实现 | 本项目采用方式与差异 |
|---|---|
| `apps/daemon/src/prompt-telemetry.ts` 的 `buildSafeChildPromptTelemetry()` | 先脱敏再构建可持久化观测对象；记录版本、字节数、指纹、截断情况，不直接保存原始正文。用于应用事件的投影原则 |
| 同文件 `sanitizeSectionContent()` | runtime tool prompt 中含 OD_TOOL_TOKEN 的行先按结构剔除，再做文字脱敏；说明凭据字段应按用途丢弃，不能只依赖通用正则 |
| 同文件 `redactPromptText()` 与 `redact.ts` | 输出遥测前去除已知密钥/PII及本地路径。其注释明确不承诺识别人名、地址和所有业务秘密，不能扩大为“所有敏感信息已清除” |
| `runtimes/claude-stream.ts` | 解析工具参数与结果并归一化；沿用解析层与产品事件层分离，脱敏接在完整事件投影边界 |
| `agent-session-resume.ts` | 原生历史交由 CLI 持有，应用保存恢复引用。应用观测的脱敏规则不自动控制原生历史文件 |

OpenDesign 的上述代码证明其遥测投影处理方式，不证明原生 Claude session JSONL 已被相同逻辑脱敏；本次不作这种推断。TemporalScope 属于 Skill Recorder 的业务证据契约，应保留本项目现有校验。

## 2. 可独立派发的用例与结果

| 编号 | 具体操作 | 明确通过标准 | 实测结果 |
|---|---|---|---|
| F1.1 原生持久化 | 在初始输入和 Read 文件正文加入合成 token/邮件地址，文件路径含合成邮件地址，开启会话持久化 | 如产品声称日志已脱敏，原生 JSONL 不得含原始标记；否则必须明确列为受保护原始状态，不能默认导出 | **不满足“自动脱敏”**：原生 JSONL 含标记、tool_use 与 tool_result |
| F1.2 CLI 事件输出 | 检查相同任务的 stdout JSONL 中 assistant 工具参数及 user 工具结果 | 应用不能把该输出直接当脱敏 events.jsonl 持久化；须有投影前脱敏 | 捕获事件含合成 token/邮件地址；原生输出不是安全日志 |
| F1.3 完整事件脱敏 | 对完整事件及原生消息测试副本调用现有 `redactValue()`，写出脱敏副本 | JSON 仍可解析、已知标记消失、数字时间戳类型保持 | **单项通过**：嵌套字符串的 token/邮件消失，时间戳仍为 number |
| F1.4 分块边界反例 | 把一个 token 切成前缀 `ghp` 与其余部分，各自调用 `redactIncremental()` 后拼接 | 若采用逐块脱敏，拼接后不得恢复完整 token | **不通过**：逐块结果拼接仍含完整 token；完整消息一次脱敏可以移除 |
| F1.5 动态对象键 | 用合成邮件地址作为对象 key，调用 `redactValue()` | 若承诺整个 JSON 不含邮件地址，key 也必须处理或被白名单投影丢弃 | **不通过**：现有函数只递归 value，key 原样保留 |
| F2.1 来源引用 | 核对现有 EvidenceSchema、foundation、acceptCandidate 与存储，运行原有证据校验测试 | 模型不能自造 evidence ID、替用户批准、把无用户来源的结论升级为固定规则 | **现有通用测试通过**；新原生架构的 MCP 证据采集与落盘尚未实现 |

F1.3 是对现有函数的合成调用，不代表原生执行链路已经接入该函数。F1.4/F1.5 是实现约束，不要求把 JSON key 直接重命名后继续执行业务；优先将动态键映射为受控列表或投影成固定字段。

## 3. 落盘前的介入点

候选链路按 OpenDesign 的“完整事件解析 → 安全观测投影”组织：

```text
录制材料/用户补充
  → 应用脱敏并冻结 inputs 与证据摘要
  → Claude 输入

MCP 后端结果
  → 应用受控工具层提取来源、时间与资源范围
  → 在返回 Claude 之前移除不需要的敏感字段并脱敏
  → CLI 可见结果

CLI stdout
  → 有状态解析、累计完整工具参数
  → 固定字段事件投影 + redactValue/redactIncremental
  → events.jsonl + UI 事件 + 可导出诊断
```

工具参数的原始值只用于经过授权的调用，不把原值放入可导出事件。脱敏失败时停止对应材料提交/事件正文输出，并记录不含原文的错误码，不能回退记录原始数据。思考/文本增量可以先发送无正文的进度，在安全边界累计后发送脱敏正文；不要逐个任意 chunk 调用无状态脱敏器后直接落盘。

必须区分两条存储通道：

- **应用 events/evidence**：应用能控制落盘前脱敏及字段裁剪。
- **原生 config/projects 会话**：CLI 自己写入。stdout 脱敏发生得再早，也不能保证抢在这条写入之前；不能靠结束后扫描改写 JSONL 建立硬保证，也不能随意修改恢复历史。

若保留原生持久化，必须让输入/代理结果在进入 CLI 前就受控，原生状态视作受保护会话数据，限制导出与保留周期。仍需独立验证所有工具输出来源。若产品要求原生目录也绝不出现未脱敏内容，当前证据不足，应关闭原生持久化并采用应用检查点，接受不能原生 resume 的取舍；不能同时宣称无条件恢复和绝无原始历史。

## 4. TemporalScope 的来源与时序

下表中 inputs/evidence 的文件布局是候选契约；现有实现仍由 `WorkflowStore` 管理。

| 类型 | 可追溯来源 | 采集与脱敏点 | 验收要求 |
|---|---|---|---|
| `at-recording` | 录制 session.json 的 startedAt + analysis 步骤 startMs，任务输入 trajectory；当前由 foundation() 构建 recording evidence | 复制任务输入前脱敏，证据摘要落盘前再校验；保留 step ID、录制时点、输入修订 | 历史事实必须引用录制证据；历史 MCP 查询还需 resourceAt，不能用 queriedAt 替代 |
| `current` | 经授权 MCP 调用的成功响应、调用时间和资源身份；应用生成 evidence ID | 代理/应用受控工具层收集 queriedAt 和来源，在结果返回 CLI/证据落盘前脱敏 | 不能让模型自报“已查询”就创建 MCP 证据；真实查询记录必须可对应 |
| `invariant` | task-package 中用户明确确认的回答与 appliesTo，关联 questionId | 确认内容提交时脱敏，生成 user evidence 时脱敏 | 必须来自已确认且范围明确的用户回答；模型仅给出候选，不能自己审核通过 |

应用持有的 `inputs/evidence.jsonl` 是冻结的基础证据；新查询证据进入应用证据存储，再以受控引用提供给模型，不能由模型覆盖基础文件。证据条目至少保留已有 `id/sourceType/sourceRef/contentHash/recordedAt/queriedAt/resourceAt/privacy`，并用应用记录关联 run/attempt/toolUseId。`contentHash` 标明针对脱敏内容，不能声称它等于原始响应哈希。

最终输出先 schema 校验，再由 `validateCandidate()`、现有 `acceptCandidate()` 的来源/时间规则审核；通过后持久化候选，仍保留人工审核状态。单独的 JSON Schema 无法证明业务来源真实。

## 5. 证据和复现

- CLI 脚本：`/private/tmp/claude-task-audit-f.py`，复用原脚手架 HTTP/SSE/CLI 调用函数。
- CLI 证据：`/private/tmp/claude-task-audit-cw0e56ix/f-summary.json`、`f-native-session/events.json`、该任务 config/projects 下原生 JSONL。
- 脱敏脚本：`/private/tmp/claude-task-redact-f.ts`。
- 脱敏结果：`/private/tmp/claude-task-audit-cw0e56ix/f-redaction-results.json`。
- 命令：`node --experimental-transform-types --no-warnings --import ./evals/register.mjs /private/tmp/claude-task-redact-f.ts`。
- 既有回归：`node --experimental-transform-types --no-warnings --import ./evals/register.mjs --test electron/enrichment/privacy.test.ts common/enhancement.test.ts`，5 项通过。

未在产品中新增原生 events.jsonl，也没有修改 CLI 原生历史；这里验证的是该设计必须满足的通道差异与现有函数边界。
