function toggleDetail(id) {
  const detail = document.getElementById(id);
  if (!detail) return;
  const isOpen = detail.style.display === "block";
  detail.style.display = isOpen ? "none" : "block";
  const card = detail.closest(".software-box");
  if (card) {
    card.classList.toggle("expanded", !isOpen);
  }
}

function toggleBox(id) {
  document.querySelectorAll(".abstract-box, .bibtex").forEach((box) => {
    if (box.id !== id) {
      box.classList.add("noshow");
    }
  });

  const box = document.getElementById(id);
  if (box) {
    box.classList.toggle("noshow");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".bibtex").forEach((bib) => {
    if (bib.querySelector(".copy-btn")) return;

    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "📋";
    btn.onclick = () => {
      const pre = bib.querySelector("pre");
      if (!pre) return;
      navigator.clipboard.writeText(pre.innerText).then(() => {
        btn.textContent = "✔️";
        setTimeout(() => {
          btn.textContent = "📋";
        }, 1500);
      });
    };

    bib.appendChild(btn);
  });
});
