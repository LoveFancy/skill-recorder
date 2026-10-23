(() => {
  const resize = () => document.documentElement.style.setProperty('--deck-scale', Math.min(innerWidth / 1600, innerHeight / 900));
  resize();
  addEventListener('resize', resize);
  const sync = () => {
    const slides = [...document.querySelectorAll('.deck > .slide')];
    const idx = slides.findIndex(slide => slide.classList.contains('is-active'));
    slides.forEach((slide, i) => {slide.setAttribute('aria-hidden', String(i !== idx)); slide.inert = i !== idx;});
    document.querySelector('#nav-count').textContent = `${String(idx + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
    document.querySelector('[data-direction="prev"]').disabled = idx === 0;
    document.querySelector('[data-direction="next"]').disabled = idx === slides.length - 1;
  };
  document.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: button.dataset.direction === 'next' ? 'ArrowRight' : 'ArrowLeft', bubbles: true }))));
  document.querySelector('#fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch {}
  });
  let hideControls;
  addEventListener('pointermove', () => {document.body.classList.add('show-controls'); clearTimeout(hideControls); hideControls = setTimeout(() => document.body.classList.remove('show-controls'), 1600);});
  new MutationObserver(sync).observe(document.querySelector('.deck'), {subtree:true, attributes:true, attributeFilter:['class']});
  addEventListener('DOMContentLoaded', sync);
})();

// Offline image insertion and export. Only user-selected files are read.
(() => {
  const key = key => document.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles:true}));
  document.querySelector('#overview-button').addEventListener('click', () => key('o'));
  document.querySelector('#notes-button').addEventListener('click', () => key('n'));
  const toast = message => {
    document.querySelector('.toast')?.remove();
    const node=document.createElement('div');node.className='toast';node.textContent=message;document.body.append(node);setTimeout(()=>node.remove(),3000);
  };
  const fill = figure => {
    const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';
    input.addEventListener('change',()=>{
      const file=input.files?.[0]; if(!file)return;
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)){toast('请选择 PNG、JPG 或 WebP 图片');return;}
      const reader=new FileReader();reader.onload=()=>{
        const holder=figure.querySelector('.shot-placeholder');
        const image=document.createElement('img');image.className='shot-image';image.src=String(reader.result);image.alt=figure.querySelector('.shot-placeholder b')?.textContent||figure.querySelector('figcaption').textContent;
        holder.replaceChildren(image);figure.classList.add('has-image');
        figure.querySelector('.missing').textContent='已填入 · 请核实脱敏与红框标注';
        toast('截图已填入；点底部 ↓ 可保存到 HTML');
      };reader.readAsDataURL(file);
    });input.click();
  };
  const open = figure => {
    const src=figure.querySelector('.shot-image')?.src;
    if(!src){fill(figure);return;}
    const overlay=document.createElement('div');overlay.className='shot-lightbox';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','截图预览');
    const image=document.createElement('img');image.src=src;image.alt=figure.querySelector('figcaption').textContent;
    const controls=document.createElement('div');controls.className='shot-lightbox-controls';
    const close=document.createElement('button');close.textContent='关闭 · Esc';
    const change=document.createElement('button');change.textContent='更换截图';
    const onKey=e=>{if(e.key==='Escape'){e.stopImmediatePropagation();dismiss();}};
    const dismiss=()=>{overlay.remove();removeEventListener('keydown',onKey,true);figure.focus();};
    close.onclick=dismiss;change.onclick=()=>{dismiss();fill(figure);};
    controls.append(close,change);overlay.append(image,controls);document.body.append(overlay);addEventListener('keydown',onKey,true);close.focus();
  };
  document.querySelectorAll('.deck > .slide figure.shot').forEach(figure=>{
    figure.tabIndex=0;figure.setAttribute('role','button');figure.setAttribute('aria-label','填入或查看截图 '+figure.dataset.shot);
    figure.addEventListener('click',()=>open(figure));
    figure.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.stopPropagation();event.preventDefault();open(figure);}});
  });
  document.querySelector('#save-deck').addEventListener('click',async()=>{
    const clone=document.documentElement.cloneNode(true);
    // Resolve only local deck assets for the folder edition. The standalone edition is already inline.
    try {
      for(const link of clone.querySelectorAll('link[rel="stylesheet"]')){
        const response=await fetch(link.href);if(!response.ok)throw new Error('style');const style=document.createElement('style');style.textContent=await response.text();link.replaceWith(style);
      }
      for(const script of clone.querySelectorAll('script[src]')){
        const response=await fetch(script.src);if(!response.ok)throw new Error('script');script.textContent=await response.text();script.removeAttribute('src');
      }
    } catch {toast('请打开 docs/课题答辩.html 单文件版本后保存截图');return;}
    clone.querySelectorAll('.overview,.notes-overlay,.progress-bar,.toast,.shot-lightbox').forEach(n=>n.remove());
    clone.querySelector('body').classList.remove('show-controls');
    const blob=new Blob(['<!doctype html>\n'+clone.outerHTML],{type:'text/html;charset=utf-8'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='课题答辩-含截图.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已保存完整 HTML（含填入的截图）');
  });
})();
