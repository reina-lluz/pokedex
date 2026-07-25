const API_BASE = "https://pokeapi.co/api/v2";
const ARTWORK_BASE = "https://assets.pokemon.com/assets/cms2/img/pokedex/full";
const PAGE_SIZE = 10;
const MAX_ID = 1010; // covers gen 1-9

// weakness lookup, built from the "Weak Against" column of the type chart.
// for dual types we just combine both lists together.
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

const STAT_LABEL = {
  hp: "HP",
  attack: "ATK",
  defense: "DEF",
  "special-attack": "SP.ATK",
  "special-defense": "SP.DEF",
  speed: "SPD",
};

const STAT_MAX = 200; // ceiling used just for the bar width %

/* ---------------------------------------------------------------
   State
--------------------------------------------------------------- */
let registry = [];             // { id, name } for every Pokémon, fetched once
let detailCache = new Map();   // id -> full detail object, filled in as needed
let filteredIds = [];          // ids currently matching search/filter/sort
let loadedCount = 0;           // how many filteredIds are on screen right now
let currentDetailId = null;    // id shown in the popup, used by prev/next
let currentSort = "id";
let activeTypes = [];          // up to 2 selected type filters
let typeCache = {};            // type name -> array of pokemon ids (avoids refetching)

/* ---------------------------------------------------------------
   DOM references
--------------------------------------------------------------- */
const $grid = document.getElementById("cardGrid");
const $search = document.getElementById("searchInput");
const sortButtons = document.querySelectorAll(".sort-btn");
const $loadMoreBtn = document.getElementById("loadMoreBtn");
const $spinner = document.getElementById("spinner");
const $emptyState = document.getElementById("emptyState");
const $errorState = document.getElementById("errorState");
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
const $modalEvolution = document.getElementById("modalEvolution");
const $prevBtn = document.getElementById("prevBtn");
const $nextBtn = document.getElementById("nextBtn");

/* ---------------------------------------------------------------
   Small helpers
--------------------------------------------------------------- */

// pads an id to 3 digits, e.g. 1 -> "001" (needed for the artwork URLs)
function pad3(id) {
  return String(id).padStart(3, "0");
}

function artworkUrl(id) {
  return `${ARTWORK_BASE}/${pad3(id)}.png`;
}

// "ivysaur" -> "Ivysaur", "special-attack" -> "Special Attack"
function titleCase(str) {
  return str.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// combines the weaknesses of one or two types into a single de-duped list
function weaknessesFor(types) {
  const set = new Set();
  types.forEach((t) => (WEAKNESS_CHART[t] || []).forEach((w) => set.add(w)));
  return [...set];
}

// gets every pokemon id belonging to a given type, cached after first call
async function getPokemonByType(type) {
  if (typeCache[type]) return typeCache[type];

  const res = await fetch(`${API_BASE}/type/${type}`);
  const data = await res.json();

  const ids = data.pokemon.map((p) =>
    Number(p.pokemon.url.match(/\/pokemon\/(\d+)\//)[1])
  );

  typeCache[type] = ids;
  return ids;
}

async function init() {
  try {
    $errorState.hidden = true;

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
    console.error(err);
    $errorState.hidden = false;
  }
}

/* ---------------------------------------------------------------
   Search / type filter / sort
   Runs the registry through all three and rebuilds the grid.
--------------------------------------------------------------- */
async function applyFilterAndSort({ resetLoaded = false } = {}) {
  const query = $search.value.trim().toLowerCase();
  let list = [...registry];

  // search by name or id
  if (query) {
    list = list.filter((p) => {
      const id3 = pad3(p.id);
      return p.name.includes(query) || id3.includes(query) || String(p.id) === query;
    });
  }

  // type filter — supports selecting one or two types at once
  if (activeTypes.length === 1) {
    const ids = await getPokemonByType(activeTypes[0]);
    list = list.filter((p) => ids.includes(p.id));
  } else if (activeTypes.length === 2) {
    const first = await getPokemonByType(activeTypes[0]);
    const second = await getPokemonByType(activeTypes[1]);
    list = list.filter((p) => first.includes(p.id) && second.includes(p.id));
  }

  // sort
  list.sort((a, b) =>
    currentSort === "name" ? a.name.localeCompare(b.name) : a.id - b.id
  );

  filteredIds = list.map((p) => p.id);
  loadedCount = 0;
  $grid.innerHTML = "";

  if (!resetLoaded) loadNextPage();
}

/* ---------------------------------------------------------------
   Detail fetching — pulls /pokemon + /pokemon-species, cached per id
--------------------------------------------------------------- */
async function fetchDetail(id) {
  if (detailCache.has(id)) return detailCache.get(id);

  // wraps a fetch so a stuck request fails instead of hanging forever
  const withTimeout = (promise, ms = 8000) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);

  const poke = await withTimeout(fetch(`${API_BASE}/pokemon/${id}`)).then((r) => {
    if (!r.ok) throw new Error(`Pokemon ${id} fetch failed`);
    return r.json();
  });

  // species data is just for the "category" text — nice to have, not critical,
  // so a failure here shouldn't block the rest of the detail view
  let genusEntry = null;
  try {
    const species = await withTimeout(fetch(`${API_BASE}/pokemon-species/${id}`)).then((r) =>
      r.ok ? r.json() : null
    );
    genusEntry = species?.genera?.find((g) => g.language.name === "en");
  } catch {
    // leave category as "—"
  }

  const detail = {
    id: poke.id,
    name: poke.name,
    height: poke.height,
    weight: poke.weight,
    types: poke.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
    abilities: poke.abilities.map((a) => titleCase(a.ability.name)),
    category: genusEntry ? genusEntry.genus : "—",
    stats: poke.stats.map((s) => ({ name: s.stat.name, value: s.base_stat })),
    sprite: poke.sprites?.other?.["official-artwork"]?.front_default || null,
  };

  detailCache.set(id, detail);
  return detail;
}

/* ---------------------------------------------------------------
   Card rendering
--------------------------------------------------------------- */
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

  // type + card tint load in after the fact so the grid paints immediately
  fetchDetail(entry.id)
    .then((detail) => {
      btn.classList.add(`t-${detail.types[0]}`);
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

function updateFooterState() {
  const remaining = filteredIds.length - loadedCount;
  $loadMoreBtn.disabled = remaining <= 0;
  $loadMoreBtn.textContent = remaining > 0 ? "Load More" : "All entries loaded";
  $emptyState.hidden = filteredIds.length !== 0;
  $grid.hidden = filteredIds.length === 0;
}

/* ---------------------------------------------------------------
   Evolution chain — walks the chain returned by pokemon-species
--------------------------------------------------------------- */
async function fetchEvolutionChain(id) {
  const species = await fetch(`${API_BASE}/pokemon-species/${id}`).then((r) => r.json());
  const evo = await fetch(species.evolution_chain.url).then((r) => r.json());

  const chain = [];
  function walk(node) {
    const pokemonId = Number(node.species.url.match(/\/pokemon-species\/(\d+)\//)[1]);
    chain.push({ id: pokemonId, name: node.species.name });
    if (node.evolves_to.length) walk(node.evolves_to[0]);
  }
  walk(evo.chain);

  return chain;
}

/* ---------------------------------------------------------------
   Detail popup
--------------------------------------------------------------- */
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

  // reset then reapply the type class so the banner gradient updates
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
  $modalAbilities.innerHTML = detail.abilities
    .map((a) => `<span class="type-chip">${a}</span>`)
    .join("");

  const STAT_COLOR = {
    hp: "#d63c47",
    attack: "#f39c12",
    defense: "#3498db",
    "special-attack": "#9b59b6",
    "special-defense": "#2ecc71",
    speed: "#7f8c8d",
  };

  $modalStats.innerHTML = detail.stats
    .map((s) => {
      const percent = Math.min(100, (s.value / 255) * 100);
      return `
        <div class="stat-row">
          <span class="stat-row-label">${STAT_LABEL[s.name] || s.name}</span>
          <div class="stat-bar-track">
            <div class="stat-bar-fill" style="
              width:${percent}%;
              background:linear-gradient(to right, ${STAT_COLOR[s.name]}, ${STAT_COLOR[s.name]}CC);
            "></div>
          </div>
          <span class="stat-row-value">${s.value}</span>
        </div>
      `;
    })
    .join("");

  const weaknesses = weaknessesFor(detail.types);
  $modalWeakness.innerHTML = weaknesses.length
    ? weaknesses.map((t) => `<span class="type-chip t-${t}">${t}</span>`).join("")
    : `<span style="color:var(--ink-dim); font-size:12px;">No notable weaknesses</span>`;

  const evolution = await fetchEvolutionChain(detail.id);
  if ($modalEvolution) {
    $modalEvolution.innerHTML = evolution
      .map(
        (p, index) => `
        <div class="evolution-card">
          <img src="${artworkUrl(p.id)}">
          <div class="evolution-id">#${pad3(p.id)}</div>
          <div class="evolution-name">${titleCase(p.name)}</div>
        </div>
        ${index < evolution.length - 1 ? '<div class="evolution-arrow">→</div>' : ""}
      `
      )
      .join("");
  }

  $prevBtn.disabled = detail.id <= 1;
  $nextBtn.disabled = detail.id >= MAX_ID;
}

function closeModal() {
  $modalBackdrop.hidden = true;
  document.body.style.overflow = "";
  currentDetailId = null;
}

/* ---------------------------------------------------------------
   Event listeners
--------------------------------------------------------------- */
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

// search is debounced so it doesn't refetch on every keystroke
let searchDebounce;
$search.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => applyFilterAndSort(), 220);
});

sortButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    sortButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentSort = btn.dataset.sort;
    applyFilterAndSort();
  });
});

$loadMoreBtn.addEventListener("click", loadNextPage);

/* ---------------------------------------------------------------
   Type filter dropdown
--------------------------------------------------------------- */
const filterSelect = document.getElementById("filterSelect");
const filterMenu = document.getElementById("filterMenu");
const selectedTypes = document.getElementById("selectedTypes");

filterSelect.onclick = () => {
  filterMenu.classList.toggle("show");
};

document.querySelectorAll(".filter-pill").forEach((btn) => {
  btn.onclick = () => {
    const type = btn.dataset.type;

    if (type === "all") {
      activeTypes = [];
      document.querySelectorAll(".filter-pill").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      selectedTypes.textContent = "All Types";
      applyFilterAndSort();
      return;
    }

    document.querySelector(".filter-pill[data-type='all']").classList.remove("active");

    if (btn.classList.contains("active")) {
      btn.classList.remove("active");
      activeTypes = activeTypes.filter((t) => t !== type);
    } else {
      if (activeTypes.length === 2) return; // cap at two types
      btn.classList.add("active");
      activeTypes.push(type);
    }

    if (activeTypes.length === 0) {
      document.querySelector(".filter-pill[data-type='all']").classList.add("active");
      selectedTypes.textContent = "All Types";
    } else {
      selectedTypes.textContent = activeTypes
        .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
        .join(", ");
    }

    applyFilterAndSort();
  };
});

// closes the type dropdown when clicking anywhere outside it
document.addEventListener("click", (e) => {
  if (!e.target.closest(".filter-dropdown")) {
    filterMenu.classList.remove("show");
  }
});

document.getElementById("retryBtn").addEventListener("click", init);

init();