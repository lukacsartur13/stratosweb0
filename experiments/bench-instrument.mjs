// =============================================================================
// Page-side instrumentation, shared by bench-meridian.mjs and bench-lifecycle.mjs.
//
// Everything here is installed as an init script, before any application code
// runs, and everything it measures is measured *at the WebGL boundary* rather
// than by asking three.js what it thinks it did. That choice is deliberate:
//
//   * `renderer.info` is only reachable from a development build, because the
//     `__stratos` handle is compiled out of production. Benchmarking the dev
//     bundle to get a draw-call count would mean reporting React's development
//     mode as if it were the artefact that ships.
//   * a wrapped `drawElements` counts what the driver was actually asked to do,
//     including anything drei, the environment probe or a post-pass contributes
//     that three's own counter attributes elsewhere.
//
// The wrappers are prototype-level and installed once, so a second context —
// which is itself a thing being tested for — is counted the same way.
// =============================================================================

/** Source of the init script. Stringified into `page.addInitScript`. */
export function instrumentation() {
  const w = /** @type {any} */ (globalThis);

  // --- WebGL resource + workload counters ------------------------------------
  const gl = {
    contexts: 0,
    contextsLost: 0,
    draws: 0,
    tris: 0,
    // Created minus *explicitly deleted*, pooled over every context that has
    // ever existed.
    //
    // Read the name carefully, because the obvious reading of these is wrong and
    // it cost a whole audit cycle to establish that. react-three-fiber tears a
    // canvas down with `forceContextLoss()`; the driver reclaims everything the
    // context owned, but no `deleteProgram`/`deleteTexture`/`deleteBuffer` is
    // ever issued for any of it. A pooled created-minus-deleted counter
    // therefore *cannot* go down across a remount, and rises by exactly one
    // scene's worth every cycle whether or not anything leaked.
    //
    // `liveByContext()` below is the number that answers the leak question:
    // resources still held by a context that is not lost.
    programs: 0,
    textures: 0,
    buffers: 0,
    framebuffers: 0,
    renderbuffers: 0,
    vaos: 0,
    // Peak live counts, so a cycle that allocates and frees inside one sample
    // still shows up.
    peak: { programs: 0, textures: 0, buffers: 0, framebuffers: 0 },
    timerQuery: 'unknown',
  };
  w.__gl = gl;

  // --- GPU timing -------------------------------------------------------------
  //
  // The reason this exists rather than a `--disable-gpu-vsync` throughput run.
  //
  // On a 120 Hz display every healthy frame reports 8.3 ms whatever the scene
  // costs, so wall-clock frame time cannot compare two versions of a shader.
  // Unlocking vsync was the first attempt and it measured the compositor's mood:
  // the same build reported 780 fps in one sample and 120 in the next depending
  // on window occlusion, which is a fact about the desktop, not the scene.
  //
  // `EXT_disjoint_timer_query_webgl2` asks the GPU how long it spent, in
  // nanoseconds, on exactly the draw calls of exactly one frame. It is immune to
  // vsync, to the compositor and to the window manager, and it is the only
  // number in this file that can honestly answer "did the extra light cost
  // anything". `disjoint` is checked on every read: the spec allows the driver
  // to invalidate results after a context switch, and a disjoint sample is
  // discarded rather than averaged in.
  const gpu = { ext: null, ctx: null, open: null, armed: false, samples: [], inflight: [], disjoint: 0 };
  w.__gpu = gpu;

  const TIME_ELAPSED = 0x88bf;
  const GPU_DISJOINT = 0x8fbb;

  /** Called from the sampler's rAF, which runs after the renderer's. */
  gpu.tick = () => {
    if (!gpu.ext || !gpu.ctx) return;
    const c = gpu.ctx;
    if (gpu.open) {
      c.endQuery(TIME_ELAPSED);
      gpu.inflight.push(gpu.open);
      gpu.open = null;
    }
    // Harvest whatever the driver has finished with.
    if (c.getParameter(GPU_DISJOINT)) {
      gpu.disjoint++;
      for (const q of gpu.inflight) c.deleteQuery(q);
      gpu.inflight = [];
    }
    gpu.inflight = gpu.inflight.filter((q) => {
      if (!c.getQueryParameter(q, c.QUERY_RESULT_AVAILABLE)) return true;
      gpu.samples.push(c.getQueryParameter(q, c.QUERY_RESULT) / 1e6); // ns → ms
      c.deleteQuery(q);
      return false;
    });
    gpu.armed = true;
  };

  /**
   * Called from the draw wrapper: opens a query on the frame's first draw.
   *
   * The context is adopted here rather than in `getContext`, because the first
   * WebGL context this page creates is the capability probe in
   * `lib/capabilities.ts` — which is deliberately thrown away and never draws.
   * Adopting the context that actually issues a draw call picks the renderer's.
   */
  const armQuery = (ctx) => {
    if (!gpu.ctx && typeof ctx.createQuery === 'function') {
      gpu.ctx = ctx;
      try {
        gpu.ext = ctx.getExtension('EXT_disjoint_timer_query_webgl2') ?? null;
      } catch {
        gpu.ext = null;
      }
      gpu.armed = true;
    }
    if (!gpu.armed || gpu.open || !gpu.ext || gpu.ctx !== ctx) return;
    const q = ctx.createQuery();
    if (!q) return;
    ctx.beginQuery(TIME_ELAPSED, q);
    gpu.open = q;
    gpu.armed = false;
  };

  const TRIANGLES = 4;
  const TRIANGLE_STRIP = 5;
  const TRIANGLE_FAN = 6;

  const primCount = (mode, count) => {
    if (mode === TRIANGLES) return count / 3;
    if (mode === TRIANGLE_STRIP || mode === TRIANGLE_FAN) return Math.max(0, count - 2);
    return 0;
  };

  const bump = (key, delta) => {
    gl[key] += delta;
    if (gl.peak[key] !== undefined && gl[key] > gl.peak[key]) gl.peak[key] = gl[key];
  };

  // --- per-context attribution --------------------------------------------------
  //
  // Every GL object is tagged with the id of the context that created it, and
  // every context is held through a `WeakRef`. The weak reference is not
  // fastidiousness: an earlier version of this probe kept the contexts and their
  // canvases in a plain array, and three.js's own `webglcontextlost` handler on
  // the canvas closes over the whole renderer — so the probe pinned every dead
  // renderer in memory and then reported the heap growth it had caused. A
  // measurement tool that holds the thing it is measuring for leaks is not a
  // measurement tool.
  //
  // A context whose `WeakRef` has been cleared is counted as `collected`, which
  // is the positive evidence that a torn-down renderer really did go away.
  const ctxIds = new WeakMap();
  const ctxRefs = []; // { id, ref: WeakRef<WebGLRenderingContext> }
  const owners = new WeakMap(); // GL object -> context id
  const perCtx = {}; // `${id}:${kind}` -> live count
  let nextCtxId = 0;

  /**
   * Credit or debit one resource against the context that created it.
   *
   * A delete is attributed to the *creating* context, not to whichever context
   * the call happened to be made on, so a resource can never be created on one
   * context and freed from another's ledger.
   */
  const attribute = (ctx, object, kind, delta) => {
    let id;
    if (delta > 0) {
      id = ctxIds.get(ctx) ?? 0;
      owners.set(object, id);
    } else {
      id = owners.get(object) ?? ctxIds.get(ctx) ?? 0;
    }
    const k = `${id}:${kind}`;
    perCtx[k] = (perCtx[k] ?? 0) + delta;
  };

  /**
   * Live GL resources split by whether the owning context is still alive.
   *
   * `live` is the only bucket a leak can hide in. `dead` is resources on
   * force-lost contexts, which the driver has already reclaimed and which no
   * `deleteX` will ever be issued for.
   */
  gl.liveByContext = () => {
    const kinds = ['programs', 'textures', 'buffers', 'framebuffers', 'renderbuffers', 'vaos'];
    const out = { live: {}, dead: {}, contexts: ctxRefs.length, alive: 0, lost: 0, collected: 0 };
    for (const { id, ref } of ctxRefs) {
      const ctx = ref.deref();
      let bucket;
      if (!ctx) {
        out.collected++;
        bucket = out.dead;
      } else if (ctx.isContextLost()) {
        out.lost++;
        bucket = out.dead;
      } else {
        out.alive++;
        bucket = out.live;
      }
      for (const kind of kinds) {
        const n = perCtx[`${id}:${kind}`] ?? 0;
        if (n) bucket[kind] = (bucket[kind] ?? 0) + n;
      }
    }
    return out;
  };

  function patchContext(proto) {
    if (!proto || proto.__benchPatched) return;
    proto.__benchPatched = true;

    const wrapDraw = (name, tris) => {
      const original = proto[name];
      if (typeof original !== 'function') return;
      proto[name] = function (...args) {
        armQuery(this);
        gl.draws++;
        gl.tris += tris(args);
        return original.apply(this, args);
      };
    };

    wrapDraw('drawElements', ([mode, count]) => primCount(mode, count));
    wrapDraw('drawArrays', ([mode, , count]) => primCount(mode, count));
    wrapDraw('drawElementsInstanced', ([mode, count, , , n]) => primCount(mode, count) * n);
    wrapDraw('drawArraysInstanced', ([mode, , count, n]) => primCount(mode, count) * n);
    wrapDraw('drawRangeElements', ([mode, , , count]) => primCount(mode, count));

    const wrapLifecycle = (createName, deleteName, key) => {
      const create = proto[createName];
      const destroy = proto[deleteName];
      if (typeof create === 'function') {
        proto[createName] = function (...args) {
          const out = create.apply(this, args);
          if (out) {
            bump(key, 1);
            attribute(this, out, key, 1);
          }
          return out;
        };
      }
      if (typeof destroy === 'function') {
        proto[deleteName] = function (...args) {
          if (args[0]) {
            bump(key, -1);
            attribute(this, args[0], key, -1);
          }
          return destroy.apply(this, args);
        };
      }
    };

    wrapLifecycle('createProgram', 'deleteProgram', 'programs');
    wrapLifecycle('createTexture', 'deleteTexture', 'textures');
    wrapLifecycle('createBuffer', 'deleteBuffer', 'buffers');
    wrapLifecycle('createFramebuffer', 'deleteFramebuffer', 'framebuffers');
    wrapLifecycle('createRenderbuffer', 'deleteRenderbuffer', 'renderbuffers');
    wrapLifecycle('createVertexArray', 'deleteVertexArray', 'vaos');
  }

  patchContext(w.WebGLRenderingContext && w.WebGLRenderingContext.prototype);
  patchContext(w.WebGL2RenderingContext && w.WebGL2RenderingContext.prototype);

  // Context creation. Counted here rather than by looking for canvases, because
  // the capability probe in `lib/capabilities.ts` deliberately creates one and
  // throws it away — that one is real and should be counted, and the number the
  // audit cares about is whether it stays at its expected value across ten
  // remounts.
  const getContext = w.HTMLCanvasElement.prototype.getContext;
  w.HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && /webgl/i.test(String(type))) {
      gl.contexts++;
      if (!ctxIds.has(ctx)) {
        const id = ++nextCtxId;
        ctxIds.set(ctx, id);
        ctxRefs.push({ id, ref: new WeakRef(ctx) });
      }
      this.addEventListener('webglcontextlost', () => {
        gl.contextsLost++;
      });
      if (gl.timerQuery === 'unknown') {
        try {
          gl.timerQuery = ctx.getExtension('EXT_disjoint_timer_query_webgl2')
            ? 'available'
            : ctx.getExtension('EXT_disjoint_timer_query')
              ? 'available-webgl1'
              : 'unavailable';
        } catch {
          gl.timerQuery = 'unavailable';
        }
      }
    }
    return ctx;
  };

  // --- rAF accounting ---------------------------------------------------------
  // Two questions, both from Part 4: is anything animating that should not be,
  // and is there more than one loop after a remount. A duplicated render loop
  // shows up as roughly twice the callbacks per frame.
  const raf = { scheduled: 0, mine: 0 };
  w.__raf = raf;
  const rafOriginal = w.requestAnimationFrame.bind(w);
  w.requestAnimationFrame = function (cb) {
    if (!cb || !cb.__bench) raf.scheduled++;
    return rafOriginal(cb);
  };

  // --- listener accounting ----------------------------------------------------
  const listeners = { media: 0, resize: 0, scroll: 0, visibility: 0, observers: 0 };
  w.__listeners = listeners;

  const mqProto = w.MediaQueryList && w.MediaQueryList.prototype;
  if (mqProto) {
    const add = mqProto.addEventListener;
    const remove = mqProto.removeEventListener;
    if (add) {
      mqProto.addEventListener = function (...args) {
        listeners.media++;
        return add.apply(this, args);
      };
    }
    if (remove) {
      mqProto.removeEventListener = function (...args) {
        listeners.media--;
        return remove.apply(this, args);
      };
    }
  }

  const track = (target, label) => {
    const add = target.addEventListener;
    const remove = target.removeEventListener;
    target.addEventListener = function (type, ...rest) {
      if (type === label.type) listeners[label.key]++;
      return add.call(this, type, ...rest);
    };
    target.removeEventListener = function (type, ...rest) {
      if (type === label.type) listeners[label.key]--;
      return remove.call(this, type, ...rest);
    };
  };
  track(w, { type: 'resize', key: 'resize' });
  track(w, { type: 'scroll', key: 'scroll' });
  track(w.document, { type: 'visibilitychange', key: 'visibility' });

  if (w.IntersectionObserver) {
    const Original = w.IntersectionObserver;
    class Counted extends Original {
      constructor(...args) {
        super(...args);
        listeners.observers++;
      }
      disconnect() {
        listeners.observers--;
        return super.disconnect();
      }
    }
    w.IntersectionObserver = Counted;
  }

  // --- the frame sampler ------------------------------------------------------
  // Its own rAF, running alongside the renderer's. Both are driven by the same
  // vsync, so consecutive timestamps are frame boundaries; the sampler's own
  // cost is a push onto an array and is excluded from the callback census above.
  const bench = {
    times: [],
    running: false,
    baseline: null,
    begin() {
      this.times = [];
      this.running = true;
      this.baseline = { draws: gl.draws, tris: gl.tris, raf: raf.scheduled, at: performance.now() };
      gpu.samples = [];
      gpu.disjoint = 0;
      const step = (now) => {
        if (!this.running) return;
        this.times.push(now);
        // After the renderer's own rAF for this frame — the sampler is
        // registered later, so it runs later — which is what makes the query
        // bracket exactly one frame's draw calls.
        gpu.tick();
        rafOriginal(step);
      };
      step.__bench = true;
      rafOriginal(step);
    },
    end() {
      this.running = false;

      // Close and *discard* whatever query is still open, and throw away
      // everything still in flight.
      //
      // Leaving it open was a real bug and it is worth naming, because the
      // symptom was subtle and the wrong number was plausible. Between two
      // sample windows the benchmark spends three-odd seconds seeking to the
      // next altitude and letting it settle, with the renderer drawing the
      // whole time and no `tick()` running to close anything. The query opened
      // by the last frame of window N therefore stayed open across that entire
      // gap and was closed by the first `tick()` of window N+1 — contributing
      // one sample worth one and a half seconds of accumulated GPU time.
      //
      // One such sample in a thousand does not move a median by a thousandth of
      // a millisecond, so every median in this file was always correct. It
      // tripled the *mean*: 2.3 ms median against a 7.0 ms mean, with a p95 of
      // 2.9 ms, which is arithmetically impossible and is what gave it away.
      if (gpu.ctx && gpu.open) {
        gpu.ctx.endQuery(TIME_ELAPSED);
        gpu.ctx.deleteQuery(gpu.open);
        gpu.open = null;
      }
      if (gpu.ctx) for (const q of gpu.inflight) gpu.ctx.deleteQuery(q);
      gpu.inflight = [];
      gpu.armed = false;

      const elapsed = performance.now() - this.baseline.at;
      const frames = Math.max(1, this.times.length - 1);
      return {
        times: this.times,
        elapsedMs: elapsed,
        drawsPerFrame: (gl.draws - this.baseline.draws) / frames,
        trisPerFrame: (gl.tris - this.baseline.tris) / frames,
        rafPerFrame: (raf.scheduled - this.baseline.raf) / frames,
        live: {
          contexts: gl.contexts,
          contextsLost: gl.contextsLost,
          programs: gl.programs,
          textures: gl.textures,
          buffers: gl.buffers,
          framebuffers: gl.framebuffers,
          renderbuffers: gl.renderbuffers,
          vaos: gl.vaos,
        },
        peak: { ...gl.peak },
        gpuMs: [...gpu.samples],
        gpuDisjoint: gpu.disjoint,
        gpuAvailable: !!gpu.ext,
        timerQuery: gl.timerQuery,
        listeners: { ...listeners },
      };
    },
  };
  w.__bench = bench;

  // Long tasks, for the stall check.
  w.__long = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push({ start: e.startTime, dur: e.duration });
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    /* not supported — reported as unavailable rather than as zero */
  }
}

// -----------------------------------------------------------------------------
// Node-side statistics. Kept here so both benchmarks compute them identically.
// -----------------------------------------------------------------------------

/** Frame deltas from raw rAF timestamps, first frame dropped. */
export function deltas(times) {
  const out = [];
  for (let i = 2; i < times.length; i++) out.push(times[i] - times[i - 1]);
  return out;
}

export function frameStats(times) {
  const d = deltas(times);
  if (d.length === 0) {
    return { frames: 0, avgFps: 0, median: 0, p95: 0, p99: 0, over16: 0, over33: 0, worst: 0, longestRun: 0 };
  }
  const sorted = [...d].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const total = d.reduce((a, b) => a + b, 0);

  // The longest *consecutive* sequence of frames over 33.3 ms. A single slow
  // frame is noise; five in a row is the thing a visitor calls a stutter, and
  // an average hides it completely.
  let run = 0;
  let longestRun = 0;
  for (const f of d) {
    run = f > 33.3 ? run + 1 : 0;
    if (run > longestRun) longestRun = run;
  }

  return {
    frames: d.length,
    avgFps: +(1000 / (total / d.length)).toFixed(1),
    median: +pct(0.5).toFixed(2),
    p95: +pct(0.95).toFixed(2),
    p99: +pct(0.99).toFixed(2),
    over16: +((100 * d.filter((f) => f > 16.7).length) / d.length).toFixed(1),
    over33: +((100 * d.filter((f) => f > 33.3).length) / d.length).toFixed(1),
    worst: +Math.max(...d).toFixed(1),
    longestRun,
  };
}

/**
 * GPU time per frame, in milliseconds, from the timer-query samples.
 *
 * Reported separately from wall-clock frame time and never merged into it. They
 * measure different things: the wall clock says what the visitor's frame pacing
 * was, the GPU time says what the scene actually cost. On a display with
 * headroom the first is a constant and only the second can detect a change.
 */
export function gpuStats(samples) {
  if (!samples || samples.length === 0) return { n: 0, median: null, p95: null, mean: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    n: sorted.length,
    mean: +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(3),
    median: +pct(0.5).toFixed(3),
    p95: +pct(0.95).toFixed(3),
  };
}

/** Median of a numeric field across runs. Three runs, middle value. */
export function medianOf(runs, pick) {
  const values = runs.map(pick).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
