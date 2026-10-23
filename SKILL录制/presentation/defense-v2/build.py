from pathlib import Path
import re, html
ROOT=Path(__file__).resolve().parent
DOCS=ROOT.parent.parent
source=(DOCS/'课题答辩-逐页稿.md').read_text()
sections=re.split(r'^## P\d+\s*·',source,flags=re.M)[1:]
assert len(sections)==14
sections[-1]=sections[-1].split('\n## 答辩前')[0]
faq=source.split('## 高频追问速查')[1].split('## 变更记录')[0]

def inline(s):
 s=html.escape(s)
 s=re.sub(r'\*\*(.+?)\*\*',r'<strong>\1</strong>',s)
 return re.sub(r'`(.+?)`',r'<code>\1</code>',s)
def md(s):
 return '\n'.join('<p>'+inline(re.sub(r'^>\s?|^#{1,6}\s?','',line))+'</p>' for line in s.splitlines() if line.strip() and line.strip()!='---')
def table(head,rows,cls=''):
 return '<table class="t '+cls+'"><thead><tr>'+''.join('<th>'+x+'</th>' for x in head)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+x+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table>'
def band(s,cls=''):
 return '<div class="takeaway '+cls+'">'+s+'</div>'
def mini(title,copy,cls=''):
 return '<div class="mini '+cls+'"><h3>'+title+'</h3><p>'+copy+'</p></div>'
def icon(kind):
 paths={
 'voice':'<rect x="15" y="4" width="10" height="20" rx="5"/><path d="M10 18v2a10 10 0 0 0 20 0v-2M20 30v6M13 36h14"/>',
 'screen':'<rect x="4" y="5" width="32" height="24" rx="3"/><path d="M14 36h12M20 29v7M9 22l6-7 6 4 8-9"/>',
 'browser':'<rect x="3" y="5" width="34" height="29" rx="3"/><path d="M3 13h34M8 9h1M12 9h1M19 19v13l4-4 4 5 3-2-4-5 6-1z"/>',
 'agent':'<rect x="6" y="10" width="28" height="23" rx="5"/><path d="M20 4v6M14 20h1M25 20h1M14 27h12M2 18v8M38 18v8"/>',
 'analysis':'<circle cx="17" cy="17" r="11"/><path d="m25 25 11 11M11 17h12M17 11v12"/>',
 'file':'<path d="M9 3h14l9 9v25H9zM23 3v10h9M14 21h12M14 27h12M14 32h7"/>',
 'flow':'<rect x="3" y="4" width="12" height="8" rx="2"/><rect x="25" y="16" width="12" height="8" rx="2"/><rect x="3" y="28" width="12" height="8" rx="2"/><path d="M15 8h5v12h5M25 20H20v12h-5"/>',
 'repeat':'<path d="M8 13a14 14 0 0 1 24-2l3 4M35 5v10H25M32 27a14 14 0 0 1-24 2l-3-4M5 35V25h10"/>'}
 return '<svg class="icon" viewBox="0 0 40 40" aria-hidden="true">'+paths[kind]+'</svg>'
icon_route=('<div class="icon-route" role="img" aria-label="人事后凭记忆复述，写成文字指令并附截图与样例，AI 按描述推断补全"><div class="icon-node"><div class="demo-symbol"><svg class="icon" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="13" r="6.5"/><path d="M7 36c0-7.2 5.8-12 13-12s13 4.8 13 12"/></svg></div><b>人</b><small>凭记忆复述</small></div><span class="icon-arrow">→</span><div class="icon-node"><div class="demo-symbol"><svg class="icon" viewBox="0 0 40 40" aria-hidden="true"><path d="M9 3h14l9 9v25H9zM23 3v10h9M14 21h12M14 27h12M14 32h7"/></svg></div><b>文字</b><small>指令 + 截图 + 样例</small></div><span class="icon-arrow">→</span><div class="icon-node"><div class="demo-symbol"><svg class="icon" viewBox="0 0 40 40" aria-hidden="true"><rect x="6" y="10" width="28" height="23" rx="5"/><path d="M20 4v6M14 20h1M25 20h1M14 27h12M2 18v8M38 18v8"/></svg></div><b>AI</b><small>按描述推断补全</small></div></div>')
shots=[]
def shot(n,title,focus,image=None):
 shots.append(n)
 if image:
  return f'<figure class="shot has-image" data-shot="{n}"><div class="shot-heading"><span>实物证据 {n:02d}</span><span class="filled">产品界面 · 已脱敏</span></div><img class="shot-image" src="assets/images/{image}" alt="{title}"><figcaption><span>请看这里</span>{focus}</figcaption></figure>'
 return f'<figure class="shot" data-shot="{n}"><div class="shot-heading"><span>实物证据 {n:02d}</span><span class="missing">真实脱敏截图待补</span></div><div class="shot-placeholder">{icon("screen")}<b>{title}</b><span class="upload-hint">点击填入图片</span></div><figcaption><span>请看这里</span>{focus}</figcaption></figure>'
slides=[]
def page(title,kicker,body,cls='',chapter='问题',subtitle=''):
 n=len(slides)+1
 sec=sections[n-1]
 speech=sec.split('**讲稿**',1)[1].split('**来源**',1)[0] if '**讲稿**' in sec else sec
 # The speaker view holds original script and supporting notes, including unverified Muse source.
 notes='<div class="speaker-script">'+md(speech)+'</div><details><summary>本页完整逐页稿</summary>'+md(sec)+'</details><details><summary>高频追问速查</summary>'+md(faq)+'</details>'
 heading='' if cls=='cover' else '<div class="page-heading"><p class="kicker">'+kicker+'</p><h2 class="h2">'+title+'</h2>'+('<p class="lede">'+subtitle+'</p>' if subtitle else '')+'</div>'
 header='<span class="brand"><i></i>课题答辩</span><span>SKILL RECORDER · RESEARCH PRESENTATION</span>' if cls=='cover' else '<span class="brand"><i></i>SKILL RECORDER</span><span class="section-name">'+chapter+'</span>'
 name=re.sub('<[^>]*>','',title)
 slides.append(f'<section class="slide {"is-active " if n==1 else ""}{cls}" data-page="{n}" data-title="{html.escape(name)}"><div class="deck-header">{header}</div>{heading}<div class="page-body">{body}</div><div class="deck-footer"><span>{"问题 · 方案 · 原型　 /　 汇报人【待补】　 /　 2026.10" if n==1 else "从「描述」到「演示」　 /　 课题答辩"}</span><span class="slide-number" data-current="{n}" data-total="%%TOTAL%%"></span></div><aside class="notes">{notes}</aside></section>')

# Uses the existing html-ppt cover / comparison / flow / table layouts as primitives.
layers=''.join(f'''<article class="layer {cls}"><div class="layer-symbol">{icon(ic)}</div><div class="layer-copy"><div class="layer-head"><span class="layer-tag">{num}</span><h3>{name}</h3>{('<span class="layer-out">产出 ' + out + '</span>') if out else ''}<span class="layer-badge {cls}">{state}</span></div><p class="layer-desc">{desc}<span class="layer-eg"><i>例</i>{eg}</span></p></div></article>''' for num,name,desc,eg,state,cls,ic,out in [
 ('L4','表达层','人如何把自己的工作、需求表达成 AI 能执行的形式：流程、判断与例外都要说清楚','Prompt · Skill · SOP 的编写','本课题关注','now','voice','Skill'),
 ('L3','企业上下文（Context）','业务数据、客户数据、流程数据等企业数据资产，决定 AI 是否真的了解这家公司','企业级数据治理 · 金融中台','本课题补充','doing','file','SOP · 使用手册'),
 ('L2','Agent 层','工具与编排的执行骨架，是 AI 落地的入口','WorkMate · 数字分身 · AgentFactory','相对成熟','done','flow',''),
 ('L1','模型层','理解与推理的通用能力，是 AI 落地的基石','DeepSeek · GLM · Kimi','相对成熟','done','agent','')])
page('从「描述」到「演示」','','''<div class="cover-copy">
      <p class="kicker"><span class="line"></span>人机协同新范式</p>
      <h1 class="h1">从<span class="quiet">「描述」</span><br>到<span class="blue">「演示」</span></h1>
      <p class="cover-subtitle"><span class="dash">——</span>让大模型理解人的真实工作</p>
    </div>
    <div class="cover-visual" role="img" aria-label="真实操作、完整时序与必要澄清，沉淀为 Skill 和 SOP">
      <div class="visual-grid"></div>
      <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
      <svg class="wires" viewBox="0 0 640 570" aria-hidden="true"><path d="M115 160H245Q265 160 265 180V260H350M105 325H350M160 470H245Q265 470 265 450V365H350"/><circle cx="115" cy="160" r="5"/><circle cx="105" cy="325" r="5"/><circle cx="160" cy="470" r="5"/></svg>
      <div class="evidence evidence-one"><span class="signal-icon">↗</span><div><b>真实操作</b><small>按平时的方法做一遍</small></div></div>
      <div class="evidence evidence-two"><span class="signal-icon">≋</span><div><b>完整时序</b><small>保留跨系统的衔接</small></div></div>
      <div class="evidence evidence-three"><span class="signal-icon">···</span><div><b>必要澄清</b><small>再回答几个问题</small></div></div>
      <div class="knowledge-sheet">
        <div class="sheet-head"><span class="sheet-mark">K</span><span>Skill / SOP</span><span class="sheet-dot"></span></div>
        <div class="sheet-lines"><i></i><i></i><i></i></div>
        <div class="sheet-check"><span>✓</span>可理解</div><div class="sheet-check"><span>✓</span>可复用</div><div class="sheet-check"><span>✓</span>可审核</div>
        <div class="sheet-bottom">从一次演示开始</div>
      </div>
      <span class="visual-caption">把一次真实的工作，转化为 <strong>Skill 和 SOP</strong>。</span>
    </div>
''','cover','课题答辩')

page('企业 AI 落地：<em>关注点正在上移</em>','背景与判断',f'''<div class="p2-split"><div class="p2-stack"><i class="stack-axis" aria-hidden="true">↑</i>{layers}</div><aside class="p2-side"><div class="side-top"><p class="overline">本课题</p><h3 class="side-h">让一线员工高效且低成本地把工作方法变成<em>「AI 可执行的形式」</em>，并完成知识沉淀。</h3><p class="side-lead">落在最上面两层，各有一种产出</p></div><div class="side-map"><div><div class="map-head"><span class="map-layer">L3 企业上下文</span><span class="map-out">SOP · 使用手册</span></div><p>把流程、判断与例外写成可查、可交接的知识，补上企业自己缺的那部分上下文</p></div><div class="key"><div class="map-head"><span class="map-layer">L4 表达层</span><span class="map-out">Skill</span></div><p>把一次真实操作变成 Agent 可执行的步骤，覆盖最难描述的那一步</p></div></div><p class="side-note2">同一次演示，两种产物：给人读的规范，给 Agent 跑的技能。</p></aside></div>''','background-page','背景','模型层与 Agent 层相对成熟；关注点已上移到企业上下文与表达层。')

page('卡点有两层：<em>供给主体 · 转化通道</em>','问题的本质',f'''<div class="origin-strip"><span>发现于真实工作</span>自己写 Skill、整理 SOP 的成本　 /　 一线员工难以把工作交给 AI</div><div class="two mismatch"><div class="people-column"><p class="overline">01 / 供给主体</p><h3>工作知识与 AI 能力<br>长在不同的人身上</h3>{table(['','一线业务人员','熟悉 AI 的人'],[['工作知识与判断口径','<b>具备</b>','缺少'],['写成可执行指令的能力','缺少','<b>具备</b>'],['被重复工作消耗的程度','<b>严重</b>','较轻']])}<div class="quo"><span class="quo-tag">现状做法 · 层一</span><h4>换人来写</h4><p class="quo-line"><b>找人翻译</b>：请懂 AI 的人代写 Skill、整理 SOP。<span class="neg">全公司成千上万项日常工作覆盖不过来</span>，翻译本身也是损耗。</p><p class="quo-line"><b>通用 Skill</b>：专业人员集中编写，<span class="neg">但在一线实际工作中仍然需要本地 / 个人调整</span>。</p></div></div><div class="loss-column"><p class="overline">02 / 转化通道</p><h3>即便擅长表达，<br>描述通道仍有损耗</h3><div class="layer-def"><b>隐性知识</b>：可被执行，却难被完整言说。</div><div class="loss-list"><div><span>遗漏</span><p>下意识的默认动作，写不出来</p></div><div><span>失真</span><p>回忆是重构，不是记录</p></div><div><span>成本</span><p>写清楚，常常比做一遍更慢</p></div></div><div class="quo"><span class="quo-tag">现状做法 · 层二</span><h4>教人怎么写</h4><p class="quo-line"><b>培训写 Skill</b>：教一线把工作说清楚、写全指令。</p><p class="quo-line"><span class="neg">遗漏、失真、成本仍在</span>。</p></div></div></div>''','mismatch-page')

page('让工作本身，<em>成为输入</em>','核心主张',f'''<div class="channels"><div class="channel before"><div class="channel-top"><span>今天</span><h3>描述式输入</h3></div>{icon_route}<div class="loss-tags"><span>遗漏</span><span>失真</span><span>成本</span></div><dl><div><dt>用户要做</dt><dd>写完整指令，自备截图与样例</dd></div><div><dt>能力门槛</dt><dd>流程表达能力 + AI 使用经验</dd></div><div><dt>信息来源</dt><dd>事后回忆 + 人工挑选素材</dd></div></dl></div><div class="channel after"><div class="channel-top"><span>本课题</span><h3>演示式输入</h3></div><div class="demo-route" role="img" aria-label="员工照常实操，系统同步录制屏幕、语音与事件，再由 AI 分析素材"><div class="demo-node"><div class="demo-symbol">{icon('browser')}</div><b>真实实操</b><small>照常完成业务</small></div><span class="demo-arrow">→</span><div class="demo-node recording"><div class="demo-symbol">{icon('screen')}<span class="record-signal"><i></i>REC</span></div><b>同步录制</b><small>屏幕 · 语音 · 事件</small></div><span class="demo-arrow">→</span><div class="demo-node"><div class="demo-symbol">{icon('agent')}</div><b>AI 分析</b><small>还原步骤、提炼规则</small></div></div><div class="evidence-label">边做边录，让操作过程成为 AI 的输入</div><dl><div><dt>用户要做</dt><dd><strong>照常做一遍，再回答几个问题</strong></dd></div><div><dt>能力门槛</dt><dd><strong>只需会做这项工作本身</strong></dd></div><div><dt>信息来源</dt><dd>当场发生的真实操作证据</dd></div></dl></div></div>''','claim','主张','以真实操作承载业务知识，降低人向 AI 传授工作方法的成本。')

nodes=''.join(f'<div class="gap-node {cls}"><span class="node-num">0{i}</span>{icon(ic)}<h3>{title}</h3><p>{desc}</p>{("<span class=\"pending-badge\">待验证</span>" if i==3 else "")}</div>' for i,(title,desc,ic,cls) in enumerate([('真实操作','这一次，实际做了什么？','flow',''),('规则','换个样本，应该怎么做？','file','focus'),('可重复执行','换批输入，还能持续做对吗？','repeat','unverified')],1))
page('真实操作 <span class="neq">≠</span> 规则 <span class="neq">≠</span> <em>可重复执行</em>','技术锚点 · 两道鸿沟',f'''<div class="gap-nodes">{nodes}</div><div class="bridges"><div><span>第一道 · 知识提炼</span><b>补证 + 澄清 + 审核</b><p>区分样本与配置，补齐条件与例外</p></div><div><span>第二道 · 执行落地</span><b>能力映射 + 执行验证</b><p>核实依赖，在新输入、多轮运行中检验</p></div></div>''','gaps-page','问题','一次做对，不能替代换输入后的反复验证。')

page('从工作现场，<em>到能力调用</em>','方案总体 · 一图贯通',f'''<div class="pipeline"><div class="pipe-panel inputs"><div class="pipe-title"><span>01</span><h3>工作现场</h3></div><small>员工日常办公的云桌面</small><ul><li>{icon('screen')}屏幕快照</li><li>{icon('flow')}鼠标 / 窗口切换</li><li>{icon('browser')}浏览器真实事件</li><li>{icon('voice')}语音口述<small>捕获“为什么”</small></li><li>{icon('file')}剪贴板 / 终端输出</li></ul></div><div class="pipe-arrow"><span>还原</span>→</div><div class="pipe-panel trace"><div class="pipe-title"><span>02</span><h3>执行轨迹</h3></div><div class="trace-line"><i>1</i><i>2</i><i>3</i><i>4</i></div><p>做了什么<br>在哪个系统<br>为什么这样判断</p><div class="variable"><b>变量提取</b><span>每次变化 → 运行时输入</span><span>长期不变 → 固定配置</span></div></div><div class="pipe-arrow"><span>提炼</span>→</div><div class="pipe-panel artifact"><div class="pipe-title"><span>03</span><h3>Skill / SOP</h3></div>{icon('file')}<p>步骤与规则<br>证据与边界<br>变量与依赖</p><div class="audit-tag">澄清 + 人工审核</div></div><div class="pipe-arrow"><span>映射</span>→</div><div class="pipe-panel execution"><div class="pipe-title"><span>04</span><h3>既有能力调用</h3></div><div class="tool"><b>首选</b>内部 CLI / 原生工具</div><div class="tool"><b>其次</b>已授权业务 MCP</div><div class="tool fallback"><b>兜底</b>浏览器自动化<small>仅 UI 专属环节</small></div><span class="pending-badge">方案设计 · 链路未全量接通</span></div></div>{band('人照常工作，系统负责<strong>还原 → 提炼 → 映射</strong>。')}<p class="boundary">目标部署形态为云桌面；部署与性能待验证。能力调用与重复执行可靠性，按实际实现进度分别验收。</p>''','pipeline-page','方案','在真实工作中录一遍，把操作转为有证据、有边界的工作知识。')

stages=''.join(f'<div class="stage"><span>0{i}</span><div><h3>{name}<small>{question}</small></h3><p>{flow}</p><b>{human}</b></div></div>' for i,(name,question,flow,human) in enumerate([
 ('演示与忠实还原','你做了什么','录制 → 基础分析 → 用户确认','① 确认素材'),('证据化深度分析','规则是什么，证据在哪','权限判定 → 自动补证 → 一次澄清 → 人工审核','② 回答一次澄清　③ 逐条审核结论'),('知识资产生成','以后靠什么执行','能力映射 → 确定性渲染 → 导出','生成后查看正文，再显式保存')],1))
page('总体架构：<em>三步 · 四原则</em>','方案架构',f'''<div class="two architecture"><div class="stage-list">{stages}</div>{shot(1,'真实流程界面 / 阶段进度','产品界面：素材确认 → 补充分析 → 生成 → 发布',image='flow-stages.png')}</div><div class="principle-strip"><span>忠实复述与业务判断分离</span><span>证据优先，拒绝模型自评</span><span>连续运行，一次澄清</span><span>演示输入，能力执行</span></div><p class="boundary">分析阶段三个介入点；生成后仍需查看正文并显式保存。执行方式翻译的实现边界见 P9 / P11。</p>''','architecture-page','方案')

page('关键机制：<em>记录过程，补齐信息</em>','多源采集 · 自动补证',f'''<div class="mech2">
<article><span class="mech-num">01</span><h3>多源采集</h3><p>屏幕、浏览器事件、剪贴板、终端与语音，保留真实操作与上下文。</p><b>录制、抽帧、语音转写均在本机。</b>{shot(2,'采集时间线 · 三条轨道','语音片段、截屏采样、浏览器事件按时间对齐；发送前模糊处理 10 处屏幕区域',image='capture-timeline.png')}</article>
<article><span class="mech-num">02</span><h3>自动补证</h3><p>Agent 分析素材，在授权范围内补齐信息缺口。</p><b>系统先查，剩余问题再请人澄清。</b>{shot(3,'分析过程 · 步骤进度','自检模型连接后逐步推进：规划工具 → 读取材料 → 深度分析 → 整理结果',image='auto-analysis.png')}</article>
</div>''','mechanisms-page','方案')

swim_steps = ''.join(f'''<div class="swim-step" style="grid-row:{i+1}"><em>{i:02d}</em><b>{name}</b><small>{note}</small></div>''' for i,(name,note) in enumerate([
 ('登录业务系统','输入账号，进入系统'),
 ('下载报表','按周期筛选，导出 Excel'),
 ('用 Excel 加工数据','公式、透视表、异常剔除'),
 ('加工后的数据发到邮箱','填写收件人，附上文件')],1))
swim_caps = ''.join(f'''<div class="swim-cap" style="grid-row:{row}"><b>{name}</b><span>{note}</span></div><div class="swim-arrow" style="grid-row:{row}" aria-hidden="true">→</div>''' for row,name,note in [
 ('2 / 4','调用业务系统 MCP','一次调用完成登录会话与报表取数，替掉界面上的两步'),
 ('4','编写数据处理逻辑','把 Excel 里的加工步骤写成可复用的处理逻辑'),
 ('5','调用邮箱 MCP 发送','收件人与附件由任务传入，发送结果可回读')])
page('关键机制：<em>把操作翻译成能力调用</em>','执行方式翻译',f'''
<div class="workflow-caption"><span>贯穿案例</span><b>生成并发送月度经营报告</b><small>方案示意</small></div>
<div class="swim">
  <div class="swim-head"><span>真实操作 · 人在系统里做的事</span></div>
  <div class="swim-head right"><span>翻译后的动作 · Skill 里的一条操作（可稳定重复执行）</span></div>
  {swim_steps}
  {swim_caps}
</div>
<p class="opmap-note">人做一步，Skill 里就有一步对应；参数（周期、范围、收件人）由任务传入，换一批输入仍走同一条路径。</p>
''','execution-page','方案','演示是需求说明书，不是执行脚本。')

page('不是 RPA 回放，<em>也不是 Computer Use</em>','方案定位',f'''
<div class="cmp3">
  <article><span>RPA 录制回放</span><h3>按录制的界面路径执行</h3><dl><div><dt>执行依据</dt><dd>录下来的点击、输入与坐标</dd></div><div><dt>换一批输入</dt><dd>页面或流程一变就要重录</dd></div><div><dt>出问题时</dt><dd>只能整段重跑，难定位</dd></div><div><dt>适合场景</dt><dd>界面与步骤都固定的重复操作</dd></div></dl></article>
  <article><span>Computer Use</span><h3>边看屏幕，边决定操作</h3><dl><div><dt>执行依据</dt><dd>每一步实时识别界面</dd></div><div><dt>换一批输入</dt><dd>每次重新判断，慢且不稳</dd></div><div><dt>出问题时</dt><dd>结果难复现，难审核</dd></div><div><dt>适合场景</dt><dd>界面多变、系统不开放时的临时任务</dd></div></dl></article>
  <article class="now"><span>本方案</span><h3>按明确的能力路径执行</h3><dl><div><dt>执行依据</dt><dd>用户操作对齐到既有能力</dd></div><div><dt>换一批输入</dt><dd>只换参数，路径不变</dd></div><div><dt>出问题时</dt><dd>逐步校验，能定位到哪一步</dd></div><div><dt>适合场景</dt><dd>跨系统、多步骤、需要反复执行的日常工作</dd></div></dl></article>
</div>
{band('与 RPA 的分界线：<strong>不回放点击，而是调用能力。</strong>')}''','execution-page','方案','三种执行方式的差别，不在能不能自动，而在按什么执行。')

page('同源三产出，<em>应用场景决定形态</em>','产物设计',f'''
<div class="shared"><span>同一份已审核的工作知识</span><strong>登录取数 → 下载报表 → Excel 加工 → 邮件发送</strong></div>
<div class="three output-use-cards">
  <article class="output-use-card"><div class="output-use-heading"><h3>SOP</h3><span>人来执行</span></div><dl><div><dt>用途</dt><dd>规范操作步骤与业务判断口径</dd></div><div><dt>场景</dt><dd>岗位交接 · 人工操作 · 复核</dd></div></dl><div class="output-case"><span>本例产物</span><b>月度报表编制 SOP</b><p>登录业务系统、下载报表、用 Excel 加工数据、把结果发到邮箱，逐步写清判断与例外。</p></div></article>
  <article class="output-use-card focus"><div class="output-use-heading"><h3>Skill</h3><span>Agent 执行</span></div><dl><div><dt>用途</dt><dd>编排工具与分析 Skill，复用调用路径</dd></div><div><dt>场景</dt><dd>周期报告 · 重复任务自动化</dd></div></dl><div class="output-case"><span>本例产物</span><b>月度报表 Skill</b><p>调用业务系统 MCP 取数 → 执行数据处理逻辑<br>→ 调用邮箱 MCP 发送，参数随任务传入。</p></div></article>
  <article class="output-use-card"><div class="output-use-heading"><h3>使用手册</h3><span>人来学习</span></div><dl><div><dt>用途</dt><dd>说明功能入口、参数与操作方法</dd></div><div><dt>场景</dt><dd>新人培训 · 操作查询 · 使用答疑</dd></div></dl><div class="output-case"><span>本例产物</span><b>月度报告数据说明手册</b><p>按功能讲清数据来源、筛选下载、加工口径与邮件发送，便于学习与查阅。</p></div></article>
</div><div class="output-evidence"><figure class="output-figure"><div class="output-figure-head"><span>实物证据 04</span><span class="filled">产品界面 · 已脱敏</span></div><img src="assets/images/generate-options.png" alt="生成阶段：SOP 操作说明 / 产品使用手册 / 通用 Skill 三选一"><figcaption><span>请看这里</span>先问“要创建什么”，三份产物同源</figcaption></figure><div class="output-note"><b>同一次录制，三份产物</b><p>用户在生成阶段勾选要哪种：SOP 按操作顺序还原、手册按功能目录覆盖、Skill 按能力调用编排；审核与显式保存的流程一致。</p><p class="output-note-k">同一份知识，三种形态：<strong>人照着做、Agent 跑起来、新人看得懂。</strong></p></div></div>''','outputs-page','方案')

capabilities=[('voice','语音录制与转写','内置语音模型，将口述讲解转成文字','已实现',''),('screen','屏幕录制与截图','基于关键帧变化检测，自动截取画面','已实现',''),('browser','浏览器事件采集','插件采集点击等真实交互事件','已实现',''),('agent','Agent 原始数据分析','引入 Claude Code Agent 分析录制素材','已实现初步分析',''),('analysis','深度分析','已有补证、澄清与审核，仍需实测复核','部分实现','partial'),('file','转为标准制品','具备 Skill 等制品生成与导出基础','部分实现','partial')]
caps=''.join(f'<div class="capability {cls}">{icon(ic)}<span class="cap-status">{status}</span><h3>{title}</h3><p>{desc}</p></div>' for ic,title,desc,status,cls in capabilities)
page('核心能力<em>已初步构建</em>','可行性分析 · 当前 Demo',f'''<div class="capabilities">{caps}</div><div class="quality-strip"><span>产品化四关</span><b>去掉噪音</b><i>→</i><b>正确还原轨迹</b><i>→</i><b>正确生成 Skill</b><i>→</i><b>新输入下重复执行</b></div>{band('Demo 展示能力基础；<strong>产品是否可用，还要靠效果的持续打磨与验证。</strong>','dark')}<p class="boundary">尚未开展真实业务试运行；受控业务 MCP 自动调用链路未接通，重复执行可靠性仍待验证。</p>''','demo-page','原型','Demo ≠ 可用产品，真正的门槛是效果。')

lifecycle=''.join(f'<div class="life-node {"current" if i==1 else ""}"><span>0{i}</span><b>{name}</b><small>{desc}</small></div>' for i,(name,desc) in enumerate([('生成','当前聚焦'),('评估','质量门禁'),('发布','版本 / 权限'),('回测','回归测试'),('A/B','对照实验'),('监控','可观测性'),('演进退役','依赖与漂移')],1))
page('大处着眼，<em>小处着手</em>','演进与收束',f'''<div class="lifecycle">{lifecycle}</div><div class="three future-directions">{mini('回测与漂移检测','规则挂着证据，才能比对现实变化。')}{mini('评估基准自动构建','一次演示，也可沉淀为回归用例。')}{mini('发布与权限治理','Skill 是具备权限的执行主体。')}</div><p class="boundary">以上均为演进方向，不属于本课题交付范围。</p><div class="closing-statement"><span>从一份可信的知识开始</span><h3>先把一次演示变成一份可信的知识，<br><em>再谈让一万个 Skill 在企业里可靠地跑起来。</em></h3></div>''','closing','未来演进')

page('未来规划：<em>从个人效率到组织资产</em>','未来规划',f'''<p class="value-lead">从个人验证起步，逐步沉淀企业自己的工作方式。</p><div class="stairs"><div class="step-l1"><span>L1 / 当前验证重点</span><h3>个人效率</h3><p>演示者自己的<br>可复用 Skill</p></div><div class="step-l2"><span>L2 / 下一步探索</span><h3>组织知识资产</h3><p>可交接、可审计<br>口径统一的流程资产</p></div><div class="step-l3"><span>L3 / 长期方向</span><h3>企业 AI 生产力基础设施</h3><p>可管理、可发布、可度量<br>的 Skill 资产体系</p></div></div>{band('先验证个人可复用，再探索<strong>团队共享与企业级治理</strong>。')}<p class="boundary">当前验证重点为个人知识产出；组织共享与企业级治理属于后续规划。</p>''','value-page','未来规划')

assert len(slides)==14
assert sorted(shots)==[1,2,3]
controls='''<nav class="deck-controls" aria-label="演示文稿控制"><button data-direction="prev" aria-label="上一页">←</button><span id="nav-count">01 / 14</span><button data-direction="next" aria-label="下一页">→</button><span class="control-divider"></span><button id="overview-button" title="总览 O" aria-label="页面总览">▦</button><button id="notes-button" title="讲稿 N" aria-label="显示讲稿">N</button><button id="fullscreen" title="全屏 F" aria-label="全屏演示">⛶</button><button id="save-deck" title="保存含截图的 HTML" aria-label="保存完整 HTML">↓</button></nav>'''
head='<!doctype html><html lang="zh-CN" data-theme="tech-blue"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>从描述到演示 · 课题答辩 V2 · 科技蓝</title><meta name="description" content="依据 2026-10-20 最新逐页稿制作的 14 页 HTML 演示文稿">'
s=head+'<link rel="stylesheet" href="assets/base.css"><link rel="stylesheet" href="assets/theme.css"></head><body><main class="deck" aria-label="课题答辩 · 14 页">'+''.join(slides)+'</main>'+controls+'<script src="assets/runtime.js"></script><script src="assets/deck.js"></script></body></html>'
s=s.replace('%%TOTAL%%',str(len(slides)))
(ROOT/'index.html').write_text(s)
for img in (ROOT/'assets'/'images').glob('*.png'):
 import base64 as _b64
 uri='data:image/png;base64,'+_b64.b64encode(img.read_bytes()).decode()
 s=s.replace(f'src="assets/images/{img.name}"', f'src="{uri}"')

for css in ['base.css','theme.css']:
 s=s.replace(f'<link rel="stylesheet" href="assets/{css}">','<style>\n'+(ROOT/'assets'/css).read_text()+'\n</style>')
for js in ['runtime.js','deck.js']:
 s=s.replace(f'<script src="assets/{js}"></script>','<script>\n'+(ROOT/'assets'/js).read_text()+'\n</script>')
(DOCS/'课题答辩-v2-科技蓝.html').write_text(s)
(ROOT/'逐页稿快照.md').write_text(source)
print(f'Built {len(slides)} slides; 4 evidence positions; standalone HTML:',DOCS/'课题答辩-v2-科技蓝.html')
