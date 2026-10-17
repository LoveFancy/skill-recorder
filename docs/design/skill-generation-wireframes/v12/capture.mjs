/** Synthetic design review only. No model calls or external publishing. */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../../../../',import.meta.url)).replace(/\/$/,'');
const {chromium}=createRequire(`${root}/package.json`)('playwright-core');
const sharp=createRequire(`${root}/package.json`)('sharp');
const target=`${root}/docs/design/skill-generation-wireframes`;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const checks=[];
try{
 const page=await browser.newPage({viewport:{width:1400,height:1060},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const scenes=[['setup','generation-sop'],['outline','manual-outline'],['publish','publish-feishu'],['wiki','publish-wiki'],['workmate','publish-workmate'],['success','publish-success']];
 for(const [state,file] of scenes){
  await page.goto(pathToFileURL(`${target}/index-v12.html`).href+'?scene='+state+'#'+state);
  await page.locator('.page-head h1').waitFor();
  await page.locator('.app').screenshot({path:`${target}/v12/${file}.png`});
  const sizes=await page.locator('.workspace').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
  if(sizes.scroll>sizes.width+1)throw Error('Overflow '+state);
  checks.push({state,...sizes});
 }
 await page.goto(pathToFileURL(`${target}/index-v12.html`).href+'#setup');
 if(!await page.getByRole('button',{name:'生成 SOP',exact:true}).isEnabled())throw Error('SOP should generate directly');
 if(await page.locator('#confirm').count())throw Error('SOP should not repeat source confirmation');await page.getByRole('button',{name:'生成 SOP',exact:true}).click();
 await page.getByRole('button',{name:'演示：处理完成'}).click();
 await page.locator('#confirm').check();await page.getByRole('button',{name:'确认并保存，去发布'}).click();
 await page.locator('#confirm').check();
 if(!await page.getByRole('button',{name:'发布到飞书文档',exact:true}).isDisabled())throw Error('missing destination gate');
 await page.locator('#destination').selectOption('sales');
 await page.getByRole('button',{name:'发布到飞书文档',exact:true}).click();
 await page.getByRole('button',{name:'演示：处理完成'}).click();
 await page.getByRole('heading',{name:'已发布，可以分享了'}).waitFor();
 for(const kind of ['manual','sop','manual']){
  await page.locator('#output').selectOption(kind);
  await page.getByRole('heading',{name:kind==='manual'?'使用手册':'SOP 操作说明',exact:true}).waitFor();
 }
 for(const state of ['draft','skill','failure','stale','blocked','disconnected','unknown']){
  await page.locator('#scenario').selectOption(state);
  await page.locator('.page-head h1').waitFor();
 }
 await page.setViewportSize({width:480,height:980});
 await page.goto(pathToFileURL(`${target}/index-v12.html`).href+'#publish');
 await page.locator('.page-head h1').waitFor();
 await page.locator('.app').screenshot({path:`${target}/v12/publish-narrow.png`});
 const narrow=await page.locator('.workspace').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
 if(narrow.scroll>narrow.width+1)throw Error('Narrow overflow');
 await page.getByText('查看本次发布内容',{exact:true}).click();
 if(!await page.locator('.summary-mobile .publish-summary').isVisible())throw Error('missing mobile summary');
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({checks,narrow,flow:'source gate → generate → review → destination gate → publish → success; repeated output switching; narrow summary',pageErrors:errors}));
 const thumbs=await Promise.all(scenes.map(async([state,file],i)=>({input:await sharp(`${target}/v12/${file}.png`).resize({width:600}).png().toBuffer(),left:(i%2)*620+20,top:Math.floor(i/2)*450+20})));
 await sharp({create:{width:1260,height:1370,channels:3,background:'#e9e8e5'}}).composite(thumbs).png().toFile(`${target}/v12/board.png`);
}finally{await browser.close()}
