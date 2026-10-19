/*!
 * sky.js : a time-of-day and weather sky background drawn entirely in code.
 * No dependencies, no images. MIT License.
 * Tuned for the TJ & Kyle Thailand 2026 "Right now" card: pastel palette,
 * cute clouds kept clear of the title, gentle motion, paused when off screen.
 *
 *   Sky.create(element, { lat, lon, date, weather })  -> controller
 *   Sky.colors({ lat, lon, date, weather })           -> { sky, cloud, phase, altitude }
 *
 * Weather conditions: clear, partlycloudy, overcast, fog, drizzle, rain, storm, snow
 * Phases (derived from sun altitude): dawn, golden, day, dusk, night
 */
(function (global) {
  'use strict';

  var RAD = Math.PI / 180;
  var CONDITIONS = ['clear', 'partlycloudy', 'overcast', 'fog', 'drizzle', 'rain', 'storm', 'snow'];

  /* ---------- sun position (accurate to well under a degree) ---------- */
  function sunPosition(date, lat, lon) {
    var d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
    var g = (357.529 + 0.98560028 * d) * RAD;
    var q = 280.459 + 0.98564736 * d;
    var L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
    var e = (23.439 - 0.00000036 * d) * RAD;
    var ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    var dec = Math.asin(Math.sin(e) * Math.sin(L));
    var gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    var ha = (gmst * 15 + lon) * RAD - ra;
    ha = Math.atan2(Math.sin(ha), Math.cos(ha));
    var la = lat * RAD;
    var alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
    return { altitude: alt / RAD, rising: ha < 0 };
  }

  function phaseFor(alt, rising) {
    if (alt < -6) return 'night';
    if (alt < 1) return rising ? 'dawn' : 'dusk';
    if (alt < 10) return 'golden';
    return 'day';
  }

  /* ---------- color helpers ---------- */
  function hex(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function css(c, a) {
    var r = Math.max(0, Math.min(255, Math.round(c[0]))), g = Math.max(0, Math.min(255, Math.round(c[1]))), b = Math.max(0, Math.min(255, Math.round(c[2])));
    return a == null ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lum(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }

  /* ---------- time-of-day palettes: [altitude, top, middle, bottom] ---------- */
  function P(alt, a, b, c) { return [alt, hex(a), hex(b), hex(c)]; }
  var NIGHT = P(-18, '#0f1d44', '#182f63', '#25427d');
  var DAY_LOW = P(16, '#86c3ef', '#b0daf6', '#e1f1fb');
  var DAY_HIGH = P(60, '#7bbcec', '#a8d5f5', '#dbeefb');
  var MORNING = [
    NIGHT,
    P(-9, '#232a66', '#4b4a8f', '#8a6aa6'),
    P(-3, '#7f84d4', '#c7a6d6', '#f7c3bf'),
    P(2, '#a9b3ee', '#f2c6cf', '#ffd6b3'),
    P(7, '#f6cf96', '#fad9a6', '#ffeac4'),
    DAY_LOW, DAY_HIGH
  ];
  var EVENING = [
    NIGHT,
    P(-9, '#1f2563', '#3f3d86', '#6e4a8a'),
    P(-3, '#5b55b8', '#a97bc0', '#f29aa3'),
    P(2, '#7a6cc6', '#d58fb2', '#f8ab94'),
    P(7, '#f3bf86', '#f8cf9c', '#ffe2b6'),
    DAY_LOW, DAY_HIGH
  ];
  function palette(alt, rising) {
    var s = rising ? MORNING : EVENING;
    if (alt <= s[0][0]) return [s[0][1], s[0][2], s[0][3]];
    for (var i = 1; i < s.length; i++) {
      if (alt <= s[i][0]) {
        var t = (alt - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
        t = t * t * (3 - 2 * t);
        return [mix(s[i - 1][1], s[i][1], t), mix(s[i - 1][2], s[i][2], t), mix(s[i - 1][3], s[i][3], t)];
      }
    }
    var l = s[s.length - 1];
    return [l[1], l[2], l[3]];
  }

  /* ---------- weather recipes ---------- */
  // gray: pull toward neutral, dark: brightness multiplier, haze: mix toward mist,
  // clouds: count, size range, layout, opacity, shading; precip: particle density per px^2
  var WEATHER = {
    clear:        { gray: 0,    dark: 1,    haze: 0,    fog: 0,    clouds: { n: 4,  s: [0.08, 0.15], layout: 'edges', a: 0.96, shade: 0, soft: 0.42 } },
    partlycloudy: { gray: 0.04, dark: 1,    haze: 0,    fog: 0,    clouds: { n: 8,  s: [0.1, 0.2],   layout: 'edges', a: 0.97, shade: 0.03, soft: 0.4 } },
    overcast:     { gray: 0.55, dark: 0.9,  haze: 0.06, fog: 0.08, clouds: { n: 14, s: [0.16, 0.3],  layout: 'full',  a: 0.82, shade: 0.16, soft: 0.3 } },
    fog:          { gray: 0.5,  dark: 1,    haze: 0.45, fog: 0.75, clouds: { n: 12, s: [0.26, 0.42], layout: 'full',  a: 0.38, shade: 0.04, soft: 0.07 } },
    drizzle:      { gray: 0.45, dark: 0.84, haze: 0.08, fog: 0.12, clouds: { n: 12, s: [0.12, 0.24], layout: 'edges', a: 0.88, shade: 0.2, soft: 0.32 }, rain: 0.00007 },
    rain:         { gray: 0.55, dark: 0.66, haze: 0.05, fog: 0.15, clouds: { n: 14, s: [0.14, 0.28], layout: 'edges', a: 0.9, shade: 0.32, soft: 0.3 }, rain: 0.0002 },
    storm:        { gray: 0.6,  dark: 0.45, haze: 0.02, fog: 0.08, clouds: { n: 14, s: [0.16, 0.3],  layout: 'full',  a: 0.88, shade: 0.5, soft: 0.28 }, rain: 0.00026, lightning: true },
    snow:         { gray: 0.45, dark: 0.95, haze: 0.15, fog: 0.22, cool: 0.18, clouds: { n: 14, s: [0.12, 0.26], layout: 'edges', a: 0.86, shade: 0.14, soft: 0.3 }, snow: 0.00013 }
  };

  function daylight(alt) { return clamp((alt + 10) / 20, 0, 1); }

  function skyColors(alt, rising, cond) {
    var base = palette(alt, rising);
    var w = WEATHER[cond];
    var dl = daylight(alt);
    var haze = mix(hex('#283252'), hex('#e4e9ef'), dl);
    var cool = mix(hex('#1c2a4c'), hex('#d8e4f2'), dl);
    return base.map(function (c) {
      var g = lum(c);
      var out = mix(c, [g, g, g], w.gray);
      out = scale(out, w.dark);
      if (w.haze) out = mix(out, haze, w.haze);
      if (w.cool) out = mix(out, cool, w.cool);
      return out;
    });
  }

  function cloudColors(alt, rising, cond, sky) {
    var w = WEATHER[cond];
    var dl = daylight(alt);
    var warm = clamp(1 - (alt - 3) / 12, 0, 1) * dl;
    var white = [255, 255, 255];
    var dayLit = mix(white, sky[2], 0.06 + 0.5 * warm);
    var nightLit = mix(sky[0], hex('#8fa3cf'), 0.32);
    var warmLit = mix(white, sky[2], 0.55);              // pink and peach underlit clouds at twilight
    var lit = mix(nightLit, warmLit, clamp((alt + 12) / 8, 0, 1));
    lit = mix(lit, dayLit, clamp((alt - 3) / 10, 0, 1));
    var g = lum(lit);
    lit = mix(lit, [g, g, g], w.gray * 0.6);
    lit = scale(lit, 1 - w.clouds.shade * 0.55);
    var shade = mix(lit, sky[0], 0.3 + 0.25 * w.clouds.shade);
    shade = scale(shade, 1 - 0.25 * w.clouds.shade);
    return { lit: lit, shade: shade };
  }

  /* ---------- seeded random so layouts are stable ---------- */
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  /* ---------- clouds ---------- */
  function makeCloudSet(cond, W, H, seed) {
    var spec = WEATHER[cond].clouds;
    var r = rng(seed * 7919 + CONDITIONS.indexOf(cond) * 104729);
    var unit = Math.min(W, H * 1.7);
    var list = [], tries = 0;
    while (list.length < spec.n && tries < 400) {
      tries++;
      var cw = unit * (spec.s[0] + r() * (spec.s[1] - spec.s[0])) * 1.6;
      var x, y;
      if (spec.layout === 'edges') {
        var side = r() < 0.5;
        x = side ? (-0.08 + r() * 0.36) * W : (0.72 + r() * 0.36) * W;
        y = (0.02 + r() * 0.96) * H;
        if (r() < 0.15) { x = (0.2 + r() * 0.6) * W; y = (0.86 + r() * 0.14) * H; }
      } else {
        x = (-0.1 + r() * 1.2) * W;
        y = (-0.05 + r() * 1.05) * H;
      }
      var center = x > 0.3 * W && x < 0.7 * W && y < 0.8 * H;
      if (spec.layout === 'edges' && center) continue;
      // keep the title, subtitle and chips clear (top-left of the card)
      if (x + cw * 0.5 > 0 && x - cw * 0.5 < 0.64 * W && y - cw * 0.31 < 0.3 * H) continue;
      list.push({
        x: x - cw / 2, y: y - cw * 0.31, w: cw, h: cw * 0.62,
        a: spec.a * (center ? 0.55 : 1) * (0.82 + r() * 0.18),
        seed: Math.floor(r() * 1e9),
        sway: 6 + r() * 18, speed: 0.02 + r() * 0.05, phase: r() * 6.28,
        canvas: null, key: '', puffs: null
      });
    }
    list.sort(function (a, b) { return a.w - b.w; });
    return list;
  }

  // A cumulus is a cluster of puffs: a low row along a gently flat base, bigger
  // puffs stacked toward the middle. Shapes are in width units (canvas is 1 x 0.62).
  function cloudPuffs(seed) {
    var r = rng(seed), puffs = [], base = 0.5;
    var nb = 5 + Math.floor(r() * 3);
    for (var i = 0; i < nb; i++) {
      var t = (i + 0.5) / nb;
      var rad = 0.075 + 0.04 * Math.sin(Math.PI * t) + r() * 0.025;
      puffs.push([0.1 + 0.8 * t + (r() - 0.5) * 0.04, base - rad * 0.75, rad]);
    }
    var nu = 4 + Math.floor(r() * 4);
    for (var j = 0; j < nu; j++) {
      var u = 0.18 + r() * 0.64, dome = Math.sin(Math.PI * u);
      var rr = 0.07 + dome * 0.09 + r() * 0.03;
      puffs.push([u, base - 0.06 - dome * (0.08 + r() * 0.1) - rr * 0.35, rr]);
    }
    return puffs.map(function (p) { p[1] = Math.max(p[1], p[2] + 0.02); return p; });
  }

  function paintCloud(cl, colors, soft) {
    var key = colors.lit.map(Math.round).join() + colors.shade.map(Math.round).join() + soft;
    if (cl.key === key && cl.canvas) return;
    cl.key = key;
    if (!cl.puffs) cl.puffs = cloudPuffs(cl.seed);
    // Drawn small on purpose: upscaling gives the soft, painted edge.
    var w = Math.max(10, Math.ceil(cl.w * soft)), h = Math.max(7, Math.ceil(w * 0.62));
    var c = cl.canvas || document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#fff';
    cl.puffs.forEach(function (p) { x.beginPath(); x.arc(p[0] * w, p[1] * w, p[2] * w, 0, 6.2832); x.fill(); });
    x.globalCompositeOperation = 'source-atop';
    var g = x.createLinearGradient(0, 0.05 * w, 0, 0.52 * w);
    g.addColorStop(0, css(colors.lit));
    g.addColorStop(0.6, css(mix(colors.lit, colors.shade, 0.4)));
    g.addColorStop(1, css(colors.shade));
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    var hi = mix(colors.lit, [255, 255, 255], 0.3);
    cl.puffs.forEach(function (p) {
      var px = (p[0] - p[2] * 0.3) * w, py = (p[1] - p[2] * 0.4) * w, pr = p[2] * w;
      var rg = x.createRadialGradient(px, py, 0, px, py, pr * 1.05);
      rg.addColorStop(0, css(hi, 0.55));
      rg.addColorStop(1, css(hi, 0));
      x.fillStyle = rg; x.fillRect(px - pr * 1.1, py - pr * 1.1, pr * 2.2, pr * 2.2);
    });
    x.globalCompositeOperation = 'source-over';
    cl.canvas = c;
  }

  /* ---------- grain overlay ---------- */
  function grainURL() {
    var c = document.createElement('canvas'); c.width = c.height = 140;
    var x = c.getContext('2d'), d = x.createImageData(140, 140), r = rng(42);
    for (var i = 0; i < d.data.length; i += 4) {
      var v = 110 + r() * 145; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    return c.toDataURL();
  }

  /* ---------- the sky ---------- */
  function create(el, opts) {
    opts = opts || {};
    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var state = {
      lat: opts.lat != null ? opts.lat : 13.75,
      lon: opts.lon != null ? opts.lon : 100.5,
      date: opts.date || new Date(),
      weather: CONDITIONS.indexOf(opts.weather) >= 0 ? opts.weather : 'clear'
    };

    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    var grain = document.createElement('div');
    grain.setAttribute('aria-hidden', 'true');
    grain.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:.07;mix-blend-mode:overlay;background-image:url(' + grainURL() + ');';
    el.insertBefore(grain, el.firstChild);
    el.insertBefore(canvas, el.firstChild);
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';

    var W = 0, H = 0, dpr = 1;
    var cur = null, target = null;       // sky colors
    var layers = [];                     // [{cond, clouds, alpha, goal}]
    var stars = [];
    var drops = [], flakes = [];
    var fogAmt = 0, rainAmt = 0, snowAmt = 0;
    var flash = 0, bolt = null, nextBolt = 6;
    var last = 0, raf = 0, dirty = true, info = {};
    var seed = opts.seed || 7;

    function resize() {
      var r = el.getBoundingClientRect();
      dpr = Math.min(global.devicePixelRatio || 1, 1.5);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingQuality = 'high';
      layers.forEach(function (l) { l.clouds = makeCloudSet(l.cond, W, H, seed); });
      var r2 = rng(99); stars = [];
      var n = Math.round(W * H / 5200);
      for (var i = 0; i < n; i++) stars.push({ x: r2() * W, y: r2() * H * 0.85, r: r2() < 0.08 ? 1.4 : 0.5 + r2() * 0.7, tw: r2() * 6.28 });
      dirty = true;
    }

    function compute(instant) {
      var sp = sunPosition(state.date, state.lat, state.lon);
      info = { altitude: sp.altitude, rising: sp.rising, phase: phaseFor(sp.altitude, sp.rising), weather: state.weather };
      target = skyColors(sp.altitude, sp.rising, state.weather);
      if (!cur || instant || reduce) cur = target.map(function (c) { return c.slice(); });
      var top = layers[layers.length - 1];
      if (!top || top.cond !== state.weather) {
        layers.forEach(function (l) { l.goal = 0; });
        layers.push({ cond: state.weather, clouds: makeCloudSet(state.weather, W, H, seed), alpha: (instant || reduce || !top) ? 1 : 0, goal: 1 });
        if (instant || reduce) layers = [layers[layers.length - 1]];
      }
      if (instant || reduce) {
        var w = WEATHER[state.weather];
        fogAmt = w.fog; rainAmt = w.rain || 0; snowAmt = w.snow || 0;
      }
      dirty = true;
      kick();
    }

    function syncParticles(dt) {
      var w = WEATHER[state.weather];
      var k = reduce ? 1 : 1 - Math.exp(-dt * 1.2);
      rainAmt += ((w.rain || 0) - rainAmt) * k;
      snowAmt += ((w.snow || 0) - snowAmt) * k;
      fogAmt += (w.fog - fogAmt) * k;
      var area = W * H, r = Math.random;
      var wantRain = Math.round(rainAmt * area), wantSnow = Math.round(snowAmt * area);
      while (drops.length < wantRain) drops.push({ x: r() * (W + 200), y: r() * H, l: 9 + r() * 14, v: 0.75 + r() * 0.5, a: 0.5 + r() * 0.5 });
      if (drops.length > wantRain) drops.length = wantRain;
      while (flakes.length < wantSnow) flakes.push({ x: r() * W, y: r() * H, r: 0.8 + r() * 2.6, v: 0.6 + r() * 0.8, p: r() * 6.28 });
      if (flakes.length > wantSnow) flakes.length = wantSnow;
    }

    function makeBolt() {
      var x = W * (0.72 + Math.random() * 0.22), y = H * 0.06, pts = [[x, y]];
      var end = H * (0.22 + Math.random() * 0.12);
      while (y < end) { y += 10 + Math.random() * 16; x += (Math.random() - 0.5) * 22; pts.push([x, y]); }
      return { pts: pts, life: 0.32 };
    }

    function frame(t) {
      raf = 0;
      if (!visible) return;
      if (last && t - last < 30 && !dirty) { kick(); return; }
      var dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
      last = t;
      var time = t / 1000;
      var animating = false;

      // ease sky colors
      if (cur && target) {
        var k = 1 - Math.exp(-dt * 3.5), moving = 0;
        for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
          var d = target[i][j] - cur[i][j];
          cur[i][j] += d * k; moving = Math.max(moving, Math.abs(d));
        }
        if (moving > 0.5) animating = true;
      }
      // cross-fade cloud layers
      layers.forEach(function (l) {
        var d = l.goal - l.alpha;
        l.alpha += d * (1 - Math.exp(-dt * 2.2));
        if (Math.abs(d) > 0.01) animating = true;
      });
      layers = layers.filter(function (l) { return l.goal > 0 || l.alpha > 0.01; });
      syncParticles(dt);

      var alt = info.altitude, cond = state.weather, w = WEATHER[cond];

      // 1. gradient
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, css(cur[0])); g.addColorStop(0.55, css(cur[1])); g.addColorStop(1, css(cur[2]));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // 2. stars
      var starVis = clamp((-alt - 4) / 8, 0, 1) * (cond === 'clear' ? 1 : cond === 'partlycloudy' ? 0.75 : 0);
      if (starVis > 0.01) {
        ctx.fillStyle = '#fff';
        for (var s = 0; s < stars.length; s++) {
          var st = stars[s];
          ctx.globalAlpha = starVis * (reduce ? 0.8 : 0.55 + 0.45 * Math.sin(time * 1.3 + st.tw));
          ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.283); ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (!reduce) animating = true;
      }

      // 3. clouds
      layers.forEach(function (l) {
        var cc = cloudColors(alt, info.rising, l.cond, cur);
        l.clouds.forEach(function (cl) {
          paintCloud(cl, cc, WEATHER[l.cond].clouds.soft);
          var off = reduce ? 0 : Math.sin(time * cl.speed + cl.phase) * cl.sway;
          ctx.globalAlpha = cl.a * l.alpha;
          ctx.drawImage(cl.canvas, cl.x + off, cl.y, cl.w, cl.h);
        });
      });
      ctx.globalAlpha = 1;
      if (!reduce && layers.length) animating = true;

      // 4. rain / drizzle
      if (drops.length) {
        var night = 1 - daylight(alt);
        ctx.strokeStyle = css(mix([255, 255, 255], cur[2], 0.25), 0.28 - night * 0.08);
        ctx.lineWidth = cond === 'drizzle' ? 0.8 : 1.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        var speed = cond === 'drizzle' ? 320 : 640, sl = 0.22;
        for (var q = 0; q < drops.length; q++) {
          var p = drops[q];
          if (!reduce) { p.y += speed * p.v * dt; p.x -= speed * p.v * sl * dt; if (p.y > H + 20) { p.y = -20; p.x = Math.random() * (W + 200); } }
          var len = p.l * (cond === 'drizzle' ? 0.7 : 1);
          ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + len * sl, p.y - len);
        }
        ctx.stroke();
        if (!reduce) animating = true;
      }

      // 5. snow
      if (flakes.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (var f = 0; f < flakes.length; f++) {
          var fl = flakes[f];
          if (!reduce) { fl.y += 42 * fl.v * dt; fl.x += Math.sin(time * 0.9 + fl.p) * 14 * dt; if (fl.y > H + 6) { fl.y = -6; fl.x = Math.random() * W; } }
          ctx.globalAlpha = 0.5 + fl.r / 7;
          ctx.beginPath(); ctx.arc(fl.x, fl.y, fl.r, 0, 6.283); ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (!reduce) animating = true;
      }

      // 6. low mist
      if (fogAmt > 0.01) {
        var hz = mix(hex('#3a4566'), hex('#eef2f6'), daylight(alt));
        var fg = ctx.createLinearGradient(0, H * 0.15, 0, H);
        fg.addColorStop(0, css(hz, 0));
        fg.addColorStop(1, css(hz, fogAmt * 0.85));
        ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
      }

      // 7. lightning
      if (w.lightning && !reduce) {
        nextBolt -= dt;
        if (nextBolt <= 0) { bolt = makeBolt(); flash = 1; nextBolt = 9 + Math.random() * 12; }
        animating = true;
      }
      if (flash > 0.01) {
        ctx.fillStyle = 'rgba(225,232,255,' + (0.12 * flash) + ')';
        ctx.fillRect(0, 0, W, H);
        flash *= Math.exp(-dt * 9);
      }
      if (bolt && bolt.life > 0) {
        ctx.save();
        ctx.strokeStyle = '#ffe38a'; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(255,226,140,0.9)'; ctx.shadowBlur = 14;
        ctx.globalAlpha = clamp(bolt.life / 0.15, 0, 1);
        ctx.beginPath(); ctx.moveTo(bolt.pts[0][0], bolt.pts[0][1]);
        for (var b = 1; b < bolt.pts.length; b++) ctx.lineTo(bolt.pts[b][0], bolt.pts[b][1]);
        ctx.stroke(); ctx.restore();
        bolt.life -= dt;
      }

      dirty = false;
      if (animating) kick();
    }

    var visible = true;
    function kick() { if (!raf && visible) raf = global.requestAnimationFrame(frame); }
    var io = global.IntersectionObserver ? new IntersectionObserver(function (es) {
      var v = es[es.length - 1].isIntersecting;
      if (v && !visible) { visible = true; last = 0; kick(); } else if (!v) visible = false;
    }) : null;
    if (io) io.observe(el);

    var ro = global.ResizeObserver ? new ResizeObserver(function () { resize(); kick(); }) : null;
    if (ro) ro.observe(el); else global.addEventListener('resize', function () { resize(); kick(); });
    resize();
    compute(true);

    return {
      set: function (o) {
        var instant = !!(o && o.instant);
        if (o.date) state.date = o.date;
        if (o.lat != null) state.lat = o.lat;
        if (o.lon != null) state.lon = o.lon;
        if (o.weather && CONDITIONS.indexOf(o.weather) >= 0) state.weather = o.weather;
        compute(instant);
        return info;
      },
      info: function () { return info; },
      destroy: function () { if (ro) ro.disconnect(); if (io) io.disconnect(); if (raf) cancelAnimationFrame(raf); canvas.remove(); grain.remove(); }
    };
  }

  /* ---------- Open-Meteo weather_code to condition ---------- */
  function weatherFromCode(code) {
    if (code === 0 || code === 1) return 'clear';
    if (code === 2) return 'partlycloudy';
    if (code === 3) return 'overcast';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'clear';
  }

  /* ---------- colors only (for matching text and panels to the sky) ---------- */
  function colors(o) {
    var cond = CONDITIONS.indexOf(o.weather) >= 0 ? o.weather : 'clear';
    var sp = sunPosition(o.date || new Date(), o.lat != null ? o.lat : 13.75, o.lon != null ? o.lon : 100.5);
    var sky = skyColors(sp.altitude, sp.rising, cond);
    return { sky: sky, cloud: cloudColors(sp.altitude, sp.rising, cond, sky), phase: phaseFor(sp.altitude, sp.rising), altitude: sp.altitude, weather: cond };
  }

  global.Sky = { create: create, colors: colors, sunPosition: sunPosition, phaseFor: phaseFor, weatherFromCode: weatherFromCode, CONDITIONS: CONDITIONS };
})(window);
