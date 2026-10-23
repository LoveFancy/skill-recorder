# 批次 D / E：进程生命周期与会话恢复验证

日期：2026-10-15；环境：macOS、Claude Code 2.1.251。

**当前 `runProcess` 正常取消会留下后代进程；CLI 原生恢复也不会替应用检查 cwd 绑定。** POSIX 进程组原型和隔离会话故障实验提供了可复用证据，但不代表产品已经实现验收门槛。Windows、真实业务 MCP、完整应用重启及真实 PID 复用尚未验证。

## 方法和证据

复用 `/private/tmp/claude-task-audit.py` 的 HTTP 回环模拟模型、临时 HOME、合成 API key、任务专属配置目录和 requests/events/summary 记录方式，没有调用真实模型或使用用户配置。执行脚本：`/private/tmp/claude-task-audit-de.py`；最后完整运行证据：`/private/tmp/claude-task-audit-f5l6v1_5/`。原脚本未改动。

CLI 共同参数：`-p --output-format stream-json --verbose --model claude-sonnet-4-5 --permission-mode dontAsk --strict-mcp-config --mcp-config '{"mcpServers":{}}' --restricted --tools ''`。会话测试启用持久化，明确不传 `--no-session-persistence`。

D 的后代 fixture 是持有进程树形态的合成 Python 进程，不是完整 MCP 协议服务；它验证操作系统进程回收，不能覆盖真实 MCP 的所有退出/自行脱组行为。测试只对自己创建的 PID/PGID 发信号。

## D：进程生命周期故障矩阵

### D1：现有实现正常取消——不通过

直接通过 Bun 导入并调用现有 `electron/agents/process.ts` 的 `runProcess`。临时 Python 子进程再启动一个后代，后代不继承 stdout/stderr，避免管道持有影响 close 事件；700ms 后 AbortController 取消。

通过标准：Promise 报取消后，直接子进程及后代均退出。不通过标准：仍有任一运行后代，或者取消一直等待。

观察：Promise 报“任务已取消”，直接子进程退出，后代仍存活。测试随后单独回收后代。证据：`d-results.json` 中 `D-current-normal-cancel`，以及 `current-child.json`、`current-runner.ts`。源码没有 `detached`，仅对 `child.kill()` 升级 SIGKILL，无法保证后代退出。

### D2—D5：POSIX 候选原型——单项机制通过，产品尚未验收

每个用例创建独立进程组、唯一临时脚本及 manifest，记录 owner 身份、leader 身份、PGID、后代 anchor 身份和 attempt ID。身份样本使用 `ps` 的启动时间与完整命令；这是测试诊断身份，生产实现应复用 OpenDesign 的 OS creation time/spawn window 检查，不能把秒级 `lstart` 当作无碰撞凭据。

| 用例 | 操作 | 明确通过标准 | 实测 |
|---|---|---|---|
| D2 正常进程组取消 | leader 存活时对 PGID TERM，再按需 KILL | 后代退出，直接 child 最终 wait 回收 | 后代 TERM 后退出；原型清理 wait 回收 leader |
| D3 leader 先死 | kill -9 leader 并 wait；核验已记录后代身份和 PGID，再终止组 | leader 已消失仍能终止后代；身份不符不得信号 | 后代身份匹配，TERM 后退出 |
| D4 忽略 TERM | 后代注册 SIGTERM ignore；TERM 后探测，再 KILL | TERM 后仍活、KILL 后退出，两阶段证据均存在 | `term_survived:true`，KILL 后 `anchor_alive_after:false` |
| D5 owner 崩溃、manifest 仍 running | kill owner、leader；从落盘 manifest 校验后代身份和 PGID | 不因 running 跳过；后代匹配才清理 | manifest 为 running、owner 已死，后代成功回收 |
| D6 身份冲突 | 把记录的后代身份改为模拟旧身份 | 拒绝清理，无关/身份不符进程继续存活 | `identity_matched:false`，anchor 仍存活；随后测试 finally 回收 |

证据：`d-results.json` 及各 `D-*/manifest.json`。D5 是独立原型读取持久记录的故障模拟，**没有启动和崩溃真正 Electron 应用**；该原型未组成产品级 owner-aware reaper，正常取消与启动回收的授权入口仍需分开实现。

D6 是**模拟身份不匹配**，没有制造 OS 实际 PID 复用，不能写成“真实 PID 复用验证通过”。本轮也未覆盖对子进程主动 setsid 脱组、孙进程多分支、权限不允许 kill、整个进程组无存活成员的产品探测逻辑。采样时 leader 可能是尚未 wait 的僵尸，所以 `leader_alive:true` 不能当作它仍在执行；原型 finally 会 wait。对已经消失的组发第二次信号曾返回 EPERM，脚手架清理容忍该错误；产品不得笼统吞掉对仍存活组的 EPERM。

### 参考 OpenDesign，具体借用与边界

[agent-process.ts](/Users/qinxiao/WorkSpace/htworkbench/open-design/apps/daemon/src/runtimes/agent-process.ts:276) 的 `spawnAgentProcess` 已采用 POSIX `detached:true`；`recordAgentProcessUntilGroupExits` 持续保留进程记录，写记录失败会终止刚启动的进程。应借用其“先可靠记录，再允许运行”的失败策略。

[runs.ts](/Users/qinxiao/WorkSpace/htworkbench/open-design/apps/daemon/src/runtimes/runs.ts:2222) 的 `terminateProcessTree` 会检查整个进程组，TERM 后等待、再 KILL、再确认退出；同文件延迟信号捕获原 child/PGID，不使用可能被新 attempt 覆盖的 run 指针。应迁移这段生命周期结构，而非只补一行 `kill(-pid)`。

[agent-process.ts](/Users/qinxiao/WorkSpace/htworkbench/open-design/apps/daemon/src/runtimes/agent-process.ts:348) 的 `classifyLeftoverAgentRecord` 区分 own、owner_alive、gone、identity_mismatch、unverifiable、reap，校验 owner 创建时间、child spawn window 与 PGID。启动 sweep 不依赖业务 manifest 的 running 状态。

为避免只凭阅读推断，另将上述纯分类函数从当前源码原样抽取，注入合成身份探针运行：`/private/tmp/claude-task-de-opendesign.ts`；证据 `d-opendesign-classifier.json`。

| 合成状态 | OpenDesign 实际分类 |
|---|---|
| owner 死，agent 身份匹配 | reap |
| owner 身份匹配且存活 | owner_alive |
| agent PID 对应不同启动时间 | identity_mismatch |
| owner PID 被模拟复用，agent 匹配 | reap |
| leader 已死、仅后代仍存活 | gone |

最后一项是移植边界：分类器以记录的 leader PID 为锚，leader 已消失时返回 gone，纯分类函数不查询存活后代。**不能直接把 OpenDesign reaper 当成 D3 的完整证明。** 本轮后代 anchor 原型说明“记录可核验后代”是可验证方向；生产需要稳定 owner/supervisor、可靠的后代身份记录或其他 OS 归属机制，不能只凭裸 PGID 回收，避免组号复用误杀。

### D7：Windows——待验

无 Windows 执行环境。不允许从 POSIX 结果推导 Windows 通过。独立任务要求使用 Job Object 或经验证的进程树终止，实现 D1—D6 相同故障矩阵；通过标准仍为实际后代退出、身份不符不误杀、旧 attempt 不影响新 attempt。`taskkill /T` 单独使用能否覆盖父进程先死的后代，需要单列验证。

## E：会话绑定与失败策略

### 建议绑定契约

一个 logical run 对应多个不可变 attempt；一个 attempt 固定一个 config 修订、cwd、native session ID。允许继续旧 native session 时，新 attempt 显式引用旧 config 修订，不复制/重置会话目录。至少保存：

```text
runId / recordingSessionId / attemptId
configDir(realpath) / cwd(realpath) / nativeSessionId
policyHash / capabilityHash / skillRevision / model / cliVersion
lastCommittedEventCursor / owner process identity
```

同一个 native session 同时只允许一个 writer。应用策略快照存 control；CLI config/projects 是 CLI 的可变状态。跨策略或能力变化不允许把旧上下文直接带入新权限边界。

脚手架 `e-guard-prototype.json` 仅验证候选比较规则：policyHash、cwd、configDir、session ID 改变均产生 `REFUSE_RESUME_NEW_ATTEMPT`。这不是现有应用 guard，也没有执行产品级 reseed；完整 contract 与并发提交仍待实现。

### CLI 实测与明确验收

| 用例 | 步骤 | 通过标准 | 实测与结论 |
|---|---|---|---|
| E1 相同绑定恢复 | 固定 config/cwd 创建 UUID 会话，下一 CLI 进程 `--resume UUID` | 请求确实包含前轮合成标记，原 session ID 保持 | exit 0、历史标记进入请求；机制通过 |
| E2 cwd 变化 | 同 config/session，从另一 cwd resume | 产品 guard 必须在启动前拒绝；CLI 自身是否拒绝单独记录 | CLI exit 0，且仍携带旧历史；**CLI 没有替应用阻断 cwd 漂移** |
| E3 会话文件缺失 | 备份并删除目标 session JSONL 后 resume | 无模型调用，识别恢复失败；不继续发送只有“继续”的空上下文 | exit 1、0 requests、No conversation found；机制通过，应用 fallback 未实现验收 |
| E4 会话文件损坏 | 用 `{broken json` 替换全部 session 内容后 resume | 同 E3，不能静默成功恢复 | exit 1、0 requests，相同失败；仅覆盖完全损坏，不覆盖局部截断/有效前缀 |
| E5 取消后恢复 | 在模型请求已到达回环服务但响应延迟时 TERM CLI，再 resume | 已提交历史保持；不自动重放业务副作用；取消轮状态有明确记录 | 取消 exit 143；旧历史和取消轮用户输入均进入下一请求，恢复 exit 0 |
| E6 policyHash 漂移 | 比较旧绑定和改动策略的候选绑定 | 启动前拒绝旧 session、开新 attempt；不靠模型自觉忘记旧上下文 | guard 原型拒绝；尚无产品实现或端到端 reseed 证据 |

证据：`e-results.json`、`E-*/requests.json`/`events.json`/`summary.json`；取消细节在 `E-cancel/summary.json`。E5 没有实际执行工具，**不证明取消中的业务写调用可安全重试**。若工具执行状态不明，必须先核对实际副作用，再决定继续，而非自动发送原指令。

### 恢复失败应怎样处理：借用 OpenDesign 的两种路径

[agent-session-resume.ts](/Users/qinxiao/WorkSpace/htworkbench/open-design/apps/daemon/src/agent-session-resume.ts:130) 将“确认原生恢复”和“跳过完整历史”绑定；model/cwd/cursor 不匹配时拒绝 resume，要求完整 transcript。`computeIncludeStable` 在 stable prompt hash 变化时重新发送稳定上下文，**并不等于自动拒绝 session**；本项目 policyHash 变化需要更严格拒绝，不能把它们混为一谈。

[server.ts 普通路径](/Users/qinxiao/WorkSpace/htworkbench/open-design/apps/daemon/src/server.ts:16219)：只有实际尝试 resume、且非取消时识别缺失会话；清旧 handle、完整 transcript 重新播种，同 run 最多一次自动重试。本轮 E3/E4 的 `is_error:true,num_turns:0,duration_api_ms:0` 与其检测签名一致。

[server.ts OD Next 路径](/Users/qinxiao/WorkSpace/htworkbench/open-design/apps/daemon/src/server.ts:12008)：锁定 native session 的 continuation 不允许冷重播种；guard 拒绝或原生恢复失败时阻断，不能悄悄换会话。

本项目建议明确选择：

| 条件 | 决策 | 不通过表现 |
|---|---|---|
| policy/capability/model/cwd 漂移 | 拒绝旧 resume，创建新 attempt；从应用验证并脱敏的证据重播种，保留旧审计链 | 仍使用旧 native ID 或仅补一句新权限提示 |
| 普通可重建任务会话缺失/完全损坏 | 隔离损坏文件，清失效引用，最多一次新 session 重播种 | 死循环 resume、直接丢失历史、复制损坏目录 |
| 必须保留原生执行上下文的锁定 continuation | 报明确恢复错误，阻断，要求显式重新开始 | 静默切换新 session |
| 正常取消且状态可核验 | 原 attempt 标取消；用户明确继续才开新 attempt，绑定未变时允许恢复 | 取消后自动恢复，或把 cancelled 改回 running |
| 取消时工具副作用不明 | 报待核对，禁止自动重播种重试 | 重放可能已完成的业务写操作 |
| 权威证据丢失、摘要无法恢复或配置 I/O 故障 | 报错保全证据 | 空上下文继续执行 |

### E7：CLI 对 `.claude.json` 的写入

初始创建 `{}` 后，CLI 写入本轮观测到的顶层键：`firstStartTime`、`firstStartVersion`、`machineID`、`opusProMigrationComplete`、`sonnet1m45MigrationComplete`、`seenNotifications`、`hasResetAutoModeOptInForDefaultOffer`、`migrationVersion`、`userID`。创建和相同配置恢复后的键集合相同。仅记录键名，不输出可能包含身份或凭据的值。

因此应用只能负责首次创建空配置及所需显式策略文件，不能在每次恢复前把 `.claude.json` 重写为 `{}` 或重置整个 config。CLI 的 JSONL、迁移/设备/用户运行态归 CLI 管理；应用自己的 policyHash、审计映射、生命周期 manifest 放 control，不混入 `.claude.json`。

本轮只证明内容发生修改，没有文件系统事件级证据区分原地覆盖与临时文件 rename。若产品依赖文件锁/共享 config，需要追加 FS 追踪及并发恢复测试；不要声称已验证原子写入协议或多进程安全。

## 当前收敛结论

D1 为已确认的产品缺陷；D2—D6 是候选机制/故障原型，不能替代产品进程回收验收，D7 待 Windows 环境。E1/E3/E4/E5 的 CLI 机制有实证；E2 证明应用绑定 guard 必不可少；E6、自动重播种和锁定 continuation 的差异策略尚需接入产品并做端到端验收。设计正文尚未修改。
