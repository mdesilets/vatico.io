/* ============================================================
   reel-engine.js — generic cinematic-reel state machine

   Extracted from the V03 ontology reel pattern (visuals/visual-03-
   ontology.js::runReel) so additional reels can reuse the camera
   /pulse/card/loop machinery without copy-pasting it. The engine
   is renderer-agnostic: it owns time, camera, beats, pulses, and
   the info-card crossfade; the consumer owns drawing and frame
   geometry.

   Public API:
       const reel = ReelEngine.create({ ...options });
       reel.start();   reel.stop();   reel.destroy();
       reel.spawnPulseAt({x,y}, opts?);
       reel.crossFadeCardTo(beatRef);   // beatRef = beat.id, beat
                                         // object, or null

   Required options:
       canvas       HTMLCanvasElement
       worldDims    { w, h }   virtual world dims; consumer draws in
                               world coords, engine handles transform
       wideFrame    fn({W,H,world}) -> {x,y,z}    wide camera pose
       frameFor     fn(beat,{W,H,world}) -> {x,y,z}   per-beat pose
       beats        Beat[]   ordered list (see below)
       draw         fn(ctx, state)   per-frame consumer paint

   Optional:
       cardSlot     HTMLElement   bottom-left info card slot
       formatCard   fn(beat) -> htmlString
       cycleMs      number | 'auto'   default 'auto' = sum(durationMs)
       reduceMotion boolean | 'auto'  default 'auto'
       lazy         boolean   default true   IO-gated start
       onCycleStart fn()      called once per cycle
       hostElement  HTMLElement   the element observed for lazy init
                                  (default: canvas.parentElement)

   Beat shape:
       {
         id:           string
         durationMs:   number
         frame:        'wide' | 'computed' | fn -> pose
         kenBurns?:    boolean (default false)
         panMs?:       number (default min(2500, 0.35*durationMs))
         activations?: Activation[]
         payload?:     any   passed back to consumer in draw state
       }

   Activation shape (within a beat):
       {
         tMs:      number   ms within the beat
         pulseAt?: {x,y} | fn({beat,engine}) -> {x,y}
         cardTo?:  string (beat.id) | beat | null | 'self'
         onFire?:  fn({beat,activation,engine})
       }

   State exposed to consumer.draw(ctx, state):
       {
         cam:          {x,y,z}   already applied as the ctx transform
         W, H:         number    canvas CSS dims
         DPR:          number
         t:            number    ms since reel.start()
         cycleT:       number    ms within current cycle
         beat:         Beat      current beat
         beatIdx:      number
         beatT:        number    ms within current beat
         pulses:       Pulse[]   read-only (engine draws them after)
         reduceMotion: boolean
         paused:       boolean
         world:        {w,h}
       }

   Coordinate model:
       Consumer always draws in world coords. The engine sets
       ctx.setTransform(DPR*z, 0, 0, DPR*z, DPR*x, DPR*y) before
       calling draw(), where (x,y,z) is the current camera pose:
         - z is zoom (1 = world-pixel maps to css-pixel)
         - x,y is the canvas-space offset of world origin
       After draw() returns, the engine resets to a DPR-only
       transform so pulses can render in screen space.
   ============================================================ */

(function (root) {
  'use strict';

  // -------- math / easing --------
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function quartInOut(t) {
    return t < 0.5
      ? 8 * t * t * t * t
      : 1 - Math.pow(-2 * t + 2, 4) / 2;
  }
  function quartOut(t) { return 1 - Math.pow(1 - t, 4); }

  function lerpPose(a, b, t) {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
  }

  // World distance between two pose centers, normalized by zoom-1
  // world units. Used to decide far-pan bridge.
  function poseDistance(a, b, world) {
    // Recover the "center looked at" from a pose: world point that
    // maps to canvas (W/2, H/2). Without W/H we approximate using
    // pose offset alone — the real test runs against world center
    // bbox, but for adjacency comparison this suffices.
    const dx = (a.x / a.z) - (b.x / b.z);
    const dy = (a.y / a.z) - (b.y / b.z);
    return Math.hypot(dx, dy) / Math.max(world.w, world.h);
  }

  // -------- engine factory --------
  function create(opts) {
    if (!opts || !opts.canvas) throw new Error('ReelEngine: canvas is required');
    if (!opts.worldDims) throw new Error('ReelEngine: worldDims is required');
    if (!opts.wideFrame) throw new Error('ReelEngine: wideFrame is required');
    if (!Array.isArray(opts.beats) || !opts.beats.length) {
      throw new Error('ReelEngine: beats[] is required');
    }
    if (typeof opts.draw !== 'function') {
      throw new Error('ReelEngine: draw(ctx, state) is required');
    }

    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    const world = opts.worldDims;
    const beats = opts.beats.slice();
    const cardSlot = opts.cardSlot || null;
    const formatCard = opts.formatCard || null;
    const drawConsumer = opts.draw;
    const userFrameFor = opts.frameFor || null;
    const onCycleStart = opts.onCycleStart || null;
    const hostElement = opts.hostElement || canvas.parentElement || canvas;

    const reduceMotion = opts.reduceMotion === 'auto' || opts.reduceMotion == null
      ? (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      : !!opts.reduceMotion;

    const lazy = opts.lazy !== false;

    let cycleMs = opts.cycleMs;
    if (cycleMs === 'auto' || cycleMs == null) {
      cycleMs = beats.reduce(function (s, b) { return s + (b.durationMs || 0); }, 0);
    }

    // -------- canvas + DPR --------
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;

    function resize() {
      const rect = (canvas.parentElement || canvas).getBoundingClientRect();
      const nw = Math.max(320, Math.round(rect.width));
      const nh = Math.max(240, Math.round(rect.height));
      if (nw === W && nh === H) return false;
      W = nw; H = nh;
      canvas.width  = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      return true;
    }

    // -------- camera + beat frames --------
    let wideCache = null;
    const beatCache = new Array(beats.length);

    function recomputeFrames() {
      const args = { W: W, H: H, world: world };
      wideCache = opts.wideFrame(args);
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        const f = b.frame;
        if (f === 'wide' || f == null) {
          beatCache[i] = wideCache;
        } else if (f === 'computed') {
          if (!userFrameFor) throw new Error('ReelEngine: beat[' + i + "].frame='computed' but frameFor not provided");
          beatCache[i] = userFrameFor(b, args);
        } else if (typeof f === 'function') {
          beatCache[i] = f(b, args);
        } else if (f && typeof f.x === 'number') {
          // Static pose object — deep-copy so recompute can't mutate user input
          beatCache[i] = { x: f.x, y: f.y, z: f.z };
        } else {
          throw new Error('ReelEngine: beat[' + i + '] has invalid frame');
        }
      }
    }

    // -------- pulses (screen-space) --------
    const pulses = [];

    function spawnPulseAt(worldPos, pulseOpts) {
      if (!worldPos) return;
      const o = pulseOpts || {};
      pulses.push({
        wx: worldPos.x,
        wy: worldPos.y,
        born: nowMs(),
        lifeMs: o.lifeMs || 700,
        maxRadiusPx: o.maxRadiusPx || 64,
        color: o.color || '255,255,255',
        lineWidth: o.lineWidth || 2,
      });
    }

    function drawPulses(cam) {
      if (!pulses.length) return;
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      const t = nowMs();
      for (let i = 0; i < pulses.length; i++) {
        const p = pulses[i];
        const lt = (t - p.born) / p.lifeMs;
        if (lt < 0 || lt >= 1) continue;
        const sx = p.wx * cam.z + cam.x;
        const sy = p.wy * cam.z + cam.y;
        const r = quartOut(lt) * p.maxRadiusPx;
        const a = (1 - lt) * 0.6;
        ctx.strokeStyle = 'rgba(' + p.color + ',' + a.toFixed(3) + ')';
        ctx.lineWidth = p.lineWidth * (1 - lt * 0.4);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    function gcPulses() {
      const t = nowMs();
      for (let i = pulses.length - 1; i >= 0; i--) {
        if (t - pulses[i].born >= pulses[i].lifeMs) pulses.splice(i, 1);
      }
    }

    // -------- info card crossfade --------
    let cardState = 'idle';   // 'idle' | 'fading-out' | 'fading-in'
    let cardFadeStart = 0;
    let cardCurrentBeat = null;
    let cardPendingBeat = null;

    function resolveCardRef(ref, fallbackBeat) {
      if (ref == null) return null;
      if (ref === 'self') return fallbackBeat || null;
      if (typeof ref === 'string') {
        for (let i = 0; i < beats.length; i++) if (beats[i].id === ref) return beats[i];
        return null;
      }
      return ref; // assume a Beat object
    }

    function crossFadeCardTo(ref, fallbackBeat) {
      if (!cardSlot || reduceMotion) {
        // In reduced-motion mode the card snaps without animation.
        if (cardSlot && formatCard) {
          const target = resolveCardRef(ref, fallbackBeat);
          cardSlot.innerHTML = target ? formatCard(target) : '';
          cardSlot.style.opacity = target ? '1' : '0';
          cardCurrentBeat = target;
        }
        return;
      }
      const target = resolveCardRef(ref, fallbackBeat);
      if (cardCurrentBeat === target && cardPendingBeat == null) return;
      if (cardPendingBeat === target) return;
      cardPendingBeat = target;
      cardState = 'fading-out';
      cardFadeStart = nowMs();
    }

    function tickCard() {
      if (!cardSlot || cardState === 'idle') return;
      const elapsed = nowMs() - cardFadeStart;
      if (cardState === 'fading-out') {
        const t = clamp01(elapsed / 160);
        cardSlot.style.opacity = String(1 - t);
        if (t >= 1) {
          if (formatCard) {
            cardSlot.innerHTML = cardPendingBeat ? formatCard(cardPendingBeat) : '';
          }
          cardCurrentBeat = cardPendingBeat;
          cardPendingBeat = null;
          cardState = cardCurrentBeat ? 'fading-in' : 'idle';
          cardFadeStart = nowMs();
          if (!cardCurrentBeat) cardSlot.style.opacity = '0';
        }
      } else if (cardState === 'fading-in') {
        const t = clamp01(elapsed / 160);
        cardSlot.style.opacity = String(t);
        if (t >= 1) cardState = 'idle';
      }
    }

    // -------- timing + pause/resume --------
    let raf = null;
    let started = false;
    let paused = false;
    let pauseStartedAt = 0;
    let cycleStart = 0;       // performance.now() of current cycle's t=0
    let lastFrameNow = 0;
    let prevCycleT = 0;
    let prevBeatIdx = -1;
    let firedActivations = new Set();

    function nowMs() { return performance.now(); }

    // Pause/resume that preserves the timeline. Ported pattern from
    // commit 8cf042d in this repo: rather than freezing rAF (which
    // would still drift on tab refocus), we shift every absolute
    // timestamp forward by the paused duration on resume so the
    // reel picks up exactly where it left off.
    function shiftTimeline(deltaMs) {
      cycleStart += deltaMs;
      cardFadeStart += deltaMs;
      for (let i = 0; i < pulses.length; i++) pulses[i].born += deltaMs;
    }

    function pause() {
      if (paused) return;
      paused = true;
      pauseStartedAt = nowMs();
    }

    function resume() {
      if (!paused) return;
      const pausedFor = nowMs() - pauseStartedAt;
      shiftTimeline(pausedFor);
      paused = false;
      pauseStartedAt = 0;
    }

    function onVisibility() {
      if (document.hidden) pause(); else resume();
    }

    // -------- camera computation per tick --------
    function currentBeatPose(beatIdx, beatT) {
      const beat = beats[beatIdx];
      const target = beatCache[beatIdx];
      const panMs = Math.min(beat.panMs != null ? beat.panMs : 2500, beat.durationMs * 0.45);
      const prevIdx = (beatIdx - 1 + beats.length) % beats.length;
      const prevPose = beatCache[prevIdx];

      let pose;
      if (beatT <= panMs && beatIdx !== 0) {
        // panning in. Far-pan bridge if prev/target centers are far.
        const t = quartInOut(clamp01(beatT / panMs));
        const dist = poseDistance(prevPose, target, world);
        if (dist > 0.6 && wideCache) {
          // 3-point: prev -> wide (first half) -> target (second half)
          if (t < 0.5) {
            pose = lerpPose(prevPose, wideCache, quartInOut(t * 2));
          } else {
            pose = lerpPose(wideCache, target, quartInOut((t - 0.5) * 2));
          }
        } else {
          pose = lerpPose(prevPose, target, t);
        }
      } else {
        pose = { x: target.x, y: target.y, z: target.z };
      }

      // Ken-burns drift on hold portion only.
      if (beat.kenBurns && beatT > panMs) {
        const driftT = (beatT - panMs) * 0.001;
        const ampX = W * 0.015;
        const ampY = H * 0.015;
        const ampZ = 0.025;
        pose.x += ampX * Math.sin(driftT * 0.6);
        pose.y += ampY * Math.cos(driftT * 0.7);
        pose.z *= (1 + ampZ * Math.sin(driftT * 0.5));
      }

      return pose;
    }

    // -------- beat scheduler + activation triggers --------
    function locateBeat(cycleT) {
      let cum = 0;
      for (let i = 0; i < beats.length; i++) {
        const dur = beats[i].durationMs;
        if (cycleT < cum + dur) return { idx: i, beatT: cycleT - cum };
        cum += dur;
      }
      // Defensive: end of cycle = last beat's last frame
      return { idx: beats.length - 1, beatT: beats[beats.length - 1].durationMs };
    }

    function fireActivationsUpTo(beatIdx, beatT) {
      const beat = beats[beatIdx];
      if (!beat.activations || !beat.activations.length) return;
      for (let i = 0; i < beat.activations.length; i++) {
        const act = beat.activations[i];
        const key = beatIdx + ':' + i;
        if (beatT >= act.tMs && !firedActivations.has(key)) {
          firedActivations.add(key);
          if (act.pulseAt) {
            const pos = typeof act.pulseAt === 'function'
              ? act.pulseAt({ beat: beat, engine: api })
              : act.pulseAt;
            spawnPulseAt(pos, act.pulseOpts);
          }
          if (act.cardTo !== undefined) {
            crossFadeCardTo(act.cardTo, beat);
          }
          if (typeof act.onFire === 'function') {
            act.onFire({ beat: beat, activation: act, engine: api });
          }
        }
      }
    }

    // -------- main tick --------
    function tick() {
      const now = nowMs();
      lastFrameNow = now;

      if (paused) {
        // While paused we still schedule rAF but don't advance time
        // or draw. visibilitychange is the canonical pause trigger;
        // IO-leave is the other.
        raf = requestAnimationFrame(tick);
        return;
      }

      const cycleT = cycleMs > 0 ? ((now - cycleStart) % cycleMs) : 0;

      // Loop wrap: cycleT decreased means we crossed the boundary.
      if (cycleT < prevCycleT) {
        firedActivations.clear();
        pulses.length = 0;
        crossFadeCardTo(null);
        if (typeof onCycleStart === 'function') onCycleStart();
      }
      prevCycleT = cycleT;

      const located = locateBeat(cycleT);
      const beatIdx = located.idx;
      const beatT = located.beatT;
      const beat = beats[beatIdx];

      if (beatIdx !== prevBeatIdx) {
        prevBeatIdx = beatIdx;
        // Per-beat activations re-fire each loop because we cleared
        // firedActivations on wrap; nothing more to do on entry.
      }

      fireActivationsUpTo(beatIdx, beatT);

      const cam = currentBeatPose(beatIdx, beatT);

      // Set transform: DPR baseline + camera. Consumer draws in world coords.
      ctx.setTransform(DPR * cam.z, 0, 0, DPR * cam.z, DPR * cam.x, DPR * cam.y);
      ctx.clearRect(-cam.x / cam.z, -cam.y / cam.z, W / cam.z, H / cam.z);

      const state = {
        cam: cam,
        W: W, H: H, DPR: DPR,
        t: now - reelStart,
        cycleT: cycleT,
        beat: beat,
        beatIdx: beatIdx,
        beatT: beatT,
        pulses: pulses,
        reduceMotion: reduceMotion,
        paused: paused,
        world: world,
      };

      try {
        drawConsumer(ctx, state);
      } catch (err) {
        console.error('ReelEngine consumer draw error', err);
      }

      drawPulses(cam);
      gcPulses();
      tickCard();

      raf = requestAnimationFrame(tick);
    }

    // -------- single-frame static render (reduced motion) --------
    function renderStaticFrame() {
      // Static = the wide pose, beat[0] activations fired once.
      const cam = wideCache;
      ctx.setTransform(DPR * cam.z, 0, 0, DPR * cam.z, DPR * cam.x, DPR * cam.y);
      ctx.clearRect(-cam.x / cam.z, -cam.y / cam.z, W / cam.z, H / cam.z);
      const state = {
        cam: cam,
        W: W, H: H, DPR: DPR,
        t: 0, cycleT: 0,
        beat: beats[0], beatIdx: 0, beatT: 0,
        pulses: [],
        reduceMotion: true, paused: false,
        world: world,
      };
      try { drawConsumer(ctx, state); }
      catch (err) { console.error('ReelEngine static draw error', err); }
      // No pulses, no card animation.
      if (cardSlot && formatCard) {
        cardSlot.innerHTML = '';
        cardSlot.style.opacity = '0';
      }
    }

    // -------- resize handling --------
    let resizeRAF = null;
    function onResize() {
      if (resizeRAF) cancelAnimationFrame(resizeRAF);
      resizeRAF = requestAnimationFrame(function () {
        const changed = resize();
        if (changed) {
          recomputeFrames();
          // Snap camera mid-pan to avoid math glitches: clearing
          // prevBeatIdx forces the next tick to treat us as if
          // we just entered the current beat at its current beatT.
          // The pan source is prev-beat's cached pose, which is
          // also recomputed, so the transition resolves cleanly.
        }
        if (reduceMotion) renderStaticFrame();
      });
    }

    // -------- lazy init via IntersectionObserver --------
    let io = null;
    function lazyArm(onReady) {
      if (!lazy || typeof IntersectionObserver === 'undefined') {
        onReady();
        return;
      }
      io = new IntersectionObserver(function (entries) {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (e.isIntersecting) {
            io.disconnect();
            io = null;
            onReady();
            return;
          }
        }
      }, { rootMargin: '200px 0px' });
      io.observe(hostElement);
    }

    // Pause when the canvas leaves the viewport (cheap on long pages).
    let leaveIO = null;
    function armLeavePause() {
      if (typeof IntersectionObserver === 'undefined') return;
      leaveIO = new IntersectionObserver(function (entries) {
        for (let i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) resume();
          else pause();
        }
      }, { threshold: 0 });
      leaveIO.observe(hostElement);
    }

    // -------- public api --------
    let reelStart = 0;
    const api = {
      start: function () {
        if (started) return;
        started = true;
        function go() {
          resize();
          recomputeFrames();
          if (reduceMotion) {
            renderStaticFrame();
            return;
          }
          window.addEventListener('resize', onResize);
          if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', onResize);
          }
          document.addEventListener('visibilitychange', onVisibility);
          armLeavePause();
          reelStart = nowMs();
          cycleStart = reelStart;
          prevCycleT = 0;
          prevBeatIdx = -1;
          firedActivations.clear();
          raf = requestAnimationFrame(tick);
        }
        lazyArm(go);
      },
      stop: function () {
        if (raf) { cancelAnimationFrame(raf); raf = null; }
      },
      pause: pause,
      resume: resume,
      destroy: function () {
        api.stop();
        if (io) { io.disconnect(); io = null; }
        if (leaveIO) { leaveIO.disconnect(); leaveIO = null; }
        window.removeEventListener('resize', onResize);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', onResize);
        }
        document.removeEventListener('visibilitychange', onVisibility);
        started = false;
      },
      spawnPulseAt: spawnPulseAt,
      crossFadeCardTo: function (ref) { crossFadeCardTo(ref, beats[prevBeatIdx >= 0 ? prevBeatIdx : 0]); },
      // Read-only introspection — useful for the test fixture.
      get state() {
        return {
          W: W, H: H, DPR: DPR,
          paused: paused, reduceMotion: reduceMotion,
          cycleMs: cycleMs, beats: beats.length,
        };
      },
    };

    return api;
  }

  root.ReelEngine = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
