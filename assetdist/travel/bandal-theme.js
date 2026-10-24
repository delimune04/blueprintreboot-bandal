'use strict';
// Presentation-only motion follows BANDAL's timing without delaying controls.
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const header = document.querySelector('.topbar');
  const progress = document.querySelector('.scroll-progress');
  let pending = false;
  function updateScroll() {
    pending = false;
    header?.classList.toggle('scrolled', window.scrollY > 20);
    if (!progress) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${reduced.matches || max <= 0 ? 0 : Math.min(1,Math.max(0,window.scrollY / max))})`;
  }
  window.addEventListener('scroll', () => {
    if (!pending) { pending = true; requestAnimationFrame(updateScroll); }
  }, {passive:true});
  window.addEventListener('resize', updateScroll, {passive:true});
  reduced.addEventListener?.('change', () => { if (reduced.matches) document.getAnimations?.().forEach(animation => animation.cancel()); updateScroll(); });
  updateScroll();
  document.addEventListener('click', event => {
    if (reduced.matches) return;
    const control = event.target.closest('.tabs button,[data-day]');
    if (!control) return;
    requestAnimationFrame(() => {
      const panel = control.hasAttribute('data-day')
        ? document.querySelector('#dayLayout')
        : document.querySelector('[role="tabpanel"]:not([hidden])');
      panel?.animate?.([
        {opacity:.35,transform:'translateY(12px)'},
        {opacity:1,transform:'translateY(0)'}
      ], {duration:420,easing:'cubic-bezier(.2,.72,.24,1)'});
    });
  });
})();
