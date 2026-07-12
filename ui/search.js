/**
 * EarthOS Search UI — country / event search with keyboard nav.
 */

import bus, { Events } from '../core/eventBus.js';

export class SearchUI {
  #input;
  #results;
  #data = {};
  #active = -1;
  #items  = [];

  constructor(data = {}) {
    this.#data = data; // { ISO: countryData }
  }

  init() {
    this.#input   = document.getElementById('si');
    this.#results = document.getElementById('sr');
    if (!this.#input || !this.#results) return;

    this.#input.addEventListener('input',   e  => this.#onInput(e.target.value));
    this.#input.addEventListener('keydown', e  => this.#onKey(e));
    this.#input.addEventListener('blur',    () => setTimeout(() => this.#hide(), 120));
    document.addEventListener('click', e => {
      if (!this.#results.contains(e.target) && e.target !== this.#input) this.#hide();
    });
  }

  setData(data) { this.#data = data; }

  #onInput(q) {
    q = q.trim().toLowerCase();
    if (!q) { this.#hide(); return; }

    this.#items = Object.entries(this.#data)
      .filter(([iso, c]) =>
        c.n?.toLowerCase().includes(q) ||
        iso.toLowerCase().includes(q)  ||
        c.cap?.toLowerCase().includes(q)
      )
      .slice(0, 8)
      .map(([iso, c]) => ({ iso, ...c }));

    if (!this.#items.length) { this.#hide(); return; }

    this.#results.innerHTML = this.#items.map((c, i) =>
      `<div class="sri" data-i="${i}">
        <span style="opacity:.4;font-size:10px;font-family:monospace">${c.iso}</span>
        ${c.n}
        <span style="opacity:.35;font-size:10px">${c.cap ?? ''}</span>
      </div>`
    ).join('');

    this.#results.querySelectorAll('.sri').forEach((el, i) => {
      el.addEventListener('click', () => this.#select(i));
    });

    this.#results.style.display = 'block';
    this.#active = -1;
  }

  #onKey(e) {
    const n = this.#items.length;
    if (!n) return;
    if (e.key === 'ArrowDown')  { e.preventDefault(); this.#setActive(Math.min(this.#active + 1, n - 1)); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); this.#setActive(Math.max(this.#active - 1, 0)); }
    if (e.key === 'Enter')      { e.preventDefault(); if (this.#active >= 0) this.#select(this.#active); }
    if (e.key === 'Escape')     { this.#hide(); this.#input.blur(); }
  }

  #setActive(i) {
    this.#active = i;
    this.#results.querySelectorAll('.sri').forEach((el, j) =>
      el.style.background = j === i ? 'rgba(255,255,255,0.08)' : ''
    );
  }

  #select(i) {
    const country = this.#items[i];
    this.#input.value = country.n ?? '';
    this.#hide();
    bus.emit(Events.COUNTRY_SELECTED, { country });
    bus.emit(Events.SEARCH_QUERY, { query: country.n, result: country });
  }

  #hide() {
    this.#results.style.display = 'none';
    this.#active = -1;
  }
}

export default SearchUI;
