# Pokédex

A Pokémon catalogue web app built with vanilla HTML, CSS, and JavaScript — no frameworks, no build step. Data comes from [PokeAPI](https://pokeapi.co/).

## Running it

This is a static site, so there's nothing to install or build.

- Simplest Way: open `index.html` directly in a browser.
- Recommended: use a local server (e.g. the VS Code "Live Server" extension, or `npx serve .`) to avoid any browser restrictions on local file requests.

Requires an internet connection — all Pokémon data and images are fetched live from PokeAPI and Pokémon's official asset CDN.

Features
- Card grid listing every Pokémon, showing ID, name, photo, and type
- Search by name or ID number
- Sort by ID or name
- Filter by type (supports combining up to two types at once)
- Loads 10 Pokémon at a time, with a "Load More" button
- Click a card to open a detail view with:
  - Height, weight, category, abilities
  - Base stats with colored bars
  - Weaknesses, derived from the Pokémon's type(s)
  - Evolution chain
  - Next / Previous navigation by ID (also works with arrow keys)
- Error state with a retry button if data fails to load (e.g. no connection)

Tech
- Plain HTML/CSS/JS, no dependencies
- [PokeAPI](https://pokeapi.co/) for Pokémon data
- Artwork served from `assets.pokemon.com`, with a fallback to PokeAPI's own sprite CDN if an image is unavailable for a given ID

Project structure
index.html    — page structure and markup
styles.css    — all styling
app.js        — data fetching, search/sort/filter logic, card + detail rendering
