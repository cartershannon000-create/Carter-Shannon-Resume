const map = document.querySelector(".workflow-map");
const arrowLayer = document.querySelector(".flow-arrows");
const cards = Array.from(document.querySelectorAll(".agent-card"));
const bridges = Array.from(document.querySelectorAll(".tool-bridge"));
const inspectorEmpty = document.querySelector(".inspector-empty");
const inspectorContent = document.querySelector(".inspector-content");
const detailKicker = document.querySelector("#detail-kicker");
const detailTitle = document.querySelector("#detail-title");
const detailSubtitle = document.querySelector("#detail-subtitle");
const detailPlain = document.querySelector("#detail-plain");
const detailBody = document.querySelector("#detail-body");
const detailLinks = document.querySelector("#detail-links");
const viewButtons = Array.from(document.querySelectorAll(".view-toggle button"));
const viewSections = Array.from(document.querySelectorAll("[data-show-view]"));

function setView(view) {
  viewButtons.forEach((button) => {
    const isActive = button.dataset.viewTarget === view;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  viewSections.forEach((section) => {
    section.hidden = section.dataset.showView !== view;
  });
  if (view === "map") scheduleDraw();
}

viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setView(button.dataset.viewTarget);
    history.replaceState(null, "", button.dataset.viewTarget === "story" ? "#story" : "#map");
  });
});

if (location.hash === "#story") setView("story");

const connections = [
  ["human", "orchestrator", "Brief becomes mission control"],
  ["orchestrator", "human", "Scope and approvals return to human"],
  ["orchestrator", "deterministic", "Dispatch repeatable work"],
  ["orchestrator", "decision", "Dispatch judgment work"],
  ["orchestrator", "review", "Request independent critique"],
  ["review", "revise", "Critic to fixer loop"],
  ["revise", "orchestrator", "Targeted fixes return"],
  ["orchestrator", "output", "Approved artifact ships"],
];

const cardById = new Map(cards.map((card) => [card.dataset.node, card]));

function connectedIds(nodeId) {
  const ids = new Set([nodeId]);
  connections.forEach(([from, to]) => {
    if (from === nodeId) ids.add(to);
    if (to === nodeId) ids.add(from);
    if (nodeId === "orchestrator") {
      ids.add(from);
      ids.add(to);
    }
  });
  return ids;
}

function connectionIndexes(nodeId) {
  const indexes = new Set();
  connections.forEach(([from, to], index) => {
    if (nodeId === "orchestrator" || from === nodeId || to === nodeId) {
      indexes.add(String(index));
    }
  });
  return indexes;
}

function setInspector(kicker, title, body, links, subtitle = "", plain = "") {
  inspectorEmpty.hidden = true;
  inspectorContent.hidden = false;
  detailKicker.textContent = kicker;
  detailTitle.textContent = title;
  detailSubtitle.textContent = subtitle;
  detailSubtitle.hidden = !subtitle;
  detailPlain.textContent = plain;
  detailPlain.hidden = !plain;
  document.querySelector(".detail-depth-label").hidden = !plain;
  detailBody.textContent = body;
  detailLinks.innerHTML = "";

  links.forEach((link) => {
    const item = document.createElement("span");
    item.textContent = link;
    detailLinks.appendChild(item);
  });
}

function activateCard(card) {
  const nodeId = card.dataset.node;
  const related = connectedIds(nodeId);
  const activeLines = connectionIndexes(nodeId);

  cards.forEach((item) => {
    item.classList.toggle("is-active", item === card);
    item.classList.toggle("is-related", item !== card && related.has(item.dataset.node));
    item.classList.toggle("is-muted", !related.has(item.dataset.node));
  });

  arrowLayer.querySelectorAll(".flow-path").forEach((path) => {
    const isActive = activeLines.has(path.dataset.connection);
    path.classList.toggle("is-active", isActive);
    path.classList.toggle("is-muted", !isActive);
  });

  const links = [...related]
    .filter((id) => id !== nodeId)
    .map((id) => cardById.get(id)?.dataset.title)
    .filter(Boolean);

  setInspector(
    card.dataset.kicker,
    card.dataset.title,
    card.dataset.body,
    links,
    card.dataset.subtitle,
    card.dataset.plain,
  );
}

function activateConnection(index) {
  const [from, to, label] = connections[index];
  const fromCard = cardById.get(from);
  const toCard = cardById.get(to);

  cards.forEach((card) => {
    const isEndpoint = card === fromCard || card === toCard;
    card.classList.toggle("is-active", false);
    card.classList.toggle("is-related", isEndpoint);
    card.classList.toggle("is-muted", !isEndpoint);
  });

  arrowLayer.querySelectorAll(".flow-path").forEach((path) => {
    const isActive = path.dataset.connection === String(index);
    path.classList.toggle("is-active", isActive);
    path.classList.toggle("is-muted", !isActive);
  });

  setInspector(
    "Relationship",
    label,
    `${fromCard.dataset.title} connects to ${toCard.dataset.title}. This relationship shows what the orchestrator is moving, delegating, reviewing, or returning.`,
    [fromCard.dataset.title, toCard.dataset.title],
  );
}

function pointFor(card, side) {
  const mapRect = map.getBoundingClientRect();
  const rect = card.getBoundingClientRect();
  const x = side === "left"
    ? rect.left - mapRect.left
    : side === "right"
      ? rect.right - mapRect.left
      : rect.left - mapRect.left + rect.width / 2;
  const y = side === "top"
    ? rect.top - mapRect.top
    : side === "bottom"
      ? rect.bottom - mapRect.top
      : rect.top - mapRect.top + rect.height / 2;
  return { x, y };
}

function pathBetween(fromCard, toCard) {
  const fromRect = fromCard.getBoundingClientRect();
  const toRect = toCard.getBoundingClientRect();
  const horizontal = Math.abs(fromRect.top - toRect.top) < 80;

  if (horizontal) {
    const leftToRight = fromRect.left <= toRect.left;
    const from = pointFor(fromCard, leftToRight ? "right" : "left");
    const to = pointFor(toCard, leftToRight ? "left" : "right");
    const midpoint = from.x + (to.x - from.x) * 0.5;
    return `M ${from.x} ${from.y} C ${midpoint} ${from.y}, ${midpoint} ${to.y}, ${to.x} ${to.y}`;
  }

  const down = fromRect.top <= toRect.top;
  const from = pointFor(fromCard, down ? "bottom" : "top");
  const to = pointFor(toCard, down ? "top" : "bottom");
  const midpoint = from.y + (to.y - from.y) * 0.5;
  return `M ${from.x} ${from.y} C ${from.x} ${midpoint}, ${to.x} ${midpoint}, ${to.x} ${to.y}`;
}

function drawArrows() {
  const { width, height } = map.getBoundingClientRect();
  if (!width || !height || getComputedStyle(arrowLayer).display === "none") return;

  arrowLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
  arrowLayer.innerHTML = `
    <defs>
      <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(46, 107, 63, 0.82)"></path>
      </marker>
    </defs>
  `;

  connections.forEach(([from, to, label], index) => {
    const fromCard = cardById.get(from);
    const toCard = cardById.get(to);
    if (!fromCard || !toCard) return;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathBetween(fromCard, toCard));
    path.setAttribute("class", "flow-path");
    path.setAttribute("marker-end", "url(#arrowhead)");
    path.dataset.connection = String(index);
    path.dataset.label = label;
    path.addEventListener("mouseenter", () => activateConnection(index));
    path.addEventListener("click", () => activateConnection(index));
    arrowLayer.appendChild(path);
  });
}

let drawFrame = null;

function scheduleDraw() {
  if (drawFrame) cancelAnimationFrame(drawFrame);
  drawFrame = requestAnimationFrame(() => {
    drawFrame = requestAnimationFrame(drawArrows);
  });
}

cards.forEach((card) => {
  card.addEventListener("mouseenter", () => activateCard(card));
  card.addEventListener("focus", () => activateCard(card));
  card.addEventListener("click", () => activateCard(card));
});

bridges.forEach((bridge) => {
  const card = cardById.get(bridge.dataset.relatedNode);
  if (!card) return;

  const activateBridge = () => {
    bridges.forEach((item) => item.classList.toggle("is-active", item === bridge));
    activateCard(card);
  };

  bridge.addEventListener("mouseenter", activateBridge);
  bridge.addEventListener("focus", activateBridge);
  bridge.addEventListener("click", activateBridge);
});

window.addEventListener("resize", scheduleDraw);
window.addEventListener("load", scheduleDraw);

if ("ResizeObserver" in window) {
  const resizeObserver = new ResizeObserver(scheduleDraw);
  resizeObserver.observe(map);
  cards.forEach((card) => resizeObserver.observe(card));
}

if (document.fonts) {
  document.fonts.ready.then(scheduleDraw);
}

scheduleDraw();
