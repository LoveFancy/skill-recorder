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
