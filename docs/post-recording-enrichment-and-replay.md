# Skill Recorder：录制后增强与 Skill 生成方案

版本：技术方案 v2.1（Claude 进度 JSON，沿用线稿 v11.2）  
日期：2026-10-15  
状态：待实施设计，本文不代表规划能力已经上线。本轮不引入 pi；保留 Claude CLI，先试用结构化进度报告。文件沿用原路径，方便历史链接继续访问。

> **当前交互以 v11.2 为准，进度实现以 §5.9 的 Claude JSON 简化方案为准：原始素材确认 → 深度分析 → 生成。** 深度分析结合用户意图、原始操作与已启用能力补证，必要时提业务问题；回答后形成完整、可编辑的分析结果，用户确认后才生成 Skill。分析结果确认与最终文件保存是不同目的的两个动作，不能合并。工具来源按需展开，流程正文保持简洁。见 [交互规则](design/skill-generation-wireframes/REVIEW-v11.md) 和 [线稿](design/skill-generation-wireframes/index.html)。下文历史界面描述与此冲突时，以本轮为准；事实分类、权限边界与数据契约继续有效。

> **能力补充边界**：在已启用、已有授权、账号及只读权限可核验的范围内，允许使用匹配本次录制的业务 MCP 补充细节；不可用可用录制内容继续。受控业务查询仍为待实施能力，不能通过修改提示词绕过既有隔离。

> **2026-10-15 架构替换提示：§5.6–§5.10 已被取代，不要按原文实现。** 本文 §5.6（应用编排工具循环）、§5.7（三阶段调用契约）、§5.8（受控 MCP 网关）、§5.9（Claude 进度 JSON）、§5.10（提示词组织与续跑）这一整套"应用驱动工具调用循环"方案，已经过 Claude Code CLI 的大量实测，其中多条假设被证实不成立（例如原文"不依赖 Claude 原生 resume""用户答题期间不保留运行中 CLI 进程"等）。**执行层架构以 [claude-task-session-design.md](claude-task-session-design.md) 为准**（一次性原生 Claude Code 会话 + 隔离基线 + 分层写约束，取代应用逐轮拼历史的工具循环）；**步骤二的子阶段顺序与澄清时机以 [skill-pipeline-overall-plan.md](skill-pipeline-overall-plan.md) 为准**（权限范围判定→一次性深度分析执行→一次性澄清→终局整理，取代原"任务包准备→确认→增强执行"的反复问答顺序）。本文 §1–§4、§5.1–§5.5、§6 及以后的事实分类、权限边界与数据契约仍然有效，只有执行循环和子阶段顺序被取代。

## 2026-10-17 补充：产物边界与模板

SOP、Skill、使用手册的职责、模板、提示词、独立版本及验收见 [三类产物设计](recording-output-design.md)。只有 Skill 将实际操作翻译为目标环境的 MCP/CLI/浏览器能力；SOP 保留操作顺序，使用手册按已覆盖功能组织，两者不依赖能力快照、不经过技能计划。本文历史提示词中将 Skill/SOP 一律要求为运行时查询的规则，改为按产物解释。2026-10-17 已接入 SOP/手册首版生成、审核、导出，状态以关联文档 §10 为准；下文“尚未实现”的历史描述保留为设计时基线。

## 1. 产品目标与本期范围

让用户演示一次真实工作后，Agent 依据轨迹找出不清晰的地方，调用适用工具补充证据，向用户确认无法推断的规则，最终生成能处理新输入的 Skill。

核心价值是减少用户整理经验、补充上下文和纠正步骤的成本。若任务能通过几句话清楚描述，直接与 Agent 对话仍然合适；录制适合隐性步骤多、内部系统上下文不足、跨应用衔接复杂的工作。

采用以下决策，前五条延续原方案，第六、七条按本轮范围收窄：

1. 录制保持轻量，用户不必提前选择 MCP 或执行方式。
2. 录制后的基础分析继续使用现有流程；在生成 Skill 前形成可确认的深度分析结果；工具补证按可用性执行，无工具时仍可分析。
3. 增强 Agent 根据具体疑问发现和使用能力，不无目的遍历所有连接器。
4. 将历史事实补全与未来执行规划分开保存和审核。
5. 默认通过适配器调用本地 Agent，第一版接入 Claude Code；未安装受支持的本地 Agent 时，使用现有模型 API 驱动的内部 Agent。已安装但认证或运行异常时明确报错，不静默切换后端。
6. 本期闭环止于审核并导出 Skill；可以检查其逻辑、证据和能力依赖，不组织实际业务试跑，也不宣称“已验证可执行”。
7. 复用现有 Analysis → SkillPlan → BuiltSkill 生成链路，补充证据、规则与目标能力约束；不增加独立执行契约。

**本期范围**：多源证据整理、本地 Agent 专用环境与全局能力选择、能力发现、补证与用户澄清、结果审核、泛化计划、Skill 生成及导出。v10 另补齐 SOP 文档输出设计，与 Skill 并列，不涉及业务执行；该输出分支尚未实现。

**暂不纳入**：Computer Use、Replay、执行器选择与混合执行、Skill 到 Scout 的交付、自动化定时运行、自动安装 Skill。现有相关模块保持原状。本文末尾保留原失败恢复规则作为延期参考，不构成本期任务。

## 2. 当前基础与需要补充的能力

以下依据当前工作区源码核对，不代表所有安装包和操作系统均已验证。

| 能力 | 当前基础 | 本期补充 |
| --- | --- | --- |
| 多源录制与时间线 | 视频、截图、语音和浏览器事件；时间线与悬停预览 | 稳定证据 ID、来源范围、统一时间基准及采集缺失原因 |
| 基础分析 | `analysis.json`、证据引用与审核流程 | 增强结果作为候选修订；明确历史事实、推断、冲突和用户规则 |
| 模型处理 | API 多轮调用与本地 Claude 受控适配均已存在 | 对齐新目标/问卷契约、失败恢复与检查点验证 |
| Skill 生成 | `common/skill.ts` 的 SkillPlan、SkillSubmission、BuiltSkill，计划审核与导出 | 接收经审核的增强结果，检查泛化、时间适用性和实际能力依赖 |
| 目标架构与 catalogue | `common/architecture-registry.ts`、版本化静态 catalogue，生成提示与部分工具校验 | 与应用专用环境的动态能力快照分层，检查实际启用能力及输出依赖 |
| 通用配置 | 已有独立设置窗口及首页状态入口，语音与隐私分类分开 | 保持状态/保存/连接检查分离，对齐新流程的定位与恢复入口 |
| 自动化生成 | `common/automation.ts` 与 `electron/automationbuilder/builder.ts` 已有计划、触发器与 Scout 导入 JSON/bundle 生成 | 本轮不改动，不吸收或替换 AutomationPlan |

当前已有本地 Claude 受控适配、应用专用环境与全局能力选择；API 不继承本地 MCP/Skills。录制前意图、问卷式交互、首次进入自动初判及 SOP 独立导出仍为本轮待实施设计。

## 3. 用户流程（以线稿 v11.2 为准）

[线稿与状态目录](design/skill-generation-wireframes/index.html) 展示三阶段及可选状态，不代表用户必须逐张经过。

```mermaid
flowchart TD
    A[确认录制意图] --> B[录制操作]
    B --> C[原始素材确认：核对操作记录]
    C -->|确认并深度分析| D[结合意图、记录和实际能力补充细节]
    D --> E{需要业务澄清吗}
    E -->|需要| F[回答必要问题或补充材料]
    F --> G[结合回答完善分析]
    G --> H[深度分析结果：完整流程、规则和缺口]
    E -->|不需要| H
    H -->|修改或补充后重做| D
    H -->|回退修改素材| C
    H -->|确认并生成| I[生成 Skill / SOP]
    I --> J[预览、编辑、确认保存]
    J -->|返回修改分析| H
    J -->|重新生成| I
```

原始素材确认展示粗略、忠实的原始操作；不将模型推测或用户目标当作已发生事实。录制材料默认折叠，可查看三行时间线及来源。

深度分析等待页左侧统一汇总本次使用的工具与素材，右侧按真实事件逐条追加工作时间轴；动作与结果只在右侧呈现，不在工具卡片中重复。进展优先采用 Claude 通过 report_progress 提交的结构化 JSON，应用补最小运行状态；模型报告与实际工具记录分别保存，不展示思维链或预写进展。

深度分析为一个阶段：实际匹配能力并显示补证进度，必要时提出有依据的选项和“其他”输入；仅问业务问题。回答提交后继续完善分析，形成明确结果，不直接生成 Skill。结果正文包含目标、完整流程、业务规则、每次输入/查询内容与未决项。无需问题时直接展示结果；关键缺口仍可明确保留并确认生成草稿。

用户可直接编辑结果，或补充说明后显式重新分析。“确认并生成”批准当前分析版本；生成只使用已确认且未失效的输入，最后预览的“确认并保存”用于保存文件。结果被补证工具返回成功或页面导航不能代替用户确认。

默认本地 Agent，未安装受支持 Agent 时使用 API 路径；API 不继承本地能力。能力名称、登录、实际读取权限和业务调用分别核验。本次分析实际使用的工具与生成 Skill 的使用依赖分开说明。只列实际发生的调用，查询失败/跳过不显示成功；不宣称 Skill 已实际运行。

每阶段均可回退与显式重做，回看不自动调用。上游变化标记受影响分析/产物需要更新，保留回答、证据和旧结果；更新完成重新确认后才生成。更改输出格式仅使生成失效。失败/取消保留可确认的进度，重试需显式操作。

本次为设计调整，应用尚未据此实现；Computer Use、Replay 与 Scout 执行链路继续不在本期范围。

## 4. 增强 Agent 的工作循环

本节为目标工作循环。第一阶段用户确认原始操作后开始深度分析，在既有授权和已核验只读范围内可先补证，再询问仍不明确的业务规则。当前代码尚无业务 MCP 调用能力；受控网关是新增工作。开关开启不等于所有工具或数据范围均已授权。

### 4.1 建立事实清单

输入包括会话信息、已分析步骤、浏览器事件、语音片段、截图索引和用户材料。图片、长文本与事件按需分页读取，避免一次塞入整个录制。

每项结论标记为：

| 分类 | 例子 | 处理方式 |
| --- | --- | --- |
| 直接观察 | 浏览器记录到点击“发送” | 绑定事件 ID；不能据此断言发送成功 |
| 外部查询确认 | 已发送文件夹存在匹配邮件 | 记录账号、邮件标识、查询时间和匹配依据 |
| 用户确认 | 只处理状态为“已支付”的订单 | 保存用户回答和适用范围 |
| 推断 | 打开客户详情可能为查收件人 | 保留推断说明，不能升级为确定事实 |
| 未知或冲突 | 画面与查询到的附件不一致 | 保留双方证据，阻止依赖该信息的自动执行 |

以上分类保持原定义。本期“未知或冲突”会阻止相关规则被标记为已经确认；不因此启动执行。

### 4.2 发现信息缺口

每个缺口关联步骤、明确问题、重要程度、调查方法及解决标准：

- 对象：哪个订单、账号、工作簿、邮件？
- 参数：收件人、筛选条件、附件、公式是什么？
- 结果：录制时是否已经发送、生成文件或提交成功？
- 意图：为什么删除这些行、选择这个客户？
- 泛化：第一条记录是业务规则，还是恰好排在第一条？
- 能力依赖：目标环境是否具备 Skill 将要依赖的工具？

初判仅使用录制、分析和已有能力摘要，不启动外部业务查询；采用与后续相同的受限模型后端。每个缺口标记为 agent-query / user-question / unresolved，保留关联步骤和理由。向用户的问题包含为何需要、建议回答方式、是否关键；用户可以改写答案、主动补充、跳过或标记不知道。已有明确证据不重复问，预选项不算已确认答案。

对象、参数和历史结果列入 Agent 的查询任务；意图、业务规则在没有明确证据时先集中询问用户。没有用户问题直接形成待确认的深度分析结果；没有可查询工具也可用原始材料和业务回答完善内容。工具不可用不等于录制行为不存在。

### 4.3 带着问题选择能力

每次查询记录它要回答的 Gap ID、连接及账号引用、读取范围、预期证据和停止条件。先读取能力摘要，再获取选中工具的参数结构。核对账号、租户、资源范围、分页和附件支持，不能只按工具名称匹配。

MCP 是工具接口协议，不保证完整历史日志，也不保证查询无副作用。读写性质由受信任配置或核验过的适配器判定；仅有工具自述或名称时标记为 unknown，不自动用于只读增强。

本次补证授权仅用于读取明确范围内的材料。Skill 中可以描述未来发送邮件等步骤，但本次生成任务不调用这些业务写工具，内容审核也不授予未来业务操作权限。

### 4.4 验证证据与适用时间

优先读取元数据，匹配后再读取必要正文或附件。初次查不到可以有限扩大时间窗口，记录理由；“未查到”不等于“没有发生”。

邮箱示例：按录制账号、时间、主题和附件建立候选条件，查询已发送邮件并处理分页/同步延迟；结合邮件 ID、收件人、附件及时间交叉匹配。多个候选无法区分时询问用户，不自动选择最新邮件，也不重新发送。

查询到今天的客户邮箱，不能证明录制时使用了该邮箱。证据同时记录录制时间、查询时间、资源事件时间和更新时间；若查询返回可核验的历史邮件，可以支持相应历史事实。

Claim 必须包含 `temporalScope`：

| 值 | 含义 | 进入 Skill 的方式 |
| --- | --- | --- |
| `at-recording` | 只描述录制时的事实 | 示例、历史背景；不能直接成为固定值或永久规则 |
| `current` | 查询时的当前状态 | 表达为运行时重新查询；不能固化今天的客户邮箱等数据 |
| `invariant` | 在声明的业务范围内持续适用的规则 | 有证据或用户确认、适用范围明确且审核通过后，才可进入固定规则 |

`invariant` 是有依据的适用性判断，不代表绝对永恒。Agent 不能仅通过修改标签把一条观测升级为规则；规则变更时依赖它的计划需重新审核。

### 4.5 提问、预算与结束条件

问题应具体，例如：“以后处理全部待办订单，还是按订单号选择一条？”优先利用已确认目标和可验证的原始事实，在允许范围内补证；仍影响流程的业务规则再提问。同类问题合并，回答提交后保存新版输入并继续分析，不增加“任务包确认”页面。范围尚不明确时先问业务问题，不能为省去问题扩大查询。查询带来的新冲突可以追加提问，不重复询问已明确的规则。关键缺口未解决时可以保存草稿，但对应规则保持待确认。

初始建议预算为最多 20 次外部补证调用、5 分钟活动处理时间、单个已确认无业务副作用查询最多重试 2 次；重试计入调用次数，等待用户回答不消耗活动时间。恢复时显式选择增加多少预算，并保留累计消耗，不通过新建上下文悄悄重置限额。

基础整理、深度分析与生成分别记录活动时长。深度分析从匹配能力到结果形成共享一份补证预算；问卷往返、进程重启或同一运行续跑不重置额度。等待用户的时间不计活动处理时间；明确重新分析的新运行仍保留会话级历史消耗供查看。

这些是拟实施的协调器预算，**不是现有 API 参数**。`electron/ai/client.ts` 当前每次 `sendAndWait` 最多 40 轮工具循环，默认超时 180 秒；输出截断直接报错，失败或取消会回滚本轮消息。已有工具可能保存各自成果，但客户端本身没有统一的增量增强检查点，不能据此承诺续跑。

因此 P1 必须增加独立落盘机制：每条已接受证据、用户回答与阶段成果经过校验后保存，再推进检查点；预算耗尽或失败时从这些材料重建上下文。5 分钟任务预算与 180 秒单轮限制分别管理，不能靠调一个数字解决。未完成检查点前，UI 只承诺保留已成功保存的成果。

本地 Agent 的调用次数只有在适配器能够观测和拦截调度时才能成为硬上限；无法限制时走人工导出/导入路径，标记调用次数不可核验，不能承诺同样的预算控制。Claude Code 使用用户自己的订阅或密钥，应用不能保证获取 token/费用信息；UI 明示“预算限制调用次数和时长，不限制费用”，不可观测的部分明确标注。

## 5. 处理后端、工作环境与首页配置

### 5.1 本地 Agent 优先，API 作为后备

本地 Claude Code 经适配验证后承担基础分析、补证增强、规则澄清和 Skill 生成。模型连接与认证由 Agent 管理，用户不必重复配置 API。应用负责采集、转写、隐私处理、证据管理、审核和输出校验。本地 Agent 仍可能把材料发送给云端模型。

| 情况 | 行为 |
| --- | --- |
| Agent 已安装，项目、认证和所需接口可用 | 默认使用本地 Agent |
| 确认未安装受支持的 Agent | 使用已有 API 配置；没有则引导配置 API 或安装 Agent |
| 已安装但需登录、项目失效、版本不兼容、启动失败 | 明确错误与修复路径，不静默回退 API |
| MCP 不可用 | 仅阻塞依赖它的补证，其他分析可继续 |
| 用户在高级设置明确选择 API | 使用 API，并说明不会继承本地项目 MCP/Skills |
| 无法核验自动化接口或工具隔离 | 提供人工导出/导入候选结果路径 |

程序检测兼顾桌面应用 PATH、常见位置和用户指定路径；未在 PATH 找到不直接等于未安装。以独立可执行文件和参数启动进程，不执行任意 shell 命令字符串。

正式适配前核验目标版本的项目工作目录、图片输入、结构化输出、流式事件、交互澄清、取消和权限限制。版本相关协议需实测，不在方案中虚构 CLI 参数。API 后端继续只运行明确注册的进程内工具，首期没有外部补证工具时由用户补充材料。

分析、计划和生成阶段同样只开放本阶段必要的证据读取与候选输出，不给业务写工具。无法强制约束的本地接口也采用人工证据包路径，不能只限制增强阶段、却在基础分析时无约束启动同一个 Agent。

### 5.2 运行标识与适配契约

以下是**方案 schema 示例**，并非本次源代码变更；旧 Preparation 契约仅保留兼容语义，三阶段运行与结果确认以 §5.6–5.10 为准。v1.5 中 workspaceId 指应用内部专用环境；任务包和能力快照另绑定 managedConfigRevision / capabilitySelectionHash（见 §5.4），工具与 Skill 引用必须在该版本已启用清单内。基础整理与最终生成不加载业务 MCP；深度分析通过应用网关请求已核验的只读工具，Claude 进程本身仍不加载原生 MCP。读取 Skill 指令只允许选中且已核验的版本。沿用项目 Zod 风格；AgentKind 从独立注册表派生，第一版注册 Claude Code，以后增加后端时扩展注册项，而非在各处改字面量。

```typescript
const AGENT_KINDS = ["claude-code"] as const; // 由后端注册表派生
const AgentKind = z.enum(AGENT_KINDS);
const AgentStatus = z.enum([
  "available", "not-installed", "auth-required", "incompatible", "check-failed"
]);
const WorkspaceStatus = z.enum([
  "uninitialized", "initializing", "ready", "sync-required", "isolation-failed", "error"
]);
const McpStatus = z.enum([
  "configured", "checking", "connected", "auth-required", "connection-failed", "unverified"
]);
const SkillDiscoveryStatus = z.enum([
  "discovered", "unreadable", "conflict", "unverified"
]);
const RunStatus = z.enum([
  "queued", "running", "awaiting-input", "paused", "completed",
  "failed", "canceled", "interrupted"
]);
const ErrorInfo = z.object({ code: z.string(), message: z.string() }); // message 脱敏
const AgentAvailability = z.object({
  agentKind: AgentKind,
  status: AgentStatus,
  executable: z.string().nullable(),
  agentVersion: z.string().nullable(),
  checkedAt: z.number(),
  lastError: ErrorInfo.nullable()
});
const RequestedScope = z.object({
  workspaceId: z.string(),
  allowedToolRefs: z.array(z.string()),
  accountRefs: z.array(z.string()),
  resourceRefs: z.array(z.string()),
  timeWindow: z.object({ from: z.number(), to: z.number() }).nullable(),
  businessAccess: z.literal("read-only")
});
const CapabilityManifest = z.object({
  schemaVersion: z.literal(1),
  snapshotId: z.string(),
  workspaceId: z.string(),
  agentKind: AgentKind,
  agentVersion: z.string(),
  checkedAt: z.number(),
  discoveryMethod: z.string(),
  coveredSources: z.array(z.string()),
  omittedSources: z.array(z.string()),
  stale: z.boolean(),
  servers: z.array(z.object({
    id: z.string(), name: z.string(), source: z.string(),
    status: McpStatus, lastError: ErrorInfo.nullable()
  })),
  tools: z.array(z.object({
    ref: z.string(), providerId: z.string(), name: z.string(),
    description: z.string(), inputSchema: z.record(z.string(), z.unknown()),
    schemaHash: z.string(), accountRefs: z.array(z.string()),
    access: z.enum(["read", "write", "mixed", "unknown"]),
    accessVerifiedBy: z.string().nullable()
  })),
  skills: z.array(z.object({
    ref: z.string(), name: z.string(), description: z.string(),
    source: z.string(), contentHash: z.string().nullable(),
    status: SkillDiscoveryStatus, lastError: ErrorInfo.nullable()
  }))
});
const PreparationStatus = z.enum(["draft", "identifying", "awaiting-answers", "ready", "frozen", "stale"]);
const AnswerStatus = z.enum(["draft", "confirmed", "skipped", "unknown"]);
const PreparationRequest = z.object({
  preparationId: z.string().uuid(), // 调用方生成；初判尚未启动前即可保存草稿
  sessionId: z.string(),
  inputRevision: z.string(),
  backend: z.enum(["local-agent", "api"]),
  workspaceId: z.string().nullable(),
  capabilitySnapshotId: z.string().nullable(),
  extraMaterialRefs: z.array(z.string()),
  userNotes: z.string(),
  activeMs: z.number().finite().positive(),
  businessAccess: z.literal("none") // 旧 Preparation 模型整理阶段；新深度分析使用独立受控 scope
});
const EnhancementTaskPackage = z.object({
  schemaVersion: z.literal(1),
  preparationId: z.string().uuid(),
  revision: z.string(),
  sessionId: z.string(),
  inputRevision: z.string(),
  backend: z.enum(["local-agent", "api"]),
  workspaceId: z.string().nullable(),
  capabilitySnapshotId: z.string().nullable(),
  status: PreparationStatus,
  gaps: z.array(z.object({
    id: z.string(), stepRefs: z.array(z.string()), question: z.string(),
    strategy: z.enum(["agent-query", "user-question", "unresolved"]), critical: z.boolean()
  })),
  questions: z.array(z.object({
    id: z.string(), gapRefs: z.array(z.string()), text: z.string(), reason: z.string(),
    critical: z.boolean()
  })),
  answers: z.array(z.object({
    questionId: z.string(), text: z.string(), status: AnswerStatus,
    appliesTo: z.string(), updatedAt: z.number(), confirmedAt: z.number().nullable()
  })),
  userNotes: z.string(),
  extraMaterialRefs: z.array(z.string()),
  remainingGapRefs: z.array(z.string()),
  scope: RequestedScope.nullable(),
  preparedAt: z.number(),
  confirmedAt: z.number().nullable()
});
// 下方是既有请求的基础字段；三阶段扩展见 §5.7，实施不能遗漏版本及原始确认引用。
const EnhancementRequest = z.object({
  runId: z.string().uuid(), // 调用方生成
  preparationId: z.string().uuid(),
  taskPackageRevision: z.string(),
  sessionId: z.string(),
  inputRevision: z.string(),
  backend: z.enum(["local-agent", "api"]),
  workspaceId: z.string().nullable(), // API 可为空
  capabilitySnapshotId: z.string().nullable(),
  scope: RequestedScope.nullable(),
  budget: z.object({ maxExternalCalls: z.number().int().nonnegative(), activeMs: z.number() })
});
type EnhancementEvent = {
  runId: string;
  sequence: number;
} & (
  | { kind: "status"; status: z.infer<typeof RunStatus> }
  | { kind: "checkpoint"; revision: string }
  | { kind: "question"; questionId: string; text: string }
  | { kind: "call-summary"; toolRef: string; gapId: string; summary: string }
  | { kind: "candidate"; resultRevision: string }
  | { kind: "error"; error: z.infer<typeof ErrorInfo> }
);
// 目标接口示例；替代旧 prepare -> confirm package -> run 的 UI 映射。
// request 增加 stage、attemptId、intentRevision、rawRevision、contextRevision、
// managedConfigRevision、capabilitySelectionHash 及输出 schema 版本。
interface ProcessingAdapter {
  inspect(): Promise<z.infer<typeof AgentAvailability>>;
  requestModel(input: ModelTurnRequest, signal: AbortSignal): Promise<ModelTurnResponse>;
  // 只返回结构化候选或应用工具请求，不直接执行 MCP/文件/系统操作。
}
interface DeepAnalysisService {
  start(request: z.infer<typeof EnhancementRequest>, signal: AbortSignal): AsyncIterable<EnhancementEvent>;
  submitAnswers(runId: string, expectedContextRevision: string,
    answers: Array<{ questionId: string; text: string }>): Promise<void>;
  confirmResult(runId: string, resultRevision: string, expectedInputKey: string): Promise<void>;
  cancel(runId: string): Promise<void>;
}
```

上方保留的 Preparation/TaskPackage 等 schema 是既有内部材料契约，不再表示用户必须经历的独立阶段；迁移时保留历史读取。新的运行入口须扩展输入，固定已确认意图、原始分析、材料与能力版本。ModelTurnRequest/Response 为 §5.6 定义的职责边界，实施时沿用现有 Message/Tool 协议并补运行时 schema，不增加第二套模型工具协议。

调用方取得会话锁、生成 runId、创建目录并原子保存 manifest 后再 start。首事件前可幂等取消；所有事件匹配 runId/attemptId 与单调序号。空工具白名单表示不允许业务查询，API 不借用本地环境。环境、快照、scope、schema 哈希及有限预算均需跨字段校验。

用户提交回答时检查 questionId 属于当前问题集及 expectedContextRevision；保存不可变回答修订再建立下一处理尝试，恢复有效证据，不改写已开始尝试的输入。回答提交只确认用户原话，不批准最终分析。深度分析结果只能由 confirmResult 在比较当前输入和结果版本成功后批准，模型不能输出批准字段。

事件、阶段、问题、结果及审核状态均采用 Zod 判别联合与枚举；scope 只有执行网关强制检查时才构成权限约束。检查点、恢复与完整阶段接口见 §5.6–§5.10。

### 5.3 接收 Claude Code 结果的适配成本

现有 API 通过注册工具 handler 接收结果，客户端用 `submit_analysis / submit_skill / propose_plan / propose_automation_plan / submit_judgement` 名称识别成功提交。这是进程内机制，外部 Claude Code 不会天然拥有这些工具。

本地适配器需要把受支持的结构化输出或受控结果文件转换成候选 Analysis、增强结果、SkillPlan、SkillSubmission，再复用应用验证与保存逻辑。必须校验 schema、证据 ID、输入版本、目标工具、路径和运行标识；不能靠输出含有“submit_skill”字样判断成功，也不能直接接受 Agent 自报 approved。

证据包导入与自动适配共用这套验证。非法或截断输出保留脱敏错误及已有检查点，不覆盖上一版有效结果。基础分析和生成阶段复用同类运行生命周期，但各自使用现有阶段 schema，不把所有输出塞进 EnhancementResult。

### 5.4 自动管理 Claude 专用环境与全局能力（v1.5）

应用自动在受保护应用数据目录建立专用工作环境，不要求用户选择或关联项目。用户已有全局 Claude 配置作为能力来源，启用范围及生成的专用配置由 Skill Recorder 独立管理；不修改全局配置、不扫描其他项目、不自动继承全局 hooks、宽泛权限及 CLAUDE.md。来源不可完全读取时明确遗漏范围。

四层分开：全局来源快照 → 本应用 MCP / Skills 启用选择 → 生成专用配置 → 每次任务不可变快照。内部 workspaceId 仍可作为环境标识，但不再对应用户选中的项目；新的设置不需要多个项目或默认项目选择。

首次自动创建环境不启动 MCP，所有能力默认关闭。用户选择并保存后生成配置；首次加载或主动检查说明会执行配置的本地 MCP 进程、可能要求认证，Skills 可能包含指令和脚本资源。开启能力不授权业务写操作；增强仍需确认任务范围，并验证只读语义。Skill 是指令资源，不因被发现而成为 callable tool，也不等于成功加载。

配置发现只读取已核验用户级来源，不把配置存在当连接成功。主动检查仅针对保存后启用的 MCP；读取快照不启动进程。状态独立表示：来源发现、启用选择、加载隔离、MCP 连接、工具权限以及 Skill 实际加载。UI 未选能力必须不进入真实运行；不能依赖提示词或仅隐藏列表。

**新建项目并不能阻止 Claude 继承用户级能力。** 适配必须实际核验目标 CLI 版本如何隔离未选全局 MCP、Skills、指令、hooks 和插件，再选择生成配置/显式参数/受控资源装载方式。无法强制保证时标记 isolation-failed，禁止这些能力自动加载，保留受限基础分析或人工证据包路径。方案不假设尚未核验的 Claude 配置字段和 CLI 开关。

MCP 优先复用凭据引用，Claude 登录复用现有认证，避免复制 token。必须物化的含密配置只保存在受保护本地目录并限制权限，不进入快照、日志、诊断或导出。Skill 资源需要一并提供并检查越界路径、脚本执行及来源优先级。

推荐新模型（方案示例，尚未修改应用 schema）：

```typescript
interface ManagedAgentEnvironment {
  id: string;
  agentKind: z.infer<typeof AgentKind>;
  managedDirectory: string; // 应用内部管理；不需要用户选择
  createdAt: number;
  agentVersion: string | null;
  status: z.infer<typeof WorkspaceStatus>;
  activeConfigRevision: string | null;
  sourceSnapshotId: string | null;
  capabilitySnapshotId: string | null;
  lastError: z.infer<typeof ErrorInfo> | null;
}
interface CapabilitySelection {
  ref: string; // 包含来源身份，避免同名能力碰撞
  kind: "mcp" | "skill";
  enabled: boolean;
  sourceHash: string;
  reviewState: "confirmed" | "needs-review" | "missing" | "conflict";
}
interface ManagedConfigRevision {
  id: string;
  environmentId: string;
  sourceSnapshotId: string;
  selections: CapabilitySelection[];
  generatedConfigHash: string;
  isolationStatus: "unverified" | "verified" | "failed";
  createdAt: number;
}
interface ProcessingSettings {
  backendPreference: "auto" | "local-agent" | "api";
  managedEnvironmentId: string | null; // 自动创建并绑定
}
```

开关编辑为草稿，按分组保存后原子生成新版本；生成失败保持上一有效配置和未保存输入。发现来源更新先展示差异：新增默认关闭；未变化保留选择；命令/参数/凭据引用或 Skill 内容变化需重新复核；移除和冲突项禁止自动加载但保留原因。同步失败保留上次快照并标记过期，不能显示为空。确认同步不自动启用新能力，不自动重启任务。

任务包与运行增加 managedConfigRevision 及 capabilitySelectionHash，固定启动时启用配置；实际权限被撤销时仍暂停依赖步骤。全局设置修改只影响后续任务。旧用户项目记录保留给历史任务追溯，不用于新任务，不删除用户文件、不自动迁入其项目专属能力。首次迁移提示确认全局启用范围，新能力默认关闭；旧 Skill 的项目依赖仍按原快照标记。

### 5.5 全局设置与状态呈现（v1.5）

配置集中到独立设置弹窗，采用左侧分类、右侧配置结构。当前首页和 Library 内嵌的通用配置改为定位入口；不再在错误容器里展开设置。对应线稿 v6 的 01–05、26、29–36；完整交互见 [线稿说明](design/skill-generation-wireframes/README.md)。

- 通用：配置概况与定位入口；不新增账户、遥测或更新功能。
- 浏览器插件：保留 Chrome / Edge 的独立状态、插件目录与安装说明、刷新、重连和脱敏错误详情。
- AI 模型：复用 API 地址、模型、密钥、保存与连接检查；处理策略唯一归属 Agent 能力，避免两处配置互相矛盾。
- Agent 能力：本地优先/仅本地/API 策略、检测登录、专用环境自动准备、全局来源同步、MCP/Skills 启用范围、配置快照与主动连接检查。
- 语音转写：独立分类，管理默认转写语言、SenseVoice 本地模型及下载状态。首页保留旁白开关与麦克风快捷选择。
- 隐私保护：独立分类，管理本地屏幕文本保护及隐私模型；与语音转写分开保存、分开处理未保存更改。录制期间锁定冲突设置。

首页与记录窗口提供设置入口；各状态行和失败提示可直接定位对应分类。增强页仅展示后端/专用环境版本/就绪摘要和更改入口，本次任务范围与回答仍留在增强流程。输出目标仍在生成阶段选择。

按分组显式保存；保存、查看快照和主动连接检查分开。返回或关闭前处理未保存更改，保存失败保留输入。关闭设置返回原阶段，重新读取当前配置并校验；满足条件后清除对应旧错误，未满足则显示最新具体原因。旧异步检查不得覆盖新配置版本。设置变更不得自动开始整理、批准候选或跳过增强；首次进入第二阶段的受控自动初判按 §3 规则处理。

状态按程序、认证、环境准备、加载隔离、协议与能力发现分别计算，旧布尔仅作兼容派生。正常设置使用中性容器；未配置/未检查是中性或警示状态，红色只用于实际失败的局部提示。某个 MCP 失败不使整个面板染红，也不阻止不依赖它的基础分析。已保存不等于已连接，Skill 已发现不等于已加载。Library 的旧配置错误在重新验证成功后必须消失。

查看已有快照不启动进程；主动 MCP 检查明确说明本地进程与认证影响。API 未配置不影响就绪的本地 Agent。未安装受支持 Agent 或明确选择 API 时允许使用 API；需登录、项目不可访问等异常不静默降级。

修改默认值只影响后续任务，不变更运行中的冻结输入；更换当前运行环境须先取消并新建运行。录制期间禁用与本次采集冲突的设置。设置弹窗左栏、标题与操作区固定，仅正文滚动，不在配置中嵌套第二个滚动能力列表。

### 5.6 Claude 交互方式：应用编排，Claude 负责判断

> **本节（含 5.7–5.10）已被 [claude-task-session-design.md](claude-task-session-design.md) 取代，仅保留作历史记录，不要按下文实现。**

**本期选择保留应用驱动的工具循环，不切换成让 Claude CLI 自由执行任务。** 用户使用的是本机 Claude 的认证与模型能力，MCP/Skills 来源于其全局配置的已选子集；不是把用户完整 Claude 会话、hooks、插件和工具权限直接搬入应用。

源码核验（本次只读，以下不代表新能力已实现）：

| 现有位置 | 已实现边界 | 本轮需要调整 |
| --- | --- | --- |
| `electron/agents/local-request.ts` | 将模型消息、工具声明和所选 Skill 文本送入 Claude；每次请求启动独立 CLI，原生工具/MCP 关闭，结构化返回 content/toolCalls；图片以附件传入 | 固定运行配置与适用的 Skill 上下文；保留工具声明→请求→应用执行的协议，补版本化结果、限制与错误分类 |
| `electron/agents/process.ts` | 无 shell 启动、限时、限输出、取消终止子进程；收集 stdout 后返回 | 首期复用每轮结构化输出解析 report_progress；进程生命周期作兜底；单轮内流式 JSON 后续按需验证 |
| `electron/agents/mcp.ts` | 受选中配置约束的 stdio initialize/tools/list；发现工具的 access 为 unknown；HTTP/SSE 当前不支持 | 新增长期受控会话、tools/call、范围验证、取消、认证状态与凭据生命周期；不能把发现当补证 |
| `electron/enrichment/coordinator.ts` | 现有 prepare/draft/confirm/run 生命周期，prepare 主要使用前序分析、能力快照、回答与材料 | 改为三阶段服务语义；新增原始素材确认、按需读取、工具网关、深度结果与显式批准 |
| `electron/enrichment/generation.ts` | 现有 generationGate 与时间分类；无 decision 时仍有 legacy 返回 null 的兼容入口 | 新流程必须强制深度分析确认；旧录制迁移不从这个旁路绕过门槛 |
| `electron/ai/client.ts` | 本地 Claude/API 共用应用注册工具循环，40 轮上限、默认 180 秒；失败回滚本轮消息 | 接入进度 JSON 非终止工具、逐工具检查点与明确终止工具，恢复不依赖内存对话 |

Claude 每轮交互固定为：

ModelTurnRequest 的必需字段：runId、attemptId、turnId、stage、promptVersion、messages、toolDefinitions、terminalToolNames、expectedOutputSchemaVersion、remainingBudget 和 frozenBackendRef。ModelTurnResponse 包含 turnId、content（非 UI 进度）、toolCalls（id/name/arguments）或经 schema 校验的 terminalPayload，另可携带有来源的 usage 与 protocolError。工具结果必须与 toolCallId 配对，发送前校验无孤立消息；本地 Claude 的 JSON envelope 由 localRequest 转成与 API 相同的消息形态。请求/响应大小及工具参数均有限额。上述包装是应用运行元数据，模型不自行指定运行身份。

1. 协调器从不可变输入和检查点组装消息，给出本阶段允许的工具及结果 schema。
2. 本地适配器按已验证版本的参数启动 Claude，使用应用专用目录；原生工具、MCP、浏览器与未选定自定义能力保持关闭。
3. Claude 返回结构化的应用工具请求或阶段结果。应用校验名称、参数、当前状态、预算和引用，拒绝未注册调用。
4. 工具 handler 读取受控材料，或调用应用 MCP 网关。返回先脱敏、关联来源并落检查点，再以 tool result 交回模型。
5. 重复至提出业务问题、产出待确认分析、失败、取消或预算停止。一次合法终止提交后不执行同批其余调用；多终止提交或互相冲突提交拒收。

这里 Claude 的工具调用是“请求应用执行”，不是 Claude 已经执行。所选 Skill 是带来源的辅助指令/文本资源，不自动执行其脚本；脚本运行不属于首期。配置版本或资源哈希变化必须重核验，不能在同一运行中临时重读最新全局配置。

**不依赖 Claude 原生 resume。** 当前适配每轮启动进程、传入消息，原生会话不持久化。业务状态和回答都由应用管理。长流程从应用检查点重建有界上下文；原生会话恢复仅可作为后续优化。不要把 CLI 会话 ID 当作 runId，不通过向 stdin 长期挂起一个交互终端等待用户回答。

不同版本 CLI 的参数、图片输入、结构化 JSON、隔离效果必须实测；文中现有参数仅是代码现状，不承诺任意版本支持。隔离失败仍可使用已验证的受限模型路径；不得移除限制来“修复连接”。已安装但认证/协议失败不静默切换 API。

### 5.7 三阶段调用、结果契约和确认门槛

| 用户动作/状态 | 调用行为 | 结果与下一状态 |
| --- | --- | --- |
| 结束录制 | 保存采集后调用现有描述器，加入已确认意图 | 原始 Analysis 候选；只记录观察，不补业务 MCP、不生成未来规则 |
| 修改并确认原始素材 | 原子保存 rawConfirmation（原始分析版本、意图版本、材料指纹、确认时间）；显式启动深度分析 | 固定配置与输入版本，进入工具汇总+工作时间轴 |
| 深度分析运行 | 对照意图与原始分析，按需读截图/转写/事件，匹配能力并在允许范围补证 | 问题集或完整 DeepAnalysisResult；无问题直接结果页 |
| 提交回答/补充材料 | 保存答案与材料版本，复用已验证证据，新的 attempt 继续分析 | 整理完整分析结果；仍有关键冲突按需追加问题，不直接生成 |
| 编辑分析结果 | 用户编辑原位保存新 resultRevision，记录 user-edit 来源 | 仍待确认；已有生成内容标记过期 |
| 确认并生成 | 比较 raw/intent/context/resultRevision，原子保存 DeepAnalysisConfirmation，并固定生成输入 | 调用已有 SkillPlan → BuiltSkill，或新增 SOP 渲染分支 |
| 预览、重新生成、保存 | 生成失败不使分析确认失效；重新生成使用相同已确认结果，保存只写最终文件 | BuiltSkill / SOP 与保存状态；不创建业务邮件或试运行 |

建议在 `common/enhancement.ts` 扩展版本化 Zod schema，以下是字段需求而非代码已存在声明：

- **RecordingIntent**：id/revision、outputPreference(sop/skill/unspecified)、taskDescription、source(text/voice/mixed)、confirmedAt。无独立 expectedOutcome 必填字段。
- **RawConfirmation**：sessionId、rawAnalysisRevision、materialFingerprint、intentRevision、confirmedAt；第一阶段仍沿用 Analysis，不重复制造原始记录协议。
- **DeepAnalysisInput**：runId/attemptId、sessionId、rawConfirmationRef、contextRevision、answerRevision、materialRevision、backend、managedConfigRevision、capabilitySnapshotId、capabilitySelectionHash、scope、budget、promptVersion/schemaVersion。
- **DeepAnalysisResult**：id/revision、runId、inputKey、goal、steps（id/action/purpose/inputRefs/outputRefs/claimRefs）、businessRules（claimRefs/适用范围）、variableInputs、runtimeQueries、exceptions、remainingGaps、questionSetRef、usedResourceRefs、suggestedDependencies、createdAt。内部事实继续使用既有 Evidence/Claim 与 temporalScope，不另造第二套证据。
- **DeepAnalysisConfirmation**：resultId/resultRevision、inputKey、confirmedAt、acceptedGapRefs、confirmationKind(complete/draft)。批准整份可读结果，不要求用户逐 Claim 打勾；内部保存批准边界，不能提升无依据的固定规则。
- **GenerationInput**：confirmationRef、resultHash、outputPreference、targetArchitecture/catalogueVersion、outputSettingsHash；输出附 analysisToolUsage 和 skillDependencies，两者不能互相替代。

inputKey 必须是规范化内容哈希，覆盖所有影响结果的版本，不仅是文件 mtime。原始文件指纹可以作变更探测，不能替代内容身份。点击确认生成时采用期望版本比较+会话锁；并发修改导致冲突就要求更新，不能先批准旧版再用新版材料生成。

结果 schema 之外的 Agent 自述不作为产物。validateCandidate 继续校验引用、事实分类、时间范围与输出能力；current 只进入运行时查询，历史邮箱地址不自动成为永久收件人。未知答案和证据缺失落 remainingGaps。带缺口的确认须在结果页明确提示，生成、预览、文件均保留待补充项。

### 5.8 受控 MCP 网关与能力匹配

能力有四个不同集合：全局发现的候选 → 本应用已开启 → 本次已核验允许 → 本次实际调用。左侧只展示本次真实使用的工具/材料，尚未成功的调用注明失败/未读取；发现但未调用的工具不列为已使用。Skill 实际注入也留 usage 记录，不能把全部已开启 Skill 都报为使用。

首期在应用侧建立 **McpEvidenceGateway**，复用全局选择和快照引用，不另建与 catalogue 平行的连接注册体系。Claude 只见网关本轮提供的、已核验的具体工具声明（稳定 toolRef、schemaHash、用途），不是能任意指定 server/方法的透传入口。

每次执行依次核验：run/attempt 仍活动 → 选中配置修订有效 → toolRef/schema 哈希匹配 → 支持的协议与认证/业务账号 → 工具只读适配 → 对象/时间/字段范围 → 参数 schema → 剩余预算。全部通过才派发，MCP 返回也要校验 isError、结构和业务关联，不能把 HTTP 成功或 JSON-RPC 成功当证据成立。

**只读不能靠工具名称、描述、readOnlyHint 或模型判断放行。** 首期只接入经过审核的连接器/工具适配规则；规则映射具体工具、允许参数、业务对象和可验证返回。未知工具默认为不可自动调用。没有可核验适配时显示“暂不能自动补充”，继续原始材料分析或人工补充，不扩大权限。泛型工具若包含写入分支、可执行查询语句或不受限动作，不能整体列为只读。

邮箱适配优先用录制中的 messageId；否则按账号、主题、联系人和窄时间范围定位。多候选或零匹配只保留待确认，不选最近一封猜测。读取操作不得标记已读或触发草稿/发送等业务写入；服务若无法保证则不自动调用。只读范围不足需要用户决策时询问业务对象，技术认证问题放修复入口，不混入问卷。

stdio 的 list 工具实现扩展为受控 MCP 会话：initialize/分页 list、带唯一请求 ID 的 tools/call、超时、断开和取消、待完成请求映射及进程回收；独占进程的任务取消须回收其子进程，不能误杀其他会话。HTTP/Streamable HTTP/SSE、OAuth 与凭据复用需要独立适配验证，未支持就明确不可自动连接。Claude 登录不等于邮箱登录，枚举成功不等于业务授权成功；凭据不复制到导出或送模型。

开启连接可能启动本地进程或触发认证，不能宣称完全无副作用；任务侧只保证经过适配的业务读取，不作业务数据写入。全局配置与凭据是来源，不等于本应用自动拥有所有权限。权限撤销立即停止后续调用，配置变更只影响后续运行。

### 5.9 简化版进度同步：Claude 提交 JSON，应用更新时间轴

**首期继续使用 Claude CLI，不引入 pi 或另一套 Agent 引擎。** 动态分析步骤由 Claude 决定，并按提示词约定提交进度 JSON，应用校验、保存并推送到页面。无需预设“读取→匹配→查询→整理”的固定步骤树，也不要求为每种业务动作增加前端事件模板。

进度 JSON 用于展示模型报告的工作，工具执行记录、证据、工作流状态及用户确认仍由应用独立维护。`completed` 表示 Claude 报告这一项完成，不代表分析通过校验、用户批准或 Skill 已保存。模型报告和真实调用不一致时以执行记录为准，不把错误摘要当成已验证事实。

#### 5.9.1 首期传输方式：复用应用工具协议

在深度分析阶段增加一个**非终止应用工具 `report_progress`**，参数就是进度 JSON。提示词要求 Claude 在开始一项工作、完成一项工作、遇到阻塞时提交；应用 handler 负责同步界面并返回简短确认，之后 Claude 继续任务。它不是 MCP 工具，不需要开放原生工具、磁盘写入或修改 Claude 全局配置。

这是“Claude 生成 JSON → 应用读取”的受控传输方式，复用现有 localRequest 的 content/toolCalls envelope。最终分析仍由 `submit_deep_analysis` 等独立终止工具提交，不能把进度 JSON 和最终结构化结果混成一份。`report_progress` 不放入 terminalTools，也不得被提交识别正则判成完成。

```json
{
  "schemaVersion": 1,
  "stepId": "mail-details",
  "status": "running",
  "title": "通过邮箱补充细节",
  "summary": "查找与本次录制相关的已发送邮件。",
  "toolRefs": ["mail.search"],
  "error": null
}
```

同一 stepId 后续更新为：

```json
{
  "schemaVersion": 1,
  "stepId": "mail-details",
  "status": "completed",
  "title": "已补充邮件细节",
  "summary": "核对了主题、收件人和附件名称。",
  "toolRefs": ["mail.search"],
  "error": null
}
```

异常示例：

```json
{
  "schemaVersion": 1,
  "stepId": "order-details",
  "status": "blocked",
  "title": "订单信息暂时无法补充",
  "summary": "可先使用录制材料继续分析。",
  "toolRefs": [],
  "error": {"code": "source-unavailable", "message": "订单系统连接超时", "retryable": true}
}
```

使用 Zod 定义枚举与字段约束：status 为 `running | completed | blocked | failed | skipped`；stepId 有界且在同一运行内稳定；title ≤ 40 字，summary ≤ 160 字；toolRefs 必须来自本轮提供的清单；error 必须为 null 或有界结构。blocked/failed 需要简短原因；模型自报 retryable 仅作建议，重试必须通过应用权限、幂等性和预算检查。

**不让 Claude 写运行身份和时间。** handler 根据当前请求附加 sessionId/runId/attemptId、应用生成 eventId、接收时间 receivedAt、单调 sequence、source=`agent-report`。页面显示相对耗时基于应用计时；不采信模型生成的时间戳。stepId 只在 run 内有意义，跨 run 不合并。

#### 5.9.2 更新规则与运行边界

| 收到的数据 | 软件行为 |
| --- | --- |
| 新 stepId | 右侧追加一个时间轴节点，顺序取首次收到顺序 |
| 同一 stepId 新状态 | 更新原节点，保留事件历史，不重复追加工具卡片 |
| 模型声称用到工具 | 先与应用调用记录核对；仅声明不能把工具列为实际使用 |
| 应用已实际派发工具 | 左侧按稳定 toolRef/provider 身份去重汇总；无需等待模型补报 |
| 模型报告异常 | 节点显示简短原因，不自动把整个任务标为失败，不自动重试 |
| 实际工具或进程失败 | 应用可直接修正节点/显示异常，即使 Claude 没有输出 JSON |
| 模型报告整体完成 | 不能触发阶段跳转；只有合法最终分析/问题提交保存后才能切页 |

一次工具调用允许多个进度更新时以业务 stepId 关联；实际 callId 和证据引用由应用记录，不让模型自报替代。仅有模型报告的动作可显示，但不得显示“已验证”标识；涉及具体邮件事实的摘要必须有有效证据才能进入分析结论。异常信息、标题、摘要入库前均脱敏并按纯文本显示，禁止 HTML、链接指令和密钥泄漏。

每个新尝试以应用检查点中的步骤为上下文，Claude 保留已有 stepId；完成步骤不倒退成 running。需要重做时建立新的 stepId 并关联 supersedesStepId（可选），旧记录保留。应用工具调用重试用 callId 去重，重复的进度 tool call 不重复写入；同一步的后续合法更新仍被接受。未知/非法字段返回简短协议错误，保留上一有效进度，不覆盖有效分析结果；不无限要求模型重报。

handler 先保存安全事件，再更新当前视图并通过 IPC 推送；前端打开先读取快照，订阅 lastSequence 后的新事件。断线补拉去重、重启重放已提交范围。取消后拒收迟到报告及最终结果；旧 run 的进度不能覆盖新 run。

时间轴上翻不抢滚动，有新进展时给轻提示；工具保持左侧去重列表，不展示每个工具的过程卡片。JSONL 是应用持久化格式，不要求 Claude 取得任意文件写权限。

#### 5.9.3 实时能力、调用成本与第一轮试用

当前 localRequest 每轮等待 CLI 输出完毕后才解析 content/toolCalls，因此首期 `report_progress` 是**模型轮次边界的增量更新，不保证单次长推断中的实时进度**。无新 JSON 时保持最近状态和真实耗时，不能按定时器生成假步骤。每次单独报告可能增加模型往返，计入模型轮数/时间预算；不计为业务 MCP 调用。允许与独立工具请求同批返回，但只有报告 handler 实际执行后才显示，不能预先发布同批未执行动作的成功状态。工具循环只在安全边界允许批处理，遇到取消或终止就停止后续调用。

第一轮先验证“工具调用 JSON 能否及时返回、是否出现密集空报告、长推断的等待是否可接受”。无需先重写完整 CLI 流式事件系统，也不要求每个模型 token 都解析成业务状态。模型漏报不影响最终结果校验，应用可以补运行开始、真实调用失败、最终结果已保存等最小状态。

若需要在一轮长推断中更及时更新，再实测目标 Claude CLI 的 stream-json 协议：先解析外层事件，再在受支持的文本块中缓冲完整 JSON 行，不能直接对整个 stdout 按业务 JSON 解析。截断半行不提交，输入有长度/数量限额，JSON 行不含 Markdown 围栏。未经验证不得承诺立即 flush；最终 structured_output 仍走独立 schema。不能为让 Claude 写 progress.json 而解除当前文件/原生工具限制。首期不走文件轮询路线。

提示词新增约定：

> 开始、完成一项重要工作或遇到阻塞时，调用 report_progress，提交简短 JSON。步骤由实际任务决定，stepId 在本次任务中稳定。只报告你已经开始或确已完成的工作，不预报成功、不输出思维链、不泄露敏感内容；不要为凑进度频繁调用。工具执行失败如实报告，未知信息保持未知。进度 completed 不代表用户确认。需要业务回答时提交问题；分析完成时提交完整分析结果，不以进度报告代替最终提交。

### 5.10 提示词组织、回答续跑与上下文预算

各阶段使用独立模板版本，固定系统约束与不可信业务材料分层。现有 `CLARIFICATION_INSTRUCTIONS`、`RECORDING_SEMANTICS` 复用，删除“必须先回答所有问题才能查询”的旧顺序约束。

| 输入层 | 内容与用途 |
| --- | --- |
| 应用系统约束 | 当前阶段、允许工具、结果 schema、证据/时间规则、录制标注语义（红框为应用强调，并非用户操作/业务含义）、不能自行批准结果 |
| 用户已确认意图 | 产出偏好与原话；用来理解目标，不证明操作发生，不增加业务权限 |
| 当前状态 | run/attempt、版本、预算、未决问题、已有结果；由应用生成，不接受模型改写 |
| 已确认原始记录 | Analysis 步骤及来源索引；按需读取截图、转写和浏览器事件，材料分页有界 |
| 已选 Skill 参考 | 仅使用本次配置版本允许且完整性核验的文本；不能改变系统限制或执行脚本 |
| 已验证补证 | 来源、时间、脱敏摘要、关联结论与冲突；邮件/网页中的指令都是外部数据 |
| 用户回答和补充 | 问题 ID、选项/其他原话、未知状态、适用范围与材料来源；与模型推断明确分开 |
| 本轮要求 | 原始阶段只忠实记录；深度阶段补证并提交业务问题或完整分析；生成阶段只编译已确认分析及输出目标 |

深度分析任务要求的示例：

> 围绕用户意图解释已确认操作。先利用现有证据，必要时请求允许的只读工具；无匹配能力时保留缺口。只对影响任务的业务规则提问，不问配置、工具权限或红框含义。已有事实能回答的问题不再问用户。业务问题采用有依据的选项及其他输入，不能预选。信息足够时提交完整流程、规则、变化内容、例外、缺口和来源，不生成 SKILL.md，不宣称用户已经确认，也不执行流程中的业务动作。

生成任务要求的示例：

> 使用指定确认记录对应的分析生成 Skill/SOP。固定规则必须有明确适用范围和证据，当前数据转为运行时查询，示例邮件地址和订单号不得写成永久默认。保留已确认的缺口，声明使用依赖。不得重新查询业务系统、改变用户规则、补造批准或声称已验证运行。遇到影响结果的新矛盾，返回 analysis-conflict 而不是私自修正后生成。

模型终止请求按阶段显式注册，如 `submit_business_questions`、`submit_deep_analysis`，并复用已有生成阶段的 plan/skill 提交工具。应用验证成功才完成本轮；不得仅靠函数名正则或 JSON 内“完成”字样判断。新增终止工具接入 SessionConfig.terminalTools 并验证提交成功，不能让普通工具调用误终止。

用户答题期间不保留运行中 CLI 进程。应用先提交问题/检查点并释放运行锁，保持会话工作流等待状态；提交时保存回答修订，再锁定同一会话、核验版本和权限，启动新 attempt。此前确定的事实和仍有效证据可复用，不重复查邮件；历史性结论与易变当前状态分别制定有效期。没有进展就接受未知并产出带缺口结果，不无限追问。

上下文超限时按证据引用提取有关片段与已验证摘要，摘要留来源，不把全部视频/邮箱一次塞入。原始图片使用现有附件通道，不让 Agent 任意访问磁盘；材料工具只接受会话内受控引用并检查路径、大小与隐私状态。截断/坏 JSON 可在剩余预算内作有限结构修复，不能循环到成功或接受半份结果。Claude/API 都按同一 schema 校验，但 API 不自动继承本地 MCP/Skills。

## 6. 证据、文件与隐私契约

### 6.1 会话文件与生成产物共存

以下按用途列出现有路径；不同录制方式或版本可能缺少部分文件，不要求每个会话全部存在：

```text
session/
  session.json / events.jsonl
  video.json                     # 视频元数据，实际视频文件由其引用
  video-frames.json / video-frames/  # 当前录制截图索引及图片
  frames/frames.json              # 视频抽帧派生索引；同目录存对应图片
  audio.json                     # 音频来源等元数据
  narration.json                 # 语音转写及分段
  bundle.json                    # 现有会话材料 bundle
  analysis.json                  # 现有分析成果
  skill.json                     # 现有 BuiltSkill 成果
  built-automation.json          # 现有自动化成果，本轮不改
  enhancement/
    preparation/<preparation-id>/
      draft.json                 # 模型缺口、问题、回答草稿与补充材料引用
      revisions/<revision>.json  # 用户提交后不可变任务包修订
    <run-id>/
      manifest.json              # 输入版本、处理后端、环境引用、scope、预算、状态
      task-package.json          # 启动时冻结的统一材料包；续跑引用修订快照
      capability-manifest.json   # 脱敏快照，带 snapshotId
      evidence.jsonl             # 增量证据；入库前隐私处理
      claims.json / gaps.json
      questions.json             # 问题、回答及适用范围
      events.jsonl               # 脱敏阶段与调用摘要
      checkpoint.json            # 已提交序号、材料版本、预算消耗
      revisions/<revision>/      # 不可变的 claims/gaps/questions 等检查点快照
      result.json                # 增强候选修订，尚未获批
```

不能简单将 narration.json 改名为 audio.json：`electron/narration/manager.ts` 读取 audio.json，却把转写写入 `common/narration.ts` 定义的 narration.json。`electron/video/recorder.ts` 与 capture-timeline 仍使用 video-frames.json；`electron/frames/extractor.ts` 另写 frames/frames.json。两类索引需按来源归一化，不能把其中一类当作不存在。

`result.json` 保存候选修订和来源，不替代 analysis.json 或 skill.json。用户确认后生成获批分析修订，再交给 SkillPlan → BuiltSkill 流程；审核记录关联输入、增强运行和计划版本。确认新成果前保留上一有效版本，built-automation.json 不参与本轮提升或覆盖。

### 6.2 核心数据

| 对象 | 必要字段 |
| --- | --- |
| Evidence | ID、sourceType、sourceRef、录制相对时间、资源事件/更新时间、queriedAt、摘要、脱敏状态、内容摘要哈希 |
| Claim | ID、结论、事实分类、支持/冲突证据 ID、temporalScope、适用范围、待确认原因、审核状态 |
| Gap | ID、关联步骤、问题、重要性、是否阻塞确认、查询策略、解决状态与证据 |
| EnhancementTaskPackage | preparationId、revision、输入修订、缺口与问题、回答及确认状态、补充材料、读取范围 |
| EnhancementResult | schemaVersion、runId、任务包修订、输入分析修订、步骤差异、Claims、用户规则、剩余缺口、泛化建议 |

Claim 的时间类型落为 `z.enum(["at-recording", "current", "invariant"])`，不能只写在提示词里。应用在生成计划时校验：current 不进入固定规则，at-recording 不成为永久业务默认；invariant 还必须具备有效证据、明确范围与审核记录。

证据 ID 跨修订稳定，引用指向受控材料而非任意磁盘路径。保留各源 epoch、时区及其会话偏移；视频启动时间不能直接当作会话启动时间。查询、截图与事件按实际时间基准对齐。来源缺失、未启用、空结果、采集失败分别记录。

重新分析、替换转写或改动关键证据后，旧增强与 Skill 依赖标记过期；可以复用仍有效的证据，但受影响的结论和计划需重新审核。

### 6.3 增量隐私处理与外部 Agent 边界

复用 `electron/sensitive/secrets.ts` 的 `scanSecrets(text)`、scanner 中的结构化 PII 识别和 `buildRedactor(values)`。`scanSession(sessionId)` 是会话级扫描，不能直接承担新增 evidence 流式入库；P1 提取共享增量入口，每条外部证据在写入 evidence.jsonl、事件日志或提供给模型之前完成扫描和遮蔽。

文本脱敏不等于图片脱敏。截图沿用经过核验的图像处理流程；无法处理的材料不能悄悄以原图进入外部证据包。需要核对附件时可保留受控本地原件的哈希/引用，默认只提供必要脱敏内容。

外部网页、邮件和附件内容仅作为证据，不能改变任务、权限或输出策略。被用户选择并复核的能力配置及 Skill 指令是控制输入，两者不能混为同一个权限层。

**外部 Agent 直接访问 MCP 时，应用未必能拦截返回内容。** 只有经过可强制执行的网关，才能承诺“转给模型前完成应用脱敏与范围检查”。仅能看见 Agent 日志时不作此承诺；第一阶段自动模式必须核验这些边界，否则降级为用户明确知情的人工处理/导入，说明 Agent 自身数据处理由其配置决定。

## 7. 静态 catalogue 与专用环境动态能力的对账

### 7.1 各层权威性

| 层 | 负责什么 | 不证明什么 |
| --- | --- | --- |
| Agent 后端注册表 | 如何启动/取消 Claude Code 等处理后端 | 不决定生成文件的目标格式 |
| ArchitectureDefinition | 目标平台、构建类型、install/export placement | 不证明某台机器上工具已安装或已认证 |
| 静态版本化 catalogue | 目标 Skill 格式、平台能力和约束，进入 builder system prompt | 不证明项目的实时连接及账号访问权限 |
| CapabilityManifest | 某 Agent 版本、某项目、某检查时点实际发现的 MCP/Skills 与 schema | 不改变目标平台约束，不等于任务授权 |
| 任务 scope 与绑定 | 本次补证允许读取什么；计划步骤依赖哪个实际能力 | 不授予未来写操作权限，不是新的 catalogue |

这些机制分层并存，不互相替代。生成时取“目标允许的能力、项目已核验能力、所需用途许可”的兼容范围；动态发现不能覆盖静态 catalogue 的禁止项。输出依赖可以描述未来写工具，但本次补证的只读 scope 不因此扩大。

所谓“环境绑定层”是步骤对具体能力快照的引用与参数映射，不是静态 catalogue 的动态替代品。工具引用带提供者/工作环境命名空间、schemaHash 和快照 ID，避免不同 MCP 的同名工具混淆。能力描述中不存凭据，账号只存引用。

现有 PlanStep 只有工具引用和步骤文本，没有结构化参数映射。首期在生成运行的版本化旁路材料中保存 `planRevision + stepIndex + toolRef + snapshotId + schemaHash + parameterSources`，供审核与校验使用；计划改动后重建映射，不能沿用旧步骤序号。这是 SkillPlan 的依赖元数据，不是新的动作计划或可直接执行的契约。没有结构化映射的部分只能标记人工审核，不能声称参数兼容已自动验证。

### 7.2 Claude Code 后端与输出目标分别处理

**接入 Claude Code 作为生成后端，本身不要求新增 architecture。** 它可以在现有目标约束内生成通用 Skill。

但当前 `agent-skill-catalogue.ts` 明确要求可移植的文件、CLI、HTTP 能力，禁止假定专属集成及浏览器自动化。不能把 Claude 项目 MCP 列表直接追加到这个 catalogue 后宣称兼容。

本方案采用两个明确的输出选择：

- **通用 Skill**：沿用 `agent-skill`，遵守其可移植约束；补证时可使用项目 MCP，但生成内容不能因此带入不允许的依赖。无法等价转换时标记缺口，不能编造 HTTP 接口。
- **Claude Code 项目 Skill**：拟在现有 architecture 注册机制新增独立 `claude-code` 输出目标和版本化 catalogue，第一阶段只支持 `kind: skill`、`placements: ["export"]`。按已核验的 Claude Skill 格式生成，明确项目依赖与配置前提；不自动安装、不涉及 Scout 交付。

两处可以使用相同文字 ID，但分别属于后端注册表与输出目标注册表，不由一个字段控制。专用环境及能力启用范围也不自动改变用户选择的输出目标。

### 7.3 复用既有校验，增加必要的项目校验

现有 catalogue-provider / catalogue-registry 继续负责目标版本化内容；现有 TARGET_PLACEMENTS 和 skill-placement 继续决定支持的交付方式。本期不重建另一套目录安装规则。

`electron/skillbuilder/plan-tools.ts` 当前主要校验 Scout 的 `SCOUT_PLAN_TOOL_IDS` 及权限模式，不能称为已经覆盖动态 Claude 工具。新增项目目标需增加相应校验：工具引用存在、schema 与计划参数兼容、来源/快照匹配、禁止依赖冲突或未核验能力；计划与生成正文依赖一致。原有目标校验保持原义，不拿 Scout 工具白名单校验 Claude MCP。

依赖不能完全核验时仍可导出标注限制的草稿，不能显示“依赖已核验”。如果首期尚未完成项目目标，只能产出符合现有 catalogue 的通用 Skill，不能用通用标签隐藏项目依赖。

## 8. 从增强结果到 Skill

继续使用现有契约，不新增 ExecutionStep、execution.json 或另一套 plan：

```text
录制证据 → 基础 Analysis → 用户确认原始素材
                              ↓
       深度分析（补证、必要业务问题、回答续跑）
                              ↓
       DeepAnalysisResult（完整、可编辑、待确认）
                              ↓ 用户确认 + 应用校验
       DeepAnalysisConfirmation（固定结果与输入版本）
                              ↓
       SkillPlan（内部泛化计划，不增加必经审核页）
                              ↓
       SkillSubmission → BuiltSkill → 可读预览 → 确认保存/导出
```

深度分析作为带版本的 builder 输入/旁路材料，不通过未定义字段直接塞入旧 Analysis。保留原始 Analysis，DeepAnalysisResult 单独持久化；生成绑定确认记录，不依赖可覆盖的当前结果文件。现有增强 Evidence/Claim、SkillPlan/BuiltSkill 继续复用，必要扩展统一版本化。旧录制仍可查看旧成果，但重新生成按 §9.2 补新确认。草稿和剩余缺口在结构化产物、预览和导出中一致保存，不能只存在于 UI 文案。

### 8.1 泛化与参数来源

| 类别 | 示例 | 写入原则 |
| --- | --- | --- |
| 每次输入 | 订单号、报表日期、待处理文件 | 必填/可选及校验规则明确 |
| 用户配置 | 发件账号引用、输出目录、模板 | 有来源和适用范围，不把演示值当作通用默认 |
| 固定规则 | 只处理已支付订单 | 仅来自审核通过的 invariant 结论 |
| 运行时查询 | 客户邮箱、最新附件、待办集合 | 描述查询及筛选规则，不固化当前值 |
| 示例数据 | 演示订单、录制时的邮箱 | 明确仅作示例，脱敏 |
| 凭据引用 | 环境中的连接账号 | 由目标环境解析，不写密钥或令牌 |

不能从一次演示推导“总选第一条”“处理第 2–100 行”，也不能反向无依据推导“遍历全部”。集合范围和终止条件需要证据或用户确认。现有通用 catalogue 的泛化提示不能代替这一确认。

### 8.2 Skill 内容与审核

Skill 至少说明触发场景、输入及来源、适用范围、能力依赖、前置条件、步骤、分支、完成标准和异常处理。录制中的界面动作转换成任务语义，例如“按订单号读取报价附件”，而不是机械照抄点击坐标。

用户在深度分析结果页确认完整流程和规则，生成后检查最终文件；不增加独立计划审核页或逐事实勾选页。关键差异及“原操作→补充依据→以后规则”按需展开，默认以简洁正文呈现。SkillPlan 为内部校验产物，不另设用户必经阶段；未解决问题保留为待补充。

应用校验 schema、引用完整性、变量来源、时间适用性、目标能力约束、正文与计划一致性，以及凭据泄漏。生成结果不能自行新增未经审核的客户范围或业务规则。

导出以 SKILL.md 为主，可附脱敏样例、依赖说明和内容审核报告。报告说明哪些是历史事实、哪些是用户规则、哪些能力仅发现或已核验；本期没有任务运行报告，不标记“执行验证通过”。

现有 `AutomationPlan` 的计划与触发器、Scout 导入路径保持独立且不改动。本期既不吸收它，也不决定未来 Replay 与自动化是否统一；当前只有既有 SkillPlan 作为 Skill 生成计划，避免提前出现第三套执行契约。

## 9. 检查点、并发与运行恢复

导航查看与回答草稿不启动新任务，返回页面读取已保存状态。修改分析或已提交回答时生成新修订，依赖它的增强/计划/Skill 标记需更新，保留上一有效版本。运行中回答先写到下一版草稿；显式取消当前运行并提交新版，不能让旧任务读取可变答案。新增冲突的追加回答走已暂停运行的检查点与新版任务包流程。

同一会话的分析、增强和生成写入串行化，增强至少持有会话级锁，避免输入修订与候选结果相互覆盖。跨会话允许有限并发，受应用进程数与后端能力约束；同一项目不默认并发启动多个本地 Agent，适配验证前使用环境级锁。

初判/增强每次运行固定录制与分析修订、后端、Agent 版本、目录引用和能力快照；目标 catalogue 在用户选择生成目标后由生成运行固定，不能在增强之前要求选定。补充回答只在检查点新增任务包修订与处理尝试，不改写既有尝试；重新分析或切换读取范围/环境要求新建运行。默认配置变化仅影响新任务。依赖变化、权限失效和输入冲突会显式暂停或要求重建候选结果。

检查点提交顺序是：校验证据及隐私处理 → 保存不可变修订快照及证据 → 原子推进 checkpoint。checkpoint 引用具体修订与证据已提交序号；根目录 claims/gaps/questions 文件可作当前视图，恢复不能依赖被覆盖的可变文件。JSONL 记录带序号，重启只读取已提交范围；尾部不完整记录忽略或隔离。文件更新失败不能显示为进度已保存。

| 情况 | 本期恢复规则 |
| --- | --- |
| 预算耗尽、用户暂停 | 保存已提交证据、问题与预算状态，用户明确继续后重建上下文 |
| 查询超时 | 仅对已核验无业务副作用的查询有限重试；保留未知结果与调用记录 |
| Agent 崩溃或应用退出 | 孤儿运行标记 interrupted；从应用检查点启动新的处理尝试，保留同一运行的尝试记录 |
| 用户取消 | 持久化取消状态，停止调度并结束受管理的任务进程；拒收迟到输出；已返回证据可保留但不自动批准 |
| 非法输出、截断、引用不存在 | 保留错误和最近有效检查点，不提升为获批分析或 Skill |
| 用户选择另一后端/项目 | 创建新的 run，显式引用可复用的脱敏证据；不静默转发材料 |

恢复的是已保存的任务材料，不能承诺恢复 Agent 的完整内部推理。原生会话恢复可以作为优化，不能代替应用检查点。API 后端当前的整轮回滚与统一检查点存在差距，P1 改造完成后才提供对应恢复入口。

录制期间禁用应用内自动更新安装及自动重启；手动更新提示先结束录制。分析/增强在接受证据、回答和阶段结果后落检查点，更新先暂停任务、保存检查点再退出。崩溃模拟后能重载已提交材料并继续，是验收要求；本轮只改文档，不重启应用。

### 9.1 导航与生成状态门槛

| 状态 | 允许操作 | 必须阻止 |
| --- | --- | --- |
| 原始素材未确认 | 查看/修改记录、显式重新整理 | 越过确认启动深度分析 |
| 深度分析运行中 | 查看时间轴/工具、返回查看、取消 | 修改当前 attempt 输入；页面回看重启查询 |
| 等待业务回答 | 保存草稿、其他输入、未知、提交继续 | 自动预选、把提交答案当批准完整结果 |
| 分析结果待确认 | 编辑、补充重做、确认并生成 | 无确认或过期确认生成 |
| 带缺口结果 | 明确确认草稿、保留未决项 | 把未知提升为固定规则 |
| 生成/预览 | 取消、修改、显式重新生成、确认保存 | 业务工具调用、声称已经执行 |
| 上游变化 | 保留旧结果并提示更新 | 使用旧批准覆盖新输入 |

阶段导航只读取已保存状态。深度分析仅在“确认并深度分析”、明确重做或提交回答时启动；页面挂载和设置修复不自动重试。自动切换问卷/结果来自合法运行完成事件，不由路由副作用触发。

同一会话的写任务串行；等待答案不长期持锁，所有提交带期望版本比较。回看不取消正在运行任务，取消是独立动作。修改进行中的输入要先取消/暂停，保留旧尝试并建立新版，迟到事件拒收。

### 9.2 修订与产物共存

确认结果不可变保存为 `enhancement/<run-id>/result-revisions/<revision>.json`，确认记录单独保存 `confirmations/<id>.json`；result.json 可保留为兼容当前候选视图。运行清单和检查点引用精确修订，不依赖被覆盖文件。原始确认、意图修订及问题/回答修订保留来源和历史。现有 analysis.json 仍是原始分析，深度分析不直接覆盖它。

skill.json、bundle.json 及已有导出结构继续兼容，新增元数据关联 confirmationRef/resultHash/outputSettingsHash。重新生成保留上一有效 BuiltSkill；仅当新成果验证并原子提交后更新当前指针。旧自动化不参与本链路。

旧录制无意图/确认时允许补填并走新三阶段；旧 Skill 保留查看导出能力，但“重新生成”必须先补当前确认，不从 legacy generationContext(null) 路径绕过新门槛。仅改变输出格式不重做已确认分析，重新分析才使其下游失效。

## 10. 示例：从报价单录制到 Skill

1. 原始素材确认展示下载报价单、填写邮件、点击发送；送达状态未知。用户纠错后确认。
2. 深度分析结合“发送前先确认”的用户意图与已选能力，匹配邮箱工具；左侧列使用工具，右侧依次追加已整理记录、开始查询、核对邮件细节等真实事件。
3. 邮件补证确认本次主题/附件，但不能得出以后都发给同一地址。只问“以后如何确定联系人”等业务规则。
4. 用户提交答案，应用保存版本并重建 Claude 上下文，完善分析。展示完整流程、联系人规则、每次订单输入、异常处理与补充来源。
5. 用户修改并确认分析，应用固定 confirmationRef 后生成 SkillPlan/BuiltSkill；不再查询邮箱，不发信。
6. 预览分别说明分析时使用的工具、使用 Skill 所需依赖；用户修改并保存。不宣称已经运行验证。

## 11. 分阶段实施与验收

| 阶段 | 交付范围 | 验收门槛 |
| --- | --- | --- |
| P0：证据与契约 | 文件来源归一化、时间基准、Evidence/Claim/Gap schema、runId 生命周期、输入修订与锁 | 旧会话可读；时间可对齐；缺失不当作零事件；current 不会被提升为固定规则；首事件前可取消 |
| P1：处理后端与可靠保存 | Claude Code 版本接口验证、自动环境准备、全局发现、启用配置与加载隔离、结构化输出适配、API 兼容、增量隐私入口与检查点；首页/doctor/错误兜底调整 | 正确专用版本启动；未启用能力实际不加载；配置与连接状态不混淆；无静默回退；API/Agent 同样校验结果；取消/预算耗尽/崩溃后保留已提交材料；隔离不足走人工路径 |
| P2：补证到 Skill 闭环 | 原始确认→深度分析→生成、受控只读 MCP 网关、问题续跑、完整深度结果及批准、工具汇总/时间轴、泛化与生成门槛 | 导航不隐式提交；可先补证再问规则；回答后先完善分析再确认；改答案使依赖成果过期；邮件补证不误选对象、不发信；无 MCP 仍能生成草稿；项目专用依赖不混入通用目标；沿用 SkillPlan/BuiltSkill；版本可追溯 |
| P3：内容质量试点 | 多案例对照、独立标注、错漏修订、依赖变化回归 | 满足第 13 节的样本、判据与质量门槛，不以实际任务执行成功率替代生成质量 |

P1 可先实现证据包导出/候选导入，再验证自动 CLI 适配。项目专用输出目标是 P2 的显式工作；未完成时仅开放符合既有约束的通用目标。

本期不列 Computer Use、Replay 或 Scout 交付阶段，不为其预建执行器与执行数据模型。阶段用于依赖规划，工期在接口验证和试点后估算。

## 12. 拟修改的代码边界

这是后续实施落点，本轮没有修改源代码：

| 位置 | 拟承担职责 |
| --- | --- |
| `common/enhancement.ts`（已有，扩展） | 扩展原始确认、完整深度结果/批准记录、修订身份与事件 schema；复用 Evidence/Claim/Gap |
| `common/agents.ts`（已有，扩展） | 后端注册、工作环境、全局默认、能力快照与任务 scope schema |
| `electron/agents/`（已有，扩展） | 本地 Agent 与 API 适配，能力检查、版本协议、进程生命周期 |
| `electron/enrichment/`（已有，扩展） | 缺口协调、用户问题、结果验证、增量检查点、会话锁 |
| `electron/sensitive/` | 提取现有文本扫描/遮蔽的增量入口，接入证据与日志 |
| `electron/ai/client.ts` 及阶段调用方 | 保留已有调用约束，接入应用检查点与候选提交逻辑，不依赖会话内存恢复 |
| `common/architecture-registry.ts` 与 `electron/architectures/` | 复用注册与 catalogue；核验已有 Claude 输出目标及版本化约束，不将处理后端等同输出目标 |
| `common/skill.ts` 与 `electron/skillbuilder/` | 沿用计划/成果契约，增加增强输入、时间规则与目标能力验证 |
| `electron/doctor.ts` 与公共 IPC 类型 | 新增结构化后端/项目状态，兼容原有检查结果 |
| `src/Recorder.tsx`、设置面板、`src/Library.tsx` | 智能处理配置、工作环境、三阶段导航、问卷、深度结果确认、左侧工具与右侧时间轴 |

现有证据读取工具继续扩展按需读取，保留浏览器事件引用校验。不新增与 catalogue 平行的通用 connections 注册中心；本期新增工具网关作为受控证据访问组件接入；进程隔离与业务范围控制分别验证，不能假定一层文件夹就能限制外部 Agent。

旧分析、旧 Skill 与现有 placements 保持可读。增强先保存候选，只有用户批准和校验通过后才能进入生成链路；不改 automationbuilder，不新增 execution/replay 模块。

### 12.1 按功能点实施顺序与测试（待实施）

按以下依赖顺序逐项完成、验证并在 `docs/implementation-status.md` 记录；本次方案更新不把任一项标为完成。

| 顺序 | 功能点 | 必须通过的验证 |
| --- | --- | --- |
| T1 | 意图/原始确认、深度结果、批准记录、版本与迁移 schema | 旧录制可读；未确认不能生成；unknown/current/历史值不能成为无依据固定规则；版本冲突拒绝提交 |
| T2 | 固定 Claude 运行配置与模型协议适配 | 真实支持版本下验证文字/图片、结构化结果、坏 JSON、认证失败、取消、隔离；关闭的全局 MCP/Skill/hook 实际不执行；API 不继承本地能力 |
| T3 | MCP 网关、账号/只读范围适配 | 用可观测的测试 server 验证 initialize/list 分页/call、配置哈希、未知工具拒绝、参数越界、超时、取消、认证失效、业务写调用数为 0；未知/不支持协议如实降级 |
| T4 | 深度分析循环、问卷和结果门槛 | 有问题→答案保存→新 attempt→完整结果→用户确认→生成；无问题直接结果；无法补证仍可形成带缺口结果；不重复询问已明确规则 |
| T5 | Claude 进度 JSON 与双栏页面 | report_progress 不终止模型循环；新步骤追加/同 ID 更新；模型声明不冒充实际工具；缺报/坏 JSON/重复/乱序/迟到报告保留有效状态；单轮等待不造假；断线重放去重；上翻不抢滚动 |
| T6 | 生成链路、产物绑定与旧入口迁移 | 沿用 SkillPlan/BuiltSkill；确认版本与结果哈希一致；输出格式只重生成；旧入口无法绕过新确认；分析工具与 Skill 依赖分别显示 |
| T7 | 检查点、崩溃恢复及完整回归 | 在模型返回、工具派发、证据写入、checkpoint、结果批准/生成提交边界注入故障；不丢已确认答案、不重复批准、不虚报业务完成；两种后端均测 |

Claude 协议及权限隔离至少完成 macOS 与 Windows 的真实 CLI 冒烟，不以 mock 通过替代版本兼容证据。测试日志记录 CLI 版本、系统、脱敏事件和具体断言；未经验证的组合列为不支持。当前网关首期若仅支持 stdio，不将远程邮箱连接列为已交付；至少用一个真实、只读适配通过的邮箱连接完成“录制→补证→业务问题→分析确认→Skill”端到端试点。

CI 覆盖 schema/状态机/网关协议与事件恢复，人工验收覆盖业务正确性、时间轴可读性及非技术用户操作成本。每个功能点验证后再进入依赖它的下一项；没有对应落地证据不得在 UI 显示“已完成/已登录/已保存”。方案未要求本轮编码或重启应用。

## 13. 内容质量验证与可判定指标

### 13.1 试点样本与标注

选择 3 个场景，每场景 5 个录制案例/输入，共 15 个；覆盖邮件附件、后台筛选导出、表格整理。输入包含至少一个歧义案例和一个缺失证据案例。对同一任务比较“直接对话生成 Skill”与“录制后增强生成 Skill”，顺序交叉，使用相同任务说明和可用配置，记录准备及纠错时间。

业务人员依据录制、授权范围内的历史数据和用户规则建立标准答案并标注；标注人不能是方案作者，分歧由另一名业务人员复核。关键对象、规则与缺口先定义，不能在看到结果后调整分母。

判据来自可观察材料，例如已发送历史邮件的收件人、时间和附件哈希、导出文件的筛选结果、工作簿中的目标公式；工具返回成功或 Agent 自报完成不能替代这些证据。此处只核对录制事实与生成内容，不新发邮件或执行新业务任务。

### 13.2 第一轮门槛

| 指标 | 统计方式与验收 |
| --- | --- |
| schema 与引用完整性 | 15/15 导出成果通过校验；所有关键结论引用可回溯；无不存在的工具/证据引用 |
| 事实可靠性 | 关键事实错误升级为确定结论的次数为 0；歧义保留为疑问不算伪造 |
| 泛化与时间适用性 | 错把录制值/当前值写成固定规则的次数为 0；未经确认扩大处理集合的次数为 0 |
| 关键缺口解决率 | 已被证据或用户确认解决的关键缺口 / 预标注关键缺口；可读取证据或可询问用户的样本达到 80%，不可解决项明确保留 |
| 能力依赖与隐私 | 项目依赖不进入通用目标；不支持的依赖标记未核验；凭据泄漏与未经许可的业务写操作为 0 |
| 用户成本 | 记录总用时、主动操作时间、关键纠错次数、提问轮次；增强路径中位主动操作时间较对话路径减少至少 20%，关键纠错次数不增加 |

不满足门槛则限制对应场景或继续修订，不以“全部导出成功”宣布质量达标。15 个样本用于首轮产品判断，不能证明通用任务能力。

另外覆盖导航返回不重跑、未分析禁用、原始素材确认前无外部业务查询、深度分析可在范围核验后先查再问、运行中不能确认最终结果、首页与运行异常不混用、输出目标切换只失效生成内容、未知答案不升级、答案变更使成果过期、新冲突追加澄清、显式跳过后按关键缺口决定正式/草稿，草稿标识贯穿计划与导出，以及未安装、需登录、目录失效、取消前首事件、非法输出、API 截断与整轮失败、预算耗尽、孤儿运行、配置刷新失败、MCP 分页、账号不符、多候选、时间冲突及隐私处理失败。检查点故障测试分别覆盖两种后端，不能只测本地 Agent。

只有 API 或 Agent 确实返回计费数据时展示其来源；其余标为未知，主要比较用户时间与调用/时长，不虚构增强费用。

## 14. 延期参考：原 §10 失败恢复规则

本节保留原文，不是本期交付范围、运行入口或验收要求。未来讨论执行时再与既有自动化契约对账；当前不据此开发。

运行前检查 Skill 版本、输入、账号、工具可用性、登录状态、目标资源、必要权限和授权范围。工具结构发生变化时重新绑定，不能静默沿用旧参数。

每一步执行：

1. 读取当前状态，校验前置条件。
2. 绑定本次变量，选择批准的执行方式。
3. 执行动作，保存调用和结果引用。
4. 用业务状态或可观察结果检查后置条件。
5. 成功后记录检查点，再进入下一步。

建议运行状态：`ready → running → awaiting_input / awaiting_authorization → running → succeeded / failed / canceled`。一个动作可处于 `not_started / in_progress / succeeded / failed / unknown`；`unknown` 表示请求已发出但结果未确认。

- 只读查询可以有限重试。
- 写操作先检查目标是否已变更，再决定是否重试。
- 支持幂等键时使用稳定的运行步骤键；不支持时记录业务对象指纹并查询核对。
- 点击成功、HTTP 成功或 Agent 宣称完成都不是充分的业务成功证据。
- 取消后停止排队动作；对已经发出的外部请求查询结果，不能承诺撤销。
- 补偿操作单独定义，并在适用授权范围内执行；不能假设“回退一步”能撤销发信或提交。
- 恢复必须重新检查当前环境，不从历史鼠标位置直接继续。

预览运行分为“只检查计划”“只读预演”“沙箱执行”“真实执行”。名称必须反映实际行为；不能将会创建草稿、写文件或联网查询的模式描述成零副作用。


### 历史实施记录：受控加载与业务澄清（2026-10-15）

以下附录为历史设计/实现边界，不是 v2.0 目标流程。旧任务包页、子阶段、先问后查和无业务 MCP 自动读取描述均由 §3、§5.6–5.10、§9–11 替代。

- 以应用专用工作目录和不可变配置修订替换新任务的项目关联；旧记录不删除。读取用户级 `.claude.json` 的顶层 MCP 与 `.claude/skills`，不读取 `projects`、项目 MCP 或全局 hooks/CLAUDE.md/权限。自定义 CLAUDE_CONFIG_DIR 的覆盖范围显示在遗漏说明。
- 配置版本保存脱敏元数据、来源指纹和所选 Skill 文本资源，最后提交 settings 指针；不复制登录 token 或完整 `.claude` 目录。MCP 凭据在主动连接时从原配置读取并校验来源哈希，不进入导出快照。
- CLI 使用已核验的 safe-mode、空原生工具/空 MCP 配置、禁用原生 Skills；所选 Skill 的说明及文本资源由应用作为参考上下文提供，不执行脚本。暂不支持二进制、符号链接或超过 512 KB / 100 文件的 Skill，界面报告不可加载。资源哈希不匹配时禁止加载。
- MCP 开关只控制应用可检查的连接，业务只读/资源范围仍未核验，业务补证继续采用人工增强路径。没有 MCP 不影响基础分析和 Skill 生成。
- 同步显示新增/变化/移除；新增关闭，变化关闭待复核，移除禁止启用。确认保存后生成新修订；冻结任务不会静默更换配置。当前任务恢复若配置版本改变，要求重新整理确认，不能借用新权限。
- “澄清”仅询问未明确的业务目标、规则、例外、输出要求。红框等录制语义在应用提示词说明；Agent 配置和技术证据缺口不要求用户回答。首次初判与追加澄清共用分类校验。旧包不强行改写，重新整理才应用新规则。


### 问卷澄清交互 v7（设计补充，待实施）

澄清页面按“问题 1、问题 2…”组织；以有业务依据的单选项为主，提供“其他”并在选中时展开输入框。没有可靠选项时允许直接自行填写，不为形式虚构答案；不确定/暂不回答分开保存并保留缺口。回答数量仅统计选择或非空自定义文本，选项不自动预选，提交前仍为草稿。适用范围按需补充，补充材料末尾折叠。

顶部移除大型环境卡和长说明，仅保留一行本地 Agent/专用环境状态与“更改设置”入口；异常时展开原因。子导航用紧凑文字与下划线，问题区优先占据首屏。任务包页沿用同样的轻量顶部，回显业务回答后统一确认。本次只调整设计稿，不据此宣称应用已实现问卷。

- 交互命名更新：顶部第二阶段显示“2 澄清和补充”，取代“2 增强”；待准备、待澄清等状态保持独立。此处为设计更新。


### 澄清整理进度 v8（设计更新，待实施）

首次进入“澄清和补充”且没有匹配当前分析修订的有效问题时，自动启动一次初判；页面往返不重复请求。同会话请求去重、持久化阶段/开始时间；分析修订变更提示更新并保留已有回答供复核。配置暂不可用时仅检查环境，修复后重新校验并提供继续入口，避免配置变更意外调用模型。未完成输入或用户取消后不因重入页面自动重复启动。

显示准备环境→读取已有分析与补充→模型整理问题→结果校验与问卷。只有应用真实观测到的状态才更新，模型单次请求期间不伪造更细进度；显示耗时、后端、取消及失败重试。当前初判主要读取前序分析结果而非原始视频；原始材料理解在分析阶段完成。默认优先 Claude Agent，缺少安装时或用户主动选择才使用 API。无业务问题直接进入“确认补充内容”，不为了流程凑问题。


### 录制意图 v9（设计补充，待实施）

录制前必须提供目标确认入口，回答“想沉淀什么、要完成什么任务、希望达到什么效果”。产出偏好为 SOP / Skill / 其他或暂不确定，不等同于技术 architecture 选择；选择 SOP 不代表本轮已交付独立 SOP 导出器。至少提供有效目标说明，允许预期效果暂不明确。不用固定选项替用户决定目标。确认后才调用原有录制启动流程，权限失败保留目标，不重填。

提供文字和独立目标语音两种输入。点击才获取麦克风，目标语音不启动屏幕录制；停止后本地转写，用户核对、编辑并确认采用。转写只是草稿，不允许自动归纳结果冒充用户原话；采用时不覆盖已有字段，用户选择填入任务或效果。不可用时可以继续文字输入。取消/采用后清理临时音频，默认仅保存确认文字；若未来保留音频，需明示用途及生命周期。

建议新增独立 RecordingIntent 记录（设计 schema，尚未实现）：id / revision / outputPreference(sop|skill|unspecified) / taskDescription / expectedOutcome / businessConstraints / source(text|voice|mixed) / confirmedAt / createdAt / updatedAt。草稿无 confirmedAt，确认后生成不可变版本。录制 session 引用 intentId + intentRevision；分析结果和澄清准备、生成上下文均引用同一版本。已有 Analysis.intent 是模型推断，不能替代用户确认目标。业务意图仅用于上下文，不授予 MCP 业务操作权限。

提示词输入增加 userConfirmedIntent，和 observedAnalysis / confirmedClarifications 分开：
- 分析：围绕用户目标理解原始证据；具体记录实际演示了什么，不能把期望填成已发生步骤。
- 澄清：对照目标及前序证据识别仍缺的业务规则；明确目标不重复问，客观证据不足不让用户替系统解释技术细节。
- 生成：结合产出偏好、期望结果、实际步骤和已确认规则；未演示的期望能力标为待实现/未核验，不宣称可以执行。

目标与证据不一致时显示差异，例如“希望发送邮件，录制只演示了报价单准备”，让用户确认业务范围或补录；保留目标和真实观察。目标修订保留历史，已有回答不删除；分析及澄清按版本提示更新，重跑需显式确认，不因录制中修订而重启采集。旧会话无目标时支持补填，不把模型猜测冒充用户确认。


### 历史 v10 核对优先级（已由 v2.0 替代）

如旧章节中的界面示例与 §3/线稿 v10 有差异，以最新用户流程和线稿 README 为准：不再要求项目关联、不使用“统一任务包”作为 UI 文案、不自动查询业务 MCP。内部 schema/文件契约不因 UI 改名而重写。SOP 输出为新增设计，未声明现有应用已经支持。

### v10.2 录制目标输入简化

录制前第 2–4 页仅收集产出类型和任务目标，支持框内麦克风输入、结束转写及核对采用。不再单独设置预期效果、业务范围、例外或人工确认字段，也不在弹窗展示证据约束说明；用户可在任务目标中自然描述相关要求。旧字段设计不再构成必填要求。目标仍作为用户意图，与观测证据分别保存。
