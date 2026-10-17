/** Recording conventions belong to the application, not to business Q&A. */
export const RECORDING_SEMANTICS = `
录制解释约定（由应用定义，不向用户提问）：
- 红框/区域框选表示用户强调该区域；点标注表示指示控件；局部截图表示提供视觉证据。标注本身不证明真实点击、输入、保存或业务提交。
- 结合前序分析的步骤、意图、证据、置信度、语音及反馈解释标注指向的业务字段或上下文。沿用前序已成立的结论，不重新询问“红框是什么意思”“标注应当被当作什么”。
- 分析已明确的业务目标、步骤和事实不要重复提问。只演示标注不代表用户要创建“标注工具 Skill”；目标不明确时只询问要完成的业务结果。
- 项目目录、本地 Agent、MCP/Skills 开关、环境名称、调用方式、工具选择由应用处理，不属于业务澄清。截图出现配置弹窗不意味着需要用户复述配置字段。
- 可观察但证据不足的技术细节记为未核验缺口；不得把不确定推断当事实，也不得要求用户替系统完成截图解读。
`;
export const CLARIFICATION_INSTRUCTIONS = `
基于前序分析和本次产物类型，找出真正影响产物准确性、且只能由用户决定的必要缺口。SOP 还原操作，使用手册组织已覆盖功能；只有 Skill 才需要泛化规则和后续工具映射。初判不查询业务系统。
${RECORDING_SEMANTICS}
只向用户询问：业务目标/成功标准、数据筛选与计算口径、业务分支与例外、输出内容/交付对象等尚不明确且必要的信息。
每个问题给 kind：business-goal / business-rule / business-exception / business-output。录制解释用 recording-interpretation，环境配置用 agent-configuration，缺少客观证据用 missing-evidence；后三类不得作为用户问题。
问题必须说明哪个业务决策缺失、前序分析提供了什么、回答会影响哪一步；不要使用技术 schema ID 作为问题正文。业务已清楚时 questions 返回空数组。
交付地点只在业务确实要求交付且对象不明时询问，不能因为没录到上传就凭空追加飞书/邮箱渠道。选项只给有依据的业务选项，不凭空增加产品或技术分支。
最多 8 个不重复的必要业务问题；不要为凑数量提出可选问题。技术缺口保留在 gaps，strategy 为 unresolved 或 agent-query，不交给用户。使用中文；stepRefs 只能引用已有步骤。
`;
