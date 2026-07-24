/* =============================================================
   POKÉDEX — Old.St Labs Technical Assessment
   Vanilla JS, no build step. Data: https://pokeapi.co/
   Artwork:  https://assets.pokemon.com/assets/cms2/img/pokedex/full/{id}.png
   Weakness chart sourced from:
   https://www.eurogamer.net/pokemon-go-type-chart-effectiveness-weaknesses
   ============================================================= */

const API_BASE = "https://pokeapi.co/api/v2";
const ARTWORK_BASE = "https://assets.pokemon.com/assets/cms2/img/pokedex/full";
const PAGE_SIZE = 10;
const MAX_ID = 1010; // Gen 1-9, per assessment note ("002-1010")

// "Weak Against" column from the Eurogamer Pokémon GO type chart.
// A dual-typed Pokémon's weaknesses are the union of both types' lists.
const WEAKNESS_CHART = {
  normal:   ["fighting"],
  fighting: ["flying", "psychic", "fairy"],
  flying:   ["rock", "electric", "ice"],
  poison:   ["ground", "psychic"],
  ground:   ["water", "grass", "ice"],
  rock:     ["fighting", "ground", "steel", "water", "grass"],
  bug:      ["flying", "rock", "fire"],
  ghost:    ["ghost", "dark"],
  steel:    ["fighting", "ground", "fire"],
  fire:     ["ground", "rock", "water"],
  water:    ["grass", "electric"],
  grass:    ["flying", "poison", "bug", "fire", "ice"],
  electric: ["ground"],
  psychic:  ["bug", "ghost", "dark"],
  ice:      ["fighting", "rock", "steel", "fire"],
  dragon:   ["ice", "dragon", "fairy"],
  dark:     ["fighting", "bug", "fairy"],
  fairy:    ["poison", "steel"],
};

const STAT_LABEL = { hp: "HP", attack: "ATK", defense: "DEF",
  "special-attack": "SP.ATK", "special-defense": "SP.DEF", speed: "SPD" };
const STAT_MAX = 200; // rough visual ceiling for the bar fill %

// ---- state ----------------------------------------------------
let registry = [];        // { id, name } for every Pokémon 1..MAX_ID (lightweight)
let detailCache = new Map(); // id -> full detail object, fetched lazily
let filteredIds = [];     // ids matching current search, in current sort order
let loadedCount = 0;      // how many of filteredIds are rendered
let currentDetailId = null;

// ---- dom refs ---------------------------------------------------
const $grid = document.getElementById("cardGrid");
const $search = document.getElementById("searchInput");
let currentSort = "id";
const sortButtons = document.querySelectorAll(".sort-btn");
const $loadMoreBtn = document.getElementById("loadMoreBtn");
const $spinner = document.getElementById("spinner");
const $countReadout = document.getElementById("countReadout");
const $emptyState = document.getElementById("emptyState");

const $modalBackdrop = document.getElementById("modalBackdrop");
const $modalClose = document.getElementById("modalClose");
const $modalScan = document.getElementById("modalScan");
const $modalBody = document.getElementById("modalBody");
const $modalBanner = document.getElementById("modalBanner");
const $modalId = document.getElementById("modalId");
const $modalImg = document.getElementById("modalImg");
const $modalName = document.getElementById("modalName");
const $modalTypes = document.getElementById("modalTypes");
const $modalWeight = document.getElementById("modalWeight");
const $modalHeight = document.getElementById("modalHeight");
const $modalCategory = document.getElementById("modalCategory");
const $modalAbilities = document.getElementById("modalAbilities");
const $modalStats = document.getElementById("modalStats");
const $modalWeakness = document.getElementById("modalWeakness");
const $prevBtn = document.getElementById("prevBtn");
const $nextBtn = document.getElementById("nextBtn");
const $modalEvolution = document.getElementById("modalEvolution");
// ---- helpers ------------------------------------------------------
function pad3(id) {
  return String(id).padStart(3, "0");
}

function artworkUrl(id) {
  return `${ARTWORK_BASE}/${pad3(id)}.png`;
}

function titleCase(str) {
  return str.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function weaknessesFor(types) {
  const set = new Set();
  types.forEach((t) => (WEAKNESS_CHART[t] || []).forEach((w) => set.add(w)));
  return [...set];
}

// ---- init: build the lightweight registry (id + name only) --------
async function init() {
  try {
    const res = await fetch(`${API_BASE}/pokemon?limit=${MAX_ID}&offset=0`);
    if (!res.ok) throw new Error(`Registry fetch failed: ${res.status}`);
    const data = await res.json();
    registry = data.results.map((entry, i) => {
      const idMatch = entry.url.match(/\/pokemon\/(\d+)\//);
      return { id: idMatch ? Number(idMatch[1]) : i + 1, name: entry.name };
    });
    applyFilterAndSort({ resetLoaded: true });
    await loadNextPage();
  } catch (err) {
    $countReadout.textContent = "Couldn't reach PokeAPI — check connection";
    console.error(err);
  }
}

// ---- filtering + sorting -------------------------------------------
function applyFilterAndSort({ resetLoaded = false } = {}) {

    const query = $search.value.trim().toLowerCase();

    filteredIds = registry
        .filter(p => {

            const idStr = pad3(p.id);

            const matchesSearch =
                !query ||
                p.name.includes(query) ||
                idStr.includes(query) ||
                String(p.id) === query;

            const detail = detailCache.get(p.id);

            const matchesType =
              activeTypes.length === 0 ||
              activeTypes.every(type =>
              detail.types.includes(type)
              );

return matchesSearch && matchesType;

        })
        .sort((a, b) => {

            if (currentSort === "name") {
                return a.name.localeCompare(b.name);
            }

            return a.id - b.id;

        })
        .map(p => p.id);

    loadedCount = 0;

    $grid.innerHTML = "";

    if (!resetLoaded) {
        loadNextPage();
    }

}

// ---- fetch a single Pokémon's detail (cached) ----------------------
async function fetchDetail(id) {
  if (detailCache.has(id)) return detailCache.get(id);

  const withTimeout = (promise, ms = 8000) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);

  const poke = await withTimeout(fetch(`${API_BASE}/pokemon/${id}`)).then((r) => {
    if (!r.ok) throw new Error(`Pokemon ${id} fetch failed`);
    return r.json();
  });

  // species is optional — don't let it block the whole detail view
  let genusEntry = null;
  try {
    const species = await withTimeout(fetch(`${API_BASE}/pokemon-species/${id}`)).then((r) =>
      r.ok ? r.json() : null
    );
    genusEntry = species?.genera?.find((g) => g.language.name === "en");
  } catch {
    // ignore — category will just show "—"
  }

const detail = {
    id: poke.id,
    name: poke.name,
    height: poke.height,
    weight: poke.weight,
    types: poke.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
    abilities: poke.abilities.map(a => titleCase(a.ability.name)),
    category: genusEntry ? genusEntry.genus : "—",
    stats: poke.stats.map((s) => ({name: s.stat.name, value: s.base_stat,})),
    sprite: poke.sprites?.other?.["official-artwork"]?.front_default || null,
};
  detailCache.set(id, detail);
  return detail;
}
// ---- render cards ------------------------------------------------
function renderCard(entry) {
  const btn = document.createElement("button");
  btn.className = "card";
  btn.setAttribute("data-id", entry.id);
  btn.innerHTML = `
    <span class="card-id">#${pad3(entry.id)}</span>
    <div class="card-img-wrap">
      <img class="card-img" loading="lazy" alt="${titleCase(entry.name)}"
           src="${artworkUrl(entry.id)}"
           onerror="this.onerror=null;this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${entry.id}.png'" />
    </div>
    <span class="card-name">${titleCase(entry.name)}</span>
    <span class="card-types" data-types-for="${entry.id}"></span>
  `;
  btn.addEventListener("click", () => openDetail(entry.id));
  $grid.appendChild(btn);

  // fetch details in the background: tints the card by primary type
  // and fills in the type chip(s), without blocking the initial paint
  fetchDetail(entry.id)
    .then((detail) => {
      const primaryType = detail.types[0];
      btn.classList.add(`t-${primaryType}`);
      const typesEl = btn.querySelector(`[data-types-for="${entry.id}"]`);
      if (typesEl) {
        typesEl.innerHTML = detail.types
          .map((t) => `<span class="type-chip t-${t}">${t}</span>`)
          .join("");
      }
    })
    .catch(() => {});
}

async function loadNextPage() {
  const slice = filteredIds.slice(loadedCount, loadedCount + PAGE_SIZE);
  if (slice.length === 0) {
    updateFooterState();
    return;
  }
  $spinner.hidden = false;
  $loadMoreBtn.disabled = true;

  slice.forEach((id) => {
    const entry = registry.find((p) => p.id === id);
    if (entry) renderCard(entry);
  });

  loadedCount += slice.length;
  $spinner.hidden = true;
  updateFooterState();
}

async function fetchEvolutionChain(id){
    const species = await fetch(`${API_BASE}/pokemon-species/${id}`).then(r=>r.json());
    const evoUrl = species.evolution_chain.url;
    const evo = await fetch(evoUrl).then(r=>r.json());
    const chain=[];
    function walk(node){
        const pokemonId = Number(
            node.species.url.match(/\/pokemon-species\/(\d+)\//)[1]
        );
        chain.push({
            id:pokemonId,
            name:node.species.name
        });
        if(node.evolves_to.length){
            walk(node.evolves_to[0]);
        }
    }
    walk(evo.chain);
    return chain;
}

function updateFooterState() {
  const remaining = filteredIds.length - loadedCount;
  $loadMoreBtn.disabled = remaining <= 0;
  $loadMoreBtn.textContent = remaining > 0 ? `Load More` : "All entries loaded";
  $countReadout.textContent = `${filteredIds.length} entr${filteredIds.length === 1 ? "y" : "ies"} matched · showing ${loadedCount}`;
  $emptyState.hidden = filteredIds.length !== 0;
  $grid.hidden = filteredIds.length === 0;
}

// ---- detail modal --------------------------------------------------
async function openDetail(id) {
  currentDetailId = id;
  $modalBackdrop.hidden = false;
  $modalBody.hidden = true;
  $modalScan.hidden = false;
  document.body.style.overflow = "hidden";

  try {
    const detail = await fetchDetail(id);
    await renderDetail(detail);
  } catch (err) {
    $modalScan.innerHTML = `<span>Couldn't load this record</span>`;
    console.error(err);
    return;
  }
  $modalScan.hidden = true;
  $modalBody.hidden = false;
}

async function renderDetail(detail) {
  const primaryType = detail.types[0];

  // reset banner type classes, apply the current one for the tint gradient
  $modalBanner.className = "modal-banner";
  $modalBanner.classList.add(`t-${primaryType}`);

  $modalId.textContent = `#${pad3(detail.id)}`;
  $modalImg.src = detail.sprite || artworkUrl(detail.id);
  $modalImg.alt = titleCase(detail.name);
  $modalName.textContent = titleCase(detail.name);

  $modalTypes.innerHTML = detail.types
    .map((t) => `<span class="type-chip t-${t}">${t}</span>`)
    .join("");

  $modalWeight.textContent = `${(detail.weight / 10).toFixed(1)} kg`;
  $modalHeight.textContent = `${(detail.height / 10).toFixed(1)} m`;
  $modalCategory.textContent = detail.category;
  $modalAbilities.innerHTML = detail.abilities.map(a => `<span class="type-chip">${a}</span>`).join("");

const STAT_COLOR = {
    hp: "#d63c47",                 // Red
    attack: "#f39c12",             // Orange
    defense: "#3498db",            // Blue
    "special-attack": "#9b59b6",   // Purple
    "special-defense": "#2ecc71",  // Green
    speed: "#7f8c8d"               // Gray
};

$modalStats.innerHTML = detail.stats.map((s) => {

    const percent = Math.min(100, (s.value / 255) * 100);

    return `
        <div class="stat-row">
            <span class="stat-row-label">
                ${STAT_LABEL[s.name] || s.name}
            </span>

            <div class="stat-bar-track">
                <div
                    class="stat-bar-fill"
                    style="
                        width:${percent}%;
                        background:linear-gradient(
                            to right,
                            ${STAT_COLOR[s.name]},
                            ${STAT_COLOR[s.name]}CC
                        );
                    ">
                </div>
            </div>

            <span class="stat-row-value">
                ${s.value}
            </span>
        </div>
    `;
}).join("");

  const weaknesses = weaknessesFor(detail.types);
  $modalWeakness.innerHTML = weaknesses.length
    ? weaknesses.map((t) => `<span class="type-chip t-${t}">${t}</span>`).join("")
    : `<span style="color:var(--ink-dim); font-size:12px;">No notable weaknesses</span>`;

    const evolution = await fetchEvolutionChain(detail.id);
    if ($modalEvolution) {
      $modalEvolution.innerHTML = evolution.map((p,index)=>`
        <div class="evolution-card">
            <img src="${artworkUrl(p.id)}">
            <div class="evolution-id">#${pad3(p.id)}</div>
            <div class="evolution-name">${titleCase(p.name)}</div>
        </div>
        ${index < evolution.length - 1 ? '<div class="evolution-arrow">→</div>' : ''} `).join("");
    }

  $prevBtn.disabled = detail.id <= 1;
  $nextBtn.disabled = detail.id >= MAX_ID;
}

function closeModal() {
  $modalBackdrop.hidden = true;
  document.body.style.overflow = "";
  currentDetailId = null;
}

$prevBtn.addEventListener("click", () => {
  if (currentDetailId > 1) openDetail(currentDetailId - 1);
});
$nextBtn.addEventListener("click", () => {
  if (currentDetailId < MAX_ID) openDetail(currentDetailId + 1);
});
$modalClose.addEventListener("click", closeModal);
$modalBackdrop.addEventListener("click", (e) => {
  if (e.target === $modalBackdrop) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$modalBackdrop.hidden) closeModal();
  if (!$modalBackdrop.hidden && e.key === "ArrowRight" && !$nextBtn.disabled) $nextBtn.click();
  if (!$modalBackdrop.hidden && e.key === "ArrowLeft" && !$prevBtn.disabled) $prevBtn.click();
});

// ---- controls: search / sort / load more ---------------------------
let searchDebounce;
$search.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => applyFilterAndSort(), 220);
});
sortButtons.forEach(btn=>{
    btn.addEventListener("click",()=>{
      sortButtons.forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      currentSort = btn.dataset.sort;
      applyFilterAndSort();
    });
});
$loadMoreBtn.addEventListener("click", loadNextPage);

const filterSelect = document.getElementById("filterSelect");
const filterMenu = document.getElementById("filterMenu");
const selectedTypes = document.getElementById("selectedTypes");

let activeTypes = [];

filterSelect.onclick = ()=>{

    filterMenu.classList.toggle("show");

};

document.querySelectorAll(".filter-pill").forEach(btn=>{
    btn.onclick=()=>{
        const type = btn.dataset.type;
        if(btn.classList.contains("active")){
          btn.classList.remove("active");
          activeTypes = activeTypes.filter(t=>t!==type);

        }else{
            if(activeTypes.length===2)return;
            btn.classList.add("active");
            activeTypes.push(type);
        }

        selectedTypes.textContent =
            activeTypes.length
            ? activeTypes.map(t=>t.charAt(0).toUpperCase()+t.slice(1)).join(", ")
            : "All Types";
        applyFilterAndSort();
    };
});

document.addEventListener("click",(e)=>{
    if(!e.target.closest(".filter-dropdown")){
      filterMenu.classList.remove("show");
    }
});

init();