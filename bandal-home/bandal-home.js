/* BANDAL STUDIO homepage, v9. Content and navigation work without this file;
   it only adds reveals, scroll-linked depth and decorative motion. */
(() => {
  'use strict';

  const root = document.documentElement;
  root.classList.add('js');

  const STORE_KEY = 'bandal:motion';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  let userPaused = root.classList.contains('motion-paused');
  const motionOff = () => userPaused || reduced.matches;

  /* Reveal once, then leave content visible. */
  const reveals = $$('.reveal');
  $$('[data-stagger]').forEach(group => {
    $$('.reveal', group).forEach((element, index) => element.style.setProperty('--i', String(Math.min(index, 6))));
  });
  const countTargets = new Set();
  function reveal(element) {
    if (element.classList.contains('is-visible')) return;
    element.classList.add('is-visible');
    if (element.hasAttribute('data-count-up')) countUp(element);
  }
  let revealObserver = null;
  if ('IntersectionObserver' in window) {
    revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      reveal(entry.target);
      revealObserver.unobserve(entry.target);
    }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach(element => revealObserver.observe(element));
  } else {
    reveals.forEach(reveal);
  }
  const revealAll = () => reveals.forEach(reveal);
  // Keyboard focus never lands in content that is still waiting for its reveal.
  document.addEventListener('focusin', event => {
    const target = event.target.closest?.('.reveal');
    if (target) reveal(target);
  });

  // Counts up to the number already written in the page; no data is invented.
  function countUp(container) {
    $$('[data-harupyeon-total]', container).forEach(element => {
      const target = Number.parseInt(element.textContent, 10);
      if (!Number.isFinite(target) || target <= 0 || motionOff() || countTargets.has(element)) return;
      countTargets.add(element);
      const start = performance.now();
      const duration = 1400;
      const step = now => {
        const t = clamp((now - start) / duration, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        element.textContent = String(t >= 1 || motionOff() ? target : Math.round(target * eased));
        if (t < 1 && !motionOff()) requestAnimationFrame(step);
        else element.textContent = String(target);
      };
      element.textContent = '0';
      requestAnimationFrame(step);
    });
  }

  /* Menu */
  const menu = $('.menu-toggle');
  const nav = $('#navigation');
  const masthead = $('.masthead');
  const phone = window.matchMedia('(max-width: 1020px)');
  function setMenu(open, restoreFocus) {
    if (!menu || !nav) return;
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    nav.classList.toggle('is-open', open);
    root.classList.toggle('menu-open', open);
    if (open) {
      masthead?.classList.remove('is-hidden');
      // The links come before the toggle in document order, so move focus into them.
      nav.querySelector('a')?.focus({ preventScroll: true });
    }
    if (!open && restoreFocus) menu.focus();
  }
  menu?.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && nav?.classList.contains('is-open')) setMenu(false, true);
  });
  document.addEventListener('click', event => {
    if (nav?.classList.contains('is-open') && !event.target.closest('.masthead')) setMenu(false);
  });
  const onPhoneChange = () => { if (!phone.matches) setMenu(false); };
  if (phone.addEventListener) phone.addEventListener('change', onPhoneChange);
  else phone.addListener?.(onPhoneChange);
  masthead?.addEventListener('focusin', () => masthead.classList.remove('is-hidden'));

  /* Scroll-linked state */
  const progress = $('.progress');
  const hero = $('.hero');
  const heroSticky = $('.hero-sticky');
  const horizonMoon = $('#horizon-moon');
  const parallax = $$('[data-parallax]');
  const chapters = $$('[data-chapter]');
  const chapterLinks = $$('[data-chapter-link]');
  const statement = $('[data-scrub]');
  const words = statement ? $$('.w', statement) : [];
  const footerMark = $('.footer-wordmark');
  let lastY = window.scrollY;
  let scrollQueued = false;
  let activeChapter = '';

  function setChapter(name) {
    if (name === activeChapter) return;
    activeChapter = name;
    if (name) root.dataset.chapter = name;
    else delete root.dataset.chapter;
    chapterLinks.forEach(link => {
      if (link.dataset.chapterLink === name) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  function updateScroll() {
    scrollQueued = false;
    const y = window.scrollY;
    const viewport = window.innerHeight;
    const max = document.documentElement.scrollHeight - viewport;
    const off = motionOff();
    if (progress) progress.style.transform = `scaleX(${max > 0 ? clamp(y / max, 0, 1) : 0})`;

    if (masthead) {
      masthead.classList.toggle('is-scrolled', y > 24);
      const delta = y - lastY;
      if (Math.abs(delta) > 6) {
        const menuOpen = nav?.classList.contains('is-open');
        const focusInside = masthead.contains(document.activeElement) && document.activeElement !== document.body;
        masthead.classList.toggle('is-hidden', delta > 0 && y > viewport * 0.9 && !menuOpen && !focusInside);
        lastY = y;
      }
    }
    root.classList.toggle('past-hero', y > viewport * 0.75);

    const middle = viewport * 0.5;
    let current = '';
    for (const section of chapters) {
      const rect = section.getBoundingClientRect();
      if (rect.top <= middle && rect.bottom > middle) { current = section.dataset.chapter; break; }
    }
    setChapter(current);

    if (hero && heroSticky && horizonMoon) {
      const mobile = window.innerWidth <= 760;
      // Keep the small moon near the right edge of the cropped mobile sky,
      // clear of the left-aligned headline and body copy.
      const sceneWidth = heroSticky.clientWidth || window.innerWidth;
      const scale = Math.max(sceneWidth / 1672, heroSticky.offsetHeight / 941);
      const cropOffset = (1672 * scale - sceneWidth) / 2;
      const moonX = mobile ? Math.round((cropOffset + sceneWidth - 68) / scale) : 1208;
      const moonY = moonX > 1100 ? 555 : moonX > 1030 ? 570 : 582;
      horizonMoon.setAttribute('x', String(moonX));
      horizonMoon.setAttribute('y', String(moonY));
      const distance = mobile ? 88 : 112;
      const runway = Math.max(1, hero.offsetHeight - heroSticky.offsetHeight);
      const fraction = off ? 1 : clamp(-hero.getBoundingClientRect().top / runway, 0, 1);
      const eased = fraction * fraction * (3 - 2 * fraction);
      hero.style.setProperty('--moon-shift', `${(-distance * eased).toFixed(2)}px`);
      hero.style.setProperty('--hero-p', off ? '0' : eased.toFixed(3));
      hero.style.setProperty('--hero-fade', off ? '0' : clamp((fraction - 0.25) / 0.75, 0, 1).toFixed(3));
    }

    if (off) return;

    parallax.forEach(section => {
      const rect = section.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > viewport + 200) return;
      const p = clamp((viewport - rect.top) / (viewport + rect.height), 0, 1);
      section.style.setProperty('--p', p.toFixed(3));
    });

    if (statement && words.length) {
      const rect = statement.getBoundingClientRect();
      // Words light up while the statement travels from 88% to 38% of the viewport.
      const p = clamp((viewport * 0.88 - rect.top) / (viewport * 0.5), 0, 1) * words.length;
      words.forEach((word, index) => word.style.setProperty('--on', clamp(p - index, 0, 1).toFixed(3)));
    }

    if (footerMark) {
      const rect = footerMark.getBoundingClientRect();
      const f = clamp((viewport - rect.top) / (rect.height * 1.6), 0, 1);
      footerMark.style.setProperty('--f', f.toFixed(3));
    }
  }
  function requestScroll() {
    if (!scrollQueued) {
      scrollQueued = true;
      requestAnimationFrame(updateScroll);
    }
  }
  function clearContinuousMotion() {
    parallax.forEach(section => section.style.removeProperty('--p'));
    words.forEach(word => word.style.removeProperty('--on'));
    footerMark?.style.removeProperty('--f');
  }
  window.addEventListener('scroll', requestScroll, { passive: true });
  window.addEventListener('resize', requestScroll, { passive: true });

  /* Hero constellation, pointer depth and the marquee share one frame loop. */
  const canvas = $('#constellation');
  const context = canvas?.getContext('2d', { alpha: true });
  const orbit = $('.orbit-parallax');
  const marquee = $('.studio-marquee');
  const track = $('.marquee-track');
  const toggle = $('.motion-toggle');
  const controls = $$('[data-tilt], [data-magnetic]').map(element => ({
    element,
    tilt: element.hasAttribute('data-tilt'),
    magnetic: element.hasAttribute('data-magnetic'),
    active: false, dirty: false, rect: null,
    pointerX: 0, pointerY: 0,
    x: 0, y: 0, spotX: 50, spotY: 50,
    targetX: 0, targetY: 0, targetSpotX: 50, targetSpotY: 50
  }));

  let pageActive = true;
  let heroVisible = false;
  let marqueeVisible = false;
  let frame = 0;
  let lastFrame = 0;
  let lastPaint = 0;
  let elapsed = 0;
  let width = 0;
  let height = 0;
  let stars = [];
  let connections = [];
  let shootingStar = null;
  let nextShootingStar = 9;
  let resizePending = true;
  let marqueeX = 0;
  let marqueeVelocity = 0;
  let marqueeHalf = 0;
  let scrollVelocityY = window.scrollY;
  const canRun = () => pageActive && !document.hidden && !motionOff();

  // Repeatable positions keep the sky from jumping after an ordinary resize.
  function randomFactory(seed) {
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function resizeCanvas() {
    resizePending = false;
    marqueeHalf = track ? track.scrollWidth / 2 : 0;
    if (!canvas || !heroSticky || !context) return;
    width = Math.max(1, heroSticky.clientWidth);
    height = Math.max(1, heroSticky.clientHeight);
    const ratio = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const mobile = window.innerWidth <= 760;
    const count = mobile ? 30 : clamp(Math.round(width / 19), 42, 76);
    const random = randomFactory(270419);
    stars = Array.from({ length: count }, () => ({
      x: random() * width,
      y: random() * height * 0.78,
      radius: 0.45 + random() * 1.1,
      alpha: 0.22 + random() * 0.36,
      phase: random() * Math.PI * 2,
      speed: 0.19 + random() * 0.24,
      depth: 0.3 + random() * 0.7,
      lavender: random() > 0.62
    }));

    // Sparse nearest-neighbor links: no dense network across the headline.
    connections = [];
    const maximumLinks = mobile ? 8 : 22;
    const reach = Math.min(155, width * 0.22);
    const neighbors = new Array(count).fill(0);
    for (let i = 0; i < count && connections.length < maximumLinks; i += 1) {
      let nearest = -1;
      let distance = reach * reach;
      for (let j = i + 1; j < count; j += 1) {
        if (neighbors[i] >= 2 || neighbors[j] >= 2) continue;
        const dx = stars[i].x - stars[j].x;
        const dy = stars[i].y - stars[j].y;
        const candidate = dx * dx + dy * dy;
        if (candidate < distance) { nearest = j; distance = candidate; }
      }
      if (nearest >= 0) {
        connections.push([i, nearest, 0.05 * (1 - Math.sqrt(distance) / reach)]);
        neighbors[i] += 1;
        neighbors[nearest] += 1;
      }
    }
    shootingStar = null;
    paintSky(motionOff() ? 0 : elapsed, false);
  }

  let pointerSkyX = 0;
  let pointerSkyY = 0;
  let skyX = 0;
  let skyY = 0;
  function paintSky(time, animate) {
    if (!context || !width || !height) return;
    context.clearRect(0, 0, width, height);
    const positions = stars.map(star => ({
      x: star.x + (animate ? Math.sin(time * 0.06 + star.phase) * 4 + skyX * star.depth : 0),
      y: star.y + (animate ? Math.cos(time * 0.045 + star.phase) * 3 + skyY * star.depth : 0)
    }));
    context.lineWidth = 0.65;
    connections.forEach(([from, to, alpha]) => {
      context.strokeStyle = `rgba(202, 184, 245, ${alpha})`;
      context.beginPath();
      context.moveTo(positions[from].x, positions[from].y);
      context.lineTo(positions[to].x, positions[to].y);
      context.stroke();
    });
    stars.forEach((star, index) => {
      const twinkle = animate ? 0.72 + 0.28 * Math.sin(time * star.speed + star.phase) : 0.8;
      const color = star.lavender ? '214, 193, 255' : '245, 242, 255';
      context.fillStyle = `rgba(${color}, ${star.alpha * twinkle})`;
      context.beginPath();
      context.arc(positions[index].x, positions[index].y, star.radius, 0, Math.PI * 2);
      context.fill();
    });

    if (!animate) return;
    if (!shootingStar && time >= nextShootingStar) {
      shootingStar = { start: time, x: width * (0.18 + Math.random() * 0.2), y: height * (0.08 + Math.random() * 0.12) };
      nextShootingStar = time + 14 + Math.random() * 12;
    }
    if (shootingStar) {
      const progressStar = (time - shootingStar.start) / 1.15;
      if (progressStar >= 1) { shootingStar = null; return; }
      const travel = Math.min(width * 0.29, 320);
      const x = shootingStar.x + travel * progressStar;
      const y = shootingStar.y + travel * progressStar * 0.3;
      const length = Math.min(78, width * 0.09);
      const opacity = Math.sin(progressStar * Math.PI) * 0.42;
      const gradient = context.createLinearGradient(x - length, y - length * 0.3, x, y);
      gradient.addColorStop(0, 'rgba(218, 201, 255, 0)');
      gradient.addColorStop(1, `rgba(245, 240, 255, ${opacity})`);
      context.strokeStyle = gradient;
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(x - length, y - length * 0.3);
      context.lineTo(x, y);
      context.stroke();
    }
  }

  function writeControl(control) {
    const style = control.element.style;
    if (control.tilt) {
      style.setProperty('--tilt-x', `${control.y.toFixed(3)}deg`);
      style.setProperty('--tilt-y', `${control.x.toFixed(3)}deg`);
      style.setProperty('--spot-x', `${control.spotX.toFixed(2)}%`);
      style.setProperty('--spot-y', `${control.spotY.toFixed(2)}%`);
    }
    if (control.magnetic) {
      style.setProperty('--magnet-x', `${clamp(control.x, -4, 4).toFixed(3)}px`);
      style.setProperty('--magnet-y', `${clamp(control.y, -4, 4).toFixed(3)}px`);
    }
  }
  function resetControl(control, immediate) {
    control.active = false;
    control.dirty = false;
    control.rect = null;
    control.targetX = 0;
    control.targetY = 0;
    control.targetSpotX = 50;
    control.targetSpotY = 50;
    if (immediate) {
      control.x = 0; control.y = 0; control.spotX = 50; control.spotY = 50;
      writeControl(control);
    }
  }
  const settled = (a, b) => Math.abs(a - b) <= 0.001;
  function controlsMoving() {
    return controls.some(c => c.dirty || !settled(c.x, c.targetX) || !settled(c.y, c.targetY) ||
      !settled(c.spotX, c.targetSpotX) || !settled(c.spotY, c.targetSpotY));
  }

  function requestFrame() {
    if (!frame && canRun() && (resizePending || heroVisible || marqueeVisible || controlsMoving())) {
      frame = window.requestAnimationFrame(tick);
    }
  }

  function tick(timestamp) {
    frame = 0;
    if (!canRun()) return;
    const delta = lastFrame ? Math.min(timestamp - lastFrame, 50) : 16.67;
    lastFrame = timestamp;
    if (resizePending) resizeCanvas();

    // Read active bounds together before writing any style properties.
    controls.forEach(control => {
      if (!control.active || !control.dirty) return;
      if (!control.rect) control.rect = control.element.getBoundingClientRect();
      const rect = control.rect;
      const x = clamp((control.pointerX - rect.left) / Math.max(rect.width, 1), 0, 1);
      const y = clamp((control.pointerY - rect.top) / Math.max(rect.height, 1), 0, 1);
      control.targetX = (x - 0.5) * 8;
      control.targetY = (y - 0.5) * (control.tilt ? -8 : 8);
      control.targetSpotX = x * 100;
      control.targetSpotY = y * 100;
      control.dirty = false;
    });
    const smooth = 1 - Math.exp(-delta / 72);
    controls.forEach(control => {
      let changed = false;
      [['x', 'targetX'], ['y', 'targetY'], ['spotX', 'targetSpotX'], ['spotY', 'targetSpotY']].forEach(([current, target]) => {
        const gap = control[target] - control[current];
        if (Math.abs(gap) > 0.001) {
          control[current] = Math.abs(gap) < 0.005 ? control[target] : control[current] + gap * smooth;
          changed = true;
        }
      });
      if (changed) writeControl(control);
    });

    if (heroVisible && context) {
      elapsed += delta / 1000;
      const ease = 1 - Math.exp(-delta / 260);
      skyX += (pointerSkyX - skyX) * ease;
      skyY += (pointerSkyY - skyY) * ease;
      // Canvas redraws are capped at 30 fps; pointer smoothing shares this loop.
      if (!lastPaint || timestamp - lastPaint >= 32) {
        lastPaint = timestamp;
        paintSky(elapsed, true);
      }
    }

    if (marqueeVisible && track && marqueeHalf > 0) {
      // A slow drift that briefly speeds up and leans with the scroll.
      const currentY = window.scrollY;
      const scrollDelta = currentY - scrollVelocityY;
      scrollVelocityY = currentY;
      marqueeVelocity += (clamp(scrollDelta, -120, 120) * 0.9 - marqueeVelocity) * 0.12;
      marqueeX -= (34 + Math.abs(marqueeVelocity) * 9) * (delta / 1000) * (marqueeVelocity < -0.5 ? -1 : 1);
      if (marqueeX <= -marqueeHalf) marqueeX += marqueeHalf;
      if (marqueeX > 0) marqueeX -= marqueeHalf;
      track.style.setProperty('--mx', `${marqueeX.toFixed(2)}px`);
      track.style.setProperty('--skew', `${clamp(-marqueeVelocity * 0.25, -9, 9).toFixed(2)}deg`);
    }
    requestFrame();
  }

  function stopFrame() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
    lastPaint = 0;
  }

  function syncMotion(fromUser) {
    const paused = motionOff();
    root.classList.toggle('motion-paused', userPaused);
    root.classList.toggle('motion-reduced', reduced.matches);
    if (fromUser) {
      try {
        if (userPaused) localStorage.setItem(STORE_KEY, 'paused');
        else localStorage.removeItem(STORE_KEY);
      } catch { /* Storage is a convenience only. */ }
    }
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(paused));
      toggle.disabled = reduced.matches;
      const label = reduced.matches ? '모션 감소' : userPaused ? '모션 켜기' : '모션 끄기';
      const text = toggle.querySelector('span');
      if (text) text.textContent = label;
      toggle.querySelector('svg path')?.setAttribute('d', userPaused && !reduced.matches ? 'M7 4.5L15 10L7 15.5Z' : 'M7 5v10M13 5v10');
      toggle.setAttribute('aria-label', reduced.matches ? '시스템 설정에 따라 모션 감소 적용 중' : label);
      toggle.title = reduced.matches ? '시스템의 모션 감소 설정이 적용되었습니다.' : label;
    }
    controls.forEach(control => resetControl(control, true));
    stopFrame();
    if (paused) {
      revealAll();
      clearContinuousMotion();
      orbit?.style.removeProperty('--px');
      orbit?.style.removeProperty('--py');
      track?.style.removeProperty('--mx');
      track?.style.removeProperty('--skew');
      marqueeVelocity = 0;
    }
    if (resizePending) resizeCanvas();
    paintSky(paused ? 0 : elapsed, false);
    requestScroll();
    requestFrame();
  }

  controls.forEach(control => {
    const onPointer = event => {
      if (!canRun() || !finePointer.matches || event.pointerType === 'touch') return;
      control.active = true;
      control.dirty = true;
      control.pointerX = event.clientX;
      control.pointerY = event.clientY;
      requestFrame();
    };
    const release = () => { resetControl(control, false); requestFrame(); };
    control.element.addEventListener('pointerenter', onPointer, { passive: true });
    control.element.addEventListener('pointermove', onPointer, { passive: true });
    control.element.addEventListener('pointerleave', release, { passive: true });
    control.element.addEventListener('pointercancel', release, { passive: true });
    control.element.addEventListener('blur', release);
    control.element.addEventListener('focus', () => resetControl(control, true));
  });

  // Buttons fill from the point where the pointer enters.
  $$('.button').forEach(button => {
    const place = event => {
      const rect = button.getBoundingClientRect();
      button.style.setProperty('--bx', `${(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100).toFixed(1)}%`);
      button.style.setProperty('--by', `${(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100).toFixed(1)}%`);
    };
    button.addEventListener('pointerenter', place, { passive: true });
    button.addEventListener('pointerleave', place, { passive: true });
  });

  // The orbit and the stars lean slightly toward the pointer inside the hero.
  heroSticky?.addEventListener('pointermove', event => {
    if (!canRun() || !finePointer.matches || event.pointerType === 'touch') return;
    const rect = heroSticky.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5;
    const ny = (event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5;
    orbit?.style.setProperty('--px', `${(-nx * 22).toFixed(2)}px`);
    orbit?.style.setProperty('--py', `${(-ny * 16).toFixed(2)}px`);
    pointerSkyX = nx * 14;
    pointerSkyY = ny * 10;
    requestFrame();
  }, { passive: true });
  heroSticky?.addEventListener('pointerleave', () => {
    orbit?.style.removeProperty('--px');
    orbit?.style.removeProperty('--py');
    pointerSkyX = 0;
    pointerSkyY = 0;
  }, { passive: true });

  toggle?.addEventListener('click', () => {
    if (reduced.matches) return;
    userPaused = !userPaused;
    syncMotion(true);
  });

  function observeMedia(query, listener) {
    if (query.addEventListener) query.addEventListener('change', listener);
    else query.addListener?.(listener);
  }
  observeMedia(reduced, () => syncMotion(false));
  observeMedia(finePointer, () => {
    controls.forEach(control => resetControl(control, true));
    requestFrame();
  });

  function viewportHas(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  }
  if ('IntersectionObserver' in window) {
    const visibility = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.target === heroSticky) heroVisible = entry.isIntersecting;
        if (entry.target === marquee) {
          marqueeVisible = entry.isIntersecting;
          scrollVelocityY = window.scrollY;
        }
      });
      lastFrame = 0;
      requestFrame();
    }, { threshold: 0 });
    if (heroSticky) visibility.observe(heroSticky);
    if (marquee) visibility.observe(marquee);
  } else {
    heroVisible = viewportHas(heroSticky);
    marqueeVisible = viewportHas(marquee);
  }

  window.addEventListener('resize', () => {
    resizePending = true;
    controls.forEach(control => { control.rect = null; control.dirty = control.active; });
    if (!canRun()) resizeCanvas();
    else requestFrame();
  }, { passive: true });
  window.addEventListener('scroll', () => {
    controls.forEach(control => { control.rect = null; control.dirty = control.active; });
    if (!('IntersectionObserver' in window)) {
      heroVisible = viewportHas(heroSticky);
      marqueeVisible = viewportHas(marquee);
    }
    requestFrame();
  }, { passive: true });
  window.addEventListener('blur', () => controls.forEach(control => resetControl(control, true)));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      controls.forEach(control => resetControl(control, true));
      stopFrame();
    } else {
      requestFrame();
    }
  });
  window.addEventListener('pagehide', () => {
    pageActive = false;
    controls.forEach(control => resetControl(control, true));
    stopFrame();
  });
  window.addEventListener('pageshow', () => {
    pageActive = true;
    resizePending = true;
    reveals.forEach(element => { if (element.getBoundingClientRect().top < window.innerHeight) reveal(element); });
    setMenu(false);
    if (!canRun()) resizeCanvas();
    requestScroll();
    requestFrame();
  });

  syncMotion(false);
  updateScroll();
})();
