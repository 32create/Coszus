/**
 * Coszus homepage behaviour (docs/HANDOFF.md section 4).
 *
 * - <coszus-hero>: slideshow. The active dot becomes a bar that fills while the slide plays
 *   (video length, or the image time). Video plays only while the hero is on screen. Swipe (touch)
 *   or click-and-drag (mouse) changes slide, and stops autoplay for the rest of the visit.
 * - <coszus-product-row>: New In tabs (follow the header department) and the slow drift, and
 *   Best Sellers' live best-selling order.
 * - <coszus-hotspots>: + buttons that open a product card (hero slide and Steal Their Style).
 * - <coszus-news>: card videos play muted while on screen.
 *
 * Motion uses --coszus-motion tokens in CSS. Everything that moves from JS (autoplay, drift,
 * video) checks prefers-reduced-motion itself, because CSS can't stop it.
 *
 * Speed: nothing here writes styles every frame. The hero's progress bar and the drift are
 * transform animations the browser runs off the main thread; JS only starts, pauses and syncs
 * them, and everything stops while it's off screen.
 */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const mobileQuery = window.matchMedia('(max-width: 820px)');

/**
 * Calls `callback(isVisible)` when `element` comes on or goes off screen.
 * @param {Element} element
 * @param {(visible: boolean) => void} callback
 * @param {string} [rootMargin]
 */
function onVisibility(element, callback, rootMargin = '0px') {
  if (!('IntersectionObserver' in window)) {
    callback(true);
    return null;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) callback(entry.isIntersecting);
  }, { rootMargin, threshold: 0.05 });
  observer.observe(element);
  return observer;
}

/**
 * Plays a muted video and ignores autoplay refusals (Low Power Mode, data saver).
 * @param {HTMLVideoElement} video
 * @returns {Promise<boolean>} whether it's playing
 */
async function playMuted(video) {
  video.muted = true;
  if (video.preload !== 'auto') {
    video.preload = 'auto';
  }
  try {
    await video.play();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------
   Hero slideshow
   ------------------------------------------------------------------ */
/** Set for the rest of the visit (this tab's session) once someone swipes or drags the hero */
const HERO_STOPPED_KEY = 'coszus:hero-stopped';
/** Pixels the pointer moves sideways before it counts as a swipe rather than a tap */
const SWIPE_START = 10;
/** Pixels sideways, on release, to change slide */
const SWIPE_CHANGE = 40;

function heroStoppedThisVisit() {
  try {
    return sessionStorage.getItem(HERO_STOPPED_KEY) === 'true';
  } catch {
    return false;
  }
}

function rememberHeroStopped() {
  if (window.Shopify?.designMode) return;
  try {
    sessionStorage.setItem(HERO_STOPPED_KEY, 'true');
  } catch {
    /* Private mode or storage blocked: it stops for this page only */
  }
}

class CoszusHero extends HTMLElement {
  /** @type {HTMLElement[]} */
  #slides = [];
  /** @type {HTMLButtonElement[]} */
  #dots = [];
  #current = 0;
  #onScreen = true;
  #userPaused = false;
  /** The active dot's fill. Its id says what drives it: 'timer' (image slides) or 'video'. */
  /** @type {Animation | null} */
  #fill = null;
  /** @type {IntersectionObserver | null} */
  #observer = null;
  /** The swipe or drag in progress: where it started, and whether it has gone sideways yet */
  /** @type {{ id: number, x: number, y: number, dx: number, swiping: boolean } | null} */
  #gesture = null;
  /** A drag just ended: swallow the click it would otherwise make on a link under it */
  #swallowClick = false;

  connectedCallback() {
    if (document.documentElement.dataset.bf !== 'live') this.#dropBlackFriday();
    this.#slides = Array.from(this.querySelectorAll('[data-slide]'));
    this.#dots = Array.from(this.querySelectorAll('[data-slide-dot]'));
    this.#userPaused = reducedMotion.matches || this.dataset.autoplay !== 'true' || heroStoppedThisVisit();

    this.addEventListener('click', this.#onClick);
    document.addEventListener('visibilitychange', this.#refresh);
    mobileQuery.addEventListener('change', this.#onBreakpoint);
    reducedMotion.addEventListener('change', this.#onReducedMotion);

    if (this.#slides.length > 1) {
      this.addEventListener('pointerdown', this.#onPointerDown);
      this.addEventListener('pointermove', this.#onPointerMove);
      this.addEventListener('pointerup', this.#onPointerUp);
      this.addEventListener('pointercancel', this.#onPointerCancel);
      this.addEventListener('click', this.#onClickAfterDrag, true);
      // Stops the browser dragging the photo or link out of the page instead
      this.addEventListener('dragstart', (event) => event.preventDefault());
    }
    this.#observer = onVisibility(this, (visible) => {
      this.#onScreen = visible;
      this.#refresh();
    });

    // Theme editor: show the slide being edited and hold it there
    this.addEventListener('shopify:block:select', this.#onBlockSelect);

    for (const video of this.querySelectorAll('video')) {
      video.addEventListener('ended', this.#onVideoEnded);
      video.addEventListener('playing', () => video.closest('[data-slide]')?.classList.add('is-playing'));
      for (const type of ['playing', 'pause', 'waiting', 'seeked', 'timeupdate']) {
        video.addEventListener(type, this.#syncVideoFill);
      }
    }

    this.#show(0);
  }

  /**
   * Black Friday slides (sections/coszus-hero.liquid, "Black Friday slide") are in the page while
   * the switch is on, but only stay once it's live (<html data-bf="live">, set in the head by
   * snippets/coszus-bf-state.liquid). Before then they're taken out with their dots, and the
   * "1 / 3" and "Go to slide" labels are renumbered.
   */
  #dropBlackFriday() {
    const extras = this.querySelectorAll('[data-bf-slide]');
    if (extras.length === 0) return;
    extras.forEach((element) => element.remove());

    const slides = this.querySelectorAll('[data-slide]');
    const total = slides.length;
    slides.forEach((slide, i) => slide.setAttribute('aria-label', `${i + 1} / ${total}`));
    const template = this.dataset.dotLabel || '';
    this.querySelectorAll('[data-slide-dot]').forEach((dot, i) => {
      dot.setAttribute('aria-label', template.replace('[number]', String(i + 1)).replace('[total]', String(total)));
    });
    if (total < 2) this.querySelector('.coszus-hero__controls')?.remove();
  }

  disconnectedCallback() {
    this.#fill?.cancel();
    this.#observer?.disconnect();
    document.removeEventListener('visibilitychange', this.#refresh);
    mobileQuery.removeEventListener('change', this.#onBreakpoint);
    reducedMotion.removeEventListener('change', this.#onReducedMotion);
  }

  get #interval() {
    return (Number(this.dataset.interval) || 6) * 1000;
  }

  get #running() {
    return !this.#userPaused && this.#onScreen && !document.hidden;
  }

  /** The video for the current breakpoint in a slide, if any */
  #video(slide = this.#slides[this.#current]) {
    if (!slide) return null;
    const videos = Array.from(slide.querySelectorAll('video'));
    if (videos.length === 0) return null;
    // The mobile cut on phones when there is one, otherwise the main video
    const wanted = mobileQuery.matches ? 'mobile' : 'desktop';
    return (
      videos.find((video) => video.dataset.breakpoint === wanted) ||
      videos.find((video) => video.dataset.breakpoint !== 'mobile') ||
      null
    );
  }

  /** @param {number} index */
  #show(index) {
    const count = this.#slides.length;
    if (count === 0) return;
    const previous = this.#current;
    this.#current = ((index % count) + count) % count;
    this.#fill?.cancel();
    this.#fill = null;

    this.#slides.forEach((slide, i) => {
      const active = i === this.#current;
      slide.classList.toggle('is-active', active);
      slide.toggleAttribute('inert', !active);
      slide.setAttribute('aria-hidden', String(!active));
    });
    this.#dots.forEach((dot, i) => {
      const active = i === this.#current;
      dot.classList.toggle('is-active', active);
      if (active) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });

    // Stop videos on other slides
    this.#slides.forEach((slide, i) => {
      if (i === this.#current) return;
      for (const video of slide.querySelectorAll('video')) video.pause();
      slide.classList.remove('is-playing');
    });

    const video = this.#video();
    if (video && previous !== this.#current) {
      try {
        video.currentTime = 0;
      } catch {
        /* not loaded yet */
      }
    }

    this.dispatchEvent(new CustomEvent('coszus:slide-change', { bubbles: true }));
    this.#refresh();
  }

  /** Starts or stops the slide and video to match visibility and whether autoplay was stopped */
  #refresh = () => {
    this.classList.toggle('is-paused', this.#userPaused);

    const video = this.#video();
    for (const other of this.querySelectorAll('video')) {
      if (other !== video) other.pause();
    }

    if (!this.#running) {
      video?.pause();
      this.#fill?.pause();
      return;
    }

    if (video && video.dataset.blocked !== 'true') {
      // The fill follows the video's own events (#syncVideoFill)
      playMuted(video).then((playing) => {
        // Autoplay refused: treat the slide like an image so the show keeps moving
        if (playing) return;
        video.dataset.blocked = 'true';
        if (video === this.#video() && this.#running) this.#runTimer();
      });
    } else {
      this.#runTimer();
    }
  };

  /**
   * Fills the active dot over `duration` ms on the compositor.
   * @param {number} duration
   * @param {'timer' | 'video'} id
   */
  #animateFill(duration, id) {
    this.#fill?.cancel();
    this.#fill = null;
    const bar = this.#dots[this.#current]?.querySelector('[data-fill]');
    if (!(bar instanceof HTMLElement) || typeof bar.animate !== 'function') return null;
    const animation = bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
      duration,
      fill: 'forwards',
    });
    animation.id = id;
    this.#fill = animation;
    return animation;
  }

  /** Image slides (and videos that won't autoplay): fill over the interval, then move on */
  #runTimer() {
    let animation = this.#fill;
    if (animation?.id !== 'timer') {
      animation = this.#animateFill(this.#interval, 'timer');
      if (!animation) return;
      animation.onfinish = () => {
        if (animation !== this.#fill) return;
        if (this.#slides.length > 1) {
          this.#show(this.#current + 1);
        } else {
          animation.currentTime = 0;
          animation.play();
        }
      };
    }
    animation.play();
  }

  /** Keeps the fill in step with the playing video (a few events a second, not every frame) */
  #syncVideoFill = (/** @type {Event} */ event) => {
    const video = /** @type {HTMLVideoElement} */ (event.target);
    if (video !== this.#video() || video.dataset.blocked === 'true') return;
    const duration = video.duration * 1000;
    if (!Number.isFinite(duration) || duration <= 0) return;

    let animation = this.#fill;
    if (animation?.id !== 'video' || animation.effect?.getTiming().duration !== duration) {
      animation = this.#animateFill(duration, 'video');
      if (!animation) return;
    }
    const time = video.currentTime * 1000;
    if (Math.abs(Number(animation.currentTime) - time) > 150) animation.currentTime = time;

    const playing = this.#running && !video.paused && !video.seeking && video.readyState > 2;
    if (playing && animation.playState !== 'running') animation.play();
    if (!playing && animation.playState === 'running') animation.pause();
  };

  #onVideoEnded = (/** @type {Event} */ event) => {
    if (event.target !== this.#video()) return;
    if (this.#slides.length > 1) {
      this.#show(this.#current + 1);
    } else if (this.#running) {
      const video = /** @type {HTMLVideoElement} */ (event.target);
      video.currentTime = 0;
      playMuted(video);
    }
  };

  #onBreakpoint = () => {
    for (const video of this.querySelectorAll('video')) video.pause();
    this.#refresh();
  };

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const target = /** @type {Element} */ (event.target);
    const dot = target.closest('[data-slide-dot]');
    if (dot instanceof HTMLButtonElement) {
      this.#show(this.#dots.indexOf(dot));
    }
  };

  #onReducedMotion = () => {
    if (!reducedMotion.matches) return;
    this.#userPaused = true;
    this.#refresh();
  };

  /* ---------- Swipe (touch) and click-and-drag (mouse) ---------- */
  /*
   * Pointer events only, no library. CSS sets touch-action: pan-y on the hero, so the page still
   * scrolls up and down and only sideways movement arrives here. Nothing is measured or styled per
   * move: the slide changes once, on release, with the usual crossfade.
   */

  /** @param {PointerEvent} event */
  #onPointerDown = (event) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const target = /** @type {Element} */ (event.target);
    // The dots and open hotspot cards keep their own taps
    if (target.closest('.coszus-hero__controls, [data-hotspot]')) return;
    this.#gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, swiping: false };
  };

  /** @param {PointerEvent} event */
  #onPointerMove = (event) => {
    const gesture = this.#gesture;
    if (!gesture || event.pointerId !== gesture.id) return;
    gesture.dx = event.clientX - gesture.x;
    if (gesture.swiping) return;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dy) > SWIPE_START && Math.abs(dy) > Math.abs(gesture.dx)) {
      // Mostly up or down: a scroll, not a swipe
      this.#gesture = null;
      return;
    }
    if (Math.abs(gesture.dx) < SWIPE_START) return;
    gesture.swiping = true;
    this.classList.add('is-dragging');
    try {
      this.setPointerCapture(event.pointerId);
    } catch {
      /* The pointer has already gone */
    }
  };

  /** @param {PointerEvent} event */
  #onPointerUp = (event) => {
    const gesture = this.#gesture;
    if (!gesture || event.pointerId !== gesture.id) return;
    this.#endGesture();
    if (!gesture.swiping) return;
    // It was a drag, so whatever is under the pointer shouldn't also be clicked
    this.#swallowClick = true;
    setTimeout(() => {
      this.#swallowClick = false;
    }, 0);
    if (Math.abs(gesture.dx) < SWIPE_CHANGE) return;
    this.#userPaused = true;
    rememberHeroStopped();
    this.#show(this.#current + (gesture.dx < 0 ? 1 : -1));
  };

  #onPointerCancel = () => {
    this.#endGesture();
  };

  #endGesture() {
    this.#gesture = null;
    this.classList.remove('is-dragging');
  }

  /** @param {MouseEvent} event */
  #onClickAfterDrag = (event) => {
    if (!this.#swallowClick) return;
    this.#swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  /** @param {Event} event */
  #onBlockSelect = (event) => {
    const slide = /** @type {Element} */ (event.target).closest('[data-slide]');
    if (!(slide instanceof HTMLElement)) return;
    this.#userPaused = true;
    this.#show(this.#slides.indexOf(slide));
  };
}

/* ------------------------------------------------------------------
   Hotspots: + buttons over a cover-cropped photo that open a product card.
   Positions are percentages of the original photo, so they stay on the
   garment however the photo is cropped.
   Closes on a tap or click anywhere else, and on Escape.
   Theme editor: while the photo's block is selected the dots are numbered
   (and empty product slots show), so moving the sliders is visual.
   ------------------------------------------------------------------ */
/** Block id selected in the theme editor. Survives the section re-rendering after each slider move. */
let editingBlockId = '';

class CoszusHotspots extends HTMLElement {
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;

  connectedCallback() {
    this.addEventListener('click', this.#onClick);
    document.addEventListener('coszus:hotspot-open', this.#onOtherOpen);
    this.closest('coszus-hero')?.addEventListener('coszus:slide-change', this.#closeAll);

    if (window.Shopify?.designMode) {
      document.addEventListener('shopify:block:select', this.#onBlockSelect);
      document.addEventListener('shopify:block:deselect', this.#onBlockDeselect);
      this.toggleAttribute('data-editing', !!this.dataset.blockId && this.dataset.blockId === editingBlockId);
    }

    const image = this.#image;
    if (image && !image.complete) image.addEventListener('load', this.#place, { once: true });
    // The observer's first callback places the dots once layout is done, without forcing it early
    if ('ResizeObserver' in window) {
      this.#resizeObserver = new ResizeObserver(this.#place);
      this.#resizeObserver.observe(this);
    } else {
      this.#place();
    }
  }

  disconnectedCallback() {
    this.#stopListening();
    document.removeEventListener('coszus:hotspot-open', this.#onOtherOpen);
    document.removeEventListener('shopify:block:select', this.#onBlockSelect);
    document.removeEventListener('shopify:block:deselect', this.#onBlockDeselect);
    this.#resizeObserver?.disconnect();
  }

  /** @returns {HTMLImageElement | null} */
  get #image() {
    const media = this.parentElement?.querySelector('[data-hotspot-image]');
    return media instanceof HTMLImageElement ? media : null;
  }

  #place = () => {
    const width = this.clientWidth;
    const height = this.clientHeight;
    if (!width || !height) return;

    const image = this.#image;
    // The photo's own size: from Liquid (always there), or the loaded file
    const naturalWidth = Number(this.dataset.width) || image?.naturalWidth || width;
    const naturalHeight = Number(this.dataset.height) || image?.naturalHeight || height;
    const scale = Math.max(width / naturalWidth, height / naturalHeight);
    const drawnWidth = naturalWidth * scale;
    const drawnHeight = naturalHeight * scale;

    let positionX = 0.5;
    let positionY = 0.5;
    if (image) {
      const [x, y] = getComputedStyle(image).objectPosition.split(' ');
      positionX = parseFloat(x) / 100;
      positionY = parseFloat(y ?? '50%') / 100;
      if (Number.isNaN(positionX)) positionX = 0.5;
      if (Number.isNaN(positionY)) positionY = 0.5;
    }
    const offsetX = (width - drawnWidth) * positionX;
    const offsetY = (height - drawnHeight) * positionY;

    const safeTop = Number(this.dataset.safeTop) || 0;
    const safeBottom = Number(this.dataset.safeBottom) || 0;

    for (const spot of this.querySelectorAll('[data-hotspot]')) {
      if (!(spot instanceof HTMLElement)) continue;
      const x = offsetX + (drawnWidth * Number(spot.dataset.x)) / 100;
      const y = offsetY + (drawnHeight * Number(spot.dataset.y)) / 100;
      const hidden = x < 14 || x > width - 14 || y < safeTop || y > height - safeBottom;

      spot.style.setProperty('--x', `${x}px`);
      spot.style.setProperty('--y', `${y}px`);
      spot.dataset.align = x < 110 ? 'start' : x > width - 110 ? 'end' : 'center';
      spot.dataset.side = y > height * 0.55 ? 'above' : 'below';
      spot.hidden = hidden;
      if (hidden) this.#close(spot);
    }
    this.classList.add('is-placed');
  };

  /** @param {HTMLElement} spot */
  #open(spot) {
    document.dispatchEvent(new CustomEvent('coszus:hotspot-open', { detail: { spot } }));
    spot.classList.add('is-open');
    spot.querySelector('[data-hotspot-toggle]')?.setAttribute('aria-expanded', 'true');
    // Only listen to the whole page while a card is open
    document.addEventListener('pointerdown', this.#onPointerDown, true);
    document.addEventListener('keydown', this.#onKeydown);
  }

  /** @param {Element} spot */
  #close(spot) {
    spot.classList.remove('is-open');
    spot.querySelector('[data-hotspot-toggle]')?.setAttribute('aria-expanded', 'false');
    if (!this.querySelector('[data-hotspot].is-open')) this.#stopListening();
  }

  #stopListening() {
    document.removeEventListener('pointerdown', this.#onPointerDown, true);
    document.removeEventListener('keydown', this.#onKeydown);
  }

  #closeAll = () => {
    for (const spot of this.querySelectorAll('[data-hotspot].is-open')) this.#close(spot);
  };

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const toggle = /** @type {Element} */ (event.target).closest('[data-hotspot-toggle]');
    if (!toggle) return;
    event.preventDefault();
    const spot = toggle.closest('[data-hotspot]');
    if (!(spot instanceof HTMLElement)) return;
    if (spot.classList.contains('is-open')) this.#close(spot);
    else this.#open(spot);
  };

  // Escape closes the open card from anywhere, and puts focus back on its + if focus was in it
  /** @param {KeyboardEvent} event */
  #onKeydown = (event) => {
    if (event.key !== 'Escape') return;
    const spot = this.querySelector('[data-hotspot].is-open');
    if (!spot) return;
    const hadFocus = spot.contains(document.activeElement);
    this.#close(spot);
    if (hadFocus) /** @type {HTMLElement | null} */ (spot.querySelector('[data-hotspot-toggle]'))?.focus();
  };

  // Pointer, not click: iOS Safari sends no click to the page for a tap on plain content
  /** @param {PointerEvent} event */
  #onPointerDown = (event) => {
    const target = /** @type {Element} */ (event.target);
    const spot = target instanceof Element ? target.closest('[data-hotspot]') : null;
    if (spot && this.contains(spot)) return;
    this.#closeAll();
  };

  /** @param {Event} event */
  #onOtherOpen = (event) => {
    const { spot } = /** @type {CustomEvent} */ (event).detail;
    for (const open of this.querySelectorAll('[data-hotspot].is-open')) {
      if (open !== spot) this.#close(open);
    }
  };

  /* ---------- Theme editor ---------- */

  /** @param {Event} event */
  #onBlockSelect = (event) => {
    const blockId = /** @type {CustomEvent} */ (event).detail?.blockId ?? '';
    if (blockId !== this.dataset.blockId) return;
    editingBlockId = blockId;
    this.toggleAttribute('data-editing', true);
  };

  /** @param {Event} event */
  #onBlockDeselect = (event) => {
    const blockId = /** @type {CustomEvent} */ (event).detail?.blockId ?? '';
    if (blockId !== this.dataset.blockId) return;
    if (editingBlockId === blockId) editingBlockId = '';
    this.removeAttribute('data-editing');
  };
}

/* ------------------------------------------------------------------
   Product rows: tabs, drift and live best-selling order
   ------------------------------------------------------------------ */
class CoszusProductRow extends HTMLElement {
  /** @type {HTMLButtonElement[]} */
  #tabs = [];
  /** @type {HTMLElement[]} */
  #panels = [];
  #hovering = false;
  #touching = false;
  #onScreen = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #resumeTimer;
  /** @type {IntersectionObserver | null} */
  #observer = null;

  connectedCallback() {
    this.#tabs = Array.from(this.querySelectorAll('[role="tab"]'));
    this.#panels = Array.from(this.querySelectorAll('[data-row-panel]'));

    if (this.#tabs.length > 0) {
      this.addEventListener('click', this.#onTabClick);
      this.addEventListener('keydown', this.#onTabKeydown);
      document.addEventListener('coszus:department-change', this.#onDepartmentChange);
      const department = document.documentElement.dataset.coszusDepartment;
      const start = this.#tabs.findIndex((tab) => tab.dataset.department === department);
      // Rows start scrolled to 0, so no scroll reset (it would force a layout during page load)
      this.#select(start > -1 ? start : 0, false, false);
    }

    if (this.dataset.drift === 'true') this.#setUpDrift();
    if (this.dataset.liveUrl) this.#setUpLiveOrder();
  }

  disconnectedCallback() {
    clearTimeout(this.#resumeTimer);
    this.#observer?.disconnect();
    document.removeEventListener('coszus:department-change', this.#onDepartmentChange);
    document.removeEventListener('visibilitychange', this.#refresh);
    reducedMotion.removeEventListener('change', this.#refresh);
  }

  /** The visible track */
  get #track() {
    const panel = this.#panels.find((item) => !item.hidden) || this.#panels[0];
    return /** @type {HTMLElement | null} */ (panel?.querySelector('[data-row-track]') ?? null);
  }

  /**
   * @param {number} index
   * @param {boolean} [focus]
   * @param {boolean} [reset] - scroll the newly shown row back to the start
   */
  #select(index, focus = false, reset = true) {
    this.#tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    this.#panels.forEach((panel, i) => {
      panel.hidden = i !== index;
    });
    const track = this.#track;
    if (track && reset) track.scrollLeft = 0;
    this.#refresh();
  }

  /** @param {MouseEvent} event */
  #onTabClick = (event) => {
    const tab = /** @type {Element} */ (event.target).closest('[role="tab"]');
    if (tab instanceof HTMLButtonElement) this.#select(this.#tabs.indexOf(tab));
  };

  /** @param {KeyboardEvent} event */
  #onTabKeydown = (event) => {
    const tab = /** @type {Element} */ (event.target).closest('[role="tab"]');
    if (!(tab instanceof HTMLButtonElement)) return;
    const index = this.#tabs.indexOf(tab);
    const last = this.#tabs.length - 1;
    let next = -1;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;
    if (next < 0) return;
    event.preventDefault();
    this.#select(next, true);
  };

  /** The header's department switch also sets the New In tab (HANDOFF section 3) */
  #onDepartmentChange = (/** @type {Event} */ event) => {
    const { department } = /** @type {CustomEvent} */ (event).detail || {};
    const index = this.#tabs.findIndex((tab) => tab.dataset.department === department);
    if (index > -1) this.#select(index);
  };

  /* ---------- drift ---------- */

  #setUpDrift() {
    for (const panel of this.#panels) {
      const track = panel.querySelector('[data-row-track]');
      if (!(track instanceof HTMLElement)) continue;
      track.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'mouse') return;
        this.#hovering = true;
        this.#refresh();
      });
      track.addEventListener('pointerleave', (event) => {
        if (event.pointerType !== 'mouse') return;
        this.#hovering = false;
        this.#refresh();
      });
      track.addEventListener('touchstart', this.#onTouchStart, { passive: true });
      track.addEventListener('touchend', this.#onTouchEnd, { passive: true });
      track.addEventListener('touchcancel', this.#onTouchEnd, { passive: true });
      track.addEventListener('focusin', this.#refresh);
      track.addEventListener('focusout', this.#refresh);
    }
    document.addEventListener('visibilitychange', this.#refresh);
    reducedMotion.addEventListener('change', this.#refresh);
    this.#observer = onVisibility(this, (visible) => {
      this.#onScreen = visible;
      this.#refresh();
    });
  }

  #onTouchStart = () => {
    clearTimeout(this.#resumeTimer);
    this.#touching = true;
    this.#refresh();
  };

  #onTouchEnd = () => {
    clearTimeout(this.#resumeTimer);
    this.#resumeTimer = setTimeout(() => {
      this.#touching = false;
      this.#refresh();
    }, 2500);
  };

  /**
   * Copies the cards once so the row can loop with no gap, and sizes the drift for CSS: the cards
   * slide one card count to the left (keyframes in sections/coszus-product-row.liquid), at
   * `data-speed` pixels per second. The copies are hidden from screen readers and the keyboard.
   * @param {HTMLElement} track
   */
  #ensureLoop(track) {
    if (track.dataset.looped === 'true') return true;
    const cards = Array.from(track.children);
    const first = cards[0];
    if (!(first instanceof HTMLElement) || track.scrollWidth <= track.clientWidth + 4) return false;

    // All layout reads first, then the writes
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const loop = cards.length * (first.getBoundingClientRect().width + gap);
    const speed = Number(this.dataset.speed) || 24;

    for (const card of cards) {
      const copy = /** @type {HTMLElement} */ (card.cloneNode(true));
      copy.setAttribute('aria-hidden', 'true');
      copy.setAttribute('inert', '');
      copy.dataset.copy = '';
      track.append(copy);
    }
    track.style.setProperty('--drift-cards', String(cards.length));
    track.style.setProperty('--drift-duration', `${Math.max(loop / speed, 1).toFixed(2)}s`);
    track.dataset.looped = 'true';
    return true;
  }

  /**
   * Distance from a card to its copy: one full loop. offsetLeft ignores the drift's transform.
   * @param {HTMLElement} track
   */
  #loopWidth(track) {
    const first = track.firstElementChild;
    const copy = track.querySelector('[data-copy]');
    if (!(first instanceof HTMLElement) || !(copy instanceof HTMLElement)) return 0;
    return copy.offsetLeft - first.offsetLeft;
  }

  /** @param {HTMLElement} track */
  #driftAnimations(track) {
    if (typeof track.getAnimations !== 'function') return [];
    return track
      .getAnimations({ subtree: true })
      .filter((animation) => /** @type {CSSAnimation} */ (animation).animationName === 'coszus-row-drift');
  }

  /**
   * After a swipe, moves the scroll distance into the drift (same picture, scroll back at 0), so
   * the row can't run past its copies.
   * @param {HTMLElement} track
   */
  #foldScroll(track) {
    const scroll = track.scrollLeft;
    if (scroll < 1) return;
    const animations = this.#driftAnimations(track);
    const loop = this.#loopWidth(track);
    const duration = Number(animations[0]?.effect?.getComputedTiming().duration) || 0;
    if (animations.length === 0 || loop <= 0 || duration <= 0) return;

    const progress = ((Number(animations[0].currentTime) || 0) % duration) / duration;
    const time = ((progress + scroll / loop) % 1) * duration;
    for (const animation of animations) animation.currentTime = time;
    track.scrollLeft = 0;
  }

  get #drifting() {
    const track = this.#track;
    return (
      this.dataset.drift === 'true' &&
      !reducedMotion.matches &&
      this.#onScreen &&
      !document.hidden &&
      !this.#hovering &&
      !this.#touching &&
      !(track && track.contains(document.activeElement))
    );
  }

  /** Runs or pauses the drift. Runs only while on screen; CSS does the moving. */
  #refresh = () => {
    const track = this.#track;
    if (!track) return;
    const drifting = this.#drifting && this.#ensureLoop(track);
    if (drifting && !track.classList.contains('is-drifting')) this.#foldScroll(track);
    track.classList.toggle('is-drifting', drifting);
  };

  /* ---------- live best-selling order ---------- */

  /**
   * Liquid can't sort a collection, so the row is rendered in the collection's own order and
   * swapped for Shopify's best-selling order (Section Rendering API) before it scrolls into view.
   */
  #setUpLiveOrder() {
    let loaded = false;
    const observer = onVisibility(
      this,
      (visible) => {
        if (!visible || loaded) return;
        loaded = true;
        observer?.disconnect();
        // Not while the page is still loading its first screen
        if ('requestIdleCallback' in window) requestIdleCallback(() => this.#loadLiveOrder(), { timeout: 2000 });
        else setTimeout(() => this.#loadLiveOrder(), 200);
      },
      '1200px 0px'
    );
  }

  async #loadLiveOrder() {
    const track = this.#track;
    const url = this.dataset.liveUrl;
    if (!track || !url) return;
    try {
      const response = await fetch(url, { headers: { Accept: 'text/html' } });
      if (!response.ok) return;
      const html = new DOMParser().parseFromString(await response.text(), 'text/html');
      const fresh = Array.from(html.querySelectorAll('[data-row-track] > .coszus-row__item'));
      const count = track.querySelectorAll(':scope > .coszus-row__item:not([data-copy])').length;
      if (fresh.length === 0) return;
      track.replaceChildren(...fresh.slice(0, Math.max(count, 1)).map((card) => document.importNode(card, true)));
      delete track.dataset.looped;
      track.classList.remove('is-drifting');
      track.scrollLeft = 0;
      this.#refresh();
    } catch {
      /* Keep the collection order */
    }
  }
}

/* ------------------------------------------------------------------
   Latest News videos: muted, looping, only while on screen
   ------------------------------------------------------------------ */
class CoszusNews extends HTMLElement {
  /** @type {IntersectionObserver[]} */
  #observers = [];

  connectedCallback() {
    for (const video of this.querySelectorAll('video')) {
      const observer = onVisibility(video, (visible) => {
        if (visible && !reducedMotion.matches && !document.hidden) {
          playMuted(video).then((playing) => video.closest('[data-news-media]')?.classList.toggle('is-playing', playing));
        } else {
          video.pause();
        }
      });
      if (observer) this.#observers.push(observer);
    }
  }

  disconnectedCallback() {
    for (const observer of this.#observers) observer.disconnect();
  }
}

const elements = {
  'coszus-hero': CoszusHero,
  'coszus-hotspots': CoszusHotspots,
  'coszus-product-row': CoszusProductRow,
  'coszus-news': CoszusNews,
};

for (const [name, constructor] of Object.entries(elements)) {
  if (!customElements.get(name)) customElements.define(name, constructor);
}
