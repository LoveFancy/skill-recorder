"""Generate the v11 review wireframes. No application code or user data is changed."""
from pathlib import Path
import html,json,math,re
R=Path(__file__).resolve().parent
P=R.parent
screens=[]
def esc(v):return html.escape(str(v))
def rect(x,y,w,h,fill='white',stroke='#d8d8d5',rx=8):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}"/>'
def txt(x,y,v,size=15,color='#333',weight=400):return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}">{esc(v)}</text>'
def line(x,y,x2,y2):return f'<line x1="{x}" y1="{y}" x2="{x2}" y2="{y2}" stroke="#dededb"/>'
def link(target,body,label=''):return f'<a href="#{target}" data-screen="{target}" aria-label="{esc(label or target)}">{body}</a>'
def btn(x,y,w,label,target=None,primary=False):
 b=rect(x,y,w,38,'#303030' if primary else '#fafafa')+txt(x+16,y+25,label,14,'white' if primary else '#444',500)
 return link(target,b,label) if target else b

def base():
 return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" font-family="PingFang SC,Microsoft YaHei,sans-serif">'+rect(0,0,1200,900,'#fafaf9','#bbb',10)+rect(1,1,1198,35,'white','none',10)+txt(22,24,'技能录制器',14,'#777',500)+line(0,36,1200,36)

def side(current_state="待完善"):
 s=rect(1,37,259,862,'#f5f5f3','none',0)+line(260,36,260,900)+txt(24,78,'录制记录',16,'#555',600)+link('home',txt(191,78,'新录制',13))
 for i,(title,state,date) in enumerate([('订单报价',current_state,'今天 10:32'),('整理客户资料','已保存','昨天 16:20'),('导出销售报表','已分析','昨天 11:08')]):
  y=104+i*104;s+=link('analysis',rect(14,y,232,88,'#eaeae6' if i==0 else 'white','#999' if i==0 else '#ddd')+txt(28,y+24,date,12,'#888')+txt(28,y+49,title,16,'#333',600)+txt(28,y+72,'4分32秒  ·  '+state,12,'#888'))
 s+=link('settings',txt(24,865,'设置',14,'#666'))
 return s

def shell(stage=1,status='',footer=None):
 s=base()+side('已保存' if status=='已保存' else '分析中' if status=='分析中' else '草稿' if stage==3 else '待完善')+rect(261,37,938,63,'white','none',0)
 for i,(x,w,name,target) in enumerate([(292,244,'1 原始素材确认','analysis'),(568,218,'2 深度分析','deep-result'),(818,150,'3 生成','preview')],1):
  if i==stage:s+=rect(x,48,w,40,'#eaeae6','none',7)
  s+=link(target,txt(x+16,74,name,17,'#333' if i==stage else '#888',600 if i==stage else 400))
  if i<3:s+=txt(x+w+13,74,'›',18,'#aaa')
 s+=line(260,100,1200,100)+txt(304,127,'订单报价',13,'#666')+txt(428,127,'今天 10:32',12,'#999')
 if status:s+=txt(960,127,status,12,'#888')
 s+=line(260,144,1200,144)
 if footer:s+=rect(261,818,938,81,'white','none',0)+line(260,818,1200,818)+footer
 return s

def add(id,title,group,s,notes):
 assert id not in {x['id'] for x in screens}
 screens.append(dict(id=id,title=title,group=group,notes=notes,svg=s+'</svg>'))

def recorder(active=False):
 # Preserve the user's existing portrait recorder. Outer canvas is only for the gallery.
 s='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" font-family="PingFang SC,Microsoft YaHei,sans-serif">'+rect(0,0,1200,900,'#eee','none',0)+'<g transform="translate(360,36)">'
 s+=rect(0,0,480,820,'#faf9f7','#bbb',20)+rect(1,1,478,38,'white','none',20)+line(0,39,480,39)
 for x in [20,48,76]:s+=f'<circle cx="{x}" cy="20" r="8" fill="#ddd"/>'
 s+=txt(102,27,'技能录制器',17,'#666',600)+link('settings',txt(420,75,'设置',15,'#777'))
 control='<circle cx="240" cy="112" r="45" fill="#faf9f7" stroke="#d8d8d5"/><circle cx="240" cy="112" r="20" fill="#e7e7e3"/>'
 control+=rect(228,100,24,24,'#444','none',4) if active else '<circle cx="240" cy="112" r="16" fill="#444"/>'
 s+=link('analyzing' if active else 'goal',control,'结束录制' if active else '开始录制')
 s+=f'<text x="240" y="202" text-anchor="middle" font-size="40" font-weight="600" fill="#888" font-family="monospace">{"00:32" if active else "00:00"}</text>'
 s+=f'<text x="240" y="235" text-anchor="middle" font-size="15" fill="#888">{"正在录制" if active else "准备录制"} · Mi Monitor</text>'
 s+=rect(22,272,436,80,'#faf9f7')+txt(42,306,'录制内容',18,'#333',600)+txt(42,334,'整个屏幕 · Mi Monitor',15,'#888')+btn(296,290,142,'选择屏幕或应用')
 s+=rect(22,380,436,64,'#ededE9','#bbb',14)+txt(42,419,'♩',22,'#777')+txt(70,408,'语音旁白',17,'#333',600)+txt(70,429,'中文',13,'#777')+link('speech',txt(366,419,'⚙',20,'#777'))+rect(400,398,42,26,'#555','none',13)+'<circle cx="428" cy="411" r="10" fill="white"/>'
 s+=rect(22,455,436,64,'#faf9f7')+txt(70,483,'记录屏幕和操作活动',16,'#333',600)+txt(70,504,'查看具体采集内容',14,'#888')+txt(427,492,'›',24,'#888')
 s+=link('analysis',rect(22,530,436,66,'#f2f2ef')+txt(70,558,'查看录制记录  ⑤',17,'#333',600)+txt(70,580,'5 条待分析',15,'#777')+txt(427,568,'›',24,'#888'))
 for i,(label,value) in enumerate([('智能处理','Claude Code · 已就绪'),('语音转写','SenseVoice · 本地处理'),('隐私保护','已开启 · 本地处理'),('浏览器插件','录制中' if active else '已连接')]):
  y=654+i*36;s+=f'<circle cx="31" cy="{y-5}" r="9" fill="#777"/>'+txt(26,y,'✓',12,'white')+txt(50,y,label,15,'#888')+f'<text x="458" y="{y}" text-anchor="end" font-size="13" fill="#888">{esc(value)}</text>'
 s+='<text x="240" y="802" text-anchor="middle" font-size="12" fill="#999">⌘⇧R 随时开始或结束录制</text></g>'
 return s

def goal(voice=None):
 background=recorder().split('>',1)[1]
 s=base()+'<g opacity="0.18" pointer-events="none">'+background+'</g>'+rect(220,100,760,650 if voice else 490,'white','#bbb',12)
 s+=txt(258,151,'这次想记录什么？',24,'#333',600)+link('home',txt(938,146,'×',22,'#888'))
 s+=txt(258,201,'希望产出什么',14,'#666')
 for x,w,label in [(258,194,'○  操作说明（SOP）'),(464,212,'○  可复用技能（Skill）'),(688,254,'○  暂不确定')]:s+=btn(x,217,w,label)
 s+=txt(258,296,'你想让它帮你完成什么？',16,'#333',600)+rect(258,318,684,132)
 s+=txt(278,350,'例如：根据订单准备报价单，确认后发给客户。',15,'#999')
 # Reuse the microphone glyph from the accepted v10 goal drawing.
 old=(P/'41-recording-intent.svg').read_text();m=re.search(r'<a[^>]*aria-label="语音输入".*?</a>',old)
 if not voice and m:
  mic=m.group(0).replace('#42-intent-voice','#voice').replace('data-screen="42-intent-voice"','data-screen="voice"')
  s+='<g transform="translate(18,31)">'+mic+'</g>'
 if voice:
  s+=rect(258,468,684,164,'#f6f6f3')
  if voice=='listen':
   s+=txt(280,500,'正在听…',17,'#333',600)+txt(280,532,'00:18    ▂ ▃ ▅ ▃ ▂ ▅ ▃',16,'#777')+txt(280,556,'尚未开始录屏',12,'#999')+btn(280,576,156,'结束并转写','voice-review',True)+link('goal',txt(830,601,'取消',14,'#777'))
  else:
   s+=txt(280,500,'核对一下识别的文字',17,'#333',600)+txt(280,531,'根据订单准备报价单和邮件，发送前先给我确认。',14)+btn(280,576,130,'采用文字','goal',True)+link('voice',txt(815,601,'重新录音',14,'#777'))
  s+=line(220,656,980,656)+link('goal',txt(258,704,'返回',14,'#666'))+txt(678,704,'采用文字后再确认录制',13,'#999')
 else:s+=line(220,484,980,484)+link('home',txt(258,540,'取消',14,'#666'))+btn(750,514,192,'确认并开始录制','recording',True)
 return s

# Main path: actual decisions, not every loading/exception state.
add('home','录制页：保持现有界面','主流程',recorder(),['以用户提供的真实录制页为底稿，保持竖向窗口、圆形按钮、计时器、卡片及四行状态原样布局。','圆形录制按钮与快捷键先打开目标确认；确认后才开始采集。设置及其他入口位置不变。'])
add('goal','录制前：一句话说明目标','主流程',goal(),['只收集产出类型和任务目标；初始不代选、不代填。示例为占位文字。','文字或麦克风输入；至少填写目标后主按钮才启用。权限失败保留目标。'])
add('recording','录制中：保持原布局','主流程',recorder(True),['沿用录制页布局，只更新计时、停止按钮与实际采集状态；不替换为宽屏工作台。','结束后保存再进入分析，浏览器心跳不冒充录制成功。'])
s=shell(1,'分析中')+txt(304,211,'正在整理这次操作…',24,'#333',600)+txt(304,252,'已用时 00:35',14,'#888')+link('analysis-error',txt(1090,251,'取消',14,'#777'))+rect(304,299,852,112,'white')+rect(330,327,270,15,'#dededb','none',4)+rect(330,362,620,10,'#eee','none',4)+rect(304,429,852,112,'white')+rect(330,457,340,15,'#dededb','none',4)+rect(330,492,580,10,'#eee','none',4)
add('analyzing','分析中：只显示当前进度','主流程',s,['显示真实阶段与耗时；不虚构百分比，完成后自动呈现分析结果。','取消只停止当前处理，保留录制；再次开始须显式操作。'])

def analysis(expanded=False):
 s=shell(1,'',link('goal-edit',txt(304,862,'修改录制目标',14,'#777'))+btn(954,839,202,'确认并深度分析','clarify-loading',True))
 s+=link('analyzing',txt(994,127,'重新分析',12,'#777'))
 s+=link('timeline' if not expanded else 'analysis',rect(304,164,852,38,'#f3f3f0','none',6)+txt(320,189,'录制材料   语音 12   ·   截图 38   ·   浏览器 26',13,'#777')+txt(1088,189,'收起' if expanded else '展开',13,'#777'))
 y=244
 if expanded:
  s+=rect(304,216,852,184)
  for j,(label,count) in enumerate([('语音',12),('录屏',38),('浏览器',26)]):
   yy=248+j*40;s+=txt(322,yy+6,label,13,'#777')+rect(390,yy-10,660,20,'#eee','none',4)+txt(1090,yy+5,count,12,'#888')
   for k in range(7):s+=rect(415+k*87+(j%2)*20,yy-7,24 if j==0 else 3,14,'#999','none',2)
  s+=txt(390,382,'0:00',11,'#999')+txt(1012,382,'04:32',11,'#999');y=442
 s+=txt(304,y,'这次操作：准备并发送订单报价',24,'#333',600)+link('analysis-edit',txt(1118,y,'修改',13,'#777'))
 s+=txt(304,y+36,'从订单获取报价单，填写收件人，添加附件后点击发送。',15,'#777')
 for i,(title,desc) in enumerate([('打开订单','查看订单和客户信息'),('准备报价单','下载文件并添加到邮件'),('填写收件人并发送','录制中有发送动作，是否送达尚不清楚')]):
  yy=y+78+i*79;s+=txt(308,yy,str(i+1),15,'#888')+txt(338,yy,title,16,'#333',500)+txt(338,yy+27,desc,13,'#888')+link('timeline',txt(1088,yy,'查看',13,'#888'))
 return s
add('analysis','分析：看懂这次操作','主流程',analysis(),['40px 级工具栏，不重复大标题；材料折叠条、时间线和正文左右对齐。','只显示操作摘要和步骤；截图、转写、事件来源按需打开。','点击继续进入澄清，表示继续使用此分析，不把模型推断或未观察结果自动标成已证实。'])

def question(s,y,n,title,opts,chosen=None,other=False,unknown=False):
 s+=txt(304,y,f'问题 {n}',13,'#888')+txt(304,y+32,title,20,'#333',600)
 for i,opt in enumerate(opts):
  yy=y+50+i*44
  active=chosen==i
  s+=link('clarify-answered',rect(304,yy,852,36,'#eeeee9' if active else 'white','#bbb' if active else '#ddd',6)+txt(320,yy+24,('●  ' if active else '○  ')+opt,14))
 yy=y+50+len(opts)*44
 s+=link('clarify-other',txt(312,yy+20,'●  其他' if other else '○  其他',14))+link('clarify-unknown',txt(1052,yy+20,'暂不确定',13,'#888'))
 if other:s+=rect(304,yy+36,852,64)+txt(320,yy+62,'使用客户档案中的采购联系人；有多个时先问我。',14)
 return s

def clarify(mode='blank'):
 answered=mode in ['answered','other'];unknown=mode=='unknown'
 target='deep-result-incomplete' if unknown else 'deep-refining'
 label='暂不确定，继续' if unknown else '提交并继续分析'
 # Unanswered questions can be skipped with an explicit draft action; no default answers.
 s=shell(2,'',link('materials',txt(304,861,'＋ 补充说明或文件',14,'#777'))+btn(984,839,172,label,target,True))
 s+=txt(304,205,'还需要你确认两点',24,'#333',600)+txt(304,241,'选一个答案，也可以填写自己的做法。',14,'#888')
 s=question(s,287,1,'以后需要处理哪些订单？',['我提供的订单号','所有已支付、未退款的订单'],0 if answered or unknown else None)
 s+=line(304,493,1156,493)
 s=question(s,531,2,'报价单应该发给谁？',['订单里的客户联系人','每次由我指定'],0 if mode=='answered' else None,mode=='other',unknown)
 if unknown:s+=txt(304,777,'收件人还不确定，将在草稿中保留提醒。',13,'#777')
 elif mode=='blank':s+=txt(304,777,'未回答的内容会标为待补充。',13,'#888')
 return s
add('clarify','澄清和补充：一页问卷','主流程',clarify(),['取消所有二级阶段导航；问题、其他输入、可选材料在同一页完成。','首次只展示 1–3 个必要业务问题；不问模型配置、工具或标注含义。','默认无答案。生成草稿提交当前回答及材料；未答保持缺口，不要求额外确认材料页。'])
s=shell(3,'生成中')+txt(304,211,'正在生成草稿…',24,'#333',600)+txt(304,252,'已用时 00:28',14,'#888')+link('generation-error',txt(1090,251,'取消',14,'#777'))+rect(304,300,852,298)+txt(330,339,'订单报价',20,'#999',500)
for j,w in enumerate([650,560,700,470]):s+=rect(330,380+j*45,w,12,'#eee','none',3)
add('generating','生成中：根据已确认结果生成','主流程',s,['回答提交后自动整理并生成候选草稿，统一显示一个等待状态。','内部仍有冻结输入、隐私处理、补充校验、能力约束和生成；无需用户逐页触发。','遇到影响结果的业务冲突，返回同页追加一个明确问题；技术故障不伪装业务问题。'])

def preview(draft=False,sop=False):
 s=shell(3,'草稿',link('deep-result',txt(304,861,'返回深度分析',14,'#777'))+link('generating',txt(510,861,'重新生成',14,'#777'))+btn(954,839,202,'确认并保存草稿' if draft else '确认并保存','saved-draft' if draft else 'saved',True))
 s+=txt(304,201,'看看是否符合你的做法',24,'#333',600)+txt(304,238,'操作说明（SOP）' if sop else '可复用技能（Skill）',14,'#666')+link('output',txt(496,238,'更改',13,'#888'))+link('source',txt(1056,238,'查看文件',13,'#888'))
 if draft:s+=rect(304,261,852,44,'#eeeee9','none',6)+txt(320,289,'待补充：收件人尚未确定。',14,'#555')
 y=335 if draft else 290
 s+=rect(304,y,852,435)+txt(332,y+42,'订单报价',23,'#333',600)+link('preview-edit',txt(1090,y+40,'修改',13,'#888'))
 for off,title,desc in [(86,'适用范围','处理你提供的订单号。'),(162,'操作步骤','核对订单 → 准备报价单 → 填写收件人 → 确认后发送。'),(238,'发送前确认','先给你查看邮件正文和附件，确认后再发送。')]:
  s+=txt(332,y+off,title,14,'#777',600)+txt(332,y+off+30,desc,15)
 s+=txt(332,y+321,'收件人',14,'#777',600)+txt(332,y+351,'待补充：每次先询问收件人。' if draft else '使用订单里的客户联系人；找不到时先询问。',15)
 s+=link('sources',txt(332,y+401,'查看依据',13,'#888'))+txt(935,y+401,'尚未实际运行',12,'#999')
 s+=link('skill-tools',txt(304,790,'使用此技能需要：邮箱、订单系统 · 查看',13,'#777'))
 return s
add('preview','生成：统一预览与确认','主流程',preview(),['取消生成准备页和独立计划审核页；默认展示易读内容，不先展示 SKILL.md 源码。','唯一一次最终确认在此：所见规则、步骤和缺口一并确认后保存；生成完成不等于用户批准。','来源详情按需展开，尚未核验的信息不得变成固定规则；输出偏好沿用录制前选择。'])

def saved(draft=False):
 return shell(3,'已保存')+txt(304,244,'草稿已保存' if draft else '已保存',28,'#333',600)+txt(304,294,'订单报价 · 待补充' if draft else '订单报价',18,'#666')+txt(304,331,'收件人信息仍待补充。' if draft else '可以在文件夹中查看生成的内容。',14,'#888')+btn(304,380,172,'查看保存位置',None,True)+link('draft' if draft else 'preview',txt(510,405,'返回内容',14,'#777'))
add('saved','保存完成：一个结束状态','主流程',saved(),['点击确认并保存后调用原生保存对话框，取消/失败留在预览；仅保存成功后显示本页。','文件系统按钮在线稿中为位置示意，不假装已产生实际文件。'])
# Supporting states, not extra required steps.
add('voice','语音输入','可选与异常',goal('listen'),['麦克风仅用于这一段目标；不提前录屏。失败回到文字输入，保留已有文字。'])
add('voice-review','核对语音文字','可选与异常',goal('review'),['采用回填原目标，已有内容冲突时选择追加/替换；不静默覆盖，不自动开始录制。'])
add('timeline','展开录制材料','可选与异常',analysis(True),['保留三条时间轴；悬停分别预览转写、截图、浏览器操作。','无数据明确显示未采集/无操作，禁止用加载状态冒充空数据。'])
def enrichment_progress(mode='reading'):
 footer=link('analysis',txt(304,861,'返回原始素材',14,'#777'))+btn(984,839,172,'取消分析','deep-cancelled')
 if mode in ['login','failed']:
  footer=link('clarify-loading',txt(304,861,'重新检查' if mode=='login' else '重试查询',14,'#777'))+btn(934,839,222,'先用录制内容继续','clarify-unenriched',True)
 s=shell(2,'',footer)+txt(304,205,'正在深度分析…',24,'#333',600)+txt(1030,205,'已用时 00:35',13,'#888')
 s+=txt(304,242,'结合你的目标，补充操作细节和业务规则。',14,'#888')
 s+=txt(304,302,'本次使用',14,'#777',600)+txt(304,348,'录制材料',16,'#444',500)+txt(304,374,'操作 · 截图 · 语音',12,'#999')
 if mode!='matching':s+=link('capability-details',txt(304,432,'邮箱 MCP  ›',16,'#444',500))
 if mode in ['login','failed']:s+=txt(304,460,'未能读取',12,'#999')
 s+=line(508,280,508,774)+txt(548,302,'工作进展',14,'#777',600)
 events=[('00:02','已整理原始操作','识别到订单、邮箱和浏览器操作。',False)]
 if mode=='matching':events+=[('00:05','正在匹配可用工具…','检查已启用能力与本次任务是否匹配。',True)]
 else:
  events+=[('00:05','已匹配邮箱工具','用于核对这次邮件的主题、收件人和附件。',False)]
  if mode=='login':events+=[('00:12','邮箱登录已过期','尚未读取邮件，可以登录后重试或跳过。',True)]
  elif mode=='failed':events+=[('00:12','邮箱查询超时','保留已有内容，未查到的信息仍待补充。',True)]
  else:
   events+=[('00:12','已开始查询相关邮件','邮箱 MCP · 仅查询与本次录制相关的内容。',False)]
   if mode=='reading':events+=[('00:35','正在核对邮件细节…','核对主题、收件人和附件。',True)]
   elif mode=='refining':events+=[('00:24','已核对邮件细节','补充了主题、收件人和附件名称。',False),('00:35','正在结合你的回答完善分析…','整理完整流程、业务规则与待补充项。',True)]
   else:events+=[('00:24','已核对邮件细节','补充了主题、收件人和附件名称。',False),('00:35','正在整理分析结果…','只保留仍需你决定的业务问题。',True)]
 for i,(time,title,desc,active) in enumerate(events):
  y=346+i*86
  if i<len(events)-1:s+=line(558,y+9,558,y+77)
  s+=f'<circle cx="558" cy="{y}" r="5" fill="{"#444" if active else "#aaa"}"/>'+txt(580,y+5,time,12,'#999')+txt(640,y+5,title,16,'#333',600 if active else 400)+txt(640,y+32,desc,13,'#888')
 if mode=='login':s+=btn(640,641,138,'去登录','agent')
 s+=link('capability-details',txt(548,778,'查看查询范围与详情',12,'#999'))
 return s

add('clarify-loading','Agent 强化分析：使用邮箱补充细节','主流程',enrichment_progress(),['从分析页继续后自动识别应用并匹配已启用能力；本页为匹配与实际调用成功开始后的示例。','只有连接检查、账号/授权范围和只读工具核验通过，且调用真正开始，才能显示正在通过邮箱补充；发现工具不等于已使用。','输入来自录制目标、前序分析、可定位事件和已有材料；仅查询与本次录制相关的邮件，优先消息 ID，再使用窄时间范围及联系人/主题定位。','已有授权范围内自动读取；未启用不自动开启。权限或登录缺失时就地提供修复或跳过，不要求正常路径重复确认。','调用返回的材料先经隐私处理、关联与时间核验，再生成带来源的候选；仍无法确定的业务规则才形成问卷。','返回分析不停止后台任务；取消停止后续查询，尽可能取消在途请求，迟到返回不能继续推进界面。展示读取 Claude 结构化进度 JSON，工具调用与阶段结果另由应用核验，不显示思维链或假进度。','这是新增设计，现有受控运行适配尚未据此接通业务 MCP；不能通过改提示词绕过工具隔离。'])
add('capability-matching','同页：识别应用并检查能力','可选与异常',enrichment_progress('matching'),['识别应用→匹配实际已启用能力→检查账号和只读权限，不新增用户操作阶段。','邮箱/MCP 名称相似不足以匹配；要核对工具 schema、支持的数据对象、业务账号及任务范围。','仅有配置或历史快照时显示检查中/未核验，不显示已登录；未提供明确认证状态时使用已连接或可读取。'])
add('capability-complete','同页：补充完成后整理问题','可选与异常',enrichment_progress('complete'),['只有已验证关联且可追溯的返回才计入补充项；模型自报和工具返回成功不等于业务事实正确。','本状态自动转换成问卷或无问题状态，无需点击继续；候选内容仍在最终预览确认。'])
add('capability-login','同页：登录失效，可跳过','可选与异常',enrichment_progress('login'),['登录只在需要时处理；返回后显式重查，防止重复运行。','能力未启用、账号不符、没有匹配连接时使用相同轻提示结构，给出对应原因与去设置/先继续；不遍历所有业务系统。'])
add('capability-failed','同页：查询失败，可继续','可选与异常',enrichment_progress('failed'),['超时/权限不足/限流/无匹配结果各自说明，保留已验证材料；可重试或仅用录制继续。','无匹配或多候选不得猜测关联，多候选保留待补充并允许用户提供材料；不要求技术问题问卷。'])
s=shell(2,'',link('clarify-loading',txt(304,861,'返回分析进度',14,'#777')))+txt(304,205,'邮箱查询详情',24,'#333',600)
s+=txt(304,258,'匹配来源',14,'#888')+txt(304,290,'录制中的邮件操作 → 当前 Agent 已启用的邮箱 MCP',16)
s+=txt(304,350,'查询范围',14,'#888')+txt(304,382,'与录制账号一致 · 本次录制前后 5 分钟的已发送邮件',15)+txt(304,414,'按录制里的主题和联系人定位；仅核对主题、收件人与附件。',14,'#777')
s+=txt(304,475,'读取内容',14,'#888')+txt(304,508,'邮件主题、收件人、附件名称',15)+txt(304,548,'用于补充这次录制的具体细节',15)+txt(304,603,'只读取相关内容，不发送或修改邮件。',13,'#888')
add('capability-details','按需：工具用途、范围和进度','可选与异常',s,['5 分钟只是线稿中的已确定查询范围示例；实际由录制时长、时区和具体证据决定，页面显示真实范围。','默认页只显示工具、用途、状态；详情提供受保护的账号提示、范围、已完成动作及脱敏错误，不能展示密钥或思维链。','成功材料保存来源 ID、获取时间、关联录制事件和时间适用性；来自当前状态的数据不证明录制时事实。'])

add('clarify-unenriched','问卷：仅使用录制内容','可选与异常',clarify(),['未启用、登录失效、无结果或主动跳过工具补充时使用此状态；不显示已通过邮箱补充的摘要。','保留业务问题与事实缺口，来源详情只包含实际取得的材料。'])
add('clarify-answered','问卷：已选择答案','可选与异常',clarify('answered'),['示例展示用户已选择的状态；初始页不预选。回答可随时修改，未提交仅为草稿。'])
add('clarify-other','问卷：填写其他做法','可选与异常',clarify('other'),['选其他后就地展开输入；切回选项保留输入草稿。多问句仍在同一页。'])
add('clarify-unknown','问卷：暂不确定','可选与异常',clarify('unknown'),['将不知道与未填写统一呈现为待补充，内部状态仍分别保存；不记作业务答案。','选择先生成草稿后，缺口在预览与文件中持续显示。'])
s=shell(2,'',link('materials',txt(304,861,'＋ 补充说明或文件',14,'#777'))+btn(984,839,172,'生成草稿','generating',True))+txt(304,211,'信息已经够用了',24,'#333',600)+txt(304,253,'可以直接生成，也可以补充你的做法。',15,'#888')
add('no-questions','无需澄清：直接继续','可选与异常',s,['没有必要问题时不凑题、不要求再次确认材料；用户点击生成即可。'])
s=shell(2,'',link('clarify-answered',txt(304,861,'收起补充',14,'#777'))+btn(984,839,172,'生成草稿','generating',True))+txt(304,205,'还需要你确认两点',24,'#333',600)
s+=txt(304,266,'问题 1 · 处理范围',13,'#888')+txt(304,297,'我提供的订单号',16)+link('clarify',txt(1110,297,'修改',13,'#888'))+line(304,322,1156,322)
s+=txt(304,362,'问题 2 · 收件人',13,'#888')+txt(304,393,'订单里的客户联系人',16)+link('clarify',txt(1110,393,'修改',13,'#888'))+line(304,418,1156,418)
s+=txt(304,462,'补充说明或文件',16,'#333',600)+rect(304,485,852,124)+txt(324,516,'写下需要补充的做法…',14,'#aaa')+btn(304,630,140,'添加文件')+txt(304,717,'客户联系人说明.pdf',15)+txt(304,745,'检查完成',12,'#888')+link('clarify-answered',txt(1100,717,'移除',13,'#888'))
add('materials','同页展开可选补充','可选与异常',s,['同页展开补充区域，保留上方已答问题；收起后回到问卷，不是新增流程阶段。','文件检查通过前不能用于生成；失败仅阻止该文件，允许删除后继续。保留来源供预览审核。'])
s=shell(2,'',link('clarify-answered',txt(304,861,'查看之前的回答',14,'#777'))+btn(954,839,202,'更新草稿','generating',True))+txt(304,205,'还有一处需要你决定',24,'#333',600)+txt(304,243,'你的回答与补充文件里的联系人规则不同。',15,'#888')
s=question(s,300,3,'找不到订单联系人时，应该怎么办？',['每次询问我','使用客户档案里的采购联系人'])
add('conflict','仅有冲突时追加问题','可选与异常',s,['原回答保留；只在同一页追加影响结果的问题，不重新走整套问卷。','用户确认更新后再次生成；问题未解决则可保留缺口生成草稿，不无限追问。'])
add('draft','预览：保留待补充项','可选与异常',preview(True),['缺口不隐藏；预览与导出文件都保留待补充标识。保存草稿不等于事实已核验。'])
add('saved-draft','草稿保存完成','可选与异常',saved(True),['未解决问题持续保留；不以成功工具返回代替业务确认。'])
add('sop','预览：操作说明','可选与异常',preview(False,True),['使用同一生成预览页，产出类型不同；Markdown 导出沿用原生文件保存，不新增执行能力。'])
s=shell(3,'')+txt(304,205,'希望保存成哪种形式？',24,'#333',600)+btn(304,256,290,'操作说明（SOP）','sop')+btn(616,256,290,'可复用技能（Skill）','preview')+txt(304,345,'技能默认使用通用格式',15,'#777')+link('target',txt(304,384,'其他格式  ›',14,'#888'))+link('preview',txt(304,466,'返回内容',14,'#777'))
add('output','按需更改输出形式','可选与异常',s,['录制前选择 SOP/Skill 则直接沿用，暂不确定时在生成前用此小弹层选择。','处理后端与输出格式独立；本地专属能力不自动写入通用技能。'])
s=shell(3,'')+txt(304,205,'其他技能格式',24,'#333',600)
for i,name in enumerate(['通用技能','Claude Code','Cowork','Scout 技能']):s+=btn(304,250+i*58,420,name,'preview')
s+=link('output',txt(304,525,'返回',14,'#777'))
add('target','高级：其他技能格式','可选与异常',s,['保留现有支持目标，放在其他格式，不做全屏平台卡片墙。','切换格式只使生成内容失效；如新目标缺少必要能力，显式保留依赖缺口，不静默假装支持。','本轮不设计 Scout 交付、自动化执行或试运行。'])
for id,title,stage,reason,dest,cta in [('analysis-error','分析未完成',1,'录制已经保存，可以稍后再试。','analyzing','重新分析'),('generation-error','这次没有生成成功',3,'回答已经保存，可以重新生成。','generating','重新生成')]:
 s=shell(stage,'')+txt(304,215,title,24,'#333',600)+txt(304,254,reason,15,'#888')+btn(304,298,150,cta,dest,True)+link('error-details',txt(490,323,'查看原因',14,'#777'))
 add(id,title,'可选与异常',s,['失败/取消不清空用户输入。只有实际持久化成功，才显示已保存。','需要配置修复时主按钮变为去设置；重试调用用户选择的后端，不静默回退。'])
s=shell(2,'')+txt(304,214,'需要重新登录 Claude',24,'#333',600)+txt(304,253,'完成登录后，回来继续。',15,'#888')+btn(304,300,150,'去设置','settings',True)+link('clarify',txt(490,325,'返回问题',14,'#777'))+txt(304,394,'详情',14,'#777')+rect(304,412,852,96)+txt(324,448,'登录状态已过期。',14)+txt(324,480,'诊断记录可复制；不包含密钥。',12,'#888')
add('error-details','异常详情：原因和解决入口','可选与异常',s,['技术名只在需要修复时出现；完整错误折叠，支持复制脱敏详情。'])
s=shell(3,'')+txt(304,211,'回答已修改，需要更新草稿',24,'#333',600)+txt(304,252,'上一版仍保留，可以随时查看。',15,'#888')+btn(304,300,160,'更新草稿','generating',True)+link('preview',txt(500,325,'查看上一版',14,'#777'))
add('stale','输入变化：一个更新动作','可选与异常',s,['内部版本和失效范围保留，不展示 v1/v2 或要求用户重走材料确认。','点击更新固定当前输入；旧版保留，未更新不得冒充最新成果。'])
s=goal().replace('这次想记录什么？','修改录制目标').replace('确认并开始录制','保存修改').replace('data-screen="recording"','data-screen="stale"').replace('href="#recording"','href="#stale"')
add('goal-edit','修改目标：保存后提示更新','可选与异常',s,['只保存目标，不启动录制；保留旧回答。语音回填必须返回编辑态，不能跳入新录制。'])
s=shell(1,'')+txt(304,205,'修改操作摘要',24,'#333',600)+rect(304,250,852,154)+txt(324,284,'从订单获取报价单，填写收件人，添加附件后点击发送。',15)+btn(984,450,172,'保存修改','stale',True)
add('analysis-edit','就地修改分析','可选与异常',s,['实际为正文原位编辑，保持同一窗口；保存后标记受影响问题和成果需更新。'])
s=shell(3,'')+txt(304,205,'修改内容',24,'#333',600)+rect(304,245,852,250)+txt(324,282,'订单报价',20)+txt(324,324,'发送前先确认邮件正文和附件。',15)+btn(984,530,172,'保存修改','preview',True)
add('preview-edit','就地修改生成内容','可选与异常',s,['编辑不自动批准结果；保存修改回到预览，仍需最后确认并保存文件。','更改事实/规则的内容必须保留用户编辑来源；违反输出结构则就地提示。'])
s=shell(3,'')+txt(304,205,'内容依据',24,'#333',600)+txt(304,263,'处理范围：你在问题 1 的回答',16)+txt(304,307,'收件人：你在问题 2 的回答',16)+txt(304,351,'发送前确认：录制前的目标说明',16)+txt(304,395,'发送是否成功：录制未能确定，未写作已成功',16)+link('capability-details',txt(304,439,'本次邮件主题和附件：邮箱查询结果  ›',15))+link('preview',txt(304,505,'返回内容',14,'#777'))
add('sources','按需查看内容依据','可选与异常',s,['技术 Evidence/Claim schema 隐藏，保留用户可理解的来源和不确定性。','新外部事实仍按时间适用性审核；当前数据不能证明录制时事实。'])
s=shell(3,'')+txt(304,205,'文件内容',24,'#333',600)+rect(304,240,852,410)+txt(326,280,'SKILL.md',15,'#888')+txt(326,326,'# 订单报价',20)+txt(326,372,'根据订单准备报价单，确认后发送给客户。',15)+link('preview',txt(304,699,'返回预览',14,'#777'))
add('source','高级：查看文件原文','可选与异常',s,['文件原文为次要入口；默认预览面向业务人员。'])
# Six concise settings categories; technical fields are confined here.
setting_tabs=[('settings','通用'),('browser','浏览器插件'),('ai','AI 模型'),('agent','Agent 能力'),('speech','语音转写'),('privacy','隐私保护')]
def settings_shell(active,title):
 s=base()+rect(110,80,980,740,'white','#bbb',12)+txt(144,125,'设置',24,'#333',600)+link('home',txt(1044,123,'×',24,'#777'))+line(110,150,1090,150)+line(300,150,300,820)
 for i,(id,label) in enumerate(setting_tabs):
  yy=174+i*60
  if id==active:s+=rect(126,yy,156,42,'#eeeee9','none',6)
  s+=link(id,txt(142,yy+27,label,15,'#444' if id==active else '#888',600 if id==active else 400))
 s+=txt(340,207,title,23,'#333',600)
 return s
s=settings_shell('settings','通用')
for i,(label,value,target) in enumerate([('浏览器插件','Chrome 已连接','browser'),('智能处理','可用','ai'),('语音转写','可用','speech'),('隐私保护','已开启','privacy')]):
 y=278+i*88;s+=txt(340,y,label,16)+link(target,txt(810,y,value+'   ›',14,'#777'))+line(340,y+25,1050,y+25)
add('settings','设置：简单概况','设置',s,['配置从主流程抽出；语音与隐私保持独立分类。正常状态不显示长篇机制说明。'])
s=settings_shell('browser','浏览器插件')+txt(340,250,'开始录制后，自动记录浏览器里的操作。',14,'#888')
for i,(name,status) in enumerate([('Chrome','已连接'),('Edge','未连接')]):
 y=320+i*136;s+=txt(340,y,name,18,'#333',600)+txt(630,y,status,14,'#777')+btn(820,y-26,150,'重新连接')
s+=link('error-details',txt(340,624,'安装说明与连接详情  ›',14,'#777'))
add('browser','设置：浏览器插件','设置',s,['跨标签页采集；分别显示连接与录制状态。重连、安装和错误详情按需打开。'])
s=settings_shell('ai','AI 模型')+txt(340,267,'处理方式',15,'#777')+rect(340,288,688,44,'#fafafa')+txt(358,317,'自动选择：优先使用本地 Claude',15)+link('api-fields',txt(340,382,'配置模型 API  ›',15,'#777'))+btn(860,720,168,'保存','settings',True)
add('ai','设置：AI 模型','设置',s,['自动策略仅在未安装受支持本地 Agent 时选择 API；登录失败不静默切换。','配置模型 API 展开地址、模型、密钥和连接检查。保存配置不启动模型任务。'])
s=settings_shell('ai','模型 API')
for i,(label,value) in enumerate([('API 地址','输入服务地址'),('模型','输入模型名称'),('API 密钥','••••••••••••')]):
 y=267+i*110;s+=txt(340,y,label,14,'#777')+rect(340,y+15,688,42)+txt(358,y+43,value,14,'#999')
s+=btn(340,656,150,'检查连接')+btn(860,720,168,'保存','ai',True)
add('api-fields','设置：展开 API 配置','设置',s,['必要的技术字段保留在设置；密钥遮挡，检查状态和保存状态区分。保存失败保留输入。'])
s=settings_shell('agent','Agent 能力')+txt(340,256,'Claude 已连接',15)+txt(340,292,'启用后，可读取相关内容来补充录制细节。',14,'#888')+txt(340,347,'连接器（MCP）',14,'#777',600)+txt(340,394,'邮箱',16)+btn(906,371,120,'已开启')+txt(340,449,'浏览器',16)+btn(906,426,120,'关闭')+txt(340,513,'技能（Skills）',14,'#777',600)+txt(340,559,'表格处理',16)+btn(906,536,120,'开启')+link('agent-details',txt(340,646,'来源与连接详情  ›',13,'#888'))+btn(860,720,168,'保存','settings',True)
add('agent','设置：能力开关','设置',s,['应用专用环境继承可核验的全局能力目录，不要求用户关联项目；不会修改全局配置。','新能力默认关闭，变更复核；开关先编辑草稿，保存后形成隔离配置。','已启用连接在已有授权与本次范围内可自动只读补充；发现、启用、登录和实际业务读取权限分别核验。','保存不授予业务写权限，无法强制排除关闭能力时阻止加载。'])
s=settings_shell('agent','来源与连接详情')+txt(340,265,'来源：本机 Claude 的全局配置',15)+txt(340,309,'应用会使用单独配置，原配置不会被修改。',14,'#888')+txt(340,381,'邮箱连接器：已启用 · 可读取',16)+txt(340,418,'检查连接会启动对应程序，可能要求登录。',14,'#888')+btn(340,451,180,'检查连接')+btn(340,523,180,'检查来源更新')+link('agent',txt(340,645,'返回能力列表',14,'#777'))
add('agent-details','设置：按需查看技术信息','设置',s,['来源变更只显示受影响的项目并请求复核，不展示整页快照/哈希。','发现时仍需区分读取配置、启动连接、执行业务操作；详情提供脱敏诊断。'])
s=settings_shell('speech','语音转写')+txt(340,280,'默认语言',15)+rect(340,301,688,44)+txt(358,330,'中文',15)+txt(340,410,'语音识别已就绪',15,'#777')+txt(340,452,'模型与下载详情  ›',13,'#888')+btn(860,720,168,'保存','settings',True)
add('speech','设置：语音转写','设置',s,['录制期间有冲突的选项禁用；模型首次下载或不可用时提供行动入口。'])
s=settings_shell('privacy','隐私保护')+txt(340,278,'隐藏截图中的敏感文字',17,'#333',500)+btn(906,252,120,'开启')+txt(340,323,'分析前处理截图中的敏感信息。',14,'#888')+txt(340,408,'查看处理详情  ›',13,'#888')+btn(860,720,168,'保存','settings',True)
add('privacy','设置：隐私保护','设置',s,['独立保存；关闭时用简短提示明确影响。隐私失败阻止相关材料传出，不用常驻说明淹没正文。'])

# Fix goal edit microphone target: editing must never start a new recording.
for sc in screens:
 if sc['id']=='goal-edit':
  sc['svg']=re.sub(r'<g transform="translate\(18,31\)">.*?</g>','',sc['svg'])
for sc in screens:
 if sc['id']=='clarify':
  sc['svg']=sc['svg'][:-6]+link('capability-complete',txt(304,262,'已通过邮箱补充 3 项细节 · 查看',12,'#888'))+'</svg>'
  sc['notes'].append('本图演示邮箱补充成功后进入问卷；只有实际完成才出现补充摘要，未查询/失败时不显示。')
# The Agent preparation is visible between analysis and questions, not hidden as an exception.
loading=next(sc for sc in screens if sc['id']=='clarify-loading')
screens.remove(loading)
screens.insert(next(i for i,sc in enumerate(screens) if sc['id']=='clarify'),loading)
# v11.2: a confirmed deep-analysis result is required before generation.
def deep_result(incomplete=False):
 footer=link('analysis',txt(304,861,'返回原始素材',14,'#777'))+link('clarify-loading',txt(492,861,'重新分析',14,'#777'))+btn(934,839,222,'确认并生成草稿' if incomplete else '确认并生成','generating',True)
 s=shell(2,'待确认',footer)+txt(304,200,'确认这份分析',24,'#333',600)+link('deep-edit',txt(1118,200,'修改',13,'#777'))
 s+=txt(304,237,'根据订单准备报价单，发送前先由你确认。',15,'#777')
 for i,(title,desc) in enumerate([('核对订单','处理你提供的订单号，读取订单和客户信息。'),('准备报价单','按订单生成报价单，作为邮件附件。'),('准备邮件并确认','使用订单联系人；找不到时先询问你。'),('确认后发送','展示正文和附件，得到你的确认后再发送。')]):
  y=291+i*78;s+=txt(308,y,str(i+1),14,'#888')+txt(338,y,title,17,'#333',500)+txt(338,y+28,desc,14,'#777')
 s+=line(304,597,1156,597)+txt(304,631,'每次需要提供',14,'#777',600)+txt(304,660,'订单号；报价单和联系人按本次订单重新获取。',15)
 if incomplete:s+=rect(304,685,852,42,'#eeeee9','none',6)+txt(320,712,'待补充：收件人规则尚未确定，草稿中会保留提醒。',14)
 else:s+=txt(304,712,'找不到联系人或附件时先询问，不自动猜测。',14,'#777')
 s+=link('analysis-tools',txt(304,773,'本次分析使用：录制材料、邮箱 MCP · 查看',13,'#888'))
 if incomplete:s=s.replace('使用订单联系人；找不到时先询问你。','收件人规则待补充，使用前先询问你。')
 return s
add('deep-result','深度分析：确认完整流程','主流程',deep_result(),['这是第二阶段的明确产物，不是最终 Skill；正文展示目标、流程、业务规则、每次变化内容与异常处理。','只有点击确认并生成才批准当前深度分析版本并启动生成；浏览、工具返回成功、回答提交均不等于确认。','流程正文可直接修改；工具与来源折叠查看。支持返回原始素材、补充后重新分析，保留旧回答和结果。'])
add('deep-result-incomplete','深度分析：仍有待补充项','可选与异常',deep_result(True),['未知问题不变成规则；允许明确确认带缺口的分析，再生成标注待补充的草稿。'])
s=enrichment_progress('refining')
add('deep-refining','深度分析：结合回答完善结果','可选与异常',s,['回答与材料持久化后继续分析；完成进入深度分析结果，绝不直接进入生成。','按需读取原始截图、转写和事件核对缺口，不无条件重读全部视频；失败或取消保留回答和已取得证据。'])
s=shell(2,'已暂停',link('analysis',txt(304,861,'返回原始素材',14,'#777'))+btn(984,839,172,'继续分析','clarify-loading',True))+txt(304,211,'深度分析已暂停',24,'#333',600)+txt(304,252,'已有内容已保留，可以稍后继续。',15,'#888')
add('deep-cancelled','深度分析：暂停后可继续','可选与异常',s,['停止后续工具调用，迟到结果不改变界面；继续必须显式操作，复用仍有效的已存材料。'])
s=shell(2,'',link('deep-result',txt(304,861,'取消',14,'#777'))+btn(954,839,202,'保存修改','deep-result',True))+txt(304,205,'修改分析结果',24,'#333',600)+rect(304,246,852,358)+txt(324,282,'订单报价',20)+txt(324,329,'处理我提供的订单号；邮件发送前先给我确认。',15)+txt(324,378,'找不到客户联系人时，先询问我。',15)+link('deep-refining',txt(304,659,'有更多说明？补充后重新分析',14,'#777'))
add('deep-edit','深度分析：直接编辑结果','可选与异常',s,['产品中为正文原位编辑，此图单独演示编辑态；保存用户修改后仍需确认并生成。','用户编辑留来源；若已有生成内容则标记需更新，保留旧成果。'])
s=shell(2,'',link('deep-result',txt(304,861,'返回分析结果',14,'#777')))+txt(304,205,'本次分析使用的工具',24,'#333',600)+txt(304,267,'录制材料',17,'#333',600)+txt(304,300,'操作记录、截图和语音，用于还原原始流程。',15,'#777')+txt(304,367,'邮箱 MCP · 已完成',17,'#333',600)+txt(304,400,'核对本次邮件的主题、收件人与附件名称。',15,'#777')+link('capability-details',txt(304,442,'查看查询范围与来源',14,'#888'))+txt(304,516,'浏览器：使用录制内容，未调用浏览器连接器。',14,'#888')
add('analysis-tools','按需：本次分析实际使用的工具','可选与异常',s,['只列真实调用和使用的来源；配置中存在或已经登录不算使用。','列表示例属于邮箱补充成功路径；失败/跳过路径不能复用成功摘要。'])
s=shell(3,'',link('preview',txt(304,861,'返回预览',14,'#777')))+txt(304,205,'使用这个 Skill 需要什么',24,'#333',600)+txt(304,271,'订单系统',17,'#333',600)+txt(304,305,'读取订单和获取报价单；具体连接方式待配置。',15,'#777')+txt(304,372,'邮箱',17,'#333',600)+txt(304,406,'读取联系人并准备邮件；发送前须由用户确认。',15,'#777')+txt(304,482,'分析时使用的邮箱连接不代表使用者已经配置完成。',14,'#888')
add('skill-tools','按需：Skill 的使用依赖','可选与异常',s,['区分生成时实际使用的工具和 Skill 未来使用依赖；未配置能力明确标记，不承诺已可执行。'])
# Make old optional states follow the new confirmation gate too.
for sc in screens:
 v=sc['svg']
 if sc['id'] in ['materials','conflict']:
  v=v.replace('data-screen="generating"','data-screen="deep-refining"').replace('href="#generating"','href="#deep-refining"').replace('生成草稿','提交并继续分析').replace('更新草稿','更新分析')
 if sc['id']=='no-questions':v=deep_result()+'</svg>';sc['notes']=['无需提问时自动展示深度分析结果，用户确认后才生成，不展示空白问卷。']
 if sc['id']=='clarify-loading':
  v=v.replace('data-screen="analysis" aria-label="取消分析"','data-screen="deep-cancelled" aria-label="取消分析"').replace('href="#analysis" data-screen="deep-cancelled"','href="#deep-cancelled" data-screen="deep-cancelled"')
 if sc['id']=='stale':
  v=shell(2,'需要更新',link('deep-result',txt(304,861,'查看上一版',14,'#777'))+btn(954,839,202,'重新深度分析','clarify-loading',True))+txt(304,211,'内容已修改，需要更新分析',24,'#333',600)+txt(304,252,'回答和上一版结果都已保留。',15,'#888')+'</svg>'
  sc['notes']=['原始素材或目标改变使深度分析及生成失效；回答或材料改变使相关深度分析和生成失效；仅改生成格式只使生成失效。','查看旧结果不会触发运行；受影响结果未更新、未重新确认前不可作为最新输入生成。']
 sc['svg']=v
for sc in screens:
 if sc['id']=='no-questions':sc['title']='无需提问：直接确认深度分析结果'
 if sc['id']=='clarify-unknown':sc['svg']=sc['svg'].replace('将在草稿中保留提醒','将在分析结果中保留提醒')
 if sc['id']=='clarify':sc['notes'].append('未回答也可提交继续分析，未答必须作为缺口呈现在待确认分析结果中，不采用默认选项。')
 if sc['id']=='preview':sc['notes']=['根据已确认深度分析展示生成内容；可编辑、返回修改分析或显式重新生成。','确认并保存用于文件落盘，不替代之前对深度分析内容的确认；依赖与来源按需查看。']
# Result belongs between questions and generation in the review gallery.
result=next(sc for sc in screens if sc['id']=='deep-result');screens.remove(result)
screens.insert(next(i for i,sc in enumerate(screens) if sc['id']=='generating'),result)
for sc in screens:
 sc['title']=sc['title'].replace('分析：看懂这次操作','原始素材确认：核对操作记录').replace('澄清和补充：一页问卷','深度分析：必要时回答问题').replace('Agent 强化分析','深度分析')
 # Remove superseded design notes which previously allowed questions -> generation.
 if sc['id']=='analysis':sc['notes']=['记录原始操作，保留粗略描述和不确定性，不预先编造可复用规则。','用户可以纠错、查看材料、修改目标或显式重新整理；点击确认并深度分析后才运行第二阶段。']
 if sc['id'].startswith('clarify') or sc['id'] in ['conflict','materials','capability-complete']:
  sc['notes']=[n.replace('生成草稿提交当前回答及材料','提交并继续分析提交当前回答及材料').replace('选择先生成草稿后，缺口在预览与文件中持续显示','选择暂不确定后，缺口在深度分析结果、预览与文件中持续显示').replace('用户确认更新后再次生成','用户提交后更新深度分析结果').replace('候选内容仍在最终预览确认','候选内容先在深度分析结果确认').replace('无问题状态','深度分析结果') for n in sc['notes']]
 if sc['id']=='generating':sc['notes']=['只使用用户已确认且未过期的深度分析结果生成；不将未经确认的补充悄悄写入 Skill。','生成失败保留确认结果；如发现新关键冲突则返回深度分析，并在确认后重新生成。']

for sc in screens:
 if sc['id'] in ['clarify-loading','capability-matching','capability-complete','capability-login','capability-failed','deep-refining']:
  sc['notes'].append('左侧只汇总本次实际使用的工具与素材，不承载过程日志；未成功读取的工具明确标记。右侧读取 Claude 的 report_progress JSON 逐条更新动态时间轴，应用补实际状态；不显示模型思维链，模型报告不等于工具核验成功。')
  sc['notes'].append('同一工具重复调用只保留一个左侧入口，动作和结果追加在右侧；长进展仅在时间轴内部滚动，用户上翻时不强制拉回，提供新进展提示。完成后自动进入必要问题或待确认结果；回看保留已有进展。')
# Persist source illustrations and generated metadata.
for sc in screens:(R/(sc['id']+'.svg')).write_text(sc['svg'])
manifest=[dict(order=i+1,**{k:v for k,v in sc.items() if k!='svg'},links=re.findall('data-screen="([^"]+)"',sc['svg'])) for i,sc in enumerate(screens)]
(R/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
# Contact sheets: main path is separate from branches/settings.
def board(name,title,items):
 h=70+math.ceil(len(items)/2)*490
 out=f'<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="{h}" viewBox="0 0 1260 {h}" font-family="PingFang SC,Microsoft YaHei,sans-serif">'+rect(0,0,1260,h,'#eeeee9','none',0)+txt(24,42,title,24,'#444',600)
 for i,sc in enumerate(items):
  x=20+(i%2)*620;y=70+(i//2)*490
  svg=sc['svg'].replace('width="1200" height="900" viewBox=', 'width="600" height="450" viewBox=',1)
  out+=f'<g transform="translate({x},{y})">'+svg+txt(6,475,sc['title'],14)+'</g>'
 (R/(name+'.svg')).write_text(out+'</svg>')
board('board-main','v11 · 用户主流程',[sc for sc in screens if sc['group']=='主流程'])
board('board-capabilities','能力补充 · 同一页面的状态变化',[next(sc for sc in screens if sc['id']==id) for id in ['capability-matching','clarify-loading','capability-complete','clarify','capability-login','capability-failed']])
board('board-three-stages','原始素材确认 → 深度分析 → 生成',[sc for sc in screens if sc['id'] in ['analysis','deep-result','preview']])
for group,prefix in [('可选与异常','states'),('设置','settings')]:
 items=[sc for sc in screens if sc['group']==group]
 for i in range(0,len(items),6):board(f'board-{prefix}-{i//6+1}',f'v11 · {group}',items[i:i+6])
# A gallery whose optional states are not presented as compulsory steps.
page=r'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Skill Recorder · v11.2 简化交互线稿</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1f1ee;color:#333;font:14px system-ui,-apple-system,sans-serif}header{padding:22px 30px;background:white;border-bottom:1px solid #ddd;display:flex;gap:24px;align-items:center}h1{font-size:20px;margin:0}header p{margin:6px 0 0;color:#888}a{color:inherit}button{font:inherit;color:inherit;border:1px solid #ddd;background:white;border-radius:6px;padding:10px 14px;cursor:pointer}main{padding:24px;max-width:1600px;margin:auto}.summary{background:#fff;padding:22px 26px;margin-bottom:24px;border:1px solid #ddd;border-radius:8px}.summary p{color:#777}.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.tile{text-align:left;padding:0;overflow:hidden}.tile svg{width:100%;height:auto;display:block;pointer-events:none}.tile span{display:block;padding:12px 16px;background:white;border-top:1px solid #eee}.tile:hover{border-color:#777}details{margin:28px 0}summary{font-size:18px;cursor:pointer;padding:12px 0}details p{color:#888}#viewer{max-width:1200px;margin:auto}#canvas svg{width:100%;height:auto;display:block}#canvas a{cursor:pointer}#notes{padding:18px 24px;background:#fff;border:1px solid #ddd;line-height:1.8}#nav{display:flex;gap:12px;align-items:center;margin-bottom:18px}#title{flex:1;font-weight:600}#notes h3{font-size:14px;margin:0}#notes li{color:#666;margin-top:6px}[hidden]{display:none!important}@media(max-width:850px){.gallery{grid-template-columns:1fr}header{padding:16px;display:block}header button{margin-top:12px}main{padding:12px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}</style>
<header><div><h1>Skill Recorder · 简化交互线稿 v11.2</h1><p>面向非技术用户 · 黑白线稿 · 示例数据，所有操作仅演示页面状态</p></div><button id="overview">流程总览</button><a href="REVIEW-v11.md">产品评审</a><a href="index-v10.html">历史 v10</a></header><main>
<div id="overview-pane"><div class="summary"><strong>录制后只走三步：原始素材确认 → 深度分析 → 生成</strong><p>核对原始操作 → 确认完整流程 → 预览并保存 Skill</p><p>深度分析按需提问，形成完整结果后再确认生成；工具与来源按需查看。</p></div><div class="gallery" id="main-gallery"></div><details><summary>可选操作与异常状态</summary><p>同一页面的不同状态，不是用户必须逐页经过的流程。</p><div class="gallery" id="state-gallery"></div></details><details><summary>设置</summary><p>技术配置集中在这里。正常使用时无需逐项查看。</p><div class="gallery" id="settings-gallery"></div></details></div>
<div id="viewer" hidden><div id="nav"><button id="prev">上一张</button><span id="title"></span><button id="next">下一张</button></div><div id="canvas"></div><div id="notes"></div></div></main><script>
const screens=__SCREENS__;const $=s=>document.querySelector(s);let current=-1;
for(const s of screens){let b=document.createElement('button');b.className='tile';b.innerHTML=s.svg.replace(/<a\b[^>]*>/g,'<g>').replace(/<\/a>/g,'</g>');let label=document.createElement('span');label.textContent=s.title;b.append(label);b.onclick=()=>location.hash=s.id;$(s.group==='主流程'?'#main-gallery':s.group==='设置'?'#settings-gallery':'#state-gallery').append(b)}
function render(){current=screens.findIndex(s=>s.id===location.hash.slice(1));let visible=current>=0;$('#overview-pane').hidden=visible;$('#viewer').hidden=!visible;if(!visible)return;const s=screens[current];$('#title').textContent=s.title;$('#canvas').innerHTML=s.svg;$('#notes').replaceChildren();let h=document.createElement('h3');h.textContent='设计说明（不出现在产品中）';$('#notes').append(h);let ul=document.createElement('ul');for(let n of s.notes){let li=document.createElement('li');li.textContent=n;ul.append(li)}$('#notes').append(ul);$('#prev').disabled=current===0;$('#next').disabled=current===screens.length-1;window.scrollTo(0,0)}
$('#overview').onclick=()=>location.hash='';$('#prev').onclick=()=>{if(current>0)location.hash=screens[current-1].id};$('#next').onclick=()=>{if(current>=0&&current<screens.length-1)location.hash=screens[current+1].id};document.addEventListener('click',e=>{const a=e.target.closest('[data-screen]');if(a){e.preventDefault();location.hash=a.dataset.screen}});document.addEventListener('keydown',e=>{if(e.key==='Escape')location.hash='';if(e.key==='ArrowLeft')$('#prev').click();if(e.key==='ArrowRight')$('#next').click()});addEventListener('hashchange',render);render();</script></html>'''
(P/'index.html').write_text(page.replace('__SCREENS__',json.dumps(screens,ensure_ascii=False)))
(P/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(P/'ORDER.md').write_text('# v11 阅读顺序\n\n主流程与可选状态分开。线稿张数不等于用户需要完成的步骤数。\n\n'+'\n'.join(f"{i+1}. [{sc['title']}](v11/{sc['id']}.png) — {sc['group']}" for i,sc in enumerate(screens))+'\n')
print(f'Generated {len(screens)} states; {sum(sc["group"]=="主流程" for sc in screens)} main-path illustrations')
