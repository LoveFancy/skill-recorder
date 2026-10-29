from pathlib import Path
import json, html, re, base64, math
from PIL import Image

ROOT=Path(__file__).resolve().parent
DOCS=ROOT.parent.parent
A=ROOT/'assets'
BLUE='#1765dc'; INK='#152c49'; MUTED='#526983'; LIGHT='#788ba3'; PALE='#eaf3ff'; SOFT='#f5f8fd'; BORDER='#dbe5f1'; NAVY='#123c74'
slides=[]

# Crops retain the original product UI while removing the old slide styling.
Image.open(A/'image7.png').crop((112,390,1740,770)).save(A/'input-ui.png')
Image.open(A/'image13.png').crop((2350,785,3670,1435)).save(A/'engine-ui.png')
Image.open(A/'image13.png').crop((2800,900,3570,1435)).save(A/'engine-menu.png')
Image.open(A/'image34.png').crop((30,170,1820,1960)).save(A/'group-qr.png')
Image.open(A/'image22.png').crop((500,120,2070,1060)).save(A/'web-search-settings.png')
Image.open(A/'image24.png').crop((150,410,2350,1794)).save(A/'web-search-example.png')

def new(title,chapter,kicker,sub='',source=0):
 s={'title':title,'chapter':chapter,'kicker':kicker,'sub':sub,'source':source,'objects':[],'notes':''};slides.append(s)
 rect(0,0,5,900,BLUE)
 rect(76,34,12,12,'#ffffff',BLUE)
 text(102,28,550,30,'WORKMATE',14,MUTED,600)
 text(1130,28,394,30,'TRAINING / '+chapter,13,LIGHT,400,'right')
 if title:
  text(76,95,1400,26,kicker,15,BLUE,600)
  text(76,130,1450,66,title,46,INK,650)
  if sub:text(76,202,1448,61,sub,21,MUTED)
 rect(76,842,1448,1,BORDER)
 text(76,854,1300,24,'WorkMate 使用培训　 /　 信息技术部 · 运营管理室 · AI研发效能管理团队',12,LIGHT)
 return s
def rect(x,y,w,h,color=SOFT,stroke=None):
 slides[-1]['objects'].append(dict(type='rect',x=x,y=y,w=w,h=h,fill=color,stroke=stroke))
def text(x,y,w,h,t,size=24,color=INK,weight=400,align='left'):
 h=max(h,len(t.split('\n'))*size*1.4)
 slides[-1]['objects'].append(dict(type='text',x=x,y=y,w=w,h=h,text=t,size=size,color=color,weight=weight,align=align))
def pic(file,x,y,w,h,caption=None):
 im=Image.open(A/file); iw,ih=im.size;f=min(w/iw,h/ih);nw,nh=iw*f,ih*f
 slides[-1]['objects'].append(dict(type='image',x=x+(w-nw)/2,y=y+(h-nh)/2,w=nw,h=nh,file=file))
 if caption:text(x,y+h+10,w,30,caption,15,LIGHT)
def band(t,y=750):
 rect(76,y,1448,65,PALE);rect(76,y,3,65,BLUE);text(100,y+15,1398,41,t,23,INK,500)
def item(x,y,w,num,title,body,size=21):
 text(x,y,45,38,num,20,BLUE,500);text(x+58,y-3,w-58,42,title,27,INK,600)
 text(x+58,y+45,w-58,100,body,size,MUTED)
def cols(y,items,h=340):
 w=(1448-32*(len(items)-1))/len(items)
 for i,(title,body) in enumerate(items):
  x=76+i*(w+32);rect(x,y,w,2,BLUE if i==0 else BORDER)
  text(x,y+20,w,50,title,30,BLUE if i==0 else INK,600)
  text(x,y+90,w,h-90,body,23,MUTED)
def note(t):slides[-1]['notes']=t

# 01
new('', '认识 WorkMate','',source=1)
text(84,158,700,40,'桌面 AI 工作助手',23,BLUE,600)
text(84,247,900,119,'WorkMate',100,INK,650)
text(84,378,820,104,'使用培训',76,BLUE,650)
text(88,684,700,40,'秦晓',25,INK,600)
text(88,731,780,58,'信息技术部　运营管理室\nAI研发效能管理团队',18,MUTED)
pic('image2.png',1060,219,360,360)
note('培训围绕一项任务如何在 WorkMate 中持续推进展开。先认识工作空间，再配置模式、引擎和模型，随后介绍上下文、复用能力与外部系统连接，最后说明持续运行和使用边界。')
# 02
new('今天的分享内容','课程导航','COURSE MAP','围绕一项任务，认识 WorkMate 的工作方式',2)
for y,n,t,b in [(300,'01','认识 WorkMate','工作空间与适用场景'),(414,'02','配置一项任务','Chat / Agent、项目、引擎与模型'),(528,'03','掌握核心能力','上下文、Skill、专家与连接器'),(642,'04','持续运行与使用边界','远程连接、定时任务、协作与人工复核')]:
 text(82,y,70,50,n,31,BLUE,500);text(178,y,490,55,t,31,INK,600);text(750,y+6,740,55,b,24,MUTED);rect(178,y+84,1346,1,BORDER)
# 03
new('WorkMate 产品特性','认识 WorkMate','01 / WORKSPACE','对话、文件和项目共同组织工作，任务过程可查看，结果可编辑，资料可继续复用',3)
pic('image3.png',76,275,1120,535)
for y,n,t,b in [(300,'01','组织资料','文件与项目上下文'),(450,'02','推进任务','执行过程可以查看'),(600,'03','保留成果','继续编辑与复用')]:item(1220,y,300,n,t,b,19)
# 04
new('沿着一项任务的生命周期，理解核心能力','核心能力','02 / TASK LIFECYCLE','本章不按按钮逐个罗列，而是回答：如何让一项工作从开始到持续运行。',5)
rect(76,280,1448,77,PALE);rect(76,280,3,77,BLUE)
text(100,296,1398,52,'介绍思路：先让任务有清晰边界，再给 Agent 正确上下文；随后扩展可调用的能力，最后让成熟方法持续运行并被复用。',21,INK,500)
stages=[
 ('01 · 定边界','让任务有起点','选择合适模式、模型与项目空间，明确目标、权限和长期工作边界。',[['Chat / Agent','项目'],['会话管理','模型']]),
 ('02 · 给上下文','让 Agent 理解现场','把本次资料和长期知识组织起来，让输入、过程与成果能够持续承接。',[['文件管理','@ 文件引用'],['预览与编辑']]),
 ('03 · 扩展执行','让能力服务任务','按任务需要调用流程、专家和外部系统，完成研究、协同和跨系统操作。',[['Skill / 专家 / 专家团'],['连接器','浏览器','联网检索']]),
 ('04 · 持续复用','让工作持续推进','将可检查的重复工作按计划运行，把成果沉淀为可复用的工作资产。',[['远程连接','定时任务'],['HTML 协作','经验沉淀']])]
for i,(k,t,b,labels) in enumerate(stages):
 x=76+i*(1448-340)/3
 rect(x,390,340,398,SOFT,BORDER);rect(x,390,340,3,BLUE)
 text(x+22,413,296,34,k,20,BLUE,600)
 text(x+22,465,296,50,t,29,INK,600)
 text(x+22,530,296,118,b,21,MUTED)
 for row,group in enumerate(labels):
  tx=x+22
  for label in group:
   w=sum(18 if ord(c)>255 else 11 for c in label)+34
   rect(tx,681+row*42,w,32,'#ffffff')
   text(tx+9,684+row*42,w-18,28,label,18,MUTED)
   tx+=w+8
 if i<3:text(x+342,555,26,44,'→',27,BLUE,500,'center')
# 05
new('模式选择：Chat 与 Agent','任务配置','03 / MODE','快速问答与持续执行，分别对应不同的任务方式',6)
pic('image5.png',76,290,760,436)
rect(880,290,644,198,SOFT);rect(880,510,644,216,PALE)
text(906,307,592,48,'Chat',34,INK,600)
text(906,367,592,108,'快速问答、摘要、润色、翻译\n适合一次性、短流程任务\n重点是获得答案或一段内容',24,MUTED)
text(906,529,592,48,'Agent',34,BLUE,600)
text(906,590,592,108,'多步骤任务、文件处理、持续协作\n可调用 Skill、专家和连接器\n重点是推进工作并交付成果',24,MUTED)
band('概括一份材料可以用 Chat；完成一项多步骤工作可以用 Agent')
# 06
new('项目：承载长期工作的独立空间','任务配置','04 / PROJECT','按具体事情建立项目，让资料、会话、能力和记忆保持清晰边界',7)
pic('image6.png',76,285,370,470)
item(520,296,1004,'01','按“事”建立','行业研究、产品研发、团队周报等长期事项。')
item(520,440,1004,'02','按项目组织','会话、文件、Skill、连接器和记忆相互隔离。')
item(520,584,1004,'03','用项目说明定义边界','长期目标、规则与约束成为 Agent 的基础上下文（Agent.md）。')
band('项目的价值：个人能接着做，团队能移交，组织能复制')
# 07
new('对话框：明确本次任务的上下文','上下文管理','05 / TASK INPUT','引用资料与能力后，再描述目标、交付物和验收标准',8)
rect(76,286,895,325,SOFT,BORDER);pic('input-ui.png',96,325,855,230)
text(100,571,825,30,'上方标签承载本次引用，底部工具栏配置能力与执行',16,LIGHT)
for y,n,t,b in [(290,'@','文件 / 目录','指定本次需要读取的资料'),(397,'/','Skill','选择固化流程与检查规则'),(504,'#','连接器','明确需要使用的外部系统'),(611,'&','会话','承接已有会话的目标与结论')]:
 text(1020,y,52,50,n,37,BLUE,600);text(1090,y,430,38,t,25,INK,600);text(1090,y+45,430,48,b,20,MUTED)
band('任务描述建议包含：要完成什么、读取哪些资料、输出什么、怎样算完成')
# 08
new('会话管理与执行观测','任务配置','06 / SESSION','组织会话，查看统计，并在需要时分叉探索或回到之前的状态',9)
pic('image12.png',76,288,290,438)
item(420,290,540,'01','会话组织','置顶便于查找且不会自动归档。\n按项目、最近时间或自动任务查看会话。',20)
item(420,438,540,'02','会话分叉与回滚','Fork：从某个时间点探索不同路径。\n回滚：退回到之前的某一轮。',20)
pic('image11.png',1010,300,514,290,'执行完一轮后，可查看响应、工具与 Token 统计')
item(420,586,540,'03','自动归档','在设置中选择自动归档策略：\n7 天、14 天、不归档等。\n超过所选天数未更新的会话会自动归档。',20)
band('过程不清楚时，先查看本轮统计，再让 WorkMate 分析具体执行原因')
# 09 rebuilt engine
new('选择引擎：Pi 与 Claude','任务配置','07 / AGENT ENGINE','引擎决定 Agent 的执行方式；模型决定本次任务使用的理解与推理能力',10)
table_start=len(slides[-1]['objects'])
rect(76,290,900,58,SOFT)
text(96,305,180,38,'比较维度',19,MUTED,500);text(296,299,270,46,'Pi',30,BLUE,600);text(586,299,370,46,'Claude',30,INK,600)
rows=[('能力侧重','极简轻量的运行时','Anthropic 官方 SDK 完整能力'),('使用体验','启动快，上下文负担较低','完整能力，开箱即用'),('适用任务','高频、日常任务','编程场景'),('首次返回（示例）','约 5 秒','约 20 秒'),('上下文占用（示例）','<10K','约 30K')]
for j,(a,b,c) in enumerate(rows):
 y=348+j*70;rect(76,y,900,1,BORDER);text(96,y+21,180,38,a,19,MUTED);text(296,y+21,270,40,b,20,INK,500);text(586,y+21,370,40,c,20,INK,500)
rect(76,698,900,1,BORDER)
for obj in slides[-1]['objects'][table_start:]:obj['table_part']=True
slides[-1]['table']={'x':76,'y':290,'widths':[200,290,410],'heights':[58]+[70]*5,'rows':[['比较维度','Pi','Claude']]+[list(r) for r in rows]}
pic('engine-menu.png',1006,301,518,401)
text(76,715,1448,27,'示例测试口径：同环境、同输入“你好”的首轮测试，实际时延随模型与网络状态波动。',14,LIGHT)
band('选择建议：日常任务先尝试 Pi；需要编程场景用 Claude',768)
note('Chat / Agent 是工作模式，Pi / Claude 是 Agent 执行引擎。测试数字沿用原始材料，仅作示例，不代表固定耗时。按用户补充，日常任务先尝试 Pi，编程场景使用 Claude。')
# 10 model
new('选择模型：先判断数据边界','任务配置','08 / MODEL','再看输入类型、上下文容量与任务能力',11)
for i,(n,t,b) in enumerate([('01','数据敏感度','敏感、涉客信息使用 Local'),('02','输入类型','图片与扫描件使用多模态模型'),('03','能力与速度','复杂任务看上下文，常规任务看稳定性')]):
 x=76+i*493;text(x,279,45,36,n,19,BLUE,500);text(x+57,275,420,40,t,26,INK,600);text(x,330,465,65,b,20,MUTED)
rect(76,421,690,271,PALE);rect(798,421,726,271,SOFT)
text(100,440,635,43,'Local 模型',29,BLUE,600);text(822,440,670,43,'SaaS 模型',29,INK,600)
text(100,496,635,62,'数据不出公司，适合敏感和涉客信息\n容量有限，可选模型较少',21,MUTED)
text(822,496,670,62,'模型更新快、响应较稳定\n仅处理不含敏感信息的内容',21,MUTED)
text(100,579,635,85,'local-deepseek-v4-flash（1M）\nlocal-qwen38（多模态）',23,INK,500)
text(822,579,670,100,'saas-kimi-26（多模态）　 saas-glm-53\nsaas-deepseek-v4-pro（1M）\nsaas-deepseek-v4-flash（1M）',20,INK,500)
band('使用本人申请的 Key；建议使用 WorkMate KEY 自动同步泰为模型，凭证不得共享或粘贴到对话中')
#11
new('文件管理：会话文件与项目文件','上下文管理','09 / FILE SCOPE','按资料的使用范围组织文件',12)
for x,title,body,image in [
 (76,'会话文件','仅当前会话可访问\n适合临时材料与中间结果\n删除会话时同步删除','image16.png'),
 (830,'项目文件','工作区内跨会话共享\n适合模板、规范和长期资料\n可被多个会话反复引用','image14.png')]:
 rect(x,280,694,2,BLUE)
 text(x,297,694,48,title,30,BLUE,600)
 text(x,351,694,96,body,23,MUTED)
 pic(image,x,450,694,270)
rect(800,280,1,440,BORDER)
rect(76,735,1448,42,SOFT)
text(98,740,1404,32,'@ 引用文件或目录　明确本次需要读取的资料，支持文件检索。',21,INK,500)
rect(76,789,1448,38,PALE);rect(76,789,3,38,BLUE)
text(98,793,1404,30,'删除工作区前确认影响：相关会话、自动任务、能力配置和项目文件',20,INK,500)
#12
new('经验复用：Skill、专家与专家团','能力复用','10 / REUSE','按任务的标准化程度与协作需要，选择合适的复用形式',13)
for i,(title,body) in enumerate([
 ('Skill','任务说明 + 操作流程 + 检查规则\n适合重复、规则清晰的流程\n已接入泰为 SkillHub'),
 ('专家','角色提示词 + 特定 Skills 以及连接器\n适合边界清晰的专业任务'),
 ('专家团','主专家 + 分工专家以及协作机制\n适合调研、分析、执行与复核')]):
 x=76+i*((1448-64)/3+32)
 rect(x,280,461.33,2,BLUE if i==0 else BORDER)
 text(x,300,461.33,46,title,30,BLUE if i==0 else INK,600)
 text(x,356,461.33,94,body,22,MUTED)
pic('image17.png',76,455,1000,280)
text(1120,489,404,210,'通过内置 expert-manager 创建自己的专家 / 专家团。\n召唤专家会新建会话，当前无法在已有会话中直接召唤。',20,MUTED)
band('规则清晰的步骤沉淀为 Skill；专业分工通过专家或专家团组织')
#13
new('文件预览与编辑','上下文管理','11 / ARTIFACTS','支持 MD、DOCX、PPTX、PDF、HTML 等格式预览，并支持 MD、HTML 编辑',14)
text(76,288,694,42,'MD 的预览与编辑',27,INK,600);text(830,288,694,42,'PPT 的预览',27,INK,600)
pic('image18.png',76,350,694,370);pic('image19.png',830,350,694,370)
band('在同一工作空间中查看资料、核对成果，并继续修改可编辑内容')
#14
new('连接器：连接外部信息与业务系统','外部能力','12 / CONNECTORS','Agent 在授权范围内访问系统，获取业务信息并执行任务',15)
pic('image20.png',76,297,865,425)
for y,n,t,b in [(294,'01','研发与数据','DPMP、华泰 GitLab、MySQL、HT Wiki'),(438,'02','办公协同','华泰邮箱、飞书、华泰云文档、多维表格'),(582,'03','业务场景','泰为 HiAgent、万得、企查查、A股市场等')]:item(994,y,530,n,t,b,20)
#15
new('连接器的启用与接入','外部能力','13 / CONNECTOR SETUP','按任务需要启用能力，明确本次要使用的系统',15)
item(76,294,650,'01','按需开启','连接器按需开启，尤其是 MCP 类型的连接器，\n会持续占用上下文。',23)
item(76,490,650,'02','通过 # 明确指定','可以在对话框中通过 # 指定连接器，\n确保 Agent 使用的准确性。',23)
rect(826,289,698,407,SOFT)
text(853,314,640,50,'内部系统尚无连接器时',30,INK,600)
text(853,393,640,95,'方案 A　建设系统 CLI\n由业务系统自建系统 CLI，\n我们提供 CLI 建设的支撑。',23,MUTED)
rect(853,515,640,1,BORDER)
text(853,547,640,140,'方案 B　接入已有 MCP\n把业务系统已有的 MCP 挂载到泰为的 MCP 市场，\n或者金融中台的 MCP 市场，\nWorkMate 自动对接这两个市场。',23,MUTED)
band('先确认目标系统和授权范围，再配置与任务相关的连接器')
# External software with an existing MCP.
new('外部软件已有 MCP，WorkMate 还没接入怎么办？','外部能力','14 / CUSTOM MCP','已有 MCP 的外部软件，可以自行配置，也可以反馈给 WorkMate 团队协助接入')
rect(76,297,690,385,PALE)
rect(798,297,726,385,SOFT)
text(106,324,620,43,'01  自行添加',31,BLUE,600)
text(828,324,650,43,'02  反馈给我们',31,INK,600)
text(106,401,620,75,'通过自定义 MCP 配置，\n将外部软件的 MCP 添加到 WorkMate。',26,INK,500)
text(106,527,620,110,'适合已有 MCP 配置说明，\n希望自己完成配置和使用的情况。',23,MUTED)
text(828,401,650,75,'把外部软件及其 MCP 信息反馈给\nWorkMate 团队，由我们协助接入。',26,INK,500)
text(828,527,650,110,'反馈时附上软件名称、MCP 文档\n以及希望实现的使用场景。',23,MUTED)
band('两种接入方式：自己配置自定义 MCP，或反馈给 WorkMate 团队协助接入')
note('用户补充：外部软件已有 MCP 而 WorkMate 暂未支持时，用户可以直接自定义添加 MCP，也可以反馈给 WorkMate 团队接入。')
#16
new('浏览器自动化','外部能力','14 / BROWSER','根据任务复杂度，选择内置浏览器或连接器里的 AgentBrowser',16)
pic('image21.png',76,287,920,448)
text(1040,299,484,46,'内置浏览器：操作看得见',27,BLUE,600)
text(1040,367,484,116,'在同一界面就能看到浏览器的操作，\n执行过程可见，更安全可信。',23,MUTED)
rect(1040,501,484,1,BORDER)
text(1040,531,484,46,'复杂表单：AgentBrowser',27,INK,600)
text(1040,599,484,110,'如果需要填写复杂表单，\n连接器里的 AgentBrowser 更强大。',23,MUTED)
band('系统尚未开放 MCP 等能力时，浏览器自动化也是不错的选择')
note('内置浏览器的好处是用户在同一界面就可以看到浏览器操作，更安全可信。复杂表单场景可以使用连接器中的 AgentBrowser，能力更强。一些系统如果尚未开放 MCP 等能力，也可以通过浏览器自动化完成操作。')
#17
new('联网检索：获取最新资讯','外部能力','15 / WEB SEARCH','启用联网检索后，可调用泰为平台的检索能力获取最新信息',17)
pic('web-search-settings.png',76,280,700,395)
pic('image23.png',270,684,300,82)
pic('web-search-example.png',816,280,708,484)
rect(76,781,1448,44,PALE);rect(76,781,3,44,BLUE)
text(100,787,1398,33,'使用建议：如果本次搜索涉及敏感信息，不要开启联网检索。',23,INK,500)
#18
new('远程连接：通过铃客持续协作','持续运行','16 / REMOTE','通过铃客向 WorkMate 发送任务，并获取执行结果',18)
text(76,290,690,40,'连接配置',27,INK,600);text(830,290,694,40,'远程发送任务与接收结果',27,INK,600)
pic('image25.png',76,348,690,362);pic('image26.png',830,348,694,362)
band('任务入口延伸到铃客，执行和结果仍由 WorkMate 持续承接')
#19
new('定时任务：让重复工作按计划执行','持续运行','17 / SCHEDULE','适合目标明确、输入稳定，并且结果可以按规则检查的重复工作',19)
item(76,310,620,'01','任务名称与描述','写清任务目标与预期产物。',22)
item(76,467,620,'02','模型与工作区','指定运行所需的模型和资料范围。',22)
item(76,624,620,'03','执行频率与通知','支持单次、间隔、日、周、月，\n保留执行记录。',22)
pic('image27.png',760,244,764,532)
rect(76,790,1448,38,PALE);rect(76,790,3,38,BLUE)
text(100,794,1398,30,'对话示例：每个工作日上午 9 点检查新增项目资料并整理待办',21,INK,500)
#20
new('HTML 的生成、预览与分享','成果协作','18 / HTML COLLABORATION','内置 HTML Skill 引导生成，浏览器实时预览，并支持页面分享',20)
pic('image28.png',76,287,881,434)
pic('image29.png',1010,292,514,200)
pic('image30.png',1110,503,314,222)
band('生成后先预览和检查，再通过文件菜单创建分享页面')
#21
new('HTML 可视化编辑','成果协作','19 / VISUAL EDITING','通过可视化方式微调局部内容与样式',21)
pic('image31.png',76,285,910,439);pic('image32.png',1060,301,397,380)
text(1040,687,463,35,'文字、颜色、边框、边距、宽高',20,BLUE,500,'center')
band('需要局部微调时，在可视化编辑器中选择元素并调整相应属性')
# Local data protection, supplied by the user.
new('本地数据安全：保护 .workmate 目录','安全与支持','21 / LOCAL DATA','当前 Windows 数据目录为 D:\\'+'.workmate，软件安装目录与数据目录分开管理')
rect(76,280,1448,102,PALE)
text(104,312,260,34,'当前数据目录',21,MUTED,500)
text(380,300,1100,58,'D:\\'+'.workmate',38,BLUE,600)
item(76,425,690,'01','不要动 .workmate 目录','不要移动、重命名或删除该目录，\n保留其中的数据文件。',23)
item(830,425,694,'02','不要把软件安装到这个目录','安装 WorkMate 时选择其他安装目录，\n让安装文件与数据文件分开。',23)
item(76,588,700,'03','可在设置中切换根目录','可在“设置 > 数据目录 > 管理目录”中切换。\n当前无法自动迁移数据，\n切换目录不会自动搬迁原目录中的数据。',22)
pic('data-directory-settings.png',830,600,694,110)
text(830,718,694,26,'设置 → 数据目录 → 管理目录',16,LIGHT,400,'center')
band('切换根目录不会自动迁移数据；原数据目录需妥善保留。')
note('当前 Windows 数据目录为 D:\\'+'.workmate。不要移动、重命名或删除该目录，不要把软件安装到数据目录。可在设置中的数据目录管理入口切换根目录，但目前无法自动迁移数据，切换不会自动搬迁原目录中的数据。设置截图由用户提供。')
#22
new('安全使用边界','安全与支持','20 / SAFE USE','数据、权限和关键操作需要清晰边界，结果提交前保留人工复核',22)
for y,n,t,b in [(292,'01','使用本人账号和 Key','不得共享、转交或在对话中粘贴凭证'),(402,'02','敏感信息使用 Local','遵守公司 Claw 类智能体工具使用规范'),(512,'03','关键写操作必须确认','发送、修改、删除前人工复核'),(622,'04','结果提交前人工检查','核对事实、来源、格式和敏感信息')]:
 text(76,y,70,50,n,32,BLUE,500);text(180,y-1,560,50,t,31,INK,600);text(795,y+5,729,55,b,24,MUTED);rect(180,y+82,1344,1,BORDER)
#23
new('遇到问题时的排查与反馈','安全与支持','21 / TROUBLESHOOTING','保留问题现场，结合会话分析与日志反馈定位原因',22)
cols(300,[('01  保存现场','记录任务目标与操作步骤\n保留错误信息、页面状态\n以及相关会话'),('02  让 WorkMate 自查','“刚才的会话为什么跑这么久？”\n“为什么没有使用某个 Skill？”\n“为什么这样处理文档？”'),('03  反馈与日志上报','通过用户群支持渠道反馈\n复杂问题进入“设置 > 日志上报”\n配合开发人员排查')],340)
#24
new('', '培训交流','',source=23)
text(84,143,1400,84,'欢迎加入 WorkMate 用户群',57,INK,650)
text(88,245,1280,54,'交流使用经验，反馈问题，继续探索 AI 工作方式',26,MUTED)
text(240,340,440,44,'飞书用户群',30,BLUE,600,'center');text(920,340,440,44,'铃客用户群',30,BLUE,600,'center')
pic('feishu-group-qr.png',280,400,360,360);pic('lingke-group-qr.png',960,400,360,360)
text(88,782,160,35,'谢谢',26,INK,600)
text(240,769,1120,32,'仅限企业内部成员加入　·　二维码有效期：11 月 4 日前',20,MUTED,400,'center')
note('已用用户本次提供的飞书 WorkMate 用户群与铃客 WorkMate 用户群二维码替换旧用户群码和培训签到码。两份原始二维码海报均注明仅限企业内部成员加入，11 月 4 日前有效。二维码保持原图内容，仅裁除海报外围并保留白色静区。')

# Render static content using the supplied technology-blue template tokens.
ref=(DOCS/'课题答辩-v2-科技蓝.html').read_text()
base=re.findall(r'<style>(.*?)</style>',ref,re.S)[0]
css=base+'''
:root{--bg:#fff;--bg-soft:#f5f8fd;--surface:#fff;--border:#dbe5f1;--text-1:#152c49;--text-2:#526983;--text-3:#788ba3;--accent:#1765dc;--blue-pale:#eaf3ff;--font-sans:'PingFang SC','Microsoft YaHei',Arial,sans-serif}
html,body{width:100%;height:100%;overflow:hidden;background:#e5ecf5}body{display:flex;align-items:center;justify-content:center}.deck{position:relative;width:1600px;height:900px;flex-shrink:0;transform:scale(var(--deck-scale,1));transform-origin:center;box-shadow:0 25px 70px #16417026}.slide{padding:0;display:block;transform:none;background:#fff;transition:opacity .15s}.slide.is-prev{transform:none}.obj{position:absolute;box-sizing:border-box;margin:0;letter-spacing:0}.txt{white-space:pre-wrap;overflow-wrap:break-word;line-height:1.4;font-family:var(--font-sans)}.img{display:block;object-fit:contain}.notes{display:none}.deck-controls{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:10px;z-index:100;padding:7px 12px;background:#fff;border:1px solid var(--border);border-radius:7px;opacity:0;transition:opacity .2s}.deck-controls:hover,body.controls-on .deck-controls{opacity:1}.deck-controls button{border:0;background:transparent;color:var(--text-2);font:14px var(--font-sans);padding:5px 10px;cursor:pointer}.deck-controls button:hover{color:var(--accent);background:var(--blue-pale)}.pagecount{font:14px Arial;color:var(--text-2);padding:5px}.notes-overlay{color:var(--text-1)}.overview{z-index:80}.overview .thumb{overflow:hidden}.overview .slide{position:relative;opacity:1;transform:scale(.2);transform-origin:top left;width:1600px;height:900px}html[data-preview] .deck-controls{display:none}
@media print{@page{size:1600px 900px;margin:0}html,body{height:auto;display:block;overflow:visible;background:#fff}.deck{height:auto;transform:none!important;box-shadow:none}.slide{position:relative;width:1600px;height:900px;opacity:1!important;display:block!important;break-after:page;page-break-after:always}.deck-controls,.overview,.notes-overlay{display:none!important}.obj{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
'''
sections=[]
for i,s in enumerate(slides,1):
 # Renumber chapter kickers after inserting the new content.
 for o in s['objects']:
  if o['type']=='text' and o['x']==76 and o['y']==95 and re.match(r'^\d+ / ',o['text']):
   o['text']=re.sub(r'^\d+',f'{i-2:02d}',o['text'])
 s['objects'].append(dict(type='text',x=1435,y=851,w=89,h=28,text=f'{i:02d} / {len(slides):02d}',size=14,color=MUTED,weight=400,align='right'))
 objs=[]
 for j,o in enumerate(s['objects']):
  style=f'left:{o["x"]}px;top:{o["y"]}px;width:{o["w"]}px;height:{o["h"]}px;'
  attr=f'data-object="{j}"'
  if o['type']=='rect':objs.append(f'<div class="obj rect" {attr} style="{style}background:{o["fill"]};'+(f'border:1px solid {o["stroke"]};' if o.get('stroke') else '')+'"></div>')
  elif o['type']=='text':objs.append(f'<div class="obj txt" {attr} style="{style}font-size:{o["size"]}px;color:{o["color"]};font-weight:{o["weight"]};text-align:{o["align"]};">{html.escape(o["text"])}</div>')
  else:
   uri='data:image/png;base64,'+base64.b64encode((A/o['file']).read_bytes()).decode()
   objs.append(f'<img class="obj img" {attr} alt="{html.escape(s["title"] or "WorkMate")}" src="{uri}" style="{style}">')
 notes=s['notes'] or f'本页介绍{s["title"]}。'+s['sub']
 s['notes']=notes+(f'\n来源：用户提供的 WorkMate培训材料0929.pptx，第 {s["source"]} 页。' if s['source'] else '\n来源：用户在本次对话中补充的培训说明。')
 sections.append(f'<section class="slide {"is-active" if i==1 else ""}" data-title="{html.escape(s["title"] or "WorkMate 使用培训")}" data-page="{i}">'+''.join(objs)+f'<aside class="notes">{html.escape(notes)}</aside></section>')
runtime=Path('/Users/qinxiao/.codex/skills/html-ppt-skill/assets/runtime.js').read_text()
runtime='\n'.join(line.rstrip() for line in runtime.splitlines())
custom="""function fit(){document.documentElement.style.setProperty('--deck-scale',Math.min(innerWidth/1600,innerHeight/900))}fit();addEventListener('resize',fit);document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:b.dataset.nav,bubbles:true}))));let timer;addEventListener('mousemove',()=>{document.body.classList.add('controls-on');clearTimeout(timer);timer=setTimeout(()=>document.body.classList.remove('controls-on'),1800)});"""
out=DOCS/'WorkMate培训材料-科技蓝重制版.html'
out.write_text('<!doctype html><html lang="zh-CN" data-theme="tech-blue"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorkMate 使用培训 · 科技蓝</title><style>'+css+'</style></head><body><main class="deck">'+''.join(sections)+'</main><nav class="deck-controls"><button data-nav="ArrowLeft">← 上一页</button><button data-nav="ArrowRight">下一页 →</button><button data-nav="o">总览 O</button><button data-nav="n">讲稿 N</button><button data-nav="f">全屏 F</button></nav><script>'+runtime+'</script><script>'+custom+'</script></body></html>')
(ROOT/'build/deck.json').write_text(json.dumps(slides,ensure_ascii=False,indent=2))
print('Built',len(slides),'slides:',out)
