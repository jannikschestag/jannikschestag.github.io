/* Animated phylogenetic-network hero background.
   Draws a small semi-directed network into a canvas behind the homepage title:
   the tree edges are faint white, the nodes drift gently, and the reticulation
   (two lineages merging) is a coral edge-pair that softly pulses — on brand for
   phylogenetic networks. With prefers-reduced-motion the network is drawn once,
   static. Progressive enhancement: without JS the hero is just its gradient. */
(function () {
  var hero = document.querySelector(".page-hero");
  if (!hero) return;

  var canvas = document.createElement("canvas");
  canvas.className = "hero-network";
  canvas.setAttribute("aria-hidden", "true");
  hero.insertBefore(canvas, hero.firstChild);
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Network topology in normalized [0,1] coordinates (x →, y ↓).
  // A semi-directed network with no suppressible (degree-2) nodes: every leaf
  // (L*) has degree 1, every internal node has degree 3, and the reticulation
  // (ret) has two parents p, q — the coral edges — that form a 4-cycle with mC.
  var N = {
    m0: [0.5, 0.1], mL: [0.26, 0.32], mR: [0.74, 0.32], mC: [0.5, 0.34],
    p: [0.4, 0.57], q: [0.6, 0.57], ret: [0.5, 0.75],
    L1: [0.1, 0.55], L2: [0.28, 0.58], L3: [0.72, 0.58], L4: [0.9, 0.55],
    Lp: [0.3, 0.75], Lq: [0.7, 0.75], Lr: [0.5, 0.95]
  };
  var TREE = [
    ["m0", "mL"], ["m0", "mR"], ["m0", "mC"],
    ["mL", "L1"], ["mL", "L2"], ["mR", "L3"], ["mR", "L4"],
    ["mC", "p"], ["mC", "q"], ["p", "Lp"], ["q", "Lq"], ["ret", "Lr"]
  ];
  var RETIC = [["p", "ret"], ["q", "ret"]];

  // Give each node its own gentle drift (phase + frequency + amplitude).
  var keys = Object.keys(N);
  var drift = {};
  keys.forEach(function (k, i) {
    var leaf = k.charAt(0) === "L";                  // leaves drift a touch more
    drift[k] = {
      base: N[k],
      ax: (leaf ? 0.014 : 0.008) * (0.7 + (i % 5) / 8),
      ay: (leaf ? 0.010 : 0.006) * (0.7 + (i % 3) / 6),
      px: (i * 1.7) % 6.283, py: (i * 2.9) % 6.283,
      fx: 0.25 + (i % 4) * 0.05, fy: 0.19 + (i % 5) * 0.04
    };
  });

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    W = hero.clientWidth; H = hero.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduce) draw(0);
  }

  function pos(k, t) {
    var d = drift[k];
    return [
      (d.base[0] + d.ax * Math.sin(t * d.fx + d.px)) * W,
      (d.base[1] + d.ay * Math.sin(t * d.fy + d.py)) * H
    ];
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);

    // Tree edges — faint white.
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    TREE.forEach(function (e) {
      var p = pos(e[0], t), q = pos(e[1], t);
      ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
    });
    ctx.stroke();

    // Reticulation edges — coral, softly pulsing.
    var pulse = 0.5 + 0.5 * Math.sin(t * 1.1);
    ctx.strokeStyle = "rgba(239,111,83," + (0.35 + 0.5 * pulse).toFixed(3) + ")";
    ctx.lineWidth = 1.6 + 1.4 * pulse;
    ctx.beginPath();
    RETIC.forEach(function (e) {
      var p = pos(e[0], t), q = pos(e[1], t);
      ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
    });
    ctx.stroke();

    // Nodes.
    keys.forEach(function (k) {
      var p = pos(k, t);
      var leaf = k.charAt(0) === "L";
      if (k === "ret") {
        ctx.fillStyle = "rgba(239,111,83," + (0.6 + 0.35 * pulse).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(p[0], p[1], 3.4 + pulse, 0, 6.283); ctx.fill();
      } else {
        ctx.fillStyle = leaf ? "rgba(255,255,255,0.62)" : "rgba(255,255,255,0.42)";
        ctx.beginPath(); ctx.arc(p[0], p[1], leaf ? 2.6 : 3.1, 0, 6.283); ctx.fill();
      }
    });
  }

  var start = null;
  function frame(ts) {
    if (start === null) start = ts;
    draw((ts - start) / 1000);
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  if (!reduce) requestAnimationFrame(frame);
})();
