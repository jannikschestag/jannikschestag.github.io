/* Interactive phylogenetic-network background.
   Replaces the static CSS-mask mesh with a canvas that scrolls with the page,
   matches the theme colour + faint side-weighted gradient, and gently repels
   nodes near the cursor (a soft "force field").

   Performance: the canvas is only viewport-sized and off-screen edges are
   culled, so cost is bounded by what's visible (~a few hundred segments). The
   animation loop runs ONLY while nodes are actually moving and stops the moment
   they settle, so an idle page spends no CPU. Disabled for reduced-motion and
   when the page has no JS (the static CSS mask stays as the fallback). */
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;                        // keep the static CSS background
  var canvas = document.createElement("canvas");
  if (!canvas.getContext) return;
  var ctx = canvas.getContext("2d");

  canvas.className = "network-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  document.body.classList.add("net-live");   // hides the static ::before mask

  // ---- tunables ----
  var CELL = 92, JIT = 28, CONNECT = 130;
  var MAX_DEG = 3;
  var REPEL = 105, REPEL_R2 = REPEL * REPEL, PUSH = 1.6, MIND = 18;
  var SPRING = 0.03, DAMP = 0.78, STROKE = 1.1, NODE_R = 1.8;

  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var vw = 0, vh = 0, nodes = [], edges = [];
  var mouse = { x: 0, y: 0, on: false };
  var running = false;

  function rnd(a) { return (Math.random() - 0.5) * 2 * a; }

    function build() {
        vw = window.innerWidth;
        vh = window.innerHeight;

        var docH = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight,
            vh
        );

        canvas.width = Math.round(vw * dpr);
        canvas.height = Math.round(vh * dpr);
        canvas.style.width = vw + "px";
        canvas.style.height = vh + "px";

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Slightly compressed vertically.
        // Together with alternating horizontal offsets, this produces
        // a loose hexagonal rather than square arrangement.
        var YSTEP = CELL * 0.82;

        var cols = Math.ceil(vw / CELL) + 3;
        var rows = Math.ceil(docH / YSTEP) + 2;

        var grid = [];
        nodes = [];

        // ---- Create vertices ----
        for (var j = 0; j < rows; j++) {
            grid[j] = [];

            for (var i = 0; i < cols; i++) {

                // Shift every second row.
                var shift = (j % 2) * CELL * 0.45;

                var bx = i * CELL + shift + rnd(JIT);
                var by = j * YSTEP + rnd(JIT);

                var n = {
                    bx: bx,
                    by: by,
                    x: bx,
                    y: by,
                    vx: 0,
                    vy: 0,
                    degree: 0
                };

                grid[j][i] = n;
                nodes.push(n);
            }
        }

        edges = [];

        var c2 = CONNECT * CONNECT;

        function link(a, b, probability) {

            if (!a || !b)
                return false;

            if (a.degree >= MAX_DEG || b.degree >= MAX_DEG)
                return false;

            if (Math.random() > probability)
                return false;

            var dx = a.bx - b.bx;
            var dy = a.by - b.by;

            if (dx * dx + dy * dy >= c2)
                return false;

            edges.push([a, b]);

            a.degree++;
            b.degree++;

            return true;
        }

        // ---- Create edges ----
        for (var jj = 0; jj < rows; jj++) {
            for (var ii = 0; ii < cols; ii++) {

                var a = grid[jj][ii];

                if (!grid[jj + 1])
                    continue;

                var below = grid[jj + 1];

                /*
                 * Because alternating rows are shifted, each vertex has
                 * two natural candidates in the next row.
                 */
                var diagonalIndex =
                    (jj % 2 === 0)
                        ? ii - 1
                        : ii + 1;

                var down1 = below[ii];
                var down2 = below[diagonalIndex];

                /*
                 * Randomly select which downward connection is the
                 * "main" one. This breaks the repetitive pattern.
                 */
                if (Math.random() < 0.5) {
                    var tmp = down1;
                    down1 = down2;
                    down2 = tmp;
                }

                // Usually continue downward.
                link(a, down1, 0.90);

                // Horizontal edges provide occasional cycles.
                link(a, grid[jj][ii + 1], 0.55);

                // Occasionally branch toward the other downward neighbour.
                link(a, down2, 0.18);
            }
        }
    }

  function step() {
    var active = false, has = mouse.on, mx = mouse.x, my = mouse.y;
    for (var k = 0; k < nodes.length; k++) {
      var n = nodes[k];
      var ax = (n.bx - n.x) * SPRING, ay = (n.by - n.y) * SPRING;
      if (has) {
        var dx = n.x - mx, dy = n.y - my, d2 = dx * dx + dy * dy;
        if (d2 < REPEL_R2) {
          var dd = Math.sqrt(d2), d = dd < MIND ? MIND : dd;
          var push = PUSH * (1 - dd / REPEL) / d;
          ax += dx * push; ay += dy * push;
        }
      }
      n.vx = (n.vx + ax) * DAMP; n.vy = (n.vy + ay) * DAMP;
      n.x += n.vx; n.y += n.vy;
      if (Math.abs(n.vx) > 0.05 || Math.abs(n.vy) > 0.05) active = true;
    }
    return active;
  }

  function render() {
    ctx.clearRect(0, 0, vw, vh);
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    var col = dark ? "150,200,230" : "74,143,168";
    var aSide = dark ? 0.20 : 0.17, aCtr = dark ? 0.09 : 0.07;
    var sy = window.scrollY || window.pageYOffset || 0;

    ctx.lineWidth = STROKE;
    ctx.lineCap = "round";
    for (var e = 0; e < edges.length; e++) {
      var a = edges[e][0], b = edges[e][1];
      var ay = a.y - sy, by = b.y - sy;
      if ((ay < -40 && by < -40) || (ay > vh + 40 && by > vh + 40)) continue;
      var mx = (a.x + b.x) / 2;
      var t = Math.abs(mx / vw - 0.5) * 2;
      var alpha = aCtr + (aSide - aCtr) * t;
      ctx.strokeStyle = "rgba(" + col + "," + alpha.toFixed(3) + ")";
      ctx.beginPath(); ctx.moveTo(a.x, ay); ctx.lineTo(b.x, by); ctx.stroke();
    }
    for (var m = 0; m < nodes.length; m++) {
      var n = nodes[m], ny = n.y - sy;
      if (ny < -10 || ny > vh + 10) continue;
      var tt = Math.abs(n.x / vw - 0.5) * 2;
      ctx.fillStyle = "rgba(" + col + "," + (aCtr + (aSide - aCtr) * tt + 0.05).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(n.x, ny, NODE_R, 0, 6.283); ctx.fill();
    }
  }

  function loop() {
    var active = step();
    render();
    if (active || mouse.on) requestAnimationFrame(loop);
    else running = false;
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(loop); } }

  window.addEventListener("mousemove", function (ev) {
    mouse.x = ev.clientX;
    mouse.y = ev.clientY + (window.scrollY || window.pageYOffset || 0);
    mouse.on = true;
    kick();
  }, { passive: true });
  document.addEventListener("mouseleave", function () { mouse.on = false; kick(); });

  window.addEventListener("scroll", function () { if (!running) render(); }, { passive: true });

  var rz;
  window.addEventListener("resize", function () {
    clearTimeout(rz);
    rz = setTimeout(function () { build(); render(); }, 200);
  });

  build();
  render();
})();
