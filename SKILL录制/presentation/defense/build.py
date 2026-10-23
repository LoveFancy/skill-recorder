"""Build the offline HTML deck from the approved 16-page manuscript. No dependencies."""
from pathlib import Path
import re
import html

ROOT = Path(__file__).resolve().parent
DOCS = ROOT.parent.parent
SOURCE = DOCS / '课题答辩-逐页稿.md'
source = SOURCE.read_text()


def esc(s):
    return html.escape(str(s))


def md(s):
    s = esc(s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'`(.+?)`', r'<code>\1</code>', s)
    lines = []
    for line in s.splitlines():
        line = re.sub(r'^&gt;\s?', '', line)
        line = re.sub(r'^#{1,6}\s+', '', line)
        if line.strip():
            lines.append(f'<p>{line}</p>')
    return '\n'.join(lines)


def table(headers, rows, cls=''):
    return f'<table class="t {cls}"><thead><tr>' + ''.join(f'<th>{v}</th>' for v in headers) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(f'<td>{v}</td>' for v in row) + '</tr>' for row in rows) + '</tbody></table>'

shots = {}
def shot(n, title, focus, cls=''):
    shots[n] = {'title':title, 'focus':focus}
    return f'''<figure class="shot {cls}" data-shot="{n}"><div class="shot-heading"><span>实物截图 {n:02d}</span><span class="missing">待补 · 真实脱敏素材</span></div><div class="shot-placeholder"><span class="photo-icon" aria-hidden="true"><svg viewBox="0 0 32 26"><rect x="1" y="1" width="30" height="24" rx="3"/><circle cx="23" cy="8" r="3"/><path d="m3 22 9-10 7 7 4-4 7 7"/></svg></span><b>{title}</b><span class="upload-hint">点击填入截图</span></div><figcaption><span>请看这里</span>{focus}</figcaption></figure>'''


def band(text, cls=''):
    return f'<div class="takeaway {cls}">{text}</div>'

def mini(title, text, cls=''):
    return f'<div class="mini {cls}"><h3>{title}</h3><p>{text}</p></div>'

pages = []
def page(title, kicker, body, cls='', chapter='问题', subtitle=''):
    n = len(pages)+1
    pieces = re.split(r'^## P\d+\s*·', source, flags=re.M)[1:]
    section = pieces[n-1].split('\n## 附：')[0].split('\n## 变更记录')[0]
    speech = re.search(r'\*\*讲稿\*\*[^\n]*\n(.*?)(?=\n\*\*来源|\Z)', section, flags=re.S)
    speech = speech.group(1).strip() if speech else section
    faq = source.split('## 附：答辩现场高频追问速查')[1].split('## 变更记录')[0]
    notes = f'<div class="speaker-script">{md(speech)}</div><details><summary>本页完整逐页稿（含截图要求与待补）</summary>{md(section)}</details><details><summary>答辩追问速查</summary>{md(faq)}</details>'
    heading = '' if cls == 'cover' else f'<div class="page-heading"><p class="kicker">{kicker}</p><h2 class="h2">{title}</h2>' + (f'<p class="lede">{subtitle}</p>' if subtitle else '') + '</div>'
    source_ref = re.search(r'\*\*来源\*\*：([^\n]+)', section)
    src = source_ref.group(1) if source_ref else '§0'
    pages.append(f'''<section class="slide {('is-active ' if n==1 else '')}{cls}" data-title="{esc(re.sub('<[^>]+>', '', title))}" data-page="{n}"><div class="deck-header"><span class="brand"><i></i>人机协同新范式</span><span class="section-name">{chapter}</span></div>{heading}<div class="page-body">{body}</div><div class="deck-footer"><span>{'问题 · 方案 · 原型　 |　 汇报人【待补】　 |　 2026-10' if n==1 else '课题答辩　 /　 '+esc(src)}</span><span class="slide-number" data-current="{n}" data-total="16"></span></div><aside class="notes">{notes}</aside></section>''')

# Cover template: pure typography, as required by P1.
page('让工作本身，成为输入', '', '''<div class="cover-content"><p class="cover-eyebrow"><span></span>课题答辩 · 2026</p><h1>让工作本身，<br><em>成为输入。</em></h1><p class="cover-claim">人最擅长的是「做」，不是「说」。</p><p class="cover-description">直接演示一遍，让真实操作转化为<br><strong>可理解、可复用、可审核</strong>的工作知识。</p><p class="cover-subtitle">人机协同新范式：从“描述”到“演示”<span>让大模型理解人的真实工作</span></p></div>''', 'cover', '研究主张')

comparison = table(['', '今天 · 描述式输入', '本课题 · 演示式输入'], [
['用户要做', '写完整指令，自备截图与样例', '<strong>按平时方法做一遍，再回答几个问题</strong>'],
['需要具备', '流程表达能力 + AI 使用经验', '<strong>只需会做这项工作本身</strong>'],
['信息来源', '事后回忆重构 + 人工挑选素材', '真实操作证据，时序完整'],
['跨系统工作', '成本随系统数线性上升，衔接易丢', '一次通过，衔接自动连上']
], 'channel-table')
page('让工作本身，<span class="blue">成为输入</span>', '核心主张', f'''<p class="hero-sentence">人最擅长的是「做」，不是「说」。</p><p class="support">与其跟大模型讲非常多，不如<strong>给它实际演示一遍</strong>。</p>{comparison}<div class="three questions">{mini('谁来教？','门槛从“会写指令”降到“会做工作”。')}{mini('用什么教？','做一遍给它看，比堆截图讲得更全。')}{mini('教完怎么跑？','<strong>演示是输入方式，不是执行方式。</strong>','accent')}</div>''','claim','研究主张')

left = table(['动作','真实工作量'],[['回忆','默认动作太熟，反而想不起来'],['截图','逐张裁剪、打码、标箭头'],['组织文字','把跳跃操作写成线性步骤'],['返工','漏步 / 误把样本值写死']],'compact')
page('问题的发现：<span class="blue">两个方向同时撞上来</span>', '01 / 问题的起点', f'''<div class="two discovery-grid"><div class="column"><p class="overline">渠道一 · 我自己</p><h3>“说清楚”远比“做一遍”贵</h3>{left}<p class="pending">自己做【待补：时长】 · 写清楚【待补：时长 / 返工轮次】</p>{shot(1,'素材文件夹 · 长说明 · 文档草稿','沉淀一次工作的真实工作量')}</div><div class="column"><p class="overline">渠道二 · 一线员工</p><h3>是工作专家，却不会“讲”给模型</h3><ul class="clean-list"><li>口径、例外、判断依据，问他都答得上。</li><li>不知道说到多细，哪些是模型猜不到的。</li><li>找懂 AI 的人一对一“翻译”，<strong>覆盖不过来</strong>。</li></ul><p class="pending">【待补：员工真实原话，须脱敏】</p>{shot(2,'聊天记录 · 流程说明 · 翻译前后对照','不是员工不努力，而是给错了工具')}</div></div>{band('两边卡的是同一件事：把“会做的事”先翻译成“说得清的话”。<strong>不如，实际演示一遍。</strong>','dark')}''','discovery')

page('问题的本质：<span class="blue">两层错配</span>', '02 / 从现象到问题定义', f'''<div class="mismatch-top"><div class="layer-title"><span>01</span><h3>谁来教</h3><p>工作知识与 AI 能力<br>长在不同的人身上</p></div><div>{table(['','一线业务人员','熟悉 AI 的人'],[['工作知识与判断口径','<b class="blue">有</b>','没有'],['把工作讲成可执行指令','没有','<b class="blue">有</b>'],['被繁琐重复工作消耗','<b>严重</b>','相对少']])}<p class="caption">找人“翻译”有二次损耗，更关键是<strong>不可规模化</strong>。</p></div></div><div class="mismatch-bottom"><div class="layer-title"><span>02</span><h3>怎么教</h3><p>描述通道有<br>结构性损耗</p></div><div><div class="three">{mini('遗漏','默认动作是“不值得说的常识”。')}{mini('失真','回忆是重构，不是记录。')}{mini('成本','完整写清楚，往往比做一遍更慢。')}</div><p class="redline">与表达能力无关：越熟练，越容易遗漏。培训写 Prompt 解决不了这一层。</p></div></div>{band('隐性知识：<strong>可被执行，却难被完整言说。</strong>单一“言说”通道，既挡住使用者，也丢失工作知识。')}''','mismatch')

page('描述通道的<span class="blue">两个长期代价</span>', '03 / 同一个病根，两个症状', f'''<div class="two costs"><div class="column"><p class="overline">跨系统工作</p><h3>越复杂，越讲不全</h3><div class="compare-lines"><p><span>准备</span>步骤与系统越多，堆素材越不可行</p><p><span>衔接</span>静态截图丢时序，跨系统动作最易漏</p><p><span>中间态</span>复制内容、命令与查询返回难还原</p><p><span>为什么</span>演示时口述一句，自动对齐步骤</p></div>{shot(3,'真实跨系统界面拼图','步骤【待补】 / 系统【待补】 / 切换【待补】')}<p class="caption">优先投向：<strong>跨系统、多步骤、高频重复</strong>的工作。</p></div><div class="column"><p class="overline">SOP 与操作手册</p><h3>第一版很完善，写完即过期</h3><div class="compare-lines"><p><span>额外工作</span>脱离日常操作，要单独挤时间</p><p><span>维护很贵</span>界面一改，截图与描述要重做</p><p><span>没有触发</span>流程变了，没人提醒该更新</p><p><span>收益错位</span>写的人已经会，受益的是后来者</p></div>{shot(4,'旧文档截图 ↔ 当前系统界面','红框标出失配按钮 / 字段；更新日期【待补】')}<p class="caption">下一步：文档成为操作的副产品，<strong>从“维护”走向“保鲜”</strong>。</p></div></div>{band('延伸价值不依赖 AI 执行成功：即使只给人看，也有收益。')}<p class="boundary">边界：独立 SOP / 手册首版已实现、尚未发布，内容质量未经业务验证；版本与变更提示尚未实现。</p>''','cost-page')

page('模型能买，<span class="blue">工作方式买不到</span>', '04 / 从个人效率到组织能力', f'''<div class="two value-layout"><div><p class="pull-quote">企业独有的“手艺”，<br>仍然锁在员工个体身上。</p>{table(['现象','组织后果'],[['知识随人走','离职、轮岗即能力流失'],['知识靠人传','培训成本高，口径逐层衰减'],['口径不统一','同一项工作，不同结果'],['<strong>AI 接不进来</strong>','<strong>有最强模型，却喂不进工作方式</strong>']],'compact')}<p class="analogy">从师徒相传的手艺，走向可复制的工艺标准。<br><strong>本课题：AI 时代的工艺标准化。</strong></p></div><div class="staircase"><div class="stair future"><span>L3 · 未来演进</span><h3>企业 AI 生产力基础设施</h3><p>可管理、可发布、可度量的 Skill 资产体系</p></div><div class="stair next"><span>L2 · 已设计，部分待实现</span><h3>组织知识资产</h3><p>可交接、可审计、口径统一的流程资产</p></div><div class="stair current"><span>L1 · 当前验证重点</span><h3>个人效率</h3><p>演示者自己的可复用 Skill</p></div></div></div>{band('企业 AI 的瓶颈：从“有没有模型”，转向<strong>“能不能把自己的工作方式交给模型”</strong>。')}''','value-page')

page('现有方案的<span class="blue">覆盖盲区</span>', '05 / 核心问题尚未被覆盖', table(['现有方案','它解决了什么','为什么覆盖不了本问题'],[
['Prompt 工程 / 指令模板','提升已写出内容的表达质量','仍以“用户能说清”为前提，<strong>两层错配未触及</strong>'],
['人工编写 SOP / 手册','把流程固化成可读文档','生产维护成本高，无变更触发点，<strong>写完即过期</strong>'],
['知识库 / RAG','检索已经被写下来的文档','<strong>隐性知识从未被写下来</strong>，无从检索'],
['流程挖掘','从系统日志还原流程骨架','难覆盖跨系统、本地操作，也拿不到<strong>“为什么”</strong>'],
['RPA / UI 录制回放','固化确定的点击路径','学到的是<strong>路径</strong>，不是<strong>规则</strong>'],
['多模态 / Computer Use','看懂屏幕、操作界面','解决“看见与动手”，未沉淀为<strong>可复用、可审核的资产</strong>']
],'blind-table')+band('本课题聚焦这一段：<strong>一次演示，如何可信地变成可复用规则？</strong>','dark'),'blind-page')

fact_table = table(['录到的事实','为什么不能直接当规则','必须确认'],[
['打开第一封邮件','第一封，还是所有未处理的？','集合范围'],['复制某个邮箱','固定联系人，还是本次客户？','配置 / 输入'],['跳过一条记录','重复、无效，还是暂缓？','条件与处置'],['周一上午演示','不等于每周一自动运行','触发条件']
],'fact-table')
page('演示给出<span class="blue">事实</span>，Skill 需要<span class="blue">规则</span>', '06 / 核心技术问题', f'''<div class="two fact-layout"><div><div class="fact-equation"><span>事实</span><i>≠</i><strong>规则</strong></div>{fact_table}</div>{shot(5,'真实录制的原始步骤 / 事件列表','这一条，到底是规则，还是本次样本？')}</div><div class="three redlines">{mini('样本 ≠ 配置','不能把本次取值，固化成长期常量。')}{mini('成功 ≠ 制度','不能猜演示外的异常分支。')}{mini('时间 ≠ 触发','不能由单次演示推定调度条件。')}</div>{band('<strong>自动补证 + 最小化人工澄清</strong> → 有证据、有边界的知识 → 目标环境中确实可用的能力','dark')}''','fact-page')

stages=''
for n,(name,sequence,q,people) in enumerate([
('演示与忠实还原','录制 → 基础分析 → 用户确认','你做了什么','① 确认素材'),
('证据化深度分析','权限判定 → 自动补证 → 一次澄清 → 人工审核','哪些是规则、证据在哪','② 回答一次澄清　③ 逐条审核结论'),
('知识资产生成','能力映射 → 确定性渲染 → 导出','以后靠什么执行','生成后查看正文，再显式保存 / 导出')],1):
    stages+=f'<div class="stage"><span class="stage-number">0{n}</span><div><h3>{name}<small>{q}</small></h3><p>{sequence}</p><span class="human">{people}</span></div></div>'
page('总体架构：<span class="blue">三步与四条原则</span>', '07 / 方案总览', f'''<div class="two architecture"><div class="stage-list">{stages}</div>{shot(6,'产品真实流程界面 · 阶段导航','对照真实界面，看三步如何落地')}</div><p class="caption architecture-caption">分析阶段三个介入点：确认素材、一次澄清、逐条审核；生成后另需查看正文并显式保存。</p><div class="four principles">{mini('忠实复述 ≠ 业务判断','基础分析不读文件系统、不调业务系统。')}{mini('证据优先','结论带来源；模型无权自评通过。')}{mini('连续运行，一次澄清','能查的一次查完，只问人能决定的。')}{mini('演示输入，能力执行','优先原生工具 / CLI / MCP，UI 专属才兜底。','accent')}</div>''','architecture-page','方案')

page('关键机制：<span class="blue">把演示变成可信知识</span>', '08 / 机制一至四', f'''<div class="mechanism-grid"><article class="mechanism"><div class="mechanism-copy"><span class="mechanism-id">01</span><h3>多源采集 · 端侧隐私</h3><p>窗口、浏览器事件、剪贴板、终端、快照与口述。<br><strong>录制 / 存储 / 抽帧 / 转写在本机完成。</strong></p></div>{shot(7,'真实录制会话目录','快照、事件、剪贴板、命令输出、转写文本')}</article><article class="mechanism"><div class="mechanism-copy"><span class="mechanism-id">02</span><h3>范围判定 · 最小授权</h3><p>已授权内自动放行；新增能力只确认一次。<br><strong>业务访问只读，会话只拿本次通过的能力。</strong></p></div>{shot(8,'能力勾选与授权确认','权限被声明、被确认、被收窄')}</article><article class="mechanism"><div class="mechanism-copy"><span class="mechanism-id">03</span><h3>隔离会话 · 自动补证</h3><p>只读素材、分层写权限、预算、暂停续跑、落盘校验。<br><strong>自动解决【待补：M 条】 / 仍需问【待补：N 条】</strong></p></div>{shot(9,'补证运行过程与缺口前后对比','先自己查，查不到才问人；需实测复核')}</article><article class="mechanism primary-mechanism"><div class="mechanism-copy"><span class="mechanism-id">04</span><h3>证据化澄清 · 逐条审核</h3><p><strong>不变规则</strong>可固化 · <strong>运行时查询</strong>每次查 · <strong>历史事实</strong>仅本次。<br>关键缺口不能无证据消失，<strong>模型不得自行通过审核。</strong></p></div>{shot(10,'澄清清单与逐条审核界面','来源可追溯、时间属性三分、接受 / 拒绝')}</article></div>''','mechanisms','方案')

shots[11]={'title':'逐步骤能力映射','focus':'设计示意；受控业务 MCP 自动调用链路尚未接通'}
page('机制五：<span class="blue">我们不回放点击</span>', '09 / 核心差异点', f'''<p class="support">演示确定业务目标；执行路径，到目标环境既有能力中重新选择。</p><div class="two execution-layout"><div><div class="execution-tier tier-one"><span>01 / 首选</span><h3>原生工具 · 内部 CLI · 已开放接口</h3><p>业务目标完整覆盖 · 与界面改版解耦</p></div><div class="execution-tier tier-two"><span>02 / 次选</span><h3>已授权业务 MCP</h3><p>复用已有能力 · 按只读 / 范围收窄</p></div><div class="execution-tier tier-three"><span>03 / 兜底</span><h3>浏览器自动化</h3><p>仅 UI 专属环节 · 显式标注脆弱</p></div><p class="pending">【待补：演示工作映射后，三级分别占几步】</p></div><div class="mapping"><h3>四步映射：按目标，不按按钮</h3><ol><li><b>能力编目</b><span>语义能力快照，作为唯一候选集</span></li><li><b>语义等价</b><span>保留账号、线程、附件、数据与授权范围</span></li><li><b>禁止猜名</b><span>工具必须可核验；判不了的交人审核</span></li><li><b>降级标注</b><span>写明执行载体、依赖与稳定性</span></li></ol></div></div><div class="design-example" data-shot="11"><span class="design-label">11 · 设计示意</span><p><b>网页回复客户邮件</b><span>→</span><b>仅当 MCP 支持“回复线程”才映射</b><span>→</span><b>若仅能新建邮件：不等价，降级 / 待审核</b></p><small>映射理由：必须保留线程归属；所需依赖：经核验且已授权的邮箱能力。</small></div>{band('演示是<strong>需求说明书</strong>，不是执行脚本。','dark')}<p class="boundary">方案已定，本期不作为已实现能力展示：受控业务 MCP 自动调用链路尚未接通；版本化依赖声明未实施。</p>''','execution-page','方案')

page('同源三产出，<span class="blue">读者决定形态</span>', '10 / 机制六 · 确定性渲染与导出', f'''<p class="shared-source">共用同一份<strong>已审核的步骤、规则、证据与适用边界</strong></p><div class="three outputs">{mini('SOP · 给操作者','按任务顺序，保留真实界面操作。<br><b>不翻译执行方式</b> · 不依赖能力快照。')}{mini('Skill · 给执行 Agent','按流程与工具依赖，映射语义等价能力。<br><b>翻译执行方式</b> · 依赖能力快照。','accent')}{mini('使用手册 · 给学习者','按功能、场景与导航层级组织。<br><b>不翻译</b> · 命令行录制保留实际命令。')}</div><div class="render-strip"><span>冻结可追溯输入</span><i>→</i><span>确定性代码渲染</span><i>→</i><span>保存前成果检查</span><i>→</i><b>正文查看 + 显式保存</b></div><div class="two output-shots">{shot(12,'SKILL.md 正文','配置 / 输入、尚未试运行、映射 / 依赖三处边界')}{shot(13,'SOP ↔ Skill · 同一步骤对照','一个写“点哪个按钮”，一个写“调哪个能力”')}</div>{band('固定标注：<strong>内容已生成，尚未进行业务试运行。</strong>生成成功 ≠ 执行可靠。')}<p class="boundary">Skill 验证最充分；SOP / 手册首版已实现但尚未发布，内容质量未经业务验证。【待补：答辩前以实际运行结果复核】</p>''','outputs-page','方案')

route_table = table(['维度','RPA 录制回放','上游开源 Recorder','Watch&Learn 类','本方案'],[
['学到什么','点击路径','泛化后的流程','对外称流程与偏好','有证据、有边界的规则'],
['<b>以后靠什么执行</b>','<b>回放界面路径</b>','目标环境通用能力','未公开','<b>原生工具 / CLI / MCP 优先</b>'],
['<b>界面改版后</b>','<b>直接失效</b>','取决于能力可用性','未公开','<b>接口步骤解耦；兜底标明脆弱</b>'],
['结论可追溯','不涉及','模型自述','未公开','每条结论挂证据来源'],
['样本误固化防护','无','依赖模型自觉','未公开','时间属性三分 + 强制校验'],
['人工审核','无','计划确认','结果审阅','逐条审核 + 正文查看才可保存'],
['效果承诺','—','生成即交付','教一次长期运行','生成质量与执行可靠性分开验收']
],'route-table')
page('不仅学得准，还要回答<span class="blue">以后靠什么跑</span>', '11 / 路线对比与价值度量', route_table+'''<div class="formula"><span>净收益</span><b>=</b><span>原手工总耗时</span><b>−</b><span>首次演示与审核</span><b>−</b><span>后续执行复核与维护</span></div><div class="two metrics"><div><h3>分阶段指标</h3><p><b>提炼</b>：漏步骤数 / 关键规则覆盖率<br><b>交付</b>：样本误固化数 / 依赖遗漏数<br><b>执行</b>：新输入完成率 / 人工介入次数</p></div><div><h3>文档保鲜指标 · 不依赖执行成功</h3><p>沉淀成本 · 文档新鲜度 · 刷新成本 · 交接可用性<br><span class="pending-text">【待补：同事能否不追问原作者即正确执行】</span></p></div></div><p class="boundary">以上为逐页稿中的路线与方案对比；机制五实现边界见下一页。模型时间与用户投入分开记录，不设未经验证的节省比例。</p>''','comparison-page','方案')

status_rows=[
['多源录制与基础分析','<span class="status done">已实现</span>','窗口 / URL / 剪贴板 / 终端 / 快照 / 端侧转写'],
['浏览器真实事件采集','<span class="status done">首版已实现并验证</span>','自研离线插件'],
['能力发现与范围判定','<span class="status done">已实现</span>','候选发现、哈希校验、能力清单快照'],
['隔离会话自动补证','<span class="status partial">已有实现，需实测复核</span>','预算、续跑、暂停、证据落盘已具备'],
['证据化澄清与逐条审核','<span class="status done">已实现</span>','强制校验，模型不得自评通过'],
['确定性渲染与多目标导出','<span class="status done">已实现</span>','多目标导出、草稿提醒、保存前成果检查'],
['<strong>执行方式翻译 · 机制五</strong>','<span class="status partial">方案已定，非已实现能力</span>','<strong>受控业务 MCP 自动调用链路尚未接通</strong>'],
['版本化依赖声明','<span class="status future">未实施</span>','正文声明依赖，尚无结构化版本绑定'],
['独立 SOP / 使用手册','<span class="status partial">首版已实现，尚未发布</span>','内容质量未经业务验证；不依赖能力快照'],
['真实业务试运行','<span class="status future">本期不做</span>','产物固定标注“尚未进行业务试运行”'],
['Computer Use / Replay / 定时运行','<span class="status future">不在本期范围</span>','属于后续演进方向']]
page('原型现状：<span class="blue">已跑通 vs 待补齐</span>', '12 / 先讲边界，再看演示', table(['环节','状态','说明'],status_rows,'status-table')+band('方案讲多远都可以，<strong>原型到哪了必须如实。</strong>','dark'),'status-page','原型')

steps=''
for n,(name,why) in enumerate([('录制演示','不写提示词，口述判断原因'),('忠实还原','捕获未主动描述的步骤'),('自动补证','系统先查，再问人'),('一次澄清','自动解决 M / 待问 N【待补】'),('逐条审核','故意拒绝一条，产物应改变'),('查看产物','配置 / 输入与试运行标注'),('映射说明','讲设计，不演执行')],1):
    steps+=f'<div class="demo-step"><span>{n:02d}</span><h3>{name}</h3><p>{why}</p></div>'
page('现场演示与评测：<span class="blue">用证据说话</span>', '13 / 演示七步 · 生成质量评测', f'''<div class="demo-scenarios"><p><b>现场验证</b>研发交付流程【待补：具体工作】</p><p><b>只讲价值</b>报表取数 / 票据核对 / 邮件转线索</p><span>本期未做真实业务试跑</span></div><div class="demo-steps">{steps}</div><div class="demo-bottom"><div class="evidence-list"><h3>现场可打开的证据</h3><ul class="clean-list"><li>真实会话目录与还原步骤</li><li>结论来源：自动查到 vs 用户回答</li><li>产物全文与“尚未试运行”标注</li><li>SOP / Skill 同一步骤对照</li><li>错误固化反例与实际评测结果</li></ul><p class="boundary">备用：全程录屏；环境故障时直接播放。</p></div><div class="two demo-shots">{shot(14,'样本误固化的错误 / 正确反例','从“写死样本值”到“运行时查询”')}{shot(15,'评测套件实际运行结果','实际分数【待补】；不是自我评价')}</div></div>{band('评测素材为<strong>合成构造</strong>：评的是生成质量，<strong>不是真实业务成功案例</strong>。')}<p class="boundary">第 7 步：执行方式翻译为方案设计，受控业务 MCP 自动调用链路尚未接通，现场不演示执行。</p>''','demo-page','原型')

life=['生成','评估','发布','回测','A/B','运行监控','演进与退役']
ring='<div class="lifecycle"><svg viewBox="0 0 520 420" aria-hidden="true"><ellipse cx="260" cy="210" rx="175" ry="135"/></svg><div class="ring-center"><span>Skill</span><b>全生命周期</b><small>未来演进图景</small></div>'
coords=[(260,57),(415,105),(453,239),(341,356),(177,356),(64,239),(104,105)]
for i,(name,(x,y)) in enumerate(zip(life,coords),1):
    ring+=f'<div class="life-node {"current" if i==1 else ""}" style="left:{x}px;top:{y}px"><span>0{i}</span>{name}</div>'
ring+='</div>'
page('大处着眼，<span class="blue">小处着手</span>', '14 / 从生成，走向资产治理', f'''<div class="closing-top">{ring}<div class="directions"><p class="overline">三个优先演进方向</p>{mini('回测与漂移检测','用规则的证据链，比对流程与依赖变化。')}{mini('评估基准自动构建','一次演示既是生成输入，也可沉淀为回归用例。')}{mini('发布与权限治理','Skill 触达业务系统，就成为具备权限的执行主体。')}<p class="boundary">本页全部为演进方向，不属于本课题交付范围。</p></div></div><div class="closing-line"><p><span>着眼的大处</span>把企业自己的工作方式交给模型</p><p><span>着手的小处</span>把一次演示中的事实，变成有证据、有边界的规则</p><h3>先把一次演示变成一份可信的知识，<br><em>再谈让一万个 Skill 在企业里可靠地跑起来。</em></h3></div>''','closing','未来演进')

assert len(pages)==16
assert sorted(shots)==list(range(1,16))
controls='''<nav class="deck-controls" aria-label="演示文稿控制"><button type="button" data-direction="prev" aria-label="上一页">←</button><span id="nav-count">01 / 16</span><button type="button" data-direction="next" aria-label="下一页">→</button><span class="control-divider"></span><button type="button" id="overview-button" title="总览 O" aria-label="页面总览">▦</button><button type="button" id="notes-button" title="备注 N" aria-label="显示讲稿">N</button><button type="button" id="fullscreen" title="全屏 F" aria-label="全屏演示">⛶</button><button type="button" id="save-deck" title="保存含截图的 HTML" aria-label="保存完整 HTML">↓</button></nav>'''
head='''<!doctype html><html lang="zh-CN" data-theme="tech-blue"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="依据课题答辩逐页稿制作的 16 页科技蓝 HTML 演示文稿"><title>让工作本身，成为输入 · 课题答辩</title>'''
html_text=head+'<link rel="stylesheet" href="assets/base.css"><link rel="stylesheet" href="assets/theme.css"></head><body><main class="deck" aria-label="课题答辩 · 16 页">'+''.join(pages)+'</main>'+controls+'<script src="assets/runtime.js"></script><script src="assets/deck.js"></script></body></html>'
(ROOT/'index.html').write_text(html_text)
single=html_text
for css in ['base.css','theme.css']:
    single=single.replace(f'<link rel="stylesheet" href="assets/{css}">', '<style>\n'+(ROOT/'assets'/css).read_text()+'\n</style>')
for js in ['runtime.js','deck.js']:
    single=single.replace(f'<script src="assets/{js}"></script>', '<script>\n'+(ROOT/'assets'/js).read_text()+'\n</script>')
(DOCS/'课题答辩.html').write_text(single)
# A reviewable checklist, not invented evidence.
checklist='# 真实素材补齐清单\n\n以下均来自《课题答辩-逐页稿》，没有使用线框图或示意界面冒充实物。\n\n| 编号 | 真实素材 | 重点标注 |\n| --- | --- | --- |\n'
for n,v in sorted(shots.items()):
    checklist+=f'| {n:02d} | {v["title"]} | {v["focus"]} |\n'
checklist+='\n第 11 位采用逐页稿明确允许的“设计示意”，不表示实现已完成。其余 14 位待补真实脱敏截图。页面可点击截图位填入图片，再用底部 ↓ 保存已嵌入图片的 HTML。\n\n## 真实数据\n\n- 汇报人\n- P3：具体工作，回忆 / 截图 / 组织文字耗时，返工轮次，亲手做与写说明总时长，员工脱敏原话\n- P5：步骤数、系统数、切换次数；文档更新与界面改版日期\n- P10：自动补齐 M 条与仍需澄清 N 条\n- P11：三级执行载体各占几步（可纸面推演）\n- P12：答辩前复核三类产物的实际运行状态\n- P13：交接可用性实测\n- P15：具体演示工作与实际评测分数\n\nP2 耗时对比：逐页稿要求“有数据才上”，因此未填写前不展示。\n'
(ROOT/'待补素材清单.md').write_text(checklist)
print(f'Built {len(pages)} slides; 15 evidence positions; {len(single):,} characters in standalone HTML')
