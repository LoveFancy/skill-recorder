from pathlib import Path
from xml.sax.saxutils import escape,quoteattr
import json, zipfile, datetime

ROOT=Path(__file__).resolve().parent
DOCS=ROOT.parent.parent
slides=json.loads((ROOT/'build/deck.json').read_text())
layouts=json.loads((ROOT/'build/text-layout.json').read_text())
P='http://schemas.openxmlformats.org/presentationml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PR='http://schemas.openxmlformats.org/package/2006/relationships'
XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
NS=f'xmlns:a="{A}" xmlns:r="{R}" xmlns:p="{P}"'
EMU=7620
def u(v):return str(round(v*EMU))
def col(c):return c.lstrip('#').upper()
def xfrm(x,y,w,h):return f'<a:xfrm><a:off x="{u(x)}" y="{u(y)}"/><a:ext cx="{u(w)}" cy="{u(h)}"/></a:xfrm>'
def tree():return '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
def rels(items):return XML+f'<Relationships xmlns="{PR}">'+''.join(f'<Relationship Id="{rid}" Type="{R}/{typ}" Target="{target}"/>' for rid,typ,target in items)+'</Relationships>'
def nv(n,name=''):
 return f'<p:nvSpPr><p:cNvPr id="{n}" name={quoteattr(name)}/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
def shape(n,o):
 line=f'<a:ln w="7620"><a:solidFill><a:srgbClr val="{col(o["stroke"])}"/></a:solidFill></a:ln>' if o.get('stroke') else '<a:ln><a:noFill/></a:ln>'
 return '<p:sp>'+nv(n,'Style')+'<p:spPr>'+xfrm(o['x'],o['y'],o['w'],o['h'])+f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{col(o["fill"])}"/></a:solidFill>'+line+'</p:spPr></p:sp>'
def textshape(n,o,ln):
 # The line's browser bounds preserve native text wrapping in PowerPoint.
 s=ln['text'].replace('\n','');sz=round(o['size']*.6*100)
 # Slide uses a 13.333 x 7.5 inch canvas: one authored pixel = .6 pt.
 b='1' if o['weight']>=550 else '0'
 rp=f'<a:rPr lang="zh-CN" sz="{sz}" b="{b}" dirty="0"><a:solidFill><a:srgbClr val="{col(o["color"])}"/></a:solidFill><a:latin typeface="PingFang SC"/><a:ea typeface="PingFang SC"/><a:cs typeface="Arial"/></a:rPr>'
 # Range bounds include the font's line box. The inset recreates CSS leading.
 y=ln['y']+o['size']*.08
 h=max(ln['h']+6,o['size']*1.4)
 w=max(ln['w']+16,20)
 return '<p:sp>'+nv(n,s[:40])+'<p:spPr>'+xfrm(ln['x'],y,w,h)+'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" rIns="0" tIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="l"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr><a:r>'+rp+'<a:t xml:space="preserve">'+escape(s)+'</a:t></a:r><a:endParaRPr lang="zh-CN" sz="'+str(sz)+'"/></a:p></p:txBody></p:sp>'
def picture(n,o,rid):
 return f'<p:pic><p:nvPicPr><p:cNvPr id="{n}" name={quoteattr(o["file"])}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>'+xfrm(o['x'],o['y'],o['w'],o['h'])+'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
def native_table(n,t):
 rows=[]
 for ri,(row,height) in enumerate(zip(t['rows'],t['heights'])):
  cells=[]
  for ci,value in enumerate(row):
   size=19 if ci==0 else (30 if ri==0 else 20)
   color='526983' if ci==0 else ('1765DC' if ri==0 and ci==1 else '152C49')
   fill='F5F8FD' if ri==0 else 'FFFFFF'
   rp=f'<a:rPr lang="zh-CN" sz="{round(size*.6*100)}" b="{int(ri==0 and ci>0)}"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:latin typeface="PingFang SC"/><a:ea typeface="PingFang SC"/></a:rPr>'
   tx='<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="l"/><a:r>'+rp+'<a:t>'+escape(value)+'</a:t></a:r></a:p></a:txBody>'
   tc=f'<a:tcPr marL="{u(20)}" marR="{u(8)}" marT="0" marB="0" anchor="ctr"><a:lnL><a:noFill/></a:lnL><a:lnR><a:noFill/></a:lnR><a:lnT><a:noFill/></a:lnT><a:lnB w="7620"><a:solidFill><a:srgbClr val="DBE5F1"/></a:solidFill></a:lnB><a:solidFill><a:srgbClr val="{fill}"/></a:solidFill></a:tcPr>'
   cells.append('<a:tc>'+tx+tc+'</a:tc>')
  rows.append(f'<a:tr h="{u(height)}">'+''.join(cells)+'</a:tr>')
 grid='<a:tblGrid>'+''.join(f'<a:gridCol w="{u(w)}"/>' for w in t['widths'])+'</a:tblGrid>'
 return f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{n}" name="引擎对比表"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="{u(t["x"])}" y="{u(t["y"])}"/><a:ext cx="{u(sum(t["widths"]))}" cy="{u(sum(t["heights"]))}"/></p:xfrm><a:graphic><a:graphicData uri="{A}/table"><a:tbl><a:tblPr firstRow="1" bandRow="0"/>'+grid+''.join(rows)+'</a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
parts={}
def put(p,s):parts[p]=(XML+s if not s.startswith('<?xml') else s).encode()
put('_rels/.rels',rels([('rId1','officeDocument','ppt/presentation.xml')]))
put('ppt/presentation.xml',f'<p:presentation {NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>'+''.join(f'<p:sldId id="{255+i}" r:id="rId{i+2}"/>' for i in range(1,len(slides)+1))+f'</p:sldIdLst><p:sldSz cx="{u(1600)}" cy="{u(900)}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>')
put('ppt/_rels/presentation.xml.rels',rels([('rId1','slideMaster','slideMasters/slideMaster1.xml'),('rId2','notesMaster','notesMasters/notesMaster1.xml')]+[(f'rId{i+2}','slide',f'slides/slide{i}.xml') for i in range(1,len(slides)+1)]))
put('ppt/slideMasters/slideMaster1.xml',f'<p:sldMaster {NS}><p:cSld><p:spTree>{tree()}</p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>')
put('ppt/slideMasters/_rels/slideMaster1.xml.rels',rels([('rId1','slideLayout','../slideLayouts/slideLayout1.xml'),('rId2','theme','../theme/theme1.xml')]))
put('ppt/slideLayouts/slideLayout1.xml',f'<p:sldLayout {NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>{tree()}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>')
put('ppt/slideLayouts/_rels/slideLayout1.xml.rels',rels([('rId1','slideMaster','../slideMasters/slideMaster1.xml')]))
with zipfile.ZipFile(DOCS/'WorkMate培训材料0929.pptx') as z:parts['ppt/theme/theme1.xml']=z.read('ppt/theme/theme1.xml')
put('ppt/notesMasters/notesMaster1.xml',f'<p:notesMaster {NS}><p:cSld><p:spTree>{tree()}</p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:notesStyle/></p:notesMaster>')
put('ppt/notesMasters/_rels/notesMaster1.xml.rels',rels([('rId1','theme','../theme/theme1.xml')]))
for i,(s,layout) in enumerate(zip(slides,layouts),1):
 lookup={t['object']:t['lines'] for t in layout};objs=[];n=1;rs=[('rId1','slideLayout','../slideLayouts/slideLayout1.xml'),('rId2','notesSlide',f'../notesSlides/notesSlide{i}.xml')]
 if s.get('table'):n+=1;objs.append(native_table(n,s['table']))
 for j,o in enumerate(s['objects']):
  if o.get('table_part'):continue
  if o['type']=='rect':n+=1;objs.append(shape(n,o))
  elif o['type']=='text':
   for ln in lookup.get(j,[]):n+=1;objs.append(textshape(n,o,ln))
  else:
   n+=1;rid=f'rId{len(rs)+1}';rs.append((rid,'image','../media/'+o['file']));objs.append(picture(n,o,rid));parts['ppt/media/'+o['file']]=(ROOT/'assets'/o['file']).read_bytes()
 put(f'ppt/slides/slide{i}.xml',f'<p:sld {NS}><p:cSld name={quoteattr(s["title"] or "WorkMate 使用培训")}><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>{tree()}'+''.join(objs)+'</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>')
 put(f'ppt/slides/_rels/slide{i}.xml.rels',rels(rs))
 paras=''.join('<a:p><a:r><a:t>'+escape(t)+'</a:t></a:r></a:p>' for t in s['notes'].split('\n'))
 put(f'ppt/notesSlides/notesSlide{i}.xml',f'<p:notes {NS}><p:cSld><p:spTree>{tree()}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>')
 put(f'ppt/notesSlides/_rels/notesSlide{i}.xml.rels',rels([('rId1','notesMaster','../notesMasters/notesMaster1.xml'),('rId2','slide',f'../slides/slide{i}.xml')]))
types={'ppt/presentation.xml':'presentation.main','ppt/slideMasters/slideMaster1.xml':'slideMaster','ppt/slideLayouts/slideLayout1.xml':'slideLayout','ppt/notesMasters/notesMaster1.xml':'notesMaster'}
for i in range(1,len(slides)+1):types[f'ppt/slides/slide{i}.xml']='slide';types[f'ppt/notesSlides/notesSlide{i}.xml']='notesSlide'
put('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'+''.join(f'<Override PartName="/{p}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.{t}+xml"/>' for p,t in types.items())+'<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>')
out=DOCS/'WorkMate培训材料-科技蓝重制版.pptx'
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for p,data in parts.items():z.writestr(p,data)
print('Exported',out,'native text objects',sum(len(t['lines']) for l in layouts for t in l))
