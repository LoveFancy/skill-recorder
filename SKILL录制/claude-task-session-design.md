# Skill Recorder：Claude Code 任务级会话与工作目录设计

日期：2026-10-15（本次为第三轮改写，汇总 A–F 批次机制验证证据）
状态：设计提案，机制级证据基本完备，**尚未集成到产品代码**。本文基于本机 Claude Code CLI 2.1.251、本机回环模拟模型完成的合成实验；真实模型自主行为（G1）与 Windows 平台（G2/D7）仍未验证，CLI 版本升级后关键结论需要重新核验。
关联文档：[post-recording-enrichment-and-replay.md](post-recording-enrichment-and-replay.md)（主设计文档，本文件对其 §5.6–§5.10 的"应用驱动工具调用循环"给出替代方案）、[open-design-claude-integration.md](open-design-claude-integration.md)（参考实现分析，非本项目代码）、[首轮验证报告](claude-task-session-design-verification.md)、[分批验证索引](claude-task-session-validation-batches.md)及其四份子报告（[A](claude-task-session-batch-a.md)/[B·C](claude-task-session-batch-bc.md)/[D·E](claude-task-session-batch-de.md)/[F](claude-task-session-batch-f.md)）。

> **证据状态说明**：下文区分四种判定——"**机制通过**"（单个 CLI 用例符合预期，不外推到全部组合）、"**原型通过**"（候选代理/回收器/guard 有效，尚未接入产品）、"**产品通过**"（需由真实产品入口复跑验收）、"**不通过/反证**"（有具体反例）。本文只在明确标注时才算"已验证"，未标注的仍是设计提案。

## 1. 背景与目标

主设计文档 §5.6–§5.10 的深度分析阶段，目前由 `electron/ai/client.ts` 的 `AgentClient` 驱动：应用在同步循环里逐轮重新序列化完整消息历史，通过 `electron/agents/local-request.ts` 为**每一轮模型调用**都重新拉起一个 Claude CLI 子进程，不具备原生会话、流式进度观察能力，也无法让模型自主规划、自主读取素材、自主调用工具。

目标架构：**录制步骤的产出以文件形式落盘到任务工作目录，深度分析阶段启动一次原生 Claude Code 会话，应用只给出任务简报（意图、素材索引、已启用能力），由 Claude 自己规划分析步骤、自己读取工作区文件、自己调用已配置的工具补证**，应用负责观察执行过程、归一化进度事件、摄取最终产出。

不能放松的硬约束：

- 分析阶段禁止任何业务写操作；
- 不静默继承用户全局 Claude 配置（CLAUDE.md、记忆、全局 MCP/Skill/自定义 Agent、宿主环境变量）；
- 只使用用户在"专用环境"里明确勾选、经完整性校验的 Skill/MCP（沿用 `electron/agents/managed.ts` 的选择与哈希校验模式）；
- 不泄露凭据与受保护素材；
- 历史事实 / 当前查询 / 不变规则三类事实必须保持可区分（`TemporalScope`），且必须能追溯到真实证据来源，不能由模型自行"升级"为已确认规则。

## 2. 总体流程

```text
录制完成（sessions/<recordingId>/：analysis.json/md、audio.json、narration.json、
          video.json/webm、video-frames.json/目录、frames/frames.json/目录）
  ↓ 应用：组装任务工作目录（见 §5），把录制产出以只读副本形式落盘，
         生成统一素材索引文档，拼好任务简报（意图 + 索引路径 + 已启用 Skill 正文）
  ↓ 应用：拉起一次原生 Claude Code 会话（隔离基线见 §3，权限策略见 §4）
  ↓ Claude：自主规划分析步骤 → 自主 Read/Glob 工作区素材 → 自主调用已授权的只读/代理 MCP 工具补证
         → 把 claims / gaps / questions 候选写入 outputs/
  ↓ 应用：解析流式事件驱动界面进度展示（§7）；任务结束后对 outputs/ 做脱敏与证据校验（§8）
  ↓ 用户确认分析结果 → 进入现有 Skill 生成链路
```

与此前方案的关键差异：应用不再把素材和历史消息反复拼进 prompt 重新发给模型，而是把素材当作**文件系统资源**交给一次性启动的原生会话，由 Claude 像在真实工作区里一样自己决定读什么、什么时候读、要不要再查一次工具。

## 3. 隔离基线（已完成机制级验证）

### 3.1 原隔离基线与当前认证接入

2026-10-17 用户确认调整：复用全局 Claude 认证，任务目录保存独立策略和会话绑定，不再将 `CLAUDE_CONFIG_DIR` 指向空任务目录。当前启动组合为 `--restricted --setting-sources "" --settings <task>/config/settings.json --strict-mcp-config --mcp-config <selected servers> --disable-slash-commands`，并显式指定工具允许/拒绝列表。认证环境只保留模型认证及必要系统变量；不复制凭据文件。启动前使用同一环境执行 `claude auth status`。以下“任务专属 CLAUDE_CONFIG_DIR”是原方案的验证记录，已被本次用户决策替代；不能再宣称与旧隔离基线等价。CLI 原生历史保存在现有 Claude 配置存储，任务独立 cwd、UUID 与恢复 guard 保持不变。

产品接入补充：全局 `settings.json.env` 中的模型认证令牌、API 地址及模型名称按允许列表导入子进程，显式环境变量优先；不继承 hooks、全局权限或任意其他环境变量。任务设置文件每次启动生成，以兼容旧任务重试。CLI 2.1.251 的结构化输出使用 JSON Schema draft-07；输出证据引用限定为已有证据 ID 或真实成功 MCP 调用的别名，最终统一校验后才提交结果。候选校验失败时回滚问题及任务包变更，不留下未被接受的分析状态。

#### 原验证记录

批次 A 的 `baseline-read-outside`/`outside-positive` 用例证实：**仅靠任务专属 `CLAUDE_CONFIG_DIR` + 显式 `--strict-mcp-config`，不加 `--restricted`，子进程仍能读取 cwd 外的文件，且祖先目录 CLAUDE.md 的合成标记会进入模型请求**。加上 `--restricted` 后，`outside-restricted`/`ancestor-restricted`/`ancestor-plugin-restricted` 均确认：cwd 外读取被拒绝（明确报错"超出工作目录"），父/祖父目录 CLAUDE.md 标记均不进入请求，即使同时启用 `--plugin-dir` 也不例外。

**结论（机制通过）：隔离基线 = `--restricted` + 任务专属 `CLAUDE_CONFIG_DIR`（指向仅含最小 `.claude.json` 的目录） + `--strict-mcp-config` + 显式 `--mcp-config`，四者缺一不可**，此前"仅靠 CLAUDE_CONFIG_DIR 即可"的结论已被纠正。

### 3.2 "配置不可自动加载"与"配置文件不可被读取"是两件独立的事

批次 A `project-mcp-file-readable` 用例：cwd 内放一个合成 `.mcp.json`，`--restricted --strict-mcp-config` 下该服务不会被自动发现/启动，**但用 Read 工具主动读取该文件仍能读到完整内容**。

**结论（反证）：不能把 cwd 当作存放秘密或未脱敏配置的区域**，即使对应的自动加载机制已被阻断。任务工作目录里任何会被 Claude Read/Glob 到的文件，都要当作"模型可读"来设计。

### 3.3 环境变量必须用应用构造的允许列表，不能直接透传宿主环境

批次 A `env-positive`/`env-restricted`/`env-mcp-inheritance`：

- `ANTHROPIC_DEFAULT_SONNET_MODEL`、`CUSTOM_HEADERS` 等 CLI 识别的变量，**在 `--restricted` 下依然生效**，会真实改变模型选择和 HTTP 请求头；
- 未被 CLI 识别的自定义变量不会自动拼进模型文本，**但子进程（包括其启动的 MCP server）仍能读取到该变量的值**（MCP 回传实测证实）。

**结论（不通过）：`--restricted` 不提供环境变量隔离**。应用必须显式构造一份环境变量允许列表传给子进程（模型连接参数、本机回环地址、合成/受控凭据等），不能复制宿主进程环境，否则宿主的 `ANTHROPIC_*`、第三方服务凭据等会原样渗透给任务子进程及其派生的 MCP。

### 3.4 原生 Skill 发现存在"CLI 基线技能"泄露，且无法只保留任务插件、单独关闭基线项

批次 A3：

- 全新空 `HOME`/`CLAUDE_CONFIG_DIR`、无 `--plugin-dir` 的"纯净"基线下，`system:init.skills` 仍有 **15 项**内置技能（`deep-research`、`dataviz`、`update-config`、`verify`、`debug`、`code-review`、`simplify`、`batch`、`fewer-permission-prompts`、`doctor`、`loop`、`claude-api`、`workflow-authoring`、`run`、`run-skill-generator`），且部分技能描述会真实进入模型首条消息；
- `--setting-sources ""` 不能清除这些基线技能；
- `--disable-slash-commands` **可以**清空 `init.skills`、移除 `Skill` 工具、消除技能说明文字；
- 但 `--disable-slash-commands` 叠加任务级 `--plugin-dir` 时，**连任务自己的插件技能也被一并关闭**（`skills-plugin-disabled` 用例：插件描述未进入请求）——目前没有找到"只关闭 CLI 基线技能、保留任务插件"的参数组合。

### 3.5 原生 Skill 的调用机制本身是可用的（纠正此前"不可用"的结论），但真实模型是否会自主选用仍未验证

批次 A2/A（`plugin-restricted-explicit-skill`，见[首轮验证报告](claude-task-session-design-verification.md) §4）用**可强制返回 `tool_use` 的模拟模型**证实：在 `--restricted --tools Read,Skill --allowedTools Read,Skill --plugin-dir <plugin>` 下，`{"type":"tool_use","name":"Skill","input":{"skill":"<plugin>:<skill>"}}` 能被 CLI 正确执行，返回 `Launching skill: ...`，随后请求里出现技能正文标记。**此前"`Skill` 不是合法工具名/headless 不可执行"的结论已被推翻。**

但这只证明"被明确要求调用时，机制可用"；**真实模型在未被显式指示的情况下是否会自主判断并选用某个技能，仍是 G1（见 §9）要单独验证的产品质量问题，不是 CLI 机制问题**，本文不能据此认定原生自主触发已经可靠。

### 3.6 架构决策：Skill 接入默认走文本注入，原生 `--plugin-dir` 暂不作为依赖项

鉴于 §3.4/§3.5：若要原生 Skill 机制可用，必须放弃"仅暴露任务插件、屏蔽 CLI 基线技能"的干净诉求；若要保证"模型上下文只包含用户明确勾选的 Skill"这条硬约束，当前只能用 `--disable-slash-commands` 关闭全部原生 Skill 发现（含任务插件），**改为延续 `electron/agents/managed.ts:124` `selectedSkillContext()` 已有的文本注入模式**：把已勾选、经完整性校验（`isolationStatus==="verified"` + `capabilitySelectionHash` + `resourceHash`）的 Skill 正文作为任务简报的一部分文本拼入首条消息，说明"只作为任务方法参考，不授予工具/脚本/业务权限"。

`--plugin-dir` 原生路径保留为未来可选项：一旦 G1 证明真实模型能可靠自主选用，且产品接受"模型上下文里会额外出现 15 项 CLI 基线技能描述"这一已记录、可审计的代价,才考虑切换或并行启用。

## 4. 写操作与 MCP 授权（已完成机制级验证）

### 4.1 `--tools` 不过滤 MCP 工具；精确排除要用 `--disallowedTools`

批次 B 用同一个暴露 `read_probe`/`write_probe` 的合成 MCP 验证：

| 参数 | 实际语义 | 证据 |
| --- | --- | --- |
| `--tools` | 只控制**内置**工具集合；对 MCP 工具**不生效**——`--tools Read` 时，两个 MCP 工具依然出现在模型请求里（只是因为 `dontAsk` 权限模式而被拒绝，不是被工具集排除） | B1-read/write、B2-tools-read |
| `--allowedTools` | 是**预授权**，不是工具范围限制；一旦预授权，写工具即可被成功调用并产生后端副作用 | B1-authorized-write、B2-exact-tools-authorized-write |
| `--disallowedTools` | **本例证实可以精确把指定 MCP 工具从模型工具集中移除**，强制调用报 `No such tool available`，后端无调用记录 | B2-disallowed-write/read |

**结论（机制通过）：`--tools` 不能当作 MCP 工具过滤手段；要排除已知的 MCP 写工具，必须显式用 `--disallowedTools` 按工具全名列出**（如 `mcp__<server>__<tool>`）。

### 4.2 工具名级过滤解决不了资源/参数级越权，需要应用侧 MCP 代理

`--disallowedTools` 能挡住"调用了错误的工具"，挡不住"调用了正确的只读工具名，但参数指向了越权资源"。批次 B3 做了一个应用侧 MCP 代理原型：`tools/list` 只暴露只读子集，`tools/call` 额外校验工具名与参数（精确匹配允许的资源标识），对越权参数、伪装调用、绕过 Claude 直连 JSON-RPC 的请求均拒绝（`PROXY_POLICY_DENIED`），后端只收到合法只读调用。

**结论（原型通过，非产品能力）**：该代理证明"应用介入 MCP 调用链路做资源级授权"这条路径可行，但**尚未实现真实 schema 转换、分页、并发、取消、超时、会话认证、策略哈希绑定**，不能直接用于生产，也不能据此认为 `coordinator.ts` 现有的"范围无法核验即拒绝"策略已经被取代。**在代理真正产品化之前，`coordinator.ts` 的既有拒绝逻辑必须继续作为兜底**。

### 4.3 三类写操作需要分层控制，没有单一开关能一次性解决

| 写操作类型 | 已验证的控制手段 | 局限 |
| --- | --- | --- |
| 内置工具写（Write/Edit/Bash/NotebookEdit） | 从 `--tools` 白名单中去掉即可阻止（批次 C1：四个工具均被正确拒绝，文件内容不变）| 仅验证这 4 个工具、本版本；MCP、插件 hook、后台进程、未来新增工具不在覆盖范围内；CLI 自身仍会写配置等运行态数据 |
| MCP 业务写 | `--disallowedTools` 排除已知写工具名（§4.1）+ 应用侧代理做资源级校验（§4.2，原型级）| 代理未产品化前，含写能力的 MCP 服务应继续遵循 `coordinator.ts` 现状拒绝 |
| 文件系统层写 | `chmod 0444`(文件)/`0555`(目录) 能挡住 CLI 的 Read/Glob 之外的写入尝试（批次 C3：写已有文件、新建文件均返回权限错误）| **同用户进程可以 `chmod` 恢复写权限后再写入**（`C3-owner-restore` 实测成功），不能当作硬隔离；目录需保留执行位，否则连正常遍历都会失败（`C3-directory-0444` 反证） |

**结论：写约束是分层防御，不是单点开关**——`--tools` 白名单排除写类内置工具是第一层（机制通过）；`--disallowedTools` 排除已知 MCP 写工具是第二层（机制通过）；应用侧 MCP 代理做资源级授权是第三层（原型通过，待产品化）；文件权限是最弱的第四层，只能防误操作，不能防同用户主动绕过。

## 5. 任务工作目录与素材落盘

### 5.1 复用现有录制产出，不重新设计录制文件格式

录制步骤的产出已经落在 `sessions/<recordingId>/` 下，结构保持不变：

```text
sessions/<recordingId>/
  analysis.json / analysis.md     # 基础分析结果与文档
  audio.json                      # 原始录音元数据
  narration.json                  # 语音转写，按分段：{model, language, segments:[{atMs,endMs,text}]}
  video.json / video.webm         # 录屏元数据与文件
  video-frames.json / video-frames/   # 录制期间采集的源截图索引与图片
  frames/frames.json / frames/    # 分析时提取/筛选/裁剪的派生截图索引与图片
```

深度分析阶段**不改造这套格式**，只负责把任务需要的部分以只读副本形式带入任务工作目录，并额外生成一份 Claude 要读的"入口文档"。

### 5.2 任务工作目录层级

沿用现有 `processingDirectory()`（`electron/agents/settings.ts:1`）作为应用级根目录，新增 `tasks/` 子树：

```text
<processingDirectory>/
  managed-claude/                 # 已存在：全局能力选择与专用环境（managed.ts）
  snapshots/<snapshotId>.json     # 已存在：CapabilityManifest 快照
  tasks/
    <runId>/
      control/                   # 应用管理的任务元数据，不放进 Claude cwd
        manifest.json            # runId、attemptId、capabilitySnapshotId、状态
        policy.json              # 本次实际生效的 --tools/--disallowedTools/--mcp-config 哈希等（只存脱敏元数据与哈希，不存完整凭据，见 §8）
        process.json             # owner/leader 进程身份、PGID、启动时间（见 §7.1）
        events.jsonl             # 归一化进度事件（对应 EnhancementEvent）
      config/                    # CLAUDE_CONFIG_DIR 指向这里
        .claude.json             # 首次创建为 {}；CLI 运行后会写入自身运行态字段（见 §7.3），应用之后不得重置整个文件
      inputs/                    # 只读证据区
        materials-index.md       # 统一素材索引 + 阅读指引（见 §5.3）
        recording/               # sessions/<recordingId>/ 的只读副本（按需挑选，非符号链接）
        task-package.json        # EnhancementTaskPackage
        evidence.jsonl           # 冻结的基础证据
      resources/
        skills/<ref>/SKILL.md    # 已勾选 Skill 的冻结文本资源（用于 §3.6 文本注入）
        manifest.json            # 本任务实际启用的能力清单
      workspace/                 # Claude 子进程 cwd；叠加 --add-dir 开放 inputs/ 的路径可达性（不是只读授权，见 §5.4）
      outputs/                   # 分析产出，应用侧持久化
        claims.json / gaps.json / result.json
        questions.json           # 本次唯一的最终问题清单（§6.1 第 2 步），不是中途多轮提问
      session/
        session-id.json          # {sessionId, cwd, capabilitySnapshotId, policyHash, cliVersion}（绑定契约见 §7.2）
```

与前一版的差异：去掉了单独的 `trajectory.json`概念，统一归入 `inputs/materials-index.md` + `inputs/recording/` 这一套"索引 + 只读副本"结构，直接对应 §5.1 的真实录制产物。

### 5.3 统一素材索引文档

`inputs/materials-index.md` 是 Claude 在这次会话里应该先读的入口文档，内容包括：

1. 本次任务的 `recordingId`、`runId`，以及 `inputs/recording/` 下各文件的相对路径与用途（对应 §5.1 的六类文件）；
2. `narration.json` 分段结构说明：如何用 `atMs`/`endMs` 把一段话和截图、录屏时间点对上；
3. `video-frames.json`（录制源图）与 `frames/frames.json`（分析派生图）的区别和各自的索引字段说明；
4. `task-package.json` 摘要（用户意图、已确认参数）的指引，而不是把全文内容也在索引里重复一遍；
5. 一句话阅读指引：先读 `task-package.json` 和本索引，再按分析需要读具体素材文件；不要假设任何未在索引中列出的文件存在。

**设计原则**：应用不负责把素材内容"喂"给模型，只负责告诉模型"这里有什么、在哪、怎么关联"，具体读什么、什么时候读由 Claude 自主决定——这是对用户"素材以文档形式落到工作区，深度分析时让 Claude 自己规划、自己读取、自己用工具"这一要求的直接落地。大体积文件（`video.webm`、截图图片）只落盘、不内联进任务简报文本。

### 5.4 `inputs/`"只读"目前只是数据不可变约定，不是强制权限（已被反证）

批次 B/C `restricted-write-add-dir`、`C3-owner-restore` 等用例证实：`--add-dir` 只是扩展路径可达性，不带读写模式参数；即使 cwd 外目录用 `chmod 0444/0555` 收紧，同用户进程仍可 `chmod` 恢复后写入。**"只读副本"目前只能表达为"应用约定不依赖该目录内容被修改"，不能表达为"Claude 或其派生进程物理上不能写"**。真正的防线是 §4.3 的分层写约束（不给写类工具/MCP 写权限），文件权限只是误操作防护，不是硬隔离。

### 5.5 创建与提交流程

沿用 `managed.ts:79` `commit()` 的"先持久化依赖项、最后切指针"原子性模式：

1. 校验 `runId` 合法、任务根目录非符号链接；
2. 依次创建 `control/`、`config/`、`inputs/`、`resources/`、`workspace/`、`outputs/`、`session/`，权限 `0o700`；
3. 按需从 `sessions/<recordingId>/` 复制素材到 `inputs/recording/`（拒绝符号链接，复用 `managed.ts` 现有遍历安全模式），生成 `inputs/materials-index.md`；
4. 用 `atomicJson` 写 `inputs/task-package.json`；`evidence.jsonl` 用独立的原子追加/截断恢复策略写入（**不能用 `atomicJson`**，因为它只支持一次性完整 JSON 文档，不支持 JSONL 追加——纠正前一版的错误用法）；
5. 把已勾选 Skill 的冻结文本复制进 `resources/skills/<ref>/`，写 `resources/manifest.json`；
6. 写 `config/.claude.json = {}`（仅首次创建，之后不重置，见 §7.3）；
7. 写 `control/policy.json`，**只存脱敏元数据与配置哈希**，不写入完整 `--mcp-config` JSON 明文（可能含凭据，见 §8）；
8. 最后写 `control/manifest.json`，状态从 `preparing` 变为 `ready`。

## 6. 深度分析阶段的运行方式

### 6.0 授权范围从哪来（前置于本节，决定能传什么 `--mcp-config`）

启动原生会话之前，应用必须先拿到一个**已授权**的 `RequestedScope`（`common/agents.ts:128`），这个 scope 不是用户在本阶段手工画出来的，而是按 [`skill-pipeline-overall-plan.md`](skill-pipeline-overall-plan.md) §2.2 的流程产生：轻量模型调用基于录制分析识别缺口、对 `agent-query` 类缺口提出建议能力范围，应用核对该范围是否整体落在"专用环境"已启用的能力集合内——**整体覆盖时自动放行，不需要用户在本次任务里再确认一次**；只有建议范围超出已启用集合时，才会多一次用户确认，确认后才正式进入本节的原生会话启动流程。本节后续的 `--mcp-config`/`--disallowedTools` 都是按这个已授权 scope 裁剪的，**不是"把专用环境里所有已启用能力都给这次会话"**——已启用只代表"用户原则上同意这个能力可以被用于增强"，具体某次任务能不能摸到它，还要看这次的 scope 判定结果。

### 6.1 启动与执行

2026-10-17 重试规则更新（用户明确要求）：点击“重试”以原始录制材料重新识别缺口、规划能力并建立新 run / Claude 会话，时长与外部调用计数从零开始，无需另行增加额度确认。保留原始录制，补充说明及材料继续作为参考；旧任务结果不作为本次结果，旧快照仍保存在历史中。回答后的“提交并继续分析”属于原任务收尾，继续使用原任务结果及额度。以下第 5 项要求显式增加额度的旧规则不再适用于“重试”操作。

1. 启动一次原生会话，`cwd = workspace/`，`CLAUDE_CONFIG_DIR = config/`，参数至少包含 `--restricted --strict-mcp-config --mcp-config <按 §6.0 授权范围裁剪的配置> --tools <只读内置工具白名单> --disallowedTools <已知 MCP 写工具>`，环境变量使用 §3.3 的显式允许列表而非继承宿主环境。
2. 首条用户消息即任务简报：用户意图、`inputs/materials-index.md` 路径、`task-package.json` 摘要（含 §6.0 已授权的 scope 说明，让 Claude 知道自己能摸到哪些能力、不能摸到哪些）、已勾选 Skill 的冻结文本（§3.6）、输出契约——**这次输出契约比纯粹的"分析候选"更宽**：要求把 claims 写入 `outputs/claims.json`，**还要求把"确实无法自行解决、需要用户决定"的缺口汇总成一份最终问题清单写入 `outputs/questions.json`**，覆盖 [`skill-pipeline-overall-plan.md`](skill-pipeline-overall-plan.md) §2.2 里标记为 `user-question` 但还没定稿的候选问题，以及执行过程中新发现的问题——**这份清单就是用户本阶段唯一会看到的问题，不能让 Claude 中途打断会话问用户，只能在会话结束时一次性给出。**
3. Claude 自主规划分析步骤、自主 `Read`/`Glob` 工作区素材、按需调用已配置的只读/代理 MCP 工具补证，尽量把能自己解决的缺口解决掉，整个过程不依赖应用逐轮重建历史，也不依赖应用中途插话。
4. 应用侧只做两件事：解析流式事件驱动进度展示（§7.4），任务结束后读取 `outputs/` 并过一遍脱敏与证据校验链（§8）再交给用户确认——**不能仅凭模型的文字自述或 `stop_reason` 判断任务是否真的完成**，要结合 `outputs/` 实际落盘内容与 `result` 事件的 `is_error` 校验。
5. **预算与续跑必须接住 `electron/enrichment/coordinator.ts` 现有的 `RunSchema`/`BudgetSchema` 契约**（`run()` 现状：`budget.maxExternalCalls`/`budget.activeMs`、超预算自动转 `paused`、`continueRun` 续跑、`attempt` 计数、`eventSequence` 递增）：每次经应用侧 MCP 代理（§4.2）转发的调用都要计入 `externalCalls`；累计耗时达到 `activeMs` 上限时，应用需要能中止当前原生会话并把 `run.status` 置为 `paused`，而不是让会话无限跑下去；用户显式"增加额度"后发起 `continueRun` 时，需要明确是 `--resume` 同一个原生 session（走 §7.2 的绑定校验）还是重新播种新 attempt——两种选择对已产生的部分 `claims`/证据的处理方式不同，需要在实现前定下来，本文暂不替用户做这个选择。

### 6.2 用户回答之后，不需要再开一次原生会话

用户针对 `outputs/questions.json` 一次性回答之后（[`skill-pipeline-overall-plan.md`](skill-pipeline-overall-plan.md) §2.4"终局整理"），应用只需要把回答和已有的 `claims` 一起交给一次轻量模型调用（现有 `AgentClient` 机制），补全 `user-confirmed` 类型的 claim 并产出最终 `EnhancementResult`——**这一步不需要重新组装任务工作目录、不需要重新走 §2–§5 的隔离基线和原生会话启动流程**，因为它不读工作区文件系统、不调 MCP，只是在已有结构化数据上做文本整理。只有这一步意外发现新冲突时，才需要把问题打回 §6.1 第 2 步产出的问题清单重新走一轮用户确认，这应该是例外，不是常态。

## 7. 进程生命周期与会话绑定（已完成机制级验证）

### 7.1 现有 `runProcess` 取消后会留下后代进程——已确认的产品缺陷

批次 D1 直接调用现有 `electron/agents/process.ts` 的 `runProcess`：正常取消场景下，直接子进程退出，但其后代进程**仍然存活**（源码没有 `detached`，仅对直接子进程做 `kill()`→`SIGKILL` 升级，无法触达后代）。**这是需要修复的现有代码缺陷，不是新架构才引入的问题。**

修复方向（批次 D2–D6 POSIX 原型已验证机制可行，尚未产品化）：

- 子进程改为 `detached:true`，独立进程组；取消时对整个 PGID 发 SIGTERM，超时后 SIGKILL；
- **回收身份判断不能只看 PID 是否存在**——必须记录 owner 进程身份、leader 进程身份、PGID、后代身份锚点，启动清理时先核对身份匹配再清理，身份不符则不清理（D6 已验证"身份不符拒绝清理"可行）；
- **manifest 状态为 `running` 不能作为"跳过清理"的依据**——应用崩溃后 manifest 通常仍停留在 `running`，这正是最需要清理的场景（D5 已验证"按后代身份而非 manifest 状态清理"可行）；
- 参考 OpenDesign `agent-process.ts`/`runs.ts` 的"先可靠记录再允许运行""TERM→等待→KILL→确认退出"结构，整体迁移而不是补一行 `kill(-pid)`；
- Windows 需要独立实现（Job Object 或经验证的进程树终止），不能把 POSIX 负 PGID 信号逻辑直接套用，本次未验证（D7）。

### 7.2 会话绑定契约

一个逻辑 `run` 对应多个不可变 `attempt`；一个 `attempt` 固定一组绑定值，恢复前必须全部核验一致，不一致则拒绝恢复、改为新 attempt 重新播种：

```text
runId / recordingSessionId / attemptId
configDir(realpath) / cwd(realpath) / nativeSessionId
policyHash / capabilityHash / skillRevision / model / cliVersion
lastCommittedEventCursor / owner 进程身份
```

批次 E 的关键发现：

- **E2（反证）：CLI 原生 `--resume` 并不会替应用校验 cwd 是否漂移**——从另一个 cwd `--resume` 同一个 session，CLI 照样成功并带着旧历史，证明"cwd 一致性"必须由应用自己在调用 CLI 之前做 guard，不能依赖 CLI 拒绝。
- E3/E4（机制通过）：会话文件缺失或整体损坏时，CLI 会报错退出（`No conversation found`），不会悄悄用空上下文继续——应用可以据此判断"必须重新播种"，但目前只验证了"整体损坏"，未覆盖"局部截断/部分有效"的情况。
- E5：取消后再恢复，已提交的历史和取消那一轮的用户输入都会进入下一次请求；**这不证明取消时可能已发出的业务写调用可以被安全重放**——若工具执行状态不明，应用必须先核实实际副作用，不能自动续发原指令。
- E6：策略/能力变化后应该拒绝旧 `resume`、开新 `attempt`，这是应用侧需要实现的 guard（原型已验证比较逻辑可行），CLI 本身不会主动做这件事。

### 7.3 `config/.claude.json` 不能被应用反复重置为 `{}`

批次 E7：CLI 首次运行后会在该文件写入自己的运行态字段（`firstStartTime`、`firstStartVersion`、`machineID`、迁移/通知相关标记、`userID` 等）。**应用只负责首次创建空文件，之后不能在每次恢复前把它重写回 `{}`**，否则会破坏 CLI 自身的运行状态甚至影响恢复。应用自己的策略哈希、审计信息放在 `control/`，不要混进 `.claude.json`。

### 7.4 `system:init` 是声明记录，不是安全证明

`system:init` 事件可以用来记录"本次声明加载的工具/服务/会话信息"，驱动进度展示，但**不能证明 hook 真的拦截了某次调用、文件真的只读、MCP 服务真的没有副作用**——这些都需要结合实际的工具调用结果和后端副作用来验收，不能只看 init 声明。

## 8. 隐私脱敏与证据保全（已完成机制级验证）

### 8.1 两条存储通道必须分开处理

- **应用自己的 `events.jsonl`/`outputs/evidence` 等**：应用能控制落盘前脱敏与字段裁剪；
- **CLI 原生的 `config/projects/.../*.jsonl` 会话历史**：由 CLI 自己写入，应用的事后脱敏**无法**抢在这条写入之前生效（批次 F1.1/F1.2 证实：原生 JSONL 和 CLI stdout 都完整保留了合成 token、邮件地址等敏感标记，不会自动脱敏）。

**结论**：如果产品要求"原生持久化目录也绝不出现未脱敏内容"，目前没有机制能保证，应当关闭原生会话持久化（即不依赖 `--resume`，接受无法原生恢复的取舍），改用应用自己的检查点机制；**不能同时宣称"支持原生恢复"又宣称"原生目录绝无原始敏感内容"**。

### 8.2 现有脱敏函数的已知边界

批次 F1.3–F1.5：

- 对完整 JSON 值调用现有 `redactValue()`/`redactIncremental()`（`electron/enrichment/privacy.ts`）可以正确移除嵌套字符串里的已知标记（**机制通过**）；
- **分块增量脱敏可以被绕过**：把一个 token 切成两段分别脱敏再拼接，完整 token 会重新出现（`redactIncremental()` 是无状态的，不能逐块任意切分调用）；
- **对象的 key 不会被处理**：`redactValue()` 只递归 value，用敏感内容做 key 时原样保留。

**落地要求**：落盘前脱敏必须对**完整累积后的值**调用一次，不能在流式分块到达时逐块脱敏；动态对象键必须先映射为受控的固定字段/白名单，不能直接对任意 key 做文本脱敏后继续使用。

### 8.3 落盘前介入点

```text
录制材料/用户补充 → 应用脱敏、冻结 inputs 与证据摘要 → 作为文件进入 Claude 工作区
MCP 后端结果 → 应用受控工具层（代理，见 §4.2）提取来源/时间/资源范围 → 脱敏 → 返回给 CLI
CLI stdout → 有状态解析、累计完整工具参数 → 固定字段事件投影 + 对完整值脱敏 → events.jsonl / UI / 可导出诊断
```

脱敏失败时应停止对应内容的落盘/展示并记录不含原文的错误码，不能回退为记录原始数据。

### 8.4 TemporalScope 证据来源与采集点

| 类型 | 可追溯来源 | 采集/脱敏点 |
| --- | --- | --- |
| `at-recording` | 录制 `session.json` 起始时间 + 分析步骤时间，任务输入素材 | 复制进 `inputs/` 前脱敏，证据摘要落盘前再校验 |
| `current` | 经授权 MCP 调用的成功响应、调用时间、资源身份 | 代理/受控工具层采集 `queriedAt` 与来源，返回给 CLI 前脱敏 |
| `invariant` | `task-package.json` 中用户已确认的回答，关联 `questionId` | 确认提交时脱敏 |

不能让模型自报"已查询"就生成 `current` 证据——必须对应一次真实的、经应用受控工具层记录的调用；最终候选仍需过现有 `validateCandidate()`/`acceptCandidate()` 的来源与时间规则审核,保留人工确认状态。

## 9. 产品化前必须完成的收尾项

本文到此为止的结论均为**机制级或原型级**证据；以下项目是接入产品代码前必须单独完成、不能用本轮合成实验替代的验收：

1. **MCP 工具/资源授权集成**（对应 §4.2）：把任务冻结策略绑定到真实产品执行入口，新出现的工具默认不允许；服务端按任务资源 ID/租户/账号范围校验参数。通过标准：真实产品 CLI 只拿到许可工具，强制调用未知/越权工具无后端调用，合法读成功。
2. **文件约束的平台级验收**（对应 §4.3/§5.4）：选定真实 OS 边界（如 Linux bind mount + ro）后分别验收读取、遍历、覆盖、创建、rename/unlink、权限恢复、符号链接；Linux/Windows 分别验收，macOS 的 `chmod` 结果不能代替。
3. **进程回收的产品集成**（对应 §7.1）：把 D2–D6 的身份匹配原型接入真实 `runProcess`，覆盖正常取消、父进程先死、忽略 TERM、应用崩溃重启、PID 复用；Windows 单独实现与验收（D7/G2）。
4. **会话绑定 guard 的产品实现**（对应 §7.2）：把 E 批的比较逻辑原型接入真实 attempt 创建/恢复流程，覆盖策略漂移、cwd 漂移、会话缺失/损坏、取消后恢复。
5. **脱敏管线的产品实现**（对应 §8）：把"完整值脱敏 + 固定字段投影"接入真实的 CLI 输出解析与事件归一化代码，而不是停留在合成脚本验证。
6. **G1：真实模型的 Skill 选择质量**：固定模型、CLI 版本、插件修订，分别测试显式指令调用、不给指令的自主选择、不相关任务下的误触发、同名技能的命名空间消歧——这是产品质量验收，不是 CLI 机制验收,决定 §3.6 是否要从"默认文本注入"切换为"原生 Skill 优先"。
7. **G2：Windows 全平台复测**：§3（隔离基线）、§4（写约束）、§7.1（进程回收）在真实 Windows 环境复跑，使用该平台实际路径语义与进程管理机制,不能用本机 macOS 结果外推。
8. **`electron/agents/mcp.ts` 既有缺陷修复**：`listStdio` 对分页 `tools/list` 复用同一 JSON-RPC `id`，在扩展 MCP 发现范围前应先确认是否构成实际缺陷并修复。
9. **预算/续跑契约接入**（对应 §6 第 5 项）：把 `electron/enrichment/coordinator.ts` 现有的 `RunSchema`/`BudgetSchema`（`maxExternalCalls`/`activeMs`、超预算 `paused`、`continueRun`/`attempt`/`eventSequence`）接到新执行引擎——确定每次代理转发的 MCP 调用怎么计入 `externalCalls`、累计耗时怎么触发会话中止、`continueRun` 对应 `--resume` 还是新 attempt 重新播种。这是现状代码已有、新设计目前未覆盖的契约，不是待验证的机制问题，是必须补的设计空白。

## 10. 变更记录

- 2026-10-15（第五轮）：按"一次连续运行、一次澄清"的产品目标重写 §6——新增 §6.0 说明授权范围来自 `skill-pipeline-overall-plan.md` §2.2 的轻量判定而非会话自画；原生会话的输出契约从"只产出 claims"扩展为"同时产出一份最终问题清单，一次性给出、不中途打断"；新增 §6.2 说明用户回答后的终局整理是轻量调用，不需要重新拉起原生会话。
- 2026-10-15（第四轮）：对照 `electron/enrichment/coordinator.ts` 现状代码复核，补上 §6 第 5 项与 §9 第 9 项——新执行引擎必须接住现有 `RunSchema`/`BudgetSchema` 的外部调用计数、超预算暂停、`continueRun` 续跑契约，此前全文未覆盖。
- 2026-10-15（第三轮）：汇总批次 A–F 的机制级验证证据，全文重写。关键修正：隔离基线必须包含 `--restricted`（不只是配置目录隔离）；环境变量需应用构造允许列表；原生 Skill 机制本身可用，但 CLI 基线技能泄露且无法与任务插件共存式关闭，维持"默认文本注入"的架构决策但改写理由；`--tools` 不过滤 MCP，改用 `--disallowedTools` + 应用代理原型做分层写约束；`add-dir`/文件权限均非硬隔离；进程回收需按身份而非 PID/manifest 状态判断；会话恢复需要应用自建 guard；脱敏需在完整值上做、不能逐块进行；新增素材落盘与统一索引设计，对应录制步骤的真实目录结构，明确深度分析阶段由 Claude 自主规划/读取/调用工具。
- 2026-10-15（第二轮）：增加独立验证报告与复核提示，标记原始提案尚未通过实施评审。
- 2026-10-15（首次）：记录 `--safe-mode`/`--restricted` 语义差异、全局配置泄露问题及 `CLAUDE_CONFIG_DIR` 隔离修复、`--plugin-dir` Skill 触发失败的初次实测结果，给出任务级工作目录设计提案。
