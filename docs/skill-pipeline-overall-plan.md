# Skill Recorder：录制 → 深度分析 → 生成 总体产品技术方案


2026-10-17 设计补充：第四步“发布与分享”及生成页面逻辑见[录制产物设计 §11](recording-output-design.md#11-生成页与发布分享v12-设计补充)与[v12 交互稿](design/skill-generation-wireframes/index-v12.html)。发布能力尚未实现，本文原三阶段技术分析作为基线保留。
日期：2026-10-15
状态：总体方案，用于把三个步骤的职责边界和"哪里用 Claude、哪里不用、不可用时怎么办"固定下来，供后续实现排期。本文不重复已有文档的全部细节，只负责把三步的关系、每步的输入输出、每步内部各子阶段的归属（已有代码 / 待实现）与 Claude 的参与方式说清楚。
关联文档：[post-recording-enrichment-and-replay.md](post-recording-enrichment-and-replay.md)（数据契约与阶段决策的权威来源）、[claude-task-session-design.md](claude-task-session-design.md)（步骤二"深度分析执行"子阶段的 Claude 原生会话机制详案与实测证据）。

## 2026-10-17 补充：三类产物分流

新增 [SOP、Skill 与使用手册产物设计](recording-output-design.md)，定义模板、提示词、数据版本、交互和验收。**只有 Skill 进行执行方式翻译和技能计划；SOP 忠实整理操作；使用手册按功能组织已覆盖的操作。** 三类共享事实底稿，按产物识别必要缺口；事实充分时可跳过增强。SOP/手册不依赖 MCP 能力快照，不经过 SkillPlan。

下文步骤三原有 Skill 说明保留为 Skill 分支，新增文档分支以补充设计为准；本文原有“本轮不改动”的表述仅指 2026-10-15 的执行层改造，不涵盖本次新增产物设计。2026-10-17 已在工作区接入 SOP/手册首版链路，实施内容与限制见补充文档 §10，尚未发布。

## 0. 三步总览

```text
步骤一：原始素材确认        步骤二：深度分析                               步骤三：Skill 生成
（录制 + 基础分析 + 确认）   （权限判定 → 执行 → 一次性澄清 → 审核）          （规划 → 确认 → 产出 → 导出）
     不依赖本次新设计              只有"执行"子阶段依赖本次新设计                  不依赖本次新设计
```

步骤二的目标是**一次连续运行、一次澄清**：AI 先判定本次需要用到哪些能力（多数情况下已经在"专用环境"里配置好，无感通过），然后一次性把能自己查清楚的都查清楚，最后只拿真正查不到、只有人能决定的问题问用户一次——不是"问一轮→跑一轮→又问一轮"反复拉锯。具体设计见 §2。

**Claude 在整条链路里只覆盖三个局部的模型调用点**，彼此的运行方式、风险等级和依赖的新设计程度完全不同：

| 步骤 | 子阶段 | 是否用 Claude/模型 | 用法 | 是否依赖本轮新设计（`claude-task-session-design.md`） |
| --- | --- | --- | --- | --- |
| 一 | 基础分析（逐步骤标注） | 是 | 现有 `Describer` 的轻量模型调用，单步反馈循环 | 否，维持现状 |
| 二 | 权限范围判定（缺口识别 + 能力建议） | 是 | 轻量模型调用（现有 `AgentClient` 机制同款规格），不查业务系统 | 否，机制不变，但输出需要新增"建议能力范围"字段 |
| 二 | 深度分析执行 | 是 | **一次性原生 Claude Code 会话**，自主规划/读取/调用工具，并产出最终问题列表 | **是，这是本轮新设计的核心内容** |
| 二 | 一次性澄清后的终局整理 | 是 | 轻量模型调用（同"权限范围判定"规格），把用户回答并入最终结果 | 否，机制不变 |
| 二 | 结果审核 | 否 | 纯应用逻辑（用户确认/拒绝 Claim） | 不涉及 |
| 三 | 计划草拟与提交 | 是 | 现有 `AgentClient` 工具循环（`propose_plan`/`submit_skill`） | 否，维持现状 |
| 三 | 渲染与导出 | 否 | 纯确定性代码（`renderSkillMarkdown`） | 不涉及 |

下面按步骤逐一展开。

## 1. 步骤一：原始素材确认

### 1.1 输入与产出（已实现，不改动）

- **输入**：用户的一次真实操作录制（视频、音频、浏览器事件、截图）。
- **产出目录**：`sessions/<recordingId>/`（`electron/recorder/session-store.ts` 的 `sessionDir(id)`）：

  ```text
  sessions/<recordingId>/
    analysis.json / analysis.md     # Describer 产出的基础分析
    audio.json                      # 原始录音元数据
    narration.json                  # 语音转写：{model, language, segments:[{atMs,endMs,text}]}
    video.json / video.webm         # 录屏元数据与文件
    video-frames.json / video-frames/   # 录制期间采集的源截图索引与图片
    frames/frames.json / frames/    # 分析时提取/筛选/裁剪的派生截图索引与图片
  ```

### 1.2 基础分析（已实现）

`electron/describer/describer.ts` 的 `Describer` 类按 `common/analysis.ts` 的 `AnalysisStepSchema`/`AnalysisSubmissionSchema` 逐步骤产出标注，支持 `FeedbackEntrySchema` 驱动的单步重试反馈循环，`loadPersistedAnalysis()`/`renderAnalysisMarkdown()` 负责持久化与渲染 `analysis.md`。**这里的模型调用是轻量级的、按步骤单次往返的标注任务，不读工作区文件系统、不调用 MCP，与步骤二的"原生会话"是两种完全不同的机制，本轮不改动。**

**步骤一的产品定位是"忠实复述"，不是业务判断。** 按 [`docs/design/skill-generation-wireframes/REVIEW-v11.md`](design/skill-generation-wireframes/REVIEW-v11.md) 的阶段表，步骤一要求"**忠实、粗略的原始操作记录**"，第 59–65 行进一步要求"停止录制后保存材料并开始**原有分析**"——这里的"原有"就是指现状已实现的 `Describer` 机制，不是新设计。对应到 `AnalysisSchema`：`intent`/`intentRationale` 是对录制意图的复述（注释原文 *"why the agent believes this is the intent"*，而不是业务规则提炼），`steps` 的注释原文是 *"One **reconstructed action** the user took"*——每一步都是"重建用户做了什么"，不涉及业务判断、不涉及工具/MCP 调用。这条定位边界要保持住：**引入能力匹配、业务 MCP 补证、Agent 自主识别缺口/提问，是步骤二"深度分析"才开始做的事**（见 REVIEW-v11.md 第 67–79、124–151 行），步骤一不应该提前做这些判断。

### 1.3 用户确认（已实现）

用户在录制与基础分析完成后确认素材可用、可以进入增强流程，或者判断任务简单、无需增强直接结束（主设计文档决策 1）。确认动作对应 `common/enhancement.ts` 的 `decision.kind === "skip"` 分支（跳过增强）或进入步骤二。

**步骤一结论：不需要新设计，现状已满足需求。** 步骤二需要从这里拿到的，只是 `sessions/<recordingId>/` 这个既有目录的只读引用，不需要步骤一改变自己的产出格式。

## 2. 步骤二：深度分析

这是全文档唯一引入新机制的步骤。**核心设计目标是"一次连续运行、一次澄清"**：权限判定尽量无感（已配置好的直接放行），能自己查清楚的在一次执行里查完，只把真正需要人决定的问题汇总成一份清单问一次，回答后收尾产出最终结果。`followupQuestions` 回路保留，但只作为意外情况的兜底，不是预期中会反复走的常态路径：

```text
2.1 专用环境与能力选择（账号/机器级别，一次性配置）
        ↓
2.2 权限范围判定（轻量，不查业务系统）── 识别缺口 + 提出建议能力范围
        ↓
   应用核对建议范围 ⊆ 已启用能力？
      ├─ 是（多数情况）── 自动放行，用户无感
      └─ 否 ── 弹一次"本次需要用到 XXX，是否同意？"，用户确认一次
        ↓
2.3 深度分析执行（一次性原生 Claude Code 会话）── 自主读素材、自主查已授权 MCP，
        尽量把能解决的缺口都解决掉，产出 claims + 最终问题清单
        ↓
2.4 一次性澄清 ── 用户只看这一份最终问题清单，回答一次
        ↓
   终局整理（轻量模型调用，把回答并入 claims，产出 EnhancementResult）
        ↓          ↑
        │          └── 意外发现新冲突（罕见）才触发 followupQuestions，打回 2.4 重新问一轮
        ↓
2.5 结果审核（人工，不调模型）
```

### 2.1 专用环境与能力选择（已实现，任务级之前的一次性设置）

用户在"专用环境"里勾选希望深度分析可以使用的全局 Skill/MCP，`electron/agents/managed.ts` 负责发现候选、哈希校验、生成 `CapabilitySelection`/`CapabilityManifest`。这不是针对单个任务做的，而是账号/机器级别的一次性配置。**本轮不改动这一层**，但它是 2.2"权限范围判定"能不能自动放行的依据——判定结果如果完全落在这里已勾选的范围内，用户就不会再被问一次。

### 2.2 权限范围判定（现有机制，需要补一个输出字段）

这一步对应现状 `prepare(id)` 的职责，但目的收窄为"识别缺口 + 判定需要哪些能力"，**不在这一步直接把问题展示给用户**：

- 延续现状 `CLARIFICATION_INSTRUCTIONS` 的约束——"初判不查询业务系统"，这一步依然是轻量的、给定录制分析摘要的单次模型调用（现有 `AgentClient` 机制，不需要迁移到原生会话）；
- 识别 `Gap` 并分类 `strategy`（`agent-query`/`user-question`/`unresolved`）—— 现状已有；
- **新增**：对 `strategy: "agent-query"` 的缺口，模型需要一并给出"大概要用哪些能力解决"的建议（例如对应 `CapabilityManifest.tools[].ref`），应用据此拼出一个建议的 `RequestedScope`（`common/agents.ts:128`：`allowedToolRefs`/`accountRefs`/`resourceRefs`/`timeWindow`/`businessAccess:"read-only"`）——现状 `TaskPackage`/`Gap` 没有这个字段，需要加；
- 应用拿这个建议范围去对照 2.1 里已经勾选启用的能力集合：**建议范围整体被已启用集合覆盖时，直接采用，不用再向用户确认**（对应用户说的"也可能已经都配置好了"）；**只要建议范围包含任何一个未启用的能力，才弹一次简短确认**（"本次分析需要使用：邮箱 MCP（只读），是否同意？"），这是本阶段唯一可能打断用户的地方，而且只在真正需要新权限时才出现。
- 对于 `strategy: "user-question"` 的缺口，这一步不急着生成最终问题文案——**候选问题留到 2.3 执行完之后再最终定稿**，因为到那时才知道哪些缺口已经被 MCP 自动解决、不用再问了。

### 2.3 深度分析执行（新设计，对应 `run()`）

这是 `claude-task-session-design.md` 全文覆盖的内容，这里只给出它在整体流程里的位置和输入输出契约，细节（隔离基线、权限分层、目录结构、进程/会话生命周期、脱敏）**以该文档为准，不在本文重复**。

**先澄清现状，避免高估"换执行机制"这件事有多简单**：读 `coordinator.ts:275-405` 可以确认，当前 `run()` 只要 `scope.allowedToolRefs` 非空就**直接硬拒绝**（`coordinator.ts:286-289`），`foundation()`（`coordinator.ts:406-450`）构造的证据永远只有 `recording`/`user`/`material` 三种来源，**从未真正产生过 `mcp` 来源的证据**；`run()` 调用的 `this.model(..., "submit_enhancement", ...)` 和 `prepare()` 用的是同一个 `this.model()`/`AgentClient` 机制，只是 prompt 和 schema 不同，不是什么特殊的深度分析引擎。换句话说，REVIEW-v11.md v11.1 描述的"能力匹配中→读取中→补充完成"这一整套业务 MCP 自动补证 UX，**在当前代码里完全没有实现**——这不是本文疏漏，产品文档自己也承认（v11.2 第 19 行"受控业务 MCP 运行仍是待实施能力"；REVIEW-v11.md 第 106 行"现有实现尚未接通这条自动业务读取链路"）。

**所以"深度分析执行"这个新设计实际在做两件事，不是一件**：

1. 把 `run()` 的执行机制从"每轮重新拼历史的 `AgentClient` 循环"换成"一次性原生 Claude Code 会话"（`claude-task-session-design.md` 的全部内容）；
2. **第一次真正接通业务 MCP 自动补证**——把 `coordinator.ts:286-289` 的硬拒绝，替换成一条真正能核验只读/资源范围的调用路径。第 2 件事能不能做，完全取决于 `claude-task-session-design.md` §4.2 的应用侧 MCP 代理有没有产品化；**没有产品化之前，新引擎必须原样保留现在这条硬拒绝**，不能因为换了执行机制就顺便放开 MCP 权限——这是两件独立的事，不能捆绑上线。

**`run()` 现有的预算/续跑契约，新设计目前完全没有对接，是一个需要补的缺口**：`RunSchema`/`BudgetSchema` 已经维护 `budget.maxExternalCalls`/`budget.activeMs`，超预算自动转 `paused`（`coordinator.ts:328-332`），`continueRun` 续跑、`attempt` 计数、`eventSequence` 递增都是现状行为。`claude-task-session-design.md` 全篇没有说原生会话要怎么汇报"本次用了多少次外部调用"、预算耗尽时怎么触发暂停、怎么对应 `continueRun` 的续跑语义（是 `--resume` 同一个原生 session，还是重新播种新 attempt）。**这需要作为 `claude-task-session-design.md` §9 的一个新收尾项补上**，不能假设原生会话的进度事件会自动满足这个契约。

**输入**（由 `run()` 组装，来自 §2.2 产出的 `TaskPackage` + 步骤一的 `sessions/<recordingId>/`）：

- 用户意图（`TaskPackage.userNotes`）；
- §2.2 识别的缺口（`TaskPackage.gaps`，含 `agent-query`/`user-question`/`unresolved` 分类）；
- 步骤一的录制素材只读引用（`claude-task-session-design.md` §5.1/§5.3 的统一素材索引）；
- 已启用的 Skill 冻结文本、§2.2 判定通过（自动放行或用户确认）的 `RequestedScope` 对应的 MCP 配置——**这是本次会话唯一被允许接触的能力范围，不是"能力清单全集按需自取"**。

**执行方式**：按 `claude-task-session-design.md` §2/§3/§4/§5/§6 组装任务工作目录、隔离基线与权限策略，启动**一次**原生 Claude Code 会话，Claude 自主规划分析步骤、自主读取工作区素材、自主调用已授权的只读/代理 MCP 工具补证，**把能自己解决的 `agent-query` 缺口尽量都解决掉**，产出写入任务工作目录的 `outputs/`。

**输出**（应用读取 `outputs/` 后，按 `common/enhancement.ts` 校验并落盘）：

- 已自动解决部分的 `claims`（引用 `sourceType: "mcp"` 的真实证据，不能由模型自称"已查询"）；
- **一份最终的、最小化的问题清单**——合并"§2.2 未能被 MCP 解决的 `user-question` 候选"与"执行中新发现、只能由用户决定的缺口"，去重后作为**本次唯一要问用户的一轮问题**（见 §2.4）；
- `validateCandidate()` 强制：模型不能自己把 `Claim.review` 标成 `accepted`，不能让关键缺口无证据地消失，现状不变。

**Claude 不可用时的回退**（主设计文档决策 5，本轮不改变这条决策，只是现在要明确它和新执行引擎的关系）：

- 未安装受支持的本地 Agent：`run()` 退回现有模型 API 驱动的 `AgentClient` 工具循环（即不启用本轮新设计的"原生会话"机制，用途等同于当前实现，只是继续作为唯一的执行路径），此时 §2.2 的能力建议也无法真正执行，缺口直接保留为最终问题；
- 已安装但认证/运行异常：明确报错，不静默切换到 API 驱动路径；
- §2.2 判定的范围无法核验只读/资源范围（`claude-task-session-design.md` §4.2 的代理尚未产品化）：继续走 `coordinator.ts` 现状的硬拒绝，提示"导出任务包进行人工增强"（`exportPackage()`）。

**这意味着"原生会话"只是 `run()` 在"本地 Agent 为 Claude Code 且权限/能力条件满足"时的一种实现路径，不是唯一路径，也不是本步骤的全部**——`prepare`/`draft`/`confirm`/`review`/`skip`/`gate`/`exportPackage`/`importCandidate` 这些现有方法名可以保留，但其中 `prepare`/`confirm`/`draft` 的职责边界要按 §2.2/§2.4 调整，不是简单维持现状。

### 2.4 一次性澄清与终局整理（新设计的一部分）

- **用户只看一份清单**：§2.3 产出的最终问题列表，一次性展示给用户，用户逐条回答（沿用现有 `AnswerSchema`：`draft`/`confirmed`/`skipped`/`unknown`）。这是整个深度分析阶段**唯一一次**预期中的用户问答交互，不是"先问一轮、跑完又问一轮"。
- **终局整理是一次轻量调用，不是第二次原生会话**：用户回答提交后，用一个与 §2.2 同规格的轻量模型调用（现有 `AgentClient` 机制），把用户的回答和 §2.3 已产出的 `claims` 合并，补全 `user-confirmed`/`invariant` 类型的 claim，产出最终 `EnhancementResult`。这一步不需要重新拉起隔离的原生会话、不需要重新读工作区文件系统，所以不必走 `claude-task-session-design.md` 的完整机制，成本和延迟都应该很低。
- **`followupQuestions` 降级为例外兜底，不是常态路径**：只有终局整理阶段意外发现新冲突（例如用户的回答和已有证据矛盾）时，才产出 `followupQuestions` 打回本节重新问一轮——这应该是**罕见情况**，不是预期中的正常循环。现有 `coordinator.ts:367-388` 的打回机制保留作为安全阀，但产品体验上不应该把它当成"深度分析阶段原本就要来回好几次"的理由。

### 2.5 结果审核（已实现，不使用模型）

用户逐条查看 `Claim`，接受或拒绝（`review()`），处理剩余的关键缺口；全部处理完后 `EnhancementResult` 定稿，`approvedAt` 写入。**这一步是纯应用逻辑和人工审核，不调用任何模型。**

## 3. 步骤三：产物生成（以下为 Skill 分支）

SOP 分支为“整理操作 → 编辑预览 → 保存”；使用手册分支为“确认范围和目录 → 生成章节 → 编辑预览 → 保存”。两者的数据模型、模板和验收见 [三类产物设计](recording-output-design.md)，不复用 SkillPlan，也不将实际操作翻译为替代工具调用。

对应 `common/skill.ts` 的 `SkillPlan`/`SkillSubmission`/`BuiltSkill` 数据模型，拆成三个子阶段：

### 3.1 生成前置校验（已实现）

`electron/enrichment/generation.ts` 的 `generationContext()`/`generationKey()`：

- 必须有审核通过（`decision.kind==="enhance"` 且已 `approvedAt`）的增强结果，或明确 `skip`；
- 若目标架构是 `claude-code`，必须有对应工作区的 `CapabilityManifest` 快照（`capabilitySnapshot()`），否则直接报错"请先整理任务包"；
- 把审核通过的 `Claim` 按 `temporalScope` 分成 `rules`（不变规则）/`runtimeQueries`（当前查询）/`historicalFacts`（历史事实）三组，连同已确认的 `answers`、项目能力快照一起作为生成输入；`generationGate()` 判定草稿/定稿状态和剩余缺口。

**这一步不调用模型，是纯数据整理和前置条件检查。**

### 3.2 计划草拟与用户确认（沿用现有 `AgentClient`，非本轮新设计）

模型基于 `generationContext()` 的输出提出 `SkillPlan`（`propose_plan` 工具调用）：目标架构、kebab-case 名称、触发描述、泛化说明、固定值（`values`）、分步骤（`PlanStep`，区分 `calculation`/`action`）、建议的 `allowed-tools`。用户用自然语言反复修正这份计划，直到满意。

**这里不需要步骤二那种"自主读文件系统、自主调用业务 MCP"的能力**——生成阶段的输入已经是步骤二审核通过的、结构化的事实和规则，模型只需要在这些既定事实上做文本规划和措辞,所以继续使用现有、更轻量的 `AgentClient` 工具循环即可,不需要迁移到原生会话机制。

### 3.3 产出与导出（已实现，不使用模型）

用户确认计划后，模型提交 `SkillSubmission`（`submit_skill`：名称、描述、`allowed-tools`、正文）；`toBuiltSkill()` 把提交内容和计划一起封装成 `BuiltSkill`；`renderSkillMarkdown()` 用确定性代码把 `BuiltSkill` 渲染成最终 `SKILL.md`（YAML frontmatter + 正文，`{{id}}` 占位符替换为固定值），导出到目标 Agent 的 Skill 目录（如 Scout）。若 `generation.status==="draft"`（仍有未解决的关键缺口），渲染时会在正文顶部插入"待确认草稿"提醒；始终标注"内容已生成，尚未进行业务试运行"（主设计文档决策 6，本期不组织真实业务试跑）。

**这一步的"生成"动作本身是确定性代码，模型只参与前面的计划草拟,不参与渲染和导出。**

## 4. Claude 使用方式对照（回答"Claude 只是其中一部分"）

| 模型调用点 | 所在步骤 | 运行机制 | 自主程度 | 能否读工作区文件系统 | 能否调用 MCP | 本轮新设计覆盖？ |
| --- | --- | --- | --- | --- | --- | --- |
| 基础分析标注 | 一 | `Describer` 单步模型调用 | 无自主规划，单步生成+反馈重试 | 否 | 否 | 否 |
| 权限范围判定 | 二·2.2 | 现有 `AgentClient` 工具循环（轻量） | 有限（识别缺口 + 提出建议能力范围，不实际调用） | 否 | 否（只提建议，不执行） | 否，但输出 schema 需新增建议范围字段 |
| **深度分析执行** | **二·2.3** | **一次性原生 Claude Code 会话** | **自主规划分析步骤、自主决定读什么/何时读/查什么，并产出最终问题清单** | **是（任务工作目录内）** | **是（受 2.2 判定的范围 + 隔离基线+分层写约束限制，见 `claude-task-session-design.md` §3/§4）** | **是，本轮新设计核心内容** |
| 一次性澄清后的终局整理 | 二·2.4 | 现有 `AgentClient` 工具循环（轻量，同"权限范围判定"规格） | 有限（把用户回答并入已产出的 claims） | 否 | 否 | 否 |
| 结果审核 | 二·2.5 | 不调用模型 | — | — | — | — |
| 计划草拟与提交 | 三·规划 | 现有 `AgentClient` 工具循环 | 有限（在审核通过的事实上做文本规划） | 否 | 否 | 否 |
| 渲染与导出 | 三·产出 | 不调用模型 | — | — | — | — |

**七个模型调用点里，只有"深度分析执行"一个是本轮要新建的机制**；其余六个（基础分析、权限范围判定、终局整理、计划草拟、以及两个不调用模型的纯应用步骤）维持现状机制，只是"权限范围判定"和"终局整理"这两处的职责边界和输出内容因为 §2.2–§2.4 的重新设计而有调整，不是单纯维持原样。实现排期上，`claude-task-session-design.md` 的产品化收尾项（该文档 §9）只阻塞"深度分析执行"这一个子阶段，不阻塞步骤一、步骤三和步骤二的其余子阶段。

## 5. 变更记录

- 2026-10-15（第三轮）：把步骤二重新设计为"权限判定（多数无感）→ 一次性原生会话执行 → 一次性澄清 → 轻量终局整理 → 结果审核"，目标是避免"问一轮→跑一轮→又问一轮"的反复拉锯：`prepare()` 的职责收窄为"识别缺口 + 提出建议能力范围"，不再直接把问题展示给用户；最终问题清单改由深度分析执行阶段产出；新增"终局整理"子阶段消化用户的一次性回答；`followupQuestions` 从预期中的常态路径降级为意外情况的兜底。
- 2026-10-15（第二轮）：对照 `coordinator.ts` 现状代码复核三处问题：①步骤一措辞补充 REVIEW-v11.md 的"忠实复述"定位引用；②"深度分析执行"纠正为"换执行机制 + 第一次接通业务 MCP 自动补证"两件独立的事，澄清当前 `run()` 对任何 MCP scope 一律硬拒绝、从未产生过 `mcp` 来源证据；③流程图补上 `followupQuestions` 从"执行"打回"澄清"的回路；并把现有 `Run`/`Budget` 契约未被新设计覆盖这一缺口同步记入 `claude-task-session-design.md` §9。
- 2026-10-15（首次）：首次创建。基于现有 `common/analysis.ts`、`common/enhancement.ts`、`common/skill.ts`、`electron/describer/describer.ts`、`electron/enrichment/coordinator.ts`、`electron/enrichment/generation.ts` 源码核对三步的真实方法划分与数据契约，明确"深度分析执行"是唯一依赖 `claude-task-session-design.md` 新设计的子阶段，其余子阶段维持现状。
