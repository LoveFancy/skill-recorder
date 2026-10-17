# Claude 任务级会话设计复核

日期：2026-10-15  
对象：[claude-task-session-design.md](claude-task-session-design.md)  
结论：**目录分层与原生会话方向可继续，但原文有被实测推翻的结论，权限与恢复设计尚未通过实施评审。**

后续 A–F 分批验证及 OpenDesign 实现对照已整理到 [分批验证索引](claude-task-session-validation-batches.md)。本文件保留初次 14 用例的调查时点；后续已验证的 deny、MCP 授权、进程和会话行为以分批报告为准。原型通过不代表产品门槛已关闭，Windows 与真实模型 G 批次仍待验。

## 1. 验证范围与方法

本次核对本机 Claude Code `2.1.251` 的帮助信息、当前项目源码及 OpenDesign 的进程管理实现，并执行 14 个隔离 CLI 用例。

测试使用本机回环地址的模拟 Anthropic Messages 服务，发送确定的文本或 `tool_use` 响应。Claude Code 自身负责加载配置、生成请求、执行原生工具、运行 hook、启动 MCP 和读写会话。测试进程只使用临时 HOME、任务专属 `CLAUDE_CONFIG_DIR`、合成凭据、合成文件与合成本地 MCP，不使用用户真实配置、录制素材或真实模型。

这能验证 CLI 的配置、工具执行和恢复行为，**不能验证真实模型自主选用 Skill 的概率或任务质量**。下列“通过”表示符合对应单项预期，不表示整套设计已通过。

本机复现实物：

- 脚本：`/private/tmp/claude-task-audit.py`。
- 最终证据目录：`/private/tmp/claude-task-audit-ggiv1pxr/`。
- 每个用例保存 `requests.json`、`events.json`、`summary.json`，均为合成数据。
- 运行方式：`python3 /private/tmp/claude-task-audit.py`，需要允许监听本机回环端口。
- 共同参数：`-p --output-format stream-json --verbose --model claude-sonnet-4-5 --permission-mode dontAsk --strict-mcp-config --mcp-config <显式配置>`；普通用例加 `--no-session-persistence`，会话用例不加。
- 本次首条输入通过 stdin 文本发送，未复测 stream-json 输入保持管道和多轮 steer。

## 2. 隔离实测结果

| 用例 | 关键条件 | 观察结果 | 判定 |
|---|---|---|---|
| baseline-read-outside | 隔离配置目录、仅 Read、预授权 Read，没有 restricted | Read 成功读取 cwd 外的合成文件；祖先 CLAUDE.md 标记出现在模型请求中 | 证明空配置目录与工具白名单不足以形成目录/指令隔离 |
| restricted-read-outside | 同上，增加 restricted | Read 被拒绝，原因明确为超出工作目录；该祖先指令标记未进入请求 | 单项通过，不能推广为所有泄露面均已覆盖 |
| restricted-read-add-dir | restricted + add-dir inputs + Read | 成功读取 inputs 中的合成证据 | 单项通过 |
| restricted-write-add-dir | restricted + add-dir inputs + Write + 预授权 Write | 在 inputs 中实际创建文件 | **反证 add-dir 不是只读授权** |
| restricted-deny | restricted + 显式 settings deny Read | 模型请求中 Read 被移除；强制返回的 Read 调用被拒绝 | deny 对 Read 生效 |
| restricted-hook | restricted + 显式 PreToolUse Read hook | hook 实际运行，退出码 2 阻止 Read，工具结果包含拒绝标记 | hook 对 Read 生效 |
| restricted-deny-write | restricted + 显式 settings deny Write | Write 被移除，调用被拒绝，目标文件不存在 | deny 阻止本例 Write 副作用 |
| restricted-hook-write | restricted + 显式 PreToolUse Write hook | hook 运行并拒绝 Write，目标文件不存在 | hook 阻止本例 Write 副作用 |
| plugin-discovery | headless + plugin-dir，默认工具集 | 模型 API 请求的 tools 中有 Skill | 原文“Skill 不是合法工具”的结论不成立 |
| plugin-restricted-discovery | 同上增加 restricted | 请求 tools 中仍有 Skill | restricted 没有普遍禁用 Skill |
| plugin-restricted-explicit-skill | restricted + tools Read,Skill + 正确插件布局 | Skill 调用返回 Launching skill；后续请求包含技能正文标记 | **headless 的原生 Skill 执行路径可用** |
| restricted-mcp | restricted + tools Read + 显式合成 stdio MCP | 无 Bash 的工具集中出现目标 MCP 工具；调用返回固定标记 | MCP 启动和调用不依赖 Bash 工具可用 |
| session-create | restricted + 独立配置目录 + session-id | 在该配置目录的 projects 子树生成会话 JSONL | 任务专属会话落盘可用 |
| session-resume | 相同配置目录、cwd 和 resume ID | 复用同一 session ID，模型请求包含创建轮的历史输入 | 本例原生恢复可用 |

deny/hook 实验是工具级规则与命令 hook 的正向验证，尚未覆盖路径匹配规则、所有工具类别、MCP 写工具、无效 settings、策略合并优先级和子 Agent 的全部行为。真实业务只读仍需独立验收。

## 3. 必须修正的设计问题

### P0-1：隔离基线遗漏 restricted，目录不可见的承诺没有依据

位置：原文 §2.2、§3 第 2 项、§4.1。

原文将“空 CLAUDE_CONFIG_DIR + strict MCP + tools 白名单”定义为隔离基线，却在目录设计中承诺工作目录以外不可见。本次基线对照已实际读取 cwd 外文件，并在发往模拟模型的请求中发现祖先 CLAUDE.md 的合成指令。

修正要求：如果要依赖本版本的文件工具目录限制，启动契约必须明确包括 `--restricted`；配置目录重定向只解决一部分配置来源问题。还要校验祖先目录、额外目录、环境变量、managed 策略和其他自动发现来源，不能以“模型没有提及某内容”证明该内容没有进入上下文。

本次还发现，隔离配置的 init 仍报告多项 CLI 技能名称。这不能直接证明全局 Skill 泄露，可能包括内置项；但同样不能据此声称上下文只包含用户勾选的 Skill。若采用纯文本 Skill 路径，应评估显式禁用原生 Skill 发现，并单独验收。

### P0-2：原生 MCP 调用会绕过现有应用侧拒绝逻辑

位置：原文 §3 第 4、5 项。

`electron/enrichment/coordinator.ts` 的 `run()` 在 `allowedToolRefs` 非空时直接拒绝增强运行，当前并没有一个可自动提供给原生 Claude 的、已经验证业务只读和资源范围的 MCP 工具集合。`managedMcpConfiguration()` 只检查能力启用和配置来源哈希，不执行工具级/资源级授权。

把勾选的整个服务直接交给 Claude，会使服务工具由 Claude 自行调用，不能再声称“沿用 coordinator 的拒绝策略”就保持了同一权限边界。`--tools` 帮助明确针对内置工具，本次也证实仅 `--tools Read` 并不排除已配置的 MCP 工具。

修正要求：在完成工具和资源的强制过滤前，继续拒绝或不注入这些业务 MCP。后续可通过应用 MCP 代理、真正只读的服务/凭据或经过验证的调用拦截实施限制。不能只依赖工具名称、描述、只读 annotation 或提示词。

### P0-3：add-dir 与文件副本均不等于只读

位置：原文 §4.1 的 inputs/workspace 注释及设计要点。

本次 restricted + add-dir inputs + Write 在输入目录成功创建了文件。`--add-dir` 只扩展访问路径，没有读写模式参数。复制输入避免修改原始素材，但副本仍可能被当前用户的进程修改。目录权限 `0700` 同样不能隔离同一用户启动的 Claude/MCP 进程。

修正要求：将“只读副本”区分为数据不可变约定与实际写入约束。分析阶段至少明确枚举所需工具，禁用写类原生工具并配置已验证的补充规则；MCP 的进程级访问能力另行控制。不要把目录布局本身写成安全保证。

### P0-4：孤儿进程清理规则会漏清理，也可能误杀

位置：原文 §4.3。

“PID 仍存在且 manifest 不是 running 才清理”有两类问题：

- 应用崩溃后 manifest 通常仍是 running，反而会留下最需要清理的孤儿进程。
- PID 可以被复用，“PID 仍存在”不能证明它仍属于原任务。

修正要求：记录 owner 进程及启动身份、子进程启动身份、PGID、run/attempt 归属，启动恢复先判断原 owner 是否还活着，再验证待清理进程身份。对旧 attempt 的清理不能命中新 attempt。

POSIX 使用独立进程组，分阶段 SIGTERM/SIGKILL，并在父进程退出后继续检查后代；主动脱离进程组的后代另行处理。Windows 不能直接照搬负 PGID 信号，应单独实现并验收。OpenDesign 的 `agent-process.ts` 与 `runs.ts` 可作为实现参考，本次未运行进程树故障矩阵。

## 4. 被本次实测推翻或收窄的结论

### §2.3：插件 Skill 并非不能在 headless 中执行

本次插件布局为：

```text
plugin/
  .claude-plugin/plugin.json
  skills/audit-skill/SKILL.md
```

manifest 声明 `name: audit-tools`。在 `--restricted --tools Read,Skill --allowedTools Read,Skill --plugin-dir <plugin>` 下，模拟模型返回：

```json
{"type":"tool_use","name":"Skill","input":{"skill":"audit-tools:audit-skill"}}
```

Claude 返回 `Launching skill: audit-tools:audit-skill`，下一次模型请求包含 `SKILL_BODY_CANARY`。init 的 `tools` 为 Read、Skill，`skills` 中也包含该完整技能名。

因此，原文“没有合法 Skill 工具”“skills 始终为空”“headless 执行不可用”的泛化判断应撤回。真实模型没有自动触发，最多支持该组提示词和配置下未观测到调用；不能证明执行机制不存在。

仍可选择文本注入作为当前实现，但理由应是便于冻结和控制上下文，而非原生路径不受支持。纯文本注入自身也不要求移除 safe-mode；移除与否应由所需原生能力决定。

### §2.5 / §5：deny、hook、受限 MCP、会话恢复已有正向证据

将这些项从“完全未验证”更新为“已完成本机合成正向实验，待范围与故障矩阵验收”。不要据此直接宣称支持所有 CLI 版本、Windows、真实业务 MCP 或所有权限组合。

### config/.claude.json 不能承诺始终为 {}

本次会话创建和恢复后，CLI 已修改隔离配置目录中的 `.claude.json`。它可以初始化为 `{}`，随后由 CLI 持有运行状态；应用策略快照应放在 control 中，不能把配置文件固定内容作为恢复不变量，也不能每次恢复前重置整个配置目录。

### system:init 是声明记录，不是完整安全证明

原文 §3 第 6 项把 init 当作“真实生效配置”的权威记录，表述过强。init 可用于记录声明的工具、服务和会话，但不证明 hook 拦截有效、文件只读、服务无副作用或上下文无泄露。应结合模型请求、实际工具结果与文件/业务副作用验收。

## 5. 代码与数据契约问题

| 原文位置 | 核对结果 | 修正建议 |
|---|---|---|
| §4.1 runId 与 workflowStore.read(id) 的 ID 一致 | `WorkflowStore.read(id)` 接受录制 session ID，RunSchema 分别保存 runId/sessionId | 可以按 runId 建目录，但必须显式保存 recordingSessionId 与 runId 的关联；Claude session ID 另列 |
| §4.1 引入 attempts 后复制 session，不提 config | Claude 实际会话文件位于 config/projects，session-id.json 只是应用引用 | 定义 config 是任务级共享还是 attempt 级；应用引用文件不等于真实会话存储 |
| §4.2 用 atomicJson 写 evidence.jsonl | atomicJson 输出一个 pretty JSON 文档，不输出 JSONL | JSON 文件用 atomicJson；JSONL 用独立原子写入/追加及截断恢复策略 |
| §4.2 policy.json 保存 mcp-config 内容 | 原文目录注释说记录哈希，步骤却可能写入完整配置 | 只持久化脱敏元数据与配置哈希；命令行中的完整 JSON 也可能暴露凭据，应使用权限受控的临时配置文件或代理机制 |
| §4.2 最后写 ready manifest 保证原子 | 有助于避免半成品被当作 ready，但不自动处理重复创建、并发、旧 ready manifest | 定义独占创建、不可变修订、准备失败清理与提交指针 |
| §2.5 分页复用 JSON-RPC id 2 被定为既有缺陷 | 当前先收到当前页响应才发送下一页，同一 ID 没有同时对应多个待决请求 | 仅凭串行复用不能认定协议错误；递增 ID 有助诊断，但需用迟到/重复响应等故障用例证明具体缺陷 |

## 6. 下一步验收门槛

目录脚手架可以先实现，原生执行替换上线前至少完成：

1. 固定完整启动参数、环境来源与权限来源，验证所有禁止的配置加载入口。
2. 明确业务 MCP 的强制授权边界；没有可核验的只读范围就保持拒绝。
3. 定义工具、文件、MCP 三类写操作的控制和实际副作用验收。
4. 实现并验证正常取消、父进程先退出、忽略 SIGTERM、应用崩溃、重启及 PID 复用场景。
5. 定义 run/attempt/config/原生 session 的绑定与恢复失败策略，覆盖配置变化、cwd 变化、会话缺失和取消后恢复。
6. 明确事件和会话日志可能包含输入、工具参数与结果，不能默认无脱敏落盘；为证据来源和 TemporalScope 保留应用侧校验。

当前不需要以插件自动发现为前置条件阻塞目录设计，但同样不能把上述 P0 问题归为“不阻塞原生执行替换”的细化项。
