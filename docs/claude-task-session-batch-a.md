# 批次 A：任务隔离基线验收

日期：2026-10-15。CLI：Claude Code 2.1.251。关联：[原验证报告](claude-task-session-design-verification.md) §3 P0-1、§6 第 1 项。

**结论：祖先指令、隔离 HOME 配置及 cwd 外 Read 的本机合成验收通过；“restricted 会屏蔽继承环境”和“空配置目录没有额外 Skill”两个假设不通过。** 项目 `.mcp.json` 自动发现被本例 restricted 阻断，但文件本身仍可被 cwd 内 Read 读取。尚不能宣布完整隔离基线验收通过。

## 1. 与 OpenDesign 的实际实现对照

本批参考的是 `/Users/qinxiao/WorkSpace/htworkbench/open-design`，不是 OpenCode：

| OpenDesign 实现 | 本批如何借鉴、哪些不能直接沿用 |
|---|---|
| `apps/daemon/src/sandbox-mode.ts` 的 `applySandboxRuntimeEnv()` 将 HOME/USERPROFILE、XDG、临时目录和 CLAUDE_CONFIG_DIR 重定向到受管目录 | 本批使用隔离 HOME/config/temp；该函数先复制 `baseEnv`，并未清除全部 ANTHROPIC_*。本批证明单纯目录重定向加 restricted 仍不能排除这类环境配置影响。这里的 sandbox 是运行目录管理，不能等同于 OS 沙箱。 |
| `apps/daemon/src/server.ts:11470` 附近将选中技能的附属文件复制到 cwd 的 `.od-skills/`，并提供 add-dir 绝对路径兜底；设计系统正文由 daemon 拼接进提示词 | 可以借鉴“应用冻结选中资源、显式提供上下文和资源路径”。复制可避免修改原始分发资源，不能保证副本不可读/不可写；本批新增 cwd `.mcp.json` 的 Read 用例说明隐藏目录/配置文件不天然不可见。 |
| `apps/daemon/src/runtimes/defs/claude.ts` 以 stream-json 启动 CLI，配置 add-dir/resume，最终使用 `bypassPermissions`；MCP 注入声明为 `claude-mcp-json` | 该实现依赖项目 `.mcp.json` 自动加载，不是严格任务级工具隔离。不能把 bypassPermissions 搬入本项目。本批保留 dontAsk、显式工具和严格 MCP 配置，并单独证明自动发现正对照。 |
| `docs/prompt-composition.md` 明确 legacy 与 OD Next 有两个独立提示词组合入口 | 若采用 OpenDesign 式文本注入，应用约束必须进入实际执行分支；不能因为某一提示词文件写了规则就认为所有运行受约束。CLI 原生 Skill 是否禁用是另一层问题，本批 A3 独立验证。 |

OpenDesign 提供了运行目录和上下文编排范例；本批新增验证的是受限 CLI 的配置加载与工具访问边界，不是声称 OpenDesign 已实现同样的硬隔离。

## 2. 复用脚手架及证据

- 基础方法：复用 `/private/tmp/claude-task-audit.py` 的 `Handler`、回环 Messages 模拟服务、确定性 `tool_use` 和 `run()`，未修改公共原脚本。
- 批次脚本：`/private/tmp/claude-task-batch-a.py`。
- 最终证据：`/private/tmp/claude-task-batch-a-g97jgyoa/`，共 **23 个 CLI 用例，均正常退出**。正常退出不等于隔离通过。
- 复现：`python3 /private/tmp/claude-task-batch-a.py`，需允许监听 `127.0.0.1` 并运行隔离 CLI。
- 每例保存 `requests.json`、`headers.json`、`events.json`、`summary.json`。MCP 自动发现例另存 `mcp-started.json`；根目录 `checks.json` 汇总部分标记与 init.skills。`summary.json.argv/cwd/config/home` 保留实际调用条件。
- 固定参数：`-p --output-format stream-json --verbose --permission-mode dontAsk --no-session-persistence`；通常显式 `--model claude-sonnet-4-5 --strict-mcp-config --mcp-config '{"mcpServers":{}}'`。MCP 自动发现对照省略 strict 和显式 MCP；环境模型测试以末尾 `--model sonnet` 测试别名解析。精确参数以各例 argv 为准。
- 进程环境从少量显式键构造，不复制宿主环境；凭据为合成字符串、API 地址始终为本机回环。未读取真实 HOME 配置、凭据或录制输入，未调用真实模型。

判定依赖实际发给回环模型的请求、工具结果、服务启动副作用，不能以最终回答或单独 init 声明代替。正对照必须先能触发同一来源，否则阴性结果只能记未验证。

## 3. A1：配置来源与文件访问

| 用例名 | 用例与通过/不通过标准 | 实际结果与判定 |
|---|---|---|
| `outside-positive` / `outside-restricted` | 同一个 cwd 外文件放独立标记；正对照必须读到，restricted 必须拒绝且后续请求无文件正文 | 正对照读到 OUTSIDE 标记；restricted 返回 `is_error: true`，说明超出工作目录。**通过**。 |
| `mcp-positive` / `mcp-restricted` / `mcp-restricted-strict` | cwd `.mcp.json` 配置合成服务；正对照必须有启动文件与 MCP 工具；受限基线不得启动/暴露该自动发现服务 | 正对照启动且请求 tools 含 `mcp__projectcanary__project_canary_51024`；restricted 与 restricted+strict 均未启动、未暴露。**本例通过**，不能据此删除 strict：未覆盖所有 MCP 来源。 |
| `project-mcp-file-readable` | restricted+strict 下主动 Read cwd 内 `.mcp.json`；若设计承诺“配置不可见”，读到正文即不通过 | **读到完整合成配置**。自动发现已阻断，但不是内容隐藏。配置不可见假设**不通过**；cwd 不得放可被普通 Read 暴露的真实凭据。 |
| `home-positive` | 隔离 HOME 下 `.claude/CLAUDE.md` 放 HOME 指令标记，settings deny Read；config 指向该 `.claude`，必须加载标记且移除 Read | 请求有 HOME 标记，tools 为空。**正对照成立**。 |
| `home-redirect` / `home-restricted` | HOME 不变但 config 重定向；不得加载 HOME 标记和 deny Read | 两者均无 HOME 标记，Read 仍在请求工具集。**本例通过**。 |
| `home-restricted-same-config` | config 仍指向合成 `.claude`，但增加 restricted，区分 config 重定向与受限行为 | 无 HOME 标记，Read 可用。**本例通过**。 |
| `home-hidden-read-positive` / `home-hidden-read-restricted` | 明确 Read 隐藏 HOME 文件；正对照成功，restricted 拒绝 | 正对照读到 HOME 指令标记；restricted 返回目录越界错误。**通过**。不能推广为 OS 进程不可访问。 |
| `env-positive` / `env-restricted` | 为 ANTHROPIC_DEFAULT_SONNET_MODEL、CUSTOM_HEADERS、未识别变量设置不同合成值；分开检查 CLI 配置效果、HTTP 头和模型消息。若承诺 restricted 屏蔽环境，任何配置效果即不通过 | 两组请求 model 均为 `ENV_MODEL_CANARY_51029`，HTTP 头均带 `ENV_HEADER_CANARY_51027`；未识别变量值未自动拼入消息。**环境屏蔽不通过**。API key 也正常作为合成鉴权头发给本机端点，这是预期配置行为。 |
| `env-mcp-inheritance` | 显式配置的只读合成 MCP 返回自己继承的环境变量；若承诺 restricted 隔离子进程环境，返回合成值即不通过 | MCP 调用返回 `ENV_CHILD_CANARY_51030`，随后进入请求中的工具结果。**子进程环境隔离不通过**。 |

环境项的正确结论是：**未识别变量没有自动进入模型文本，不代表它不可被子进程读取；支持的变量仍能改变模型和 HTTP 请求。** 应由应用构造允许列表环境，显式控制模型、endpoint、鉴权与允许传给 MCP 的键。不能把清除所有 ANTHROPIC_* 当作现成结论，因为运行本身仍需要允许的连接参数。

## 4. A2：逐层祖先 CLAUDE.md 与插件组合

目录为 `ancestor/parent/work`，cwd 是 work；父目录和祖父目录各放一个不同的 `CLAUDE.md` 标记。config/HOME 是隔离目录，与祖先指令路径不同。

| 用例名 | 通过/不通过标准 | 实际结果 |
|---|---|---|
| `ancestor-positive` | 请求必须同时出现父、祖父两个标记，证明本机 CLI 确实向上加载，而不是测试路径没触发 | 两个均出现，**正对照通过**。 |
| `ancestor-restricted` | 两个标记在全部模型请求中均不存在，否则不通过 | 两个均不存在，**通过**。 |
| `ancestor-plugin-positive` | 加 plugin-dir 后正对照仍应有两个祖先标记，另有插件说明/完整技能名 | 两个祖先标记和插件描述均存在，init 有 `audit-a:probe`。**通过**。 |
| `ancestor-plugin-restricted` | restricted+plugin-dir 下两个祖先标记不存在，但显式插件仍被发现 | 祖先标记均不存在，插件描述存在、init 有 `audit-a:probe`。**通过**。 |

本批验证的是插件发现与祖先指令组合；没有再次强制调用 Skill，实际 Skill 执行正向证据沿用原报告，真实模型自主选择留到 G。

## 5. A3：零插件、零用户 Skill 目录基线

此组使用新建空 HOME/config，无 plugin-dir，没有创建任何用户/global skills 目录。不能保证机器级 managed 配置或二进制内资源不存在，因此以下称“该 CLI 基线项”，不把全部来源都武断归为二进制内置。

| 用例名 | 通过/不通过标准 | 实际结果 |
|---|---|---|
| `skills-clean` | 若设计承诺仅有选中 Skill，则无选中项时 init.skills 应为空，模型请求不得含额外 Skill 说明 | init.skills 有 **15 项**；模型首条消息包含 `The following skills are available for use with the Skill tool` 与技能描述。**纯净 Skill 假设不通过**。 |
| `skills-sources-empty` | 增加 `--setting-sources ""`，若能清除原生发现应为空，否则不通过 | 仍有同样 15 项、Skill 工具和说明。**作为禁用 Skill 方法不通过**。 |
| `skills-disabled` | 增加 `--disable-slash-commands`，应清空 init.skills、移除 Skill 工具和额外技能说明 | init.skills 为空、请求 tools 只剩 Read、技能说明消失。**本例通过**。 |
| `skills-plugin-disabled` | 与显式 plugin-dir 叠加，观察是否仅关闭基线项而保留任务插件 | init.skills 为空、Skill 工具移除、插件描述也未进入请求。**“只关基线、保留插件”不通过**；全关行为符合该参数帮助说明。 |

15 项为 `deep-research, dataviz, update-config, verify, debug, code-review, simplify, batch, fewer-permission-prompts, doctor, loop, claude-api, workflow-authoring, run, run-skill-generator`。init 列表不等同于全部描述都已发给模型；请求中确实存在部分基线 Skill 的说明，足以反证“空目录即无额外技能上下文”。

若采用 OpenDesign 式应用文本注入，可以选择禁用全部原生 Skill 后由应用提供冻结正文和资源路径；若采用 plugin-dir 原生 Skill，不能同时把 disable-slash-commands 当成“只关闭非任务技能”的参数。目前没有验证出保留显式插件但只清除全部 CLI 基线项的可靠开关，需先确定产品是否接受这些基线项，再决定该分支是否达标。

## 6. 收敛条件与剩余边界

本批已将 P0-1 从泛泛“再测隔离”收窄为两个具体设计决定：

1. 固定应用构造的环境允许列表，避免透传宿主 ANTHROPIC_* 和无关服务凭据；对明确允许的模型连接配置保持显式记录。
2. 选择文本注入且关闭原生 Skill，或接受并明确记录原生插件路径下的 CLI 基线 Skill；不能继续声明 plugin-dir 是请求中唯一的技能来源。

继续保留 restricted、隔离 HOME/config、显式严格 MCP 配置和文件工具白名单。项目配置不可自动加载，与配置文件不可被读取，是两项独立契约。像 OpenDesign 一样把资源放入 cwd 意味着它是模型可访问资源，不能同时把它当作存放秘密控制数据的区域。

未验收项：Windows；machine managed 策略；符号链接/路径规范化/其他文件工具绕过；全部 ANTHROPIC_* 或云供应商环境变量；所有 HOME 隐藏文件类型；插件/用户/managed 的全部 MCP 来源；插件级工具执行副作用；OS 沙箱；真实模型行为。本批未验证项均不能记为通过，也没有修改产品代码或设计正文。
