/* =========================================================
   Casa Nova — app
   Dois ecrãs: Casa (resumo + divisões ou lista de itens)
   e Divisão (itens de uma divisão). Dados em js/store.js,
   ícones em js/icons.js.
   ========================================================= */
"use strict";

/* ---------- 1. Utilitários ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const PRIOS = { E: "Essencial", I: "Importante", D: "Pode esperar" };
const PRIO_ORDER = { E: 0, I: 1, D: 2 };
const ESTADOS = ["Por comprar", "Comprado", "Feito"];
const NEW_ROOM = "__nova__";
const XLSX_SRC = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const SUPABASE_SRC = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

function eur(value) {
  const n = Math.round((Number(value) || 0) * 100) / 100;
  const digits = Number.isInteger(n) ? 0 : 2;
  return n.toLocaleString("pt-PT", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " €";
}

/* Aceita "1500", "1 500", "1.500", "22,5" ou "22.50 €". Vazio dá null; inválido dá NaN. */
function parseMoney(value) {
  let s = String(value ?? "").replace(/[\s  €]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}
const moneyField = n => (n == null ? "" : String(n).replace(".", ","));

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fold = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function safeUrl(value) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return /^https?:$/.test(url.protocol) && url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}
let xlsxLoading = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  xlsxLoading ??= loadScript(XLSX_SRC).catch(err => {
    xlsxLoading = null;
    throw err;
  });
  return xlsxLoading;
}

function errMsg(err) {
  if (err?.code === "42501") return "Não tens permissão para alterar esta lista.";
  if (!navigator.onLine) return "Sem internet. Tenta outra vez quando tiveres rede.";
  return "Não foi possível guardar. Tenta outra vez.";
}

/* ---------- 2. Estado e contas ---------- */

const ui = {
  route: { name: "home" }, // ou { name: "room", room: "Cozinha" }
  filter: "rooms", // rooms | todo | essential | done | all
  query: "",
  hideDone: saved.get("casa.ocultarComprados", false),
  lastRoom: null,
  fromHome: false,
  homeScroll: 0,
};
let user = null;
let theme = readTheme();

const FILTERS = {
  todo: { title: "Por comprar", test: it => it.estado === 0 },
  essential: { title: "Essenciais em falta", test: it => it.estado === 0 && it.prio === "E" },
  done: { title: "Já comprados", test: it => it.estado !== 0 },
  all: { title: "Todos os itens", test: () => true },
};

const previsto = it => it.preco * it.qtd;
const custo = it => (it.estado !== 0 && it.preco_pago != null ? it.preco_pago : previsto(it));

function sumUp(list) {
  const s = { n: list.length, nFalta: 0, gasto: 0, falta: 0, total: 0 };
  for (const it of list) {
    if (it.estado === 0) {
      s.nFalta++;
      s.falta += custo(it);
    } else {
      s.gasto += custo(it);
    }
  }
  s.total = s.gasto + s.falta;
  return s;
}
const progress = s => (s.total > 0 ? s.gasto / s.total : s.n ? (s.n - s.nFalta) / s.n : 0);

function roomNames() {
  const names = Store.cfg.divisoes.slice();
  for (const it of Store.items) if (!names.includes(it.divisao)) names.push(it.divisao);
  return names;
}
const itemsIn = room => Store.items.filter(it => it.divisao === room);
const findRoom = name => roomNames().find(room => fold(room) === fold(name));
const byPriority = (a, b) => PRIO_ORDER[a.prio] - PRIO_ORDER[b.prio] || a.nome.localeCompare(b.nome, "pt");
const byStatus = (a, b) => a.estado - b.estado || byPriority(a, b);
const activeFilter = () => (ui.query.trim() && ui.filter === "rooms" ? "all" : ui.filter);
const roomHref = name => "#/d/" + encodeURIComponent(name);

/* ---------- 3. Desenhar os ecrãs ---------- */

function render() {
  if (ui.route.name === "room") renderRoom();
  else renderHome();
}

function renderHome() {
  const s = sumUp(Store.items);
  $("#homeSub").textContent = !s.n
    ? ""
    : s.nFalta
      ? `Faltam ${plural(s.nFalta, "coisa", "coisas")} para a casa ficar completa.`
      : "Está tudo comprado. Parabéns pela casa nova!";
  $("#homeSub").hidden = !s.n;
  $("#hero").innerHTML = heroHTML(s);

  const view = activeFilter();
  for (const chip of $$("#chips .chip")) {
    chip.setAttribute("aria-pressed", String(chip.dataset.f === view));
    const count = $(".count", chip);
    if (count) count.textContent = Store.items.filter(FILTERS[chip.dataset.f].test).length;
  }
  $("#qClear").hidden = !ui.query;
  $("#homeContent").innerHTML = view === "rooms" ? roomsHTML() : listHTML(view);
}

function heroHTML(s) {
  const orc = Number(Store.cfg.orcamento) || 0;
  const over = orc > 0 && s.total > orc;
  const scale = Math.max(s.total, orc) || 1;
  const pct = s.n ? Math.round(((s.n - s.nFalta) / s.n) * 100) : 0;
  const budget = orc
    ? `<button class="hero-stat budget-btn" type="button" data-action="budget" aria-label="Mudar orçamento">
         <span class="eyebrow">Orçamento ${icon("pencil")}</span><b class="num">${eur(orc)}</b>
       </button>
       <div class="hero-stat hero-stat--end${over ? " warn" : " ok"}">
         <span class="eyebrow">${over ? "Acima do orçamento" : "Ainda sobram"}</span><b class="num">${eur(Math.abs(orc - s.total))}</b>
       </div>`
    : `<button class="budget-pill" type="button" data-action="budget">${icon("pencil")}Definir orçamento</button>`;

  return `
    <div class="hero-top">
      <div>
        <p class="eyebrow">Já gasto</p>
        <p class="hero-amount num">${eur(s.gasto)}</p>
        <p class="hero-sub">${s.n ? `de <b class="num">${eur(s.total)}</b> previstos` : "Adiciona o primeiro item para começar a contar."}</p>
      </div>
      <div class="ring" role="img" aria-label="${pct}% dos itens já comprados">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle class="ring-track" cx="32" cy="32" r="27"/>
          ${pct ? `<circle class="ring-fill" cx="32" cy="32" r="27" pathLength="100" stroke-dasharray="${pct} 100"/>` : ""}
        </svg>
        <span class="ring-label"><b class="num">${pct}%</b><small>itens</small></span>
      </div>
    </div>
    ${s.n ? `
    <div class="meter" aria-hidden="true">
      <div class="meter-bar">
        <i class="seg-gasto" style="width:${(s.gasto / scale) * 100}%"></i>
        <i class="seg-falta" style="width:${(s.falta / scale) * 100}%"></i>
      </div>
      ${over ? `<span class="meter-mark" style="left:${(orc / scale) * 100}%"></span>` : ""}
    </div>
    <div class="legend">
      <span><i class="sw sw-gasto"></i>Gasto <b class="num">${eur(s.gasto)}</b></span>
      <span><i class="sw sw-falta"></i>Falta comprar <b class="num">${eur(s.falta)}</b></span>
      ${over ? `<span><i class="sw sw-orc"></i>Orçamento</span>` : ""}
    </div>` : ""}
    <div class="hero-foot">${budget}</div>`;
}

function roomsHTML() {
  const rooms = roomNames();
  const starter = Store.items.length ? "" : `
    <div class="starter">
      <span class="room-icon tint-clay">${icon("sparkles")}</span>
      <div>
        <h3>Por onde começar?</h3>
        <p>Carregar no botão Usar Sugestões para importar itens sugeridos.</p>
      </div>
      <button class="btn btn-primary" type="button" data-action="starter">Usar Sugestões</button>
    </div>`;
  return `${starter}
    <div class="section-head"><h2>Divisões</h2><span class="num">${rooms.length}</span></div>
    <div class="rooms">
      ${rooms.map(roomCardHTML).join("")}
      <button class="room-card room-card--add" type="button" data-action="add-room">
        <span class="plus">${icon("plus")}</span><span>Nova divisão</span>
      </button>
    </div>`;
}

function roomCardHTML(name) {
  const s = sumUp(itemsIn(name));
  const st = roomStyle(name);
  const status = !s.n
    ? "Ainda vazia"
    : `${plural(s.n, "item", "itens")} · ${s.nFalta ? `<span class="status-todo">${s.nFalta} em falta</span>` : `<span class="status-done">completa</span>`}`;
  return `
    <a class="room-card tint-${st.tint}" href="${roomHref(name)}">
      <span class="room-icon">${icon(st.icon)}</span>
      <span>
        <span class="room-card-name">${esc(name)}</span>
        <span class="room-card-sub">${status}</span>
      </span>
      ${s.n ? `
      <span class="room-card-foot">
        <b class="num">${s.total ? eur(s.total) : "Sem preços"}</b>
        <span class="track"><i style="width:${progress(s) * 100}%"></i></span>
      </span>` : `<span class="room-card-foot room-card-hint">${icon("plus")}Adicionar itens</span>`}
    </a>`;
}

function listHTML(filterKey) {
  const filter = FILTERS[filterKey];
  const q = fold(ui.query.trim());
  const matches = it => filter.test(it) && (!q || fold(`${it.nome} ${it.categoria} ${it.notas} ${it.divisao}`).includes(q));
  const groups = roomNames()
    .map(room => ({ room, items: itemsIn(room).filter(matches).sort(byStatus) }))
    .filter(g => g.items.length);
  if (!groups.length) return emptyListHTML(filterKey, q);

  const all = groups.flatMap(g => g.items);
  const total = all.reduce((sum, it) => sum + custo(it), 0);
  return `
    <div class="section-head">
      <h2>${q ? "Resultados" : filter.title}</h2>
      <span class="num">${plural(all.length, "item", "itens")}${total ? ` · ${eur(total)}` : ""}</span>
    </div>
    <div class="groups">
      ${groups.map(g => {
        const st = roomStyle(g.room);
        return `
          <section class="group">
            <a class="group-head tint-${st.tint}" href="${roomHref(g.room)}">
              <span class="group-room"><span class="room-icon sm">${icon(st.icon)}</span>${esc(g.room)}</span>
              <span class="group-go num">${g.items.length}${icon("chevronRight")}</span>
            </a>
            <ul class="card-list">${g.items.map(it => itemHTML(it, { showCat: true })).join("")}</ul>
          </section>`;
      }).join("")}
    </div>`;
}

function emptyListHTML(filterKey, q) {
  if (q) return emptyHTML({ iconName: "search", title: "Nada encontrado", text: `Nenhum item corresponde a “${ui.query.trim()}”.` });
  const [iconName, tint, title, text] = {
    todo: ["check", "sage", "Nada por comprar", "Está tudo tratado. Bom trabalho!"],
    essential: ["check", "sage", "Sem essenciais em falta", "Os itens essenciais já estão todos comprados."],
    done: ["home", "sand", "Ainda nada comprado", "Toca no círculo ao lado de um item para o marcar como comprado."],
    all: ["home", "sand", "A lista está vazia", "Carrega em Adicionar para pôr o primeiro item."],
  }[filterKey];
  return emptyHTML({ iconName, tint, title, text });
}

function emptyHTML({ iconName = "search", tint = "stone", title, text = "", action = "" }) {
  return `
    <div class="empty tint-${tint}">
      <span class="room-icon xl">${icon(iconName)}</span>
      <h3>${esc(title)}</h3>
      ${text ? `<p>${esc(text)}</p>` : ""}
      ${action}
    </div>`;
}

function renderRoom() {
  const room = ui.route.room;
  const exists = roomNames().includes(room);
  if (!exists && findRoom(room)) {
    go(roomHref(findRoom(room)), true); // endereço antigo, ex.: "Casa de banho" → "Casa de Banho"
    return;
  }
  $("#quickAdd").hidden = !exists;
  $("#roomBarTitle").textContent = exists ? room : "";

  if (!exists) {
    $("#roomHero").innerHTML = "";
    $("#roomList").innerHTML = emptyHTML({
      iconName: "home",
      title: "Esta divisão já não existe",
      text: "Pode ter sido apagada ou mudado de nome.",
      action: `<a class="btn btn-ghost" href="#/">Voltar à casa</a>`,
    });
    return;
  }

  const st = roomStyle(room);
  const list = itemsIn(room);
  const s = sumUp(list);
  $("#roomHero").innerHTML = `
    <section class="room-hero tint-${st.tint}">
      <div class="room-hero-top">
        <span class="room-icon lg">${icon(st.icon)}</span>
        <div>
          <h2>${esc(room)}</h2>
          <p>${s.n ? `${plural(s.n, "item", "itens")} · ${s.nFalta ? `${s.nFalta} por comprar` : "tudo tratado"}` : "Ainda sem itens"}</p>
        </div>
      </div>
      ${s.n ? `
      <div class="money">
        <div class="money-col is-done"><span>Gasto</span><b class="num">${eur(s.gasto)}</b></div>
        <div class="money-col is-todo"><span>Falta comprar</span><b class="num">${eur(s.falta)}</b></div>
      </div>
      <span class="track track--lg"><i style="width:${progress(s) * 100}%"></i></span>
      <p class="money-total">Total previsto <b class="num">${s.total ? eur(s.total) : "sem preços ainda"}</b></p>` : ""}
    </section>`;

  if (!list.length) {
    $("#roomList").innerHTML = emptyHTML({
      iconName: st.icon,
      tint: st.tint,
      title: "Ainda não há nada aqui",
      text: "Escreve na caixa acima ou carrega em Adicionar para pôr o primeiro item.",
    });
    return;
  }

  const todo = list.filter(it => it.estado === 0);
  const done = list.filter(it => it.estado !== 0).sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
  let html = todo.length
    ? categoryGroupsHTML(todo)
    : `<div class="all-done">${icon("check")}<div><b>Está tudo tratado nesta divisão.</b><span>Bom trabalho!</span></div></div>`;
  if (done.length) {
    html += `
      <section class="group">
        <div class="group-head">
          <h3 class="group-title">Já comprado <span class="num">${done.length}</span></h3>
          <label class="switch"><input type="checkbox" id="hideDone"${ui.hideDone ? " checked" : ""}><span class="switch-track" aria-hidden="true"></span>Ocultar</label>
        </div>
        ${ui.hideDone ? "" : `<ul class="card-list">${done.map(it => itemHTML(it, { showCat: true })).join("")}</ul>`}
      </section>`;
  }
  $("#roomList").innerHTML = html;
}

function categoryGroupsHTML(list) {
  const groups = new Map();
  for (const it of list) {
    const key = fold(it.categoria);
    if (!groups.has(key)) groups.set(key, { name: it.categoria, items: [] });
    groups.get(key).items.push(it);
  }
  const ordered = [...groups.entries()]
    .sort(([a], [b]) => (a === "") - (b === "") || a.localeCompare(b, "pt"))
    .map(([, group]) => group);

  return ordered.map(g => {
    const total = g.items.reduce((sum, it) => sum + custo(it), 0);
    const title = g.name || (ordered.length === 1 ? "Por comprar" : "Outros");
    return `
      <section class="group">
        <div class="group-head">
          <h3 class="group-title">${esc(title)} <span class="num">${g.items.length}</span></h3>
          ${total ? `<span class="group-sum num">${eur(total)}</span>` : ""}
        </div>
        <ul class="card-list">${g.items.sort(byPriority).map(it => itemHTML(it)).join("")}</ul>
      </section>`;
  }).join("");
}

function itemHTML(it, { showCat = false } = {}) {
  const done = it.estado !== 0;
  const info = [];
  if (it.qtd > 1) info.push(it.preco ? `${it.qtd} × ${eur(it.preco)}` : `${it.qtd} unidades`);
  if (showCat && it.categoria) info.push(esc(it.categoria));
  const tags = [];
  if (it.estado === 2) tags.push(`<span class="tag tag-made">Feito</span>`);
  if (!done && it.prio !== "I") tags.push(`<span class="tag tag-${it.prio}">${PRIOS[it.prio]}</span>`);
  const meta = info.length || tags.length
    ? `<span class="item-meta">${info.length ? `<span>${info.join(" · ")}</span>` : ""}${tags.join("")}</span>`
    : "";

  const paidOther = done && it.preco_pago != null && Math.abs(it.preco_pago - previsto(it)) >= 0.01;
  const price = custo(it) > 0 || it.preco_pago != null ? eur(custo(it)) : `<span class="no-price">sem preço</span>`;
  const links = it.links
    .map(u => safeUrl(u))
    .filter(Boolean)
    .map(u => `<a class="link-chip" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${icon("external")}<span>${esc(hostOf(u))}</span></a>`)
    .join("");

  return `
    <li class="item${done ? " is-done" : ""}">
      <button class="check s${it.estado}" type="button" data-toggle="${esc(it.id)}" aria-pressed="${done}"
        aria-label="${esc(it.nome)}: ${done ? "marcar como por comprar" : "marcar como comprado"}">${icon("check")}</button>
      <button class="item-main" type="button" data-edit="${esc(it.id)}">
        <span class="item-name">${esc(it.nome)}</span>${meta}
        ${it.notas ? `<span class="item-note">${esc(it.notas)}</span>` : ""}
      </button>
      <span class="item-price num">${price}${paidOther ? `<small>previsto ${eur(previsto(it))}</small>` : ""}</span>
      ${links ? `<span class="item-links">${links}</span>` : ""}
    </li>`;
}

/* ---------- 4. Navegação ---------- */

function parseRoute() {
  const match = location.hash.match(/^#\/d\/(.+)$/);
  if (match) {
    try {
      return { name: "room", room: decodeURIComponent(match[1]) };
    } catch {
      /* endereço estragado: volta ao início */
    }
  }
  return { name: "home" };
}

function go(hash, replace = false) {
  if (replace) {
    history.replaceState(history.state, "", hash);
    onRouteChange();
  } else {
    location.hash = hash;
  }
}

function onRouteChange() {
  const prev = ui.route;
  ui.route = parseRoute();
  const toRoom = ui.route.name === "room";
  if (toRoom && prev.name === "home") {
    ui.homeScroll = scrollY;
    ui.fromHome = true;
  }
  if (!toRoom) ui.fromHome = false;
  if (toRoom) ui.lastRoom = ui.route.room;

  closeMenu();
  $("#viewHome").hidden = toRoom;
  $("#viewRoom").hidden = !toRoom;
  if (toRoom) $("#quickInput").value = "";
  render();
  window.scrollTo(0, toRoom ? 0 : ui.homeScroll);
  $("#roomBar").classList.remove("scrolled");
}

/* ---------- 5. Folhas, diálogos, menu e avisos ---------- */

/* Cada folha aberta fica no histórico: o botão "voltar" do telemóvel fecha-a. */
const layers = [];

/* No iPhone, "overflow: hidden" não chega para a página de trás não deslizar: fixa-se o body. */
let lockedScrollY = 0;
function lockScroll() {
  lockedScrollY = window.scrollY;
  Object.assign(document.body.style, { position: "fixed", top: `-${lockedScrollY}px`, left: "0", right: "0" });
  document.documentElement.classList.add("is-locked");
}
function unlockScroll() {
  Object.assign(document.body.style, { position: "", top: "", left: "", right: "" });
  document.documentElement.classList.remove("is-locked");
  window.scrollTo(0, lockedScrollY);
}

function openLayer(el, onClose) {
  closeMenu();
  const layer = { el, onClose, returnFocus: document.activeElement, viaHistory: true, closing: false };
  try {
    history.pushState({ layer: true }, "");
  } catch {
    layer.viaHistory = false;
  }
  if (!layers.length) lockScroll();
  layers.push(layer);
  el.hidden = false;
}

function closeLayer() {
  const top = layers[layers.length - 1];
  if (!top || top.closing) return;
  top.closing = true;
  if (top.viaHistory) history.back();
  else hideTopLayer();
}

function hideTopLayer() {
  const top = layers.pop();
  if (!top) return;
  top.el.hidden = true;
  const sheet = $(".sheet", top.el);
  if (sheet) Object.assign(sheet.style, { transform: "", transition: "" });
  if (!layers.length) unlockScroll();
  top.returnFocus?.focus?.({ preventScroll: true });
  top.onClose?.();
}

window.addEventListener("popstate", () => {
  if (layers.length) hideTopLayer();
});

/* Arrastar a folha para baixo (pela barra do título) fecha-a, como nas apps do iPhone. */
function enableSwipeToClose(sheet) {
  const head = $(".sheet-head", sheet);
  let startY = null;
  let dy = 0;
  head.addEventListener("touchstart", e => {
    if (innerWidth >= 640 || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    dy = 0;
    sheet.style.transition = "none";
  }, { passive: true });
  head.addEventListener("touchmove", e => {
    if (startY === null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  const release = () => {
    if (startY === null) return;
    startY = null;
    sheet.style.transition = "transform .2s ease";
    if (dy > 90) {
      sheet.style.transform = "translateY(100%)";
      setTimeout(closeLayer, 180);
    } else {
      sheet.style.transform = "";
    }
  };
  head.addEventListener("touchend", release);
  head.addEventListener("touchcancel", release);
}

/* O teclado do iPhone não encolhe a página: acompanha-se a parte visível do ecrã. */
function trackVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const rootStyle = document.documentElement.style;
  const update = () => {
    rootStyle.setProperty("--vvh", `${Math.round(vv.height)}px`);
    rootStyle.setProperty("--vvt", `${Math.round(vv.offsetTop)}px`);
  };
  vv.addEventListener("resize", () => {
    update();
    const field = document.activeElement;
    if (layers.length && field?.closest?.(".sheet-body")) field.scrollIntoView({ block: "nearest" });
  });
  vv.addEventListener("scroll", update);
  update();
}

for (const overlay of $$(".overlay")) {
  let pressedBackdrop = false;
  overlay.addEventListener("pointerdown", e => {
    pressedBackdrop = e.target === overlay;
  });
  overlay.addEventListener("click", e => {
    if ((e.target === overlay && pressedBackdrop) || e.target.closest("[data-close]")) closeLayer();
  });
}

/* Diálogo simples: pergunta um valor (com label) ou pede confirmação (sem label). */
function dialog({ title, text = "", label = "", value = "", placeholder = "", inputMode = "text", autocapitalize = "sentences", ok = "Guardar", danger = false, validate = () => "" }) {
  return new Promise(resolve => {
    const input = $("#dlgInput");
    let result = null;
    $("#dlgTitle").textContent = title;
    $("#dlgText").textContent = text;
    $("#dlgText").hidden = !text;
    $("#dlgField").hidden = !label;
    $("#dlgLabel").textContent = label;
    input.value = value;
    input.placeholder = placeholder;
    input.inputMode = inputMode;
    input.setAttribute("autocapitalize", autocapitalize);
    $("#dlgErr").hidden = true;
    $("#dlgOk").textContent = ok;
    $("#dlgOk").className = `btn ${danger ? "btn-danger" : "btn-primary"}`;
    $("#dlgForm").onsubmit = e => {
      e.preventDefault();
      const answer = label ? input.value.trim() : true;
      const problem = label ? validate(answer) : "";
      if (problem) {
        $("#dlgErr").textContent = problem;
        $("#dlgErr").hidden = false;
        input.focus();
        return;
      }
      result = answer;
      closeLayer();
    };
    openLayer($("#dialog"), () => resolve(result));
    // Focar já (ainda dentro do toque): no iPhone é a única forma de o teclado abrir sozinho.
    if (label) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(0, input.value.length);
    } else {
      $("#dlgOk").focus({ preventScroll: true });
    }
  });
}

let menuAnchor = null;

function openMenu(anchor, entries) {
  if (menuAnchor === anchor) {
    closeMenu();
    return;
  }
  closeMenu();
  const menu = $("#menu");
  menu.innerHTML = entries
    .map((entry, i) => {
      if (entry === "-") return "<hr>";
      if (entry.note) return `<p class="menu-note">${esc(entry.note)}</p>`;
      return `<button type="button" role="menuitem" data-i="${i}"${entry.danger ? ' class="danger"' : ""}>${icon(entry.icon)}<span>${esc(entry.label)}</span></button>`;
    })
    .join("");
  menu.onclick = e => {
    const button = e.target.closest("button[data-i]");
    if (!button) return;
    closeMenu(true);
    entries[Number(button.dataset.i)].run();
  };
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${Math.round(rect.bottom + 8)}px`;
  menu.style.right = `${Math.round(Math.max(12, document.documentElement.clientWidth - rect.right))}px`;
  menu.hidden = false;
  menuAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  $("button", menu)?.focus({ preventScroll: true });
}

function closeMenu(restoreFocus = false) {
  if (!menuAnchor) return;
  $("#menu").hidden = true;
  menuAnchor.setAttribute("aria-expanded", "false");
  if (restoreFocus) menuAnchor.focus({ preventScroll: true });
  menuAnchor = null;
}

let toastTimer = 0;
function toast(message, action = null) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
  el.classList.toggle("has-action", Boolean(action));
  if (action) {
    $("button", el).onclick = () => {
      el.hidden = true;
      action.run();
    };
  }
  el.hidden = false;
  el.classList.remove("show");
  void el.offsetWidth; // reinicia a animação
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), action ? 5000 : 2600);
}

/* ---------- 6. Formulário do item ---------- */

const form = { editing: null, estado: 0, prio: "I" };

function defaultRoom() {
  const rooms = roomNames();
  return ui.lastRoom && rooms.includes(ui.lastRoom) ? ui.lastRoom : rooms[0] || "Geral";
}

function openItemForm(item, room) {
  form.editing = item || null;
  $("#itemTitle").textContent = item ? "Editar item" : "Novo item";
  $("#fNome").value = item?.nome ?? "";
  $("#fCat").value = item?.categoria ?? "";
  $("#fPreco").value = item?.preco ? moneyField(item.preco) : "";
  $("#fQtd").value = item?.qtd ?? 1;
  $("#fPago").value = moneyField(item?.preco_pago);
  $("#fNotas").value = item?.notas ?? "";
  fillRoomSelect(item?.divisao || room || defaultRoom());
  fillCategories();
  setEstado(item?.estado ?? 0);
  setPrio(item?.prio ?? "I");
  $("#fLinks").innerHTML = "";
  (item?.links ?? []).forEach(url => $("#fLinks").append(linkRow(url)));

  const when = item?.atualizado_em ? new Date(item.atualizado_em) : null;
  const stamp = when && !Number.isNaN(when.getTime())
    ? `Última alteração a ${when.toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })}${item.atualizado_por && item.atualizado_por !== window.CASA_CONFIG?.LOGIN_EMAIL ? ` por ${item.atualizado_por}` : ""}`
    : "";
  $("#fStamp").textContent = stamp;
  $("#fStamp").hidden = !stamp;

  $("#fDelete").hidden = !item;
  $("#fSaveMore").hidden = Boolean(item);
  hideFormError();
  updateTotal();
  openLayer($("#itemSheet"), () => {
    form.editing = null;
  });
  $("#itemSheet .sheet-body").scrollTop = 0;
  // Focar já (ainda dentro do toque) para o teclado do iPhone abrir num item novo.
  (item ? $("#itemForm") : $("#fNome")).focus({ preventScroll: true });
}

function fillRoomSelect(selected) {
  const rooms = roomNames();
  if (selected && !rooms.includes(selected)) rooms.push(selected);
  $("#fDiv").innerHTML =
    rooms.map(room => `<option${room === selected ? " selected" : ""}>${esc(room)}</option>`).join("") +
    `<option value="${NEW_ROOM}">+ Nova divisão…</option>`;
  $("#newDivField").hidden = true;
  $("#fNewDiv").value = "";
}

function fillCategories() {
  const seen = new Map();
  for (const it of Store.items) {
    if (it.categoria && !seen.has(fold(it.categoria))) seen.set(fold(it.categoria), it.categoria);
  }
  $("#catList").innerHTML = [...seen.values()]
    .sort((a, b) => a.localeCompare(b, "pt"))
    .map(cat => `<option value="${esc(cat)}"></option>`)
    .join("");
}

function setEstado(value) {
  form.estado = value;
  $$("#fEstado button").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.v) === value)));
  $("#pagoField").hidden = value === 0;
}

function setPrio(value) {
  form.prio = value;
  $$("#fPrio button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === value)));
}

const readQty = () => Math.min(999, Math.max(1, parseInt($("#fQtd").value, 10) || 1));

function updateTotal() {
  const price = parseMoney($("#fPreco").value);
  const qty = readQty();
  const total = (Number.isFinite(price) ? price : 0) * qty;
  $("#fTotal").hidden = !(total > 0 && qty > 1);
  $("#fTotalVal").textContent = eur(total);
}

function linkRow(value = "") {
  const row = document.createElement("div");
  row.className = "link-row";
  row.innerHTML = `
    <input class="input" type="url" inputmode="url" placeholder="https://…" value="${esc(value)}" aria-label="Link"
      autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    <button class="icon-btn" type="button" aria-label="Remover link">${icon("x")}</button>`;
  $("button", row).addEventListener("click", () => row.remove());
  return row;
}

function showFormError(message, focusSel) {
  $("#fErr").textContent = message;
  $("#fErr").hidden = false;
  if (focusSel) $(focusSel).focus();
}
function hideFormError() {
  $("#fErr").hidden = true;
}

function resetFormForNext(prev) {
  form.editing = null;
  $("#fNome").value = "";
  $("#fPreco").value = "";
  $("#fQtd").value = 1;
  $("#fPago").value = "";
  $("#fNotas").value = "";
  $("#fLinks").innerHTML = "";
  fillRoomSelect(prev.divisao);
  fillCategories();
  $("#fCat").value = prev.categoria;
  setEstado(0);
  setPrio("I");
  updateTotal();
  $("#itemSheet .sheet-body").scrollTop = 0;
  $("#fNome").focus();
}

async function submitItemForm(e) {
  e.preventDefault();
  hideFormError();
  const another = e.submitter?.id === "fSaveMore";

  const nome = $("#fNome").value.trim();
  if (!nome) return showFormError("Escreve o que é preciso comprar.", "#fNome");

  let divisao = $("#fDiv").value;
  if (divisao === NEW_ROOM) {
    divisao = $("#fNewDiv").value.trim();
    if (!divisao) return showFormError("Dá um nome à nova divisão.", "#fNewDiv");
    divisao = findRoom(divisao) || roomTitle(divisao);
  }

  const preco = parseMoney($("#fPreco").value);
  if (Number.isNaN(preco)) return showFormError("O preço não parece válido.", "#fPreco");
  const pago = form.estado === 0 ? null : parseMoney($("#fPago").value);
  if (Number.isNaN(pago)) return showFormError("O valor pago não parece válido.", "#fPago");

  const links = $$("#fLinks input").map(input => input.value.trim()).filter(Boolean);
  const badLink = links.find(url => !safeUrl(url));
  if (badLink) return showFormError(`Este link não parece válido: ${badLink}`);

  const item = {
    ...(form.editing || {}),
    nome,
    divisao,
    categoria: $("#fCat").value.trim(),
    preco: preco ?? 0,
    qtd: readQty(),
    estado: form.estado,
    preco_pago: pago,
    prio: form.prio,
    links: links.map(safeUrl),
    notas: $("#fNotas").value.trim(),
  };
  const isNew = !form.editing;

  $$("#itemForm .sheet-foot button").forEach(b => (b.disabled = true));
  try {
    await Store.ensureRoom(divisao);
    await Store.saveItem(item);
    if (another) {
      resetFormForNext(item);
      toast(`“${nome}” adicionado`);
    } else {
      closeLayer();
      toast(isNew ? "Item adicionado" : "Alterações guardadas");
    }
  } catch (err) {
    showFormError(errMsg(err));
  } finally {
    $$("#itemForm .sheet-foot button").forEach(b => (b.disabled = false));
  }
}

/* ---------- 7. Ações ---------- */

async function toggleItem(id) {
  const it = Store.find(id);
  if (!it) return;
  const saving = Store.saveItem({ ...it, estado: it.estado === 0 ? 1 : 0 }); // desenha logo, antes de confirmar
  $(`[data-toggle="${CSS.escape(id)}"]`)?.classList.add("pop");
  try {
    await saving;
  } catch (err) {
    toast(errMsg(err));
  }
}

async function deleteItem(it) {
  try {
    await Store.removeItem(it.id);
    toast("Item apagado", {
      label: "Anular",
      run: () => Store.insertItems([it]).catch(err => toast(errMsg(err))),
    });
  } catch (err) {
    toast(errMsg(err));
  }
}

/* "2x Toalhas 15€" → 2 toalhas a 15 € cada */
function parseQuick(text) {
  let nome = text.trim();
  let qtd = 1;
  let preco = 0;
  const q = nome.match(/^(\d{1,3})\s*[x×]\s+(.+)$/i);
  if (q) {
    qtd = Number(q[1]);
    nome = q[2];
  }
  const p = nome.match(/^(.+?)\s*(\d+(?:[.,]\d{1,2})?)\s*€$/);
  if (p) {
    const value = parseMoney(p[2]);
    if (Number.isFinite(value)) {
      preco = value;
      nome = p[1];
    }
  }
  return { nome: nome.trim(), qtd: Math.max(1, qtd), preco };
}

async function quickAdd(e) {
  e.preventDefault();
  const input = $("#quickInput");
  const text = input.value;
  const data = parseQuick(text);
  if (!data.nome) return;
  input.value = "";
  try {
    await Store.saveItem({ ...data, divisao: ui.route.room, categoria: "", estado: 0, prio: "I", preco_pago: null, links: [], notas: "" });
  } catch (err) {
    input.value = text;
    toast(errMsg(err));
  }
}

async function editBudget() {
  const value = await dialog({
    title: "Orçamento total",
    text: "Quanto contam gastar, no máximo, com tudo o que está na lista?",
    label: "Valor em euros",
    value: moneyField(Store.cfg.orcamento),
    placeholder: "ex.: 15 000",
    inputMode: "decimal",
    autocapitalize: "off",
    validate: v => (Number.isNaN(parseMoney(v)) ? "Escreve um valor válido, por exemplo 15000." : ""),
  });
  if (value == null) return;
  const orcamento = parseMoney(value);
  try {
    await Store.updateConfig({ orcamento });
    toast(orcamento == null ? "Orçamento removido" : "Orçamento guardado");
  } catch (err) {
    toast(errMsg(err));
  }
}

const roomNameProblem = (value, current = "") => {
  if (!value) return "Escreve um nome.";
  if (value.length > 80) return "Esse nome é demasiado comprido.";
  if (fold(value) !== fold(current) && findRoom(value)) return "Já existe uma divisão com esse nome.";
  return "";
};

async function addRoom() {
  const name = await dialog({
    title: "Nova divisão",
    label: "Nome",
    placeholder: "ex.: Escritório, Varanda, Lavandaria",
    autocapitalize: "words",
    ok: "Criar",
    validate: v => roomNameProblem(v),
  });
  if (!name) return;
  const title = roomTitle(name);
  try {
    await Store.addRoom(title);
    go(roomHref(title));
  } catch (err) {
    toast(errMsg(err));
  }
}

async function renameRoom(room) {
  const name = await dialog({
    title: "Mudar o nome",
    label: "Nome da divisão",
    value: room,
    autocapitalize: "words",
    validate: v => roomNameProblem(v, room),
  });
  if (!name) return;
  const title = roomTitle(name);
  if (title === room) return;
  // Muda já o endereço para o ecrã acompanhar o novo nome.
  const previousHash = location.hash;
  history.replaceState(history.state, "", roomHref(title));
  ui.route = { name: "room", room: title };
  ui.lastRoom = title;
  try {
    await Store.renameRoom(room, title);
    toast("Nome alterado");
  } catch (err) {
    history.replaceState(history.state, "", previousHash);
    ui.route = parseRoute();
    render();
    toast(errMsg(err));
  }
}

async function deleteRoom(room) {
  const n = itemsIn(room).length;
  const confirmed = await dialog({
    title: `Apagar “${room}”?`,
    text: n === 0
      ? "A divisão está vazia."
      : n === 1
        ? "O item desta divisão também vai ser apagado. Não dá para desfazer."
        : `Os ${n} itens desta divisão também vão ser apagados. Não dá para desfazer.`,
    ok: "Apagar",
    danger: true,
  });
  if (!confirmed) return;
  go("#/", true);
  try {
    await Store.removeRoom(room);
    toast("Divisão apagada");
  } catch (err) {
    toast(errMsg(err));
  }
}

async function importRows(rows, message) {
  const fixed = rows.map(r => ({ ...r, divisao: findRoom(r.divisao) || roomTitle(r.divisao) || "Geral" }));
  const known = roomNames();
  const missing = [...new Set(fixed.map(r => r.divisao))].filter(room => !known.includes(room));
  if (missing.length) await Store.updateConfig({ divisoes: [...Store.cfg.divisoes, ...missing] });
  const n = await Store.insertItems(fixed);
  toast(message ? message(n) : plural(n, "item importado", "itens importados"));
}

/* Lista inicial com o que costuma fazer falta: [nome, categoria, prioridade, quantidade] */
const SUGESTOES = {
  "Entrada": [["Sapateira", "Arrumação", "I"], ["Bengaleiro ou cabides de parede", "Arrumação", "I"], ["Espelho", "Decoração", "D"], ["Tapete de entrada", "Têxteis", "I"]],
  "Sala de Estar": [["Sofá", "Móveis", "E"], ["Mesa de centro", "Móveis", "I"], ["Móvel de TV", "Móveis", "I"], ["Televisão", "Eletrónica", "I"], ["Candeeiro de pé", "Iluminação", "I"], ["Cortinas", "Têxteis", "I"], ["Tapete", "Têxteis", "D"], ["Almofadas e manta", "Têxteis", "D"]],
  "Sala de Jantar": [["Mesa de jantar", "Móveis", "E"], ["Cadeiras", "Móveis", "E", 4], ["Candeeiro de teto", "Iluminação", "I"], ["Individuais e toalha de mesa", "Têxteis", "D"]],
  "Cozinha": [["Frigorífico", "Eletrodomésticos", "E"], ["Micro-ondas", "Eletrodomésticos", "I"], ["Máquina de lavar loiça", "Eletrodomésticos", "I"], ["Máquina de café", "Eletrodomésticos", "I"], ["Chaleira", "Eletrodomésticos", "D"], ["Torradeira", "Eletrodomésticos", "D"], ["Conjunto de panelas", "Cozinhar", "E"], ["Frigideiras", "Cozinhar", "E"], ["Facas e tábua de cortar", "Cozinhar", "E"], ["Utensílios (espátulas, conchas…)", "Cozinhar", "E"], ["Pratos", "Loiça", "E"], ["Copos", "Loiça", "E"], ["Talheres", "Loiça", "E"], ["Canecas", "Loiça", "I"], ["Caixas para guardar comida", "Arrumação", "I"], ["Caixotes do lixo e reciclagem", "Limpeza", "E"], ["Panos de cozinha", "Têxteis", "I"]],
  "Quarto Principal": [["Cama e estrado", "Móveis", "E"], ["Colchão", "Móveis", "E"], ["Almofadas", "Têxteis", "E", 2], ["Edredão", "Têxteis", "E"], ["Jogos de lençóis", "Têxteis", "E", 2], ["Mesas de cabeceira", "Móveis", "I", 2], ["Candeeiros de cabeceira", "Iluminação", "I", 2], ["Cómoda ou roupeiro", "Móveis", "I"], ["Cabides", "Arrumação", "I"], ["Cortinas blackout", "Têxteis", "I"]],
  "Quarto 2": [["Cama", "Móveis", "D"], ["Secretária e cadeira", "Móveis", "D"]],
  "Casa de Banho": [["Toalhas de banho", "Têxteis", "E", 4], ["Toalhas de rosto", "Têxteis", "E", 4], ["Tapete de banho", "Têxteis", "I"], ["Resguardo ou cortina de duche", "Acessórios", "I"], ["Escova da sanita", "Limpeza", "E"], ["Caixote do lixo pequeno", "Limpeza", "I"], ["Organizadores", "Arrumação", "D"]],
  "Geral": [["Aspirador", "Limpeza", "E"], ["Esfregona e balde", "Limpeza", "E"], ["Vassoura e pá", "Limpeza", "E"], ["Máquina de lavar roupa", "Eletrodomésticos", "E"], ["Estendal", "Roupa", "E"], ["Ferro e tábua de engomar", "Roupa", "I"], ["Caixa de ferramentas", "Ferramentas", "I"], ["Lâmpadas", "Eletricidade", "E"], ["Extensões e triplas", "Eletricidade", "I"], ["Detetor de fumo", "Segurança", "I"], ["Kit de primeiros socorros", "Segurança", "I"]],
};

async function useSuggestions() {
  const rows = Object.entries(SUGESTOES).flatMap(([divisao, list]) =>
    list.map(([nome, categoria, prio, qtd = 1]) => ({ nome, divisao, categoria, prio, qtd, preco: 0, estado: 0, preco_pago: null, links: [], notas: "" }))
  );
  try {
    await importRows(rows, n => `${n} sugestões adicionadas`);
  } catch (err) {
    toast(errMsg(err));
  }
}

/* Tema: automático (segue o sistema), claro ou escuro */
const THEME_LABELS = { auto: "automático", light: "claro", dark: "escuro" };
function readTheme() {
  try {
    return localStorage.getItem("casa.theme") || "auto";
  } catch {
    return "auto";
  }
}
const THEME_COLORS = { light: "#F4EFE7", dark: "#141210" };
function applyTheme() {
  const root = document.documentElement;
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
  // A cor da barra do Safari (e da barra de estado no iPhone) acompanha o tema escolhido.
  for (const meta of $$('meta[name="theme-color"]')) {
    meta.dataset.media ??= meta.getAttribute("media") || "";
    if (theme === "auto") {
      meta.setAttribute("media", meta.dataset.media);
      meta.content = meta.dataset.media.includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light;
    } else {
      meta.removeAttribute("media");
      meta.content = THEME_COLORS[theme];
    }
  }
}
function cycleTheme() {
  theme = { auto: "light", light: "dark", dark: "auto" }[theme] || "auto";
  try {
    localStorage.setItem("casa.theme", theme);
  } catch {
    /* sem armazenamento: o tema dura só esta visita */
  }
  applyTheme();
  toast(`Tema ${THEME_LABELS[theme]}`);
}

function homeMenu() {
  const entries = [
    { icon: "download", label: "Exportar para Excel", run: exportExcel },
    { icon: "upload", label: "Importar de Excel", run: () => $("#fileImport").click() },
    "-",
    { icon: { auto: "contrast", light: "sun", dark: "moon" }[theme], label: `Tema: ${THEME_LABELS[theme]}`, run: cycleTheme },
  ];
  if (Store.shared && user) {
    entries.push("-", { icon: "logout", label: "Terminar sessão", run: signOut });
  }
  return entries;
}

function roomMenu() {
  const room = ui.route.room;
  return [
    { icon: "pencil", label: "Mudar o nome", run: () => renameRoom(room) },
    { icon: "trash", label: "Apagar divisão", danger: true, run: () => deleteRoom(room) },
  ];
}

/* ---------- 8. Excel ---------- */

const XL = {
  div: "Divisão", cat: "Categoria", nome: "Produto", qtd: "Quantidade", preco: "Preço unitário (€)",
  tot: "Total previsto (€)", pago: "Pago (€)", estado: "Estado", prio: "Prioridade", links: "Links", notas: "Notas",
};

async function exportExcel() {
  if (!Store.items.length) {
    toast("A lista ainda está vazia");
    return;
  }
  try {
    await loadXLSX();
  } catch {
    toast("Não foi possível preparar o Excel. Verifica a internet.");
    return;
  }
  const order = roomNames();
  const rows = Store.items
    .slice()
    .sort((a, b) => order.indexOf(a.divisao) - order.indexOf(b.divisao) || a.categoria.localeCompare(b.categoria, "pt") || a.nome.localeCompare(b.nome, "pt"))
    .map(it => ({
      [XL.div]: it.divisao,
      [XL.cat]: it.categoria,
      [XL.nome]: it.nome,
      [XL.qtd]: it.qtd,
      [XL.preco]: it.preco,
      [XL.tot]: previsto(it),
      [XL.pago]: it.preco_pago ?? "",
      [XL.estado]: ESTADOS[it.estado],
      [XL.prio]: PRIOS[it.prio],
      [XL.links]: it.links.join("\n"),
      [XL.notas]: it.notas,
    }));
  const sheet = XLSX.utils.json_to_sheet(rows, { header: Object.values(XL) });
  sheet["!cols"] = [18, 16, 34, 11, 16, 16, 10, 13, 13, 40, 30].map(wch => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Lista");
  const filename = `Casa Nova - ${new Date().toISOString().slice(0, 10)}.xlsx`;
  if (await shareWorkbook(book, filename)) return;
  XLSX.writeFile(book, filename);
  toast("Ficheiro Excel descarregado");
}

/* No telemóvel abre a folha de partilha (Guardar em Ficheiros, WhatsApp, Mail…). */
async function shareWorkbook(book, filename) {
  if (!matchMedia("(pointer: coarse)").matches || !navigator.canShare) return false;
  const data = XLSX.write(book, { bookType: "xlsx", type: "array" });
  const file = new File([data], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: "Casa Nova" });
    return true;
  } catch (err) {
    return err?.name === "AbortError"; // fechou a folha de partilha: não descarregar
  }
}

async function importExcel(file) {
  try {
    await loadXLSX();
    const book = XLSX.read(await file.arrayBuffer());
    const raw = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "" });
    const pick = (row, ...names) => {
      for (const name of names) {
        const key = Object.keys(row).find(k => fold(k.trim()) === fold(name));
        if (key !== undefined && row[key] !== "") return row[key];
      }
      return "";
    };
    const rows = raw
      .map(row => {
        const nome = String(pick(row, XL.nome, "Nome", "Item")).trim();
        if (!nome) return null;
        const estado = ESTADOS.findIndex(s => fold(s) === fold(String(pick(row, XL.estado)).trim()));
        const prio = Object.keys(PRIOS).find(k => fold(PRIOS[k]) === fold(String(pick(row, XL.prio)).trim()));
        const pago = parseMoney(pick(row, XL.pago));
        return normalizeItem({
          nome: nome.slice(0, 200),
          divisao: String(pick(row, XL.div)).trim().slice(0, 80) || "Geral",
          categoria: String(pick(row, XL.cat)).trim(),
          preco: parseMoney(pick(row, XL.preco, "Preço", "Preco")) || 0,
          qtd: pick(row, XL.qtd, "Qtd") || 1,
          estado: estado < 0 ? 0 : estado,
          prio: prio || "I",
          preco_pago: estado > 0 && Number.isFinite(pago) ? pago : null,
          links: String(pick(row, XL.links)).split(/\s+/).map(u => safeUrl(u)).filter(Boolean),
          notas: String(pick(row, XL.notas)).trim(),
        });
      })
      .filter(Boolean);
    if (!rows.length) {
      toast("Não encontrei itens nesse ficheiro");
      return;
    }
    await importRows(rows);
  } catch (err) {
    console.error(err);
    toast(err?.code ? errMsg(err) : "Não foi possível ler esse ficheiro");
  }
}

/* ---------- 9. Entrada com palavra-passe (Supabase) ----------
   Quem verifica a palavra-passe é o Supabase, não esta página: sem ela o servidor
   não entrega dados. Há uma só conta, partilhada pelos dois (LOGIN_EMAIL em config.js). */

function showLogin(mode) {
  $("#login").hidden = false;
  $("#loginForm").hidden = mode !== "form";
  $("#loginDenied").hidden = mode !== "denied";
  if (mode === "form") $("#loginPass").focus({ preventScroll: true });
}

function loginError(message) {
  $("#loginErr").textContent = message;
  $("#loginErr").hidden = !message;
}

const signOut = () => Store.sb.auth.signOut().finally(() => location.reload());

async function startSupabase(config) {
  showLogin("loading");
  try {
    await loadScript(SUPABASE_SRC);
  } catch {
    $("#login").hidden = true;
    Store.loadLocal();
    $("#footNote").textContent = "Sem ligação ao Supabase: a mostrar só o que está guardado neste navegador.";
    return;
  }
  Store.sb = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  $("#loginUser").value = config.LOGIN_EMAIL || ""; // ajuda o iPhone a guardar a palavra-passe no Porta-chaves

  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const password = $("#loginPass").value;
    if (!password) return loginError("Escreve a palavra-passe.");
    if (!config.LOGIN_EMAIL) return loginError("Falta o LOGIN_EMAIL em config.js.");
    $("#btnLogin").disabled = true;
    loginError("");
    const { error } = await Store.sb.auth.signInWithPassword({ email: config.LOGIN_EMAIL, password });
    $("#btnLogin").disabled = false;
    if (!error) return; // o resto acontece em handleSession
    loginError(
      error.status === 429 ? "Demasiadas tentativas. Espera um bocadinho e tenta outra vez."
        : !navigator.onLine ? "Sem internet. Verifica a ligação."
        : "Palavra-passe errada."
    );
    $("#loginPass").select();
  });

  $("#togglePass").addEventListener("click", () => {
    const input = $("#loginPass");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    $("#togglePass").setAttribute("aria-pressed", String(show));
    $("#togglePass").setAttribute("aria-label", show ? "Esconder palavra-passe" : "Mostrar palavra-passe");
    $("#togglePass use").setAttribute("href", show ? "#i-eyeOff" : "#i-eye");
    input.focus({ preventScroll: true });
  });
  $("#btnDeniedOut").addEventListener("click", signOut);

  // Não chamar o Supabase dentro deste callback (evita bloqueios): adiar.
  Store.sb.auth.onAuthStateChange((_event, session) => setTimeout(() => handleSession(session), 0));
}

let sessionStarted = false;
async function handleSession(session) {
  user = session?.user ?? null;
  if (!user) {
    sessionStarted = false;
    showLogin("form");
    return;
  }
  if (sessionStarted) return;
  sessionStarted = true;

  const { data: isMember, error } = await Store.sb.rpc("is_membro");
  if (error || !isMember) {
    sessionStarted = false;
    showLogin("denied");
    return;
  }
  $("#loginPass").value = "";
  $("#login").hidden = true;
  $("#sync").hidden = false;
  try {
    await Store.loadRemote();
    Store.normalizeRoomNames().catch(() => {});
    offerMigration();
  } catch {
    toast("Não foi possível carregar a lista. Recarrega a página.");
  }
  Store.subscribe(status => {
    const live = status === "SUBSCRIBED";
    $("#sync").classList.toggle("on", live);
    $("#sync span").textContent = live ? "Sincronizado" : "A ligar…";
    if (live) Store.loadRemote().catch(() => {}); // apanha o que mudou enquanto esteve desligado
  });
}

/* Itens que ficaram guardados no navegador antes de ligar o Supabase */
function offerMigration() {
  const old = saved.get("casa.itens", []);
  if (!old.length || Store.items.length || saved.get("casa.migrado", false)) return;
  $("#migrateTxt").textContent = `Há ${plural(old.length, "item guardado", "itens guardados")} só neste navegador. Queres passá-los para a lista partilhada?`;
  $("#migrate").hidden = false;
  $("#migrateNo").onclick = () => {
    saved.set("casa.migrado", true);
    $("#migrate").hidden = true;
  };
  $("#migrateYes").onclick = async () => {
    $("#migrateYes").disabled = true;
    try {
      const oldCfg = saved.get("casa.cfg", {});
      if (oldCfg.orcamento != null && Store.cfg.orcamento == null) await Store.updateConfig({ orcamento: oldCfg.orcamento });
      await importRows(old.map(normalizeItem));
      saved.set("casa.migrado", true);
      $("#migrate").hidden = true;
    } catch (err) {
      toast(errMsg(err));
    } finally {
      $("#migrateYes").disabled = false;
    }
  };
}

/* ---------- 10. iPhone ---------- */

/* O Safari do iPhone não oferece instalar a app: explica-se uma vez como se faz. */
function setupInstallHint() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  const installed = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  if (!isIOS || !isSafari || installed || saved.get("casa.dicaInstalar", false)) return;
  $("#installHint").hidden = false;
  $("#installClose").addEventListener("click", () => {
    saved.set("casa.dicaInstalar", true);
    $("#installHint").hidden = true;
  });
}

/* Enquanto se escreve fora das folhas (pesquisa, adicionar rápido), o botão Adicionar sai da frente do teclado. */
const TEXT_FIELDS = "input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select";
document.addEventListener("focusin", e => {
  if (!layers.length && e.target.matches?.(TEXT_FIELDS)) document.documentElement.classList.add("is-typing");
});
document.addEventListener("focusout", () => {
  setTimeout(() => {
    if (!document.activeElement?.matches?.(TEXT_FIELDS)) document.documentElement.classList.remove("is-typing");
  }, 0);
});

document.addEventListener("touchstart", () => {}, { passive: true }); // sem isto o Safari não mostra o efeito ao carregar (:active)

/* ---------- 11. Ligações aos botões e arranque ---------- */

const ACTIONS = {
  budget: editBudget,
  "add-room": addRoom,
  "add-item": () => openItemForm(null, ui.route.name === "room" ? ui.route.room : null),
  starter: useSuggestions,
};

document.addEventListener("click", e => {
  const target = e.target.closest("[data-toggle], [data-edit], [data-action]");
  if (!target) return;
  if (target.dataset.toggle) toggleItem(target.dataset.toggle);
  else if (target.dataset.edit) {
    const it = Store.find(target.dataset.edit);
    if (it) openItemForm(it);
  } else ACTIONS[target.dataset.action]?.();
});

document.addEventListener("pointerdown", e => {
  if (menuAnchor && !e.target.closest("#menu") && !menuAnchor.contains(e.target)) closeMenu();
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (menuAnchor) closeMenu(true);
    else if (layers.length) closeLayer();
    return;
  }
  // Tab fica dentro da folha aberta
  if (e.key === "Tab" && layers.length) {
    const root = layers[layers.length - 1].el;
    const focusable = $$("button:not([disabled]), input, select, textarea, a[href]", root).filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
    return;
  }
  // "/" salta para a pesquisa
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing && !layers.length && ui.route.name === "home") {
    e.preventDefault();
    $("#q").focus();
  }
});

$("#menu").addEventListener("keydown", e => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const buttons = $$("#menu button");
  const i = buttons.indexOf(document.activeElement);
  buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
});

window.addEventListener("hashchange", onRouteChange);
window.addEventListener("resize", () => closeMenu());
window.addEventListener("scroll", () => {
  closeMenu();
  $("#roomBar").classList.toggle("scrolled", ui.route.name === "room" && scrollY > 90);
}, { passive: true });

/* Casa */
$("#btnMenu").addEventListener("click", e => {
  loadXLSX().catch(() => {}); // já fica pronto: a partilha no iPhone tem de abrir logo a seguir ao toque
  openMenu(e.currentTarget, homeMenu());
});
$("#chips").addEventListener("click", e => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  ui.filter = chip.dataset.f;
  if (ui.filter === "rooms") {
    ui.query = "";
    $("#q").value = "";
  }
  render();
});
$("#q").addEventListener("input", e => {
  ui.query = e.target.value;
  render();
});
$("#q").addEventListener("keydown", e => {
  if (e.key === "Enter") e.target.blur(); // "Pesquisar" no teclado do telemóvel fecha o teclado
});
$("#qClear").addEventListener("click", () => {
  ui.query = "";
  $("#q").value = "";
  render();
  $("#q").focus();
});

/* Divisão */
$("#btnBack").addEventListener("click", () => {
  if (ui.fromHome) history.back();
  else go("#/");
});
$("#btnRoomMenu").addEventListener("click", e => openMenu(e.currentTarget, roomMenu()));
$("#quickAdd").addEventListener("submit", quickAdd);
$("#roomList").addEventListener("change", e => {
  if (e.target.id !== "hideDone") return;
  ui.hideDone = e.target.checked;
  saved.set("casa.ocultarComprados", ui.hideDone);
  render();
});

/* Botão de adicionar */
$("#fab").addEventListener("click", () => openItemForm(null, ui.route.name === "room" ? ui.route.room : null));

/* Formulário */
$("#itemForm").addEventListener("submit", submitItemForm);
$("#fEstado").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b) setEstado(Number(b.dataset.v));
});
$("#fPrio").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b) setPrio(b.dataset.v);
});
$("#fDiv").addEventListener("change", e => {
  const isNew = e.target.value === NEW_ROOM;
  $("#newDivField").hidden = !isNew;
  if (isNew) $("#fNewDiv").focus();
});
$("#itemForm").addEventListener("click", e => {
  const step = e.target.closest("[data-step]");
  if (!step) return;
  $("#fQtd").value = Math.min(999, Math.max(1, readQty() + Number(step.dataset.step)));
  updateTotal();
});
$("#fQtd").addEventListener("input", updateTotal);
$("#fQtd").addEventListener("blur", () => ($("#fQtd").value = readQty()));
$("#fPreco").addEventListener("input", updateTotal);
$("#fAddLink").addEventListener("click", () => {
  const row = linkRow();
  $("#fLinks").append(row);
  $("input", row).focus();
});
$("#fDelete").addEventListener("click", () => {
  const it = form.editing;
  if (!it) return;
  closeLayer();
  deleteItem(it);
});

/* Excel */
$("#fileImport").addEventListener("change", e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) importExcel(file);
});

function boot() {
  if (history.state?.layer) history.replaceState(null, ""); // folha que ficou aberta antes de recarregar
  if ("scrollRestoration" in history) history.scrollRestoration = "manual"; // o scroll é gerido pela app
  applyTheme();
  trackVisualViewport();
  enableSwipeToClose($("#itemSheet .sheet"));
  setupInstallHint();
  Store.onChange(render);
  onRouteChange();
  const config = window.CASA_CONFIG || {};
  if (config.SUPABASE_URL && config.SUPABASE_ANON_KEY) {
    startSupabase(config);
  } else {
    Store.loadLocal();
    Store.normalizeRoomNames().catch(() => {});
    $("#footNote").textContent = "Modo de teste: a lista fica guardada só neste navegador.";
  }
}

boot();
