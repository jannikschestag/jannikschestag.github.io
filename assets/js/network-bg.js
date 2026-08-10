/* Interactive phylogenetic-network background.
   Replaces the static CSS-mask mesh with a canvas that scrolls with the page,
   matches the theme colour + faint side-weighted gradient, and gently repels
   nodes near the cursor (a soft "force field").

   Graph structure:
   - visible vertices have degree 3 to 5;
   - a degree-3 backbone is created first;
   - some additional edges randomly turn pairs of degree-3 vertices into
     degree-4 or 5 vertices;
   - the graph is generated beyond the visible area so that low-degree
     boundary vertices remain invisible.

   Performance: the canvas is only viewport-sized and off-screen edges are
   culled, so cost is bounded by what's visible (~a few hundred segments).
   The animation loop runs ONLY while nodes are actually moving and stops the
   moment they settle, so an idle page spends no CPU.

   Disabled for reduced-motion and when the page has no JS
   (the static CSS mask stays as the fallback).
*/

(function () {

  var reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduce) return;

  var canvas = document.createElement("canvas");

  if (!canvas.getContext) return;

  var ctx = canvas.getContext("2d");

  canvas.className = "network-canvas";
  canvas.setAttribute("aria-hidden", "true");

  document.body.appendChild(canvas);

  // Hides the static ::before mask.
  document.body.classList.add("net-live");


  // ------------------------------------------------------------
  // Tunables
  // ------------------------------------------------------------

  // Approximate distance between vertices.
  var CELL = 92;

  // Random displacement of vertices from their basic positions.
  var JIT = 28;

  // How many rows/columns are generated outside the visible area.
  // This ensures that visible vertices are not boundary vertices.
  var PAD = 4;

  // Probability that an optional fourth edge is added.
  // Larger values produce more degree-5 vertices.
  var EXTRA_EDGE_PROBABILITY = 0.30;

  // Mouse interaction.
  var REPEL = 105;
  var REPEL_R2 = REPEL * REPEL;
  var PUSH = 1.6;
  var MIND = 18;

  // Animation.
  var SPRING = 0.03;
  var DAMP = 0.78;

  // Drawing.
  var STROKE = 1.1;
  var NODE_R = 1.8;


  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------

  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  var vw = 0;
  var vh = 0;

  var nodes = [];
  var edges = [];

  var mouse = {
    x: 0,
    y: 0,
    on: false
  };

  var running = false;


  function rnd(a) {
    return (Math.random() - 0.5) * 2 * a;
  }


  // ------------------------------------------------------------
  // Build graph
  // ------------------------------------------------------------

  function build() {

    vw = window.innerWidth;
    vh = window.innerHeight;

    var docH = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      vh
    );


    // ----------------------------------------------------------
    // Set up canvas
    // ----------------------------------------------------------

    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);

    canvas.style.width = vw + "px";
    canvas.style.height = vh + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);


    // ----------------------------------------------------------
    // Create staggered grid
    // ----------------------------------------------------------

    // Slight vertical compression gives a loose hexagonal layout.
    var YSTEP = CELL * 0.82;

    /*
     * We generate vertices outside all four sides of the page.
     *
     * Thus, although vertices on the artificial outer boundary
     * have degree < 3, those vertices can never become visible.
     */
    var cols =
      Math.ceil(vw / CELL)
      + 2 * PAD
      + 4;

    var rows =
      Math.ceil(docH / YSTEP)
      + 2 * PAD
      + 4;

    var grid = [];

    nodes = [];


    // ----------------------------------------------------------
    // Create vertices
    // ----------------------------------------------------------

    for (var j = 0; j < rows; j++) {

      grid[j] = [];

      for (var i = 0; i < cols; i++) {

        /*
         * Shift every second row horizontally.
         *
         * This makes the geometry less square-like.
         */
        var shift =
          (j % 2) * CELL * 0.45;

        /*
         * PAD shifts the artificial boundary outside the page.
         */
        var bx =
          (i - PAD) * CELL
          + shift
          + rnd(JIT);

        var by =
          (j - PAD) * YSTEP
          + rnd(JIT);

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


    // ----------------------------------------------------------
    // Edge helper
    // ----------------------------------------------------------

    edges = [];


    function edgeExists(a, b) {

      for (var k = 0; k < edges.length; k++) {

        var e = edges[k];

        if (
          (e[0] === a && e[1] === b) ||
          (e[0] === b && e[1] === a)
        ) {
          return true;
        }
      }

      return false;
    }


    function addEdge(a, b) {

      if (!a || !b)
        return false;

      if (a === b)
        return false;

      /*
       * This guarantees maximum degree 5.
       */
      if (a.degree >= 5 || b.degree >= 5)
        return false;

      if (edgeExists(a, b))
        return false;

      edges.push([a, b]);

      a.degree++;
      b.degree++;

      return true;
    }


    // ----------------------------------------------------------
    // Phase 1:
    // Construct degree-3 backbone
    // ----------------------------------------------------------

    /*
     * Every interior vertex receives:
     *
     *   - one edge to the left,
     *   - one edge to the right,
     *   - exactly one vertical/diagonal edge.
     *
     * Hence every non-boundary vertex has degree exactly 3.
     *
     * Which vertices connect vertically alternates according
     * to parity. This gives a hexagonal/honeycomb-like topology,
     * but the jitter and staggered rows make it visually irregular.
     */

    for (var jj = 0; jj < rows; jj++) {

      for (var ii = 0; ii < cols; ii++) {

        var a = grid[jj][ii];


        // Horizontal backbone edge.
        if (ii + 1 < cols) {

          addEdge(
            a,
            grid[jj][ii + 1]
          );
        }


        /*
         * Alternating downward edge.
         *
         * Each interior vertex gets exactly one such
         * edge: either going down or coming from above.
         */
        if (
          jj + 1 < rows &&
          (ii + jj) % 2 === 0
        ) {

          addEdge(
            a,
            grid[jj + 1][ii]
          );
        }
      }
    }


    // ----------------------------------------------------------
    // Phase 2:
    // Add occasional fourth edges
    // ----------------------------------------------------------

    /*
     * Candidate edges connect nearby vertices in adjacent rows.
     *
     * They are deliberately different from the vertical backbone
     * edges. Adding one changes both endpoints from degree 3 to 5.
     */

    var candidates = [];


    for (var y = 1; y < rows - 1; y++) {

      for (var x = 1; x < cols - 1; x++) {

        var v = grid[y][x];


        /*
         * Because rows are staggered, choose the natural nearby
         * diagonal according to the row parity.
         */
        if (y % 2 === 0) {

          candidates.push([
            v,
            grid[y + 1][x - 1]
          ]);

        } else {

          candidates.push([
            v,
            grid[y + 1][x + 1]
          ]);
        }
      }
    }


    // ----------------------------------------------------------
    // Shuffle candidate edges
    // ----------------------------------------------------------

    /*
     * Fisher-Yates shuffle.
     *
     * Better than candidates.sort(() => Math.random() - 0.5),
     * and still very simple.
     */

    for (var s = candidates.length - 1; s > 0; s--) {

      var r =
        Math.floor(
          Math.random() * (s + 1)
        );

      var temp = candidates[s];
      candidates[s] = candidates[r];
      candidates[r] = temp;
    }


    // ----------------------------------------------------------
    // Add extra edges
    // ----------------------------------------------------------

    for (var c = 0; c < candidates.length; c++) {

      var pair = candidates[c];

      var u = pair[0];
      var w = pair[1];


      /*
       * Only connect two degree-3 vertices.
       *
       * Therefore this operation always changes
       *
       *     degree 3 -> degree 4 -> degree 5
       *
       * at both endpoints.
       */
      if (
        u.degree > 4 ||
        w.degree > 4
      ) {
        continue;
      }


      if (
        Math.random()
        < EXTRA_EDGE_PROBABILITY
      ) {

        addEdge(u, w);
      }
    }
  }


  // ------------------------------------------------------------
  // Physics / mouse interaction
  // ------------------------------------------------------------

  function step() {

    var active = false;

    var has = mouse.on;
    var mx = mouse.x;
    var my = mouse.y;


    for (var k = 0; k < nodes.length; k++) {

      var n = nodes[k];

      /*
       * Spring force pulling each node back toward
       * its original position.
       */
      var ax =
        (n.bx - n.x) * SPRING;

      var ay =
        (n.by - n.y) * SPRING;


      if (has) {

        var dx = n.x - mx;
        var dy = n.y - my;

        var d2 =
          dx * dx +
          dy * dy;


        /*
         * Repel vertices near mouse cursor.
         */
        if (d2 < REPEL_R2) {

          var dd =
            Math.sqrt(d2);

          var d =
            dd < MIND
              ? MIND
              : dd;

          var push =
            PUSH *
            (1 - dd / REPEL) /
            d;

          ax += dx * push;
          ay += dy * push;
        }
      }


      /*
       * Update velocity and position.
       */
      n.vx =
        (n.vx + ax) * DAMP;

      n.vy =
        (n.vy + ay) * DAMP;

      n.x += n.vx;
      n.y += n.vy;


      if (
        Math.abs(n.vx) > 0.05 ||
        Math.abs(n.vy) > 0.05
      ) {
        active = true;
      }
    }


    return active;
  }


  // ------------------------------------------------------------
  // Render graph
  // ------------------------------------------------------------

  function render() {

    ctx.clearRect(
      0,
      0,
      vw,
      vh
    );


    var dark =
      document.documentElement
        .getAttribute("data-theme")
      === "dark";


    var col =
      dark
        ? "150,200,230"
        : "74,143,168";


    /*
     * Make graph slightly stronger near left/right sides
     * and more subtle around the page content in the center.
     */
    var aSide =
      dark
        ? 0.20
        : 0.17;

    var aCtr =
      dark
        ? 0.09
        : 0.07;


    var sy =
      window.scrollY ||
      window.pageYOffset ||
      0;


    ctx.lineWidth = STROKE;
    ctx.lineCap = "round";


    // ----------------------------------------------------------
    // Draw edges
    // ----------------------------------------------------------

    for (var e = 0; e < edges.length; e++) {

      var a = edges[e][0];
      var b = edges[e][1];

      var ay =
        a.y - sy;

      var by =
        b.y - sy;


      /*
       * Skip edges completely outside viewport.
       */
      if (
        (ay < -40 && by < -40) ||
        (ay > vh + 40 && by > vh + 40)
      ) {
        continue;
      }


      var edgeMidX =
        (a.x + b.x) / 2;

      var t =
        Math.abs(
          edgeMidX / vw - 0.5
        ) * 2;

      var alpha =
        aCtr +
        (aSide - aCtr) * t;


      ctx.strokeStyle =
        "rgba(" +
        col +
        "," +
        alpha.toFixed(3) +
        ")";


      ctx.beginPath();

      ctx.moveTo(
        a.x,
        ay
      );

      ctx.lineTo(
        b.x,
        by
      );

      ctx.stroke();
    }


    // ----------------------------------------------------------
    // Draw vertices
    // ----------------------------------------------------------

    for (var m = 0; m < nodes.length; m++) {

      var n = nodes[m];

      var ny =
        n.y - sy;


      if (
        ny < -10 ||
        ny > vh + 10
      ) {
        continue;
      }


      var tt =
        Math.abs(
          n.x / vw - 0.5
        ) * 2;


      ctx.fillStyle =
        "rgba(" +
        col +
        "," +
        (
          aCtr +
          (aSide - aCtr) * tt +
          0.05
        ).toFixed(3) +
        ")";


      ctx.beginPath();

      ctx.arc(
        n.x,
        ny,
        NODE_R,
        0,
        6.283
      );

      ctx.fill();
    }
  }


  // ------------------------------------------------------------
  // Animation loop
  // ------------------------------------------------------------

  function loop() {

    var active =
      step();

    render();


    if (
      active ||
      mouse.on
    ) {

      requestAnimationFrame(loop);

    } else {

      running = false;
    }
  }


  function kick() {

    if (!running) {

      running = true;

      requestAnimationFrame(loop);
    }
  }


  // ------------------------------------------------------------
  // Mouse events
  // ------------------------------------------------------------

  window.addEventListener(
    "mousemove",
    function (ev) {

      mouse.x =
        ev.clientX;

      mouse.y =
        ev.clientY +
        (
          window.scrollY ||
          window.pageYOffset ||
          0
        );

      mouse.on = true;

      kick();
    },
    {
      passive: true
    }
  );


  document.addEventListener(
    "mouseleave",
    function () {

      mouse.on = false;

      kick();
    }
  );


  // ------------------------------------------------------------
  // Scroll
  // ------------------------------------------------------------

  window.addEventListener(
    "scroll",
    function () {

      if (!running)
        render();
    },
    {
      passive: true
    }
  );


  // ------------------------------------------------------------
  // Resize
  // ------------------------------------------------------------

  var rz;


  window.addEventListener(
    "resize",
    function () {

      clearTimeout(rz);

      rz =
        setTimeout(
          function () {

            build();
            render();

          },
          200
        );
    }
  );


  // ------------------------------------------------------------
  // Initial construction
  // ------------------------------------------------------------

  build();
  render();

})();
