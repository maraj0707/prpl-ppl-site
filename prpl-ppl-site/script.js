/*
  Scroll-controlled video
  -----------------------
  Scroll position decides which frame is shown. Scroll down = film moves forward,
  scroll up = it moves back. The video never plays on its own.

  Why it stays smooth and glitch-free:
  1. The whole video is downloaded into memory first (the loader shows progress),
     so every seek is local and instant. Nothing is requested from the network while scrolling.
  2. The video files are encoded with a keyframe every 8 frames and no B-frames,
     so jumping to any frame, forwards or backwards, decodes almost instantly.
  3. The playhead eases toward the scroll position (time-based, so it feels the same
     at 60 Hz and 120 Hz), and a new seek starts only after the previous one finished.
*/

(() => {
  'use strict';

  /* ---------- Settings ---------- */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SMOOTHNESS = reduceMotion ? 1000 : 9;  // higher = follows the scroll more tightly
  const END_PADDING = 0.01;                    // stop just before the end so the last frame shows
  const FRAME = 1 / 24;                        // the film is 24 fps

  /* ---------- Elements ---------- */
  const section = document.getElementById('scroll-video');
  const stage = section.querySelector('.scroll-video__stage');
  const video = stage.querySelector('video');
  const hint = document.getElementById('scroll-hint');
  const cta = document.getElementById('home-cta');
  const loader = document.getElementById('loader');
  const bar = document.getElementById('loader-bar');
  const status = document.getElementById('loader-status');
  const SOURCE = window.RVR_SRC || video.getAttribute('data-src');

  /* ---------- State ---------- */
  let duration = 0, target = 0, current = 0, requested = -1;
  let rafId = 0, lastTs = 0, ready = false;

  /* ---------- Scroll -> time ---------- */
  function scrollProgress() {
    const distance = section.offsetHeight - stage.offsetHeight;
    if (distance <= 0) return 0;
    const top = section.getBoundingClientRect().top;
    return Math.min(1, Math.max(0, -top / distance));
  }
  const maxTime = () => Math.max(0, duration - END_PADDING);

  /* ---------- Animation loop ---------- */
  function schedule() { if (!rafId) rafId = requestAnimationFrame(tick); }

  function tick(ts) {
    rafId = 0;
    if (!ready || !duration) return;

    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 1 / 60;
    lastTs = ts;

    target = scrollProgress() * maxTime();
    const k = 1 - Math.exp(-SMOOTHNESS * dt);
    current += (target - current) * k;
    if (Math.abs(target - current) < FRAME / 4) current = target;

    if (!video.seeking && current !== requested) {
      requested = current;
      video.currentTime = current;
    }

    if (hint && window.scrollY > 40) hint.classList.add('is-hidden');
    const p = scrollProgress();
    stage.style.setProperty('--p', p);
    if (cta) cta.classList.toggle('on', p > 0.93);

    if (current !== target || requested !== current || video.seeking) {
      schedule();
    } else {
      lastTs = 0; // resting: restart the clock on the next scroll
    }
  }

  /* ---------- Start ---------- */
  // Some phones (iPhone) draw nothing until the video has played once. Play and pause at once.
  function prime() {
    video.__priming = true;
    let result;
    try { result = video.play(); } catch (e) { result = null; }
    const stop = () => { video.pause(); video.__priming = false; requested = -1; schedule(); };
    if (result && typeof result.then === 'function') return result.then(stop, () => { video.__priming = false; });
    stop();
    return Promise.resolve();
  }

  video.addEventListener('seeked', schedule);
  video.addEventListener('playing', () => { if (!video.__priming) video.pause(); }); // scroll is the only control

  function reveal() {
    if (ready) return;
    ready = true;
    duration = video.duration;
    target = scrollProgress() * maxTime();   // e.g. after a refresh halfway down the page
    current = target;
    requested = -1;
    prime().then(() => {
      video.currentTime = current;
      const done = () => {
        loader.classList.add('is-done');
        document.body.classList.remove('is-loading');
        setTimeout(() => { loader.hidden = true; }, 1000);
        schedule();
      };
      if (video.readyState >= 2 && !video.seeking) done();
      else video.addEventListener('seeked', done, { once: true });
    });
  }

  function setProgress(p) {
    const pct = Math.round(p * 100);
    bar.style.width = pct + '%';
    status.textContent = 'Loading ' + pct + '%';
  }

  // Download the whole file with a progress bar, then play it from memory.
  async function loadIntoMemory() {
    const asBlobUrl = async () => {
      const res = await fetch(SOURCE);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const total = +res.headers.get('Content-Length') || 0;
      let blob;
      if (res.body && res.body.getReader && total) {
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          setProgress(got / total);
        }
        blob = new Blob(chunks, { type: 'video/mp4' });
      } else {
        blob = new Blob([await res.blob()], { type: 'video/mp4' });
      }
      return URL.createObjectURL(blob);
    };

    // Opened directly from disk (file://), or fetch unavailable: let the browser read the file.
    if (location.protocol === 'file:' || !window.fetch || !window.URL) return streamFallback();

    try {
      const url = await asBlobUrl();
      video.addEventListener('loadeddata', reveal, { once: true });
      video.addEventListener('error', streamFallback, { once: true });
      video.preload = 'auto';
      video.src = url;
      video.load();
    } catch (err) {
      streamFallback();
    }
  }

  function streamFallback() {
    status.textContent = 'Loading';
    video.addEventListener('loadeddata', reveal, { once: true });
    video.preload = 'auto';
    video.src = SOURCE;
    video.load();
  }

  /* ---------- Events ---------- */
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });

  // If the phone blocked the first priming (Low Power Mode), try again on the first touch.
  const events = ['touchend', 'pointerdown', 'keydown'];
  const primeOnGesture = () => { prime(); events.forEach((t) => window.removeEventListener(t, primeOnGesture)); };
  events.forEach((t) => window.addEventListener(t, primeOnGesture, { passive: true }));

  loadIntoMemory();
})();
