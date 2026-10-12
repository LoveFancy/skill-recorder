const { ipcRenderer } = require("electron");
ipcRenderer.on("source-picker:init", (_event,{sources,selectedId}) => {
  let selected=sources.some(s=>s.id===selectedId) ? selectedId : null;
  let filter="all";
  const container=document.getElementById("sources"), confirm=document.getElementById("confirm");
  function render(){
    container.replaceChildren();
    confirm.disabled=!selected;
    const visible=sources.filter(s=>filter==="all" || (filter==="screens" ? s.id.startsWith("screen:") : s.id.startsWith("window:")));
    if(!visible.length){const empty=document.createElement("p");empty.className="empty";empty.textContent=filter==="windows"?"没有可录制的应用窗口，请打开目标应用后重新选择。":"没有可录制的屏幕。";container.append(empty);}
    for(const source of visible){
      const button=document.createElement("button");button.className="source"+(selected===source.id?" selected":"");button.setAttribute("aria-pressed",String(selected===source.id));button.title=source.label;
      if(source.appIcon){const icon=document.createElement("img");icon.className="app-icon";icon.src=source.appIcon;icon.alt="";button.append(icon);}else{const icon=document.createElement("span");icon.className="app-icon icon-fallback";icon.textContent=source.id.startsWith("screen:")?"▣":source.label.slice(0,1);icon.setAttribute("aria-hidden","true");button.append(icon);}
      if(source.thumbnail){const img=document.createElement("img");img.className="preview";img.src=source.thumbnail;img.alt="";button.append(img);}else{const placeholder=document.createElement("div");placeholder.className="empty-preview";placeholder.textContent="预览暂不可用";button.append(placeholder);}
      const title=document.createElement("strong");title.textContent=source.label;button.append(title);
      button.onclick=()=>{selected=source.id;render();};button.ondblclick=()=>ipcRenderer.send("source-picker:finish",source.id);container.append(button);
    }
  }
  for(const id of ["all","screens","windows"])document.getElementById(id).onclick=()=>{filter=id;for(const other of ["all","screens","windows"])document.getElementById(other).classList.toggle("active",other===id);render();};
  confirm.onclick=()=>{if(selected)ipcRenderer.send("source-picker:finish",selected);};
  document.getElementById("cancel").onclick=()=>ipcRenderer.send("source-picker:finish",null);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")ipcRenderer.send("source-picker:finish",null);if(e.key==="Enter"&&selected)ipcRenderer.send("source-picker:finish",selected);});render();
});
