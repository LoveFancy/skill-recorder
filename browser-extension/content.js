(() => {
  if (globalThis.__skillRecorderContent) return;
  globalThis.__skillRecorderContent = true;
  let session = null, lastUrl = '', inputTimers = new Map(), scrollTimer;
  let inputValues=new WeakMap();
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 512);
  const sensitive = element => !!element.closest('input[type=password],input[type=hidden],input[type=file],[data-private],[data-sensitive]') || /password|passwd|secret|token|api.?key|credential|密码|密钥|验证码|credit.?card|cc-number|one-time-code/i.test([element.id, element.getAttribute('name'), element.getAttribute('autocomplete'), element.getAttribute('aria-label'),element.getAttribute('placeholder')].join(' '));
  const url = () => { const u=new URL(location.href);u.username='';u.password='';u.search='';u.hash='';return u.toString().slice(0,2048); };
  const rootQuery = (root, selector) => {try{return root.querySelectorAll(selector).length===1;}catch{return false;}};
  function describe(el) {
    const r=el.getBoundingClientRect(), root=el.getRootNode(), shadow=root instanceof ShadowRoot;
    const base={tag:el.tagName.toLowerCase(),bounds:{x:r.x,y:r.y,width:r.width,height:r.height},locators:[],shadow};
    if(sensitive(el))return {...base,redacted:true,inputType:el.type};
    const locators=[];
    const add=selector=>{if(selector && selector.length<=512)locators.push({kind:'css',value:selector,unique:!shadow&&rootQuery(root,selector)});};
    if(el.id)add('#'+CSS.escape(el.id));
    for(const attr of ['data-testid','data-test','name']){const value=el.getAttribute(attr);if(value)add(`${base.tag}[${attr}="${CSS.escape(value)}"]`);}
    if(!locators.some(l=>l.unique)){
      let n=el,parts=[];
      for(let i=0;n && i<6;i++,n=n.parentElement){const siblings=n.parentElement?Array.from(n.parentElement.children).filter(s=>s.tagName===n.tagName):[];parts.unshift(n.tagName.toLowerCase()+(siblings.length>1?`:nth-of-type(${siblings.indexOf(n)+1})`:''));if(rootQuery(root,parts.join(' > ')))break;}
      add(parts.join(' > '));
    }
    const role=el.getAttribute('role')||({BUTTON:'button',A:'link',SELECT:'combobox',TEXTAREA:'textbox'}[el.tagName]) || (el.tagName==='INPUT'?(/checkbox|radio/.test(el.type)?el.type:'textbox'):undefined);
    const name=clean(el.getAttribute('aria-label') || (el.labels?.length?Array.from(el.labels).map(l=>l.textContent).join(' '):'') || el.getAttribute('title'));
    // Never copy a container's full text: it could include unrelated/private fields.
    const text=/^(BUTTON|A|LABEL|OPTION)$/.test(el.tagName)?clean(el.textContent):clean(Array.from(el.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(' '));
    if(role && (name||text))locators.push({kind:'role',value:JSON.stringify({role,name:name||text}),unique:false});
    return {...base,role,name,text,inputType:el.type,locators:locators.slice(0,8)};
  }
  function send(action,el,extra={},previouslyFocused=false) {
    if(!session || (!previouslyFocused && (document.visibilityState!=='visible' || !document.hasFocus())))return;
    const event={eventId:crypto.randomUUID(),sessionId:session.id,capturedAt:Date.now(),action,url:url(),title:clean(document.title),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scrollX,scrollY},...extra};
    if(el instanceof Element)event.element=describe(el);
    chrome.runtime.sendMessage({kind:'capture',event,focusedAtCapture:true}).catch(()=>{});
  }
  function input(el,capturedAt=Date.now(),previouslyFocused=false) {
    if(!session || (!previouslyFocused && (document.visibilityState!=='visible'||!document.hasFocus())))return;
    const description=describe(el);
    if(!description.redacted){description.value=clean(el.value ?? el.textContent);if('checked' in el)description.checked=el.checked;}
    const signature=JSON.stringify([description.value,description.checked,description.redacted]);
    if(inputValues.get(el)===signature)return;
    inputValues.set(el,signature);
    send(el.tagName==='SELECT'?'change':'input',null,{element:description,capturedAt},previouslyFocused);
  }
  const target=ev=>ev.composedPath().find(n=>n instanceof Element);
  document.addEventListener('click',ev=>{if(!ev.isTrusted)return;const el=target(ev);send('click',el?.closest('button,a,input,select,textarea,[role=button]')||el,{point:{x:ev.clientX,y:ev.clientY}});},true);
  document.addEventListener('input',ev=>{
    if(!ev.isTrusted||!session||document.visibilityState!=='visible'||!document.hasFocus())return;
    const el=target(ev);clearTimeout(inputTimers.get(el)?.timer);if(inputTimers.size>100)return;
    const capturedAt=Date.now();const timer=setTimeout(()=>{inputTimers.delete(el);input(el,capturedAt,true);},350);
    inputTimers.set(el,{timer,capturedAt});
  },true);
  document.addEventListener('change',ev=>{
    if(!ev.isTrusted||!session)return;
    const el=target(ev),pending=inputTimers.get(el);clearTimeout(pending?.timer);inputTimers.delete(el);input(el,pending?.capturedAt??Date.now(),!!pending);
  },true);
  document.addEventListener('submit',ev=>{if(ev.isTrusted)send('submit',target(ev));},true);
  document.addEventListener('scroll',ev=>{if(!ev.isTrusted)return;clearTimeout(scrollTimer);if(session)scrollTimer=setTimeout(()=>send('scroll'),400);},true);
  function flush(){for(const [el,pending]of inputTimers){clearTimeout(pending.timer);input(el,pending.capturedAt,true);}inputTimers.clear();clearTimeout(scrollTimer);}
  chrome.runtime.onMessage.addListener((m,_sender,reply)=>{
    if(m.kind==='session'){flush();session=m.session;lastUrl='';inputValues=new WeakMap();reply({ok:true});}
    if(m.kind==='drain'){flush();session=null;reply({ok:true});}
  });
  chrome.runtime.sendMessage({kind:'content-ready'}).then(m=>{session=m?.session??null;}).catch(()=>{});
  // Isolated-world polling covers history.pushState, hash changes and SPA routing.
  setInterval(()=>{if(session && location.href!==lastUrl){lastUrl=location.href;send('navigation');}},500);
  addEventListener('pagehide',flush);
})();
