const gridEl = document.getElementById('stringer-picker-grid');
const metaEl = document.getElementById('picker-meta');
const emptyEl = document.getElementById('picker-empty');
const selectedFiltersEl = document.getElementById('selected-filters');
const changeSearchLink = document.getElementById('change-search-link');
const LISTINGS_KEY = 'rmr_listings_v1';

if (!gridEl || !metaEl || !emptyEl || !selectedFiltersEl || !changeSearchLink) {
  // Stringer picker UI is not present.
} else {
  const DEMO_STRINGERS = [
    {
      name: 'Oslo Racket Lab',
      city: 'Oslo',
      fromPrice: 175,
      waitTime: '24 timer',
      sports: ['Tennis'],
      trust: 'Erfaren stringer'
    },
    {
      name: 'Bergen String Studio',
      city: 'Bergen',
      fromPrice: 190,
      waitTime: 'Samme dag',
      sports: ['Tennis', 'Squash'],
      trust: 'Samme-dag tilgjengelig'
    },
    {
      name: 'Trondheim Court Service',
      city: 'Trondheim',
      fromPrice: 180,
      waitTime: '24-48 timer',
      sports: ['Tennis', 'Badminton'],
      trust: 'Verifisert oppføring'
    },
    {
      name: 'Stavanger Pro Strings',
      city: 'Stavanger',
      fromPrice: 185,
      waitTime: '24 timer',
      sports: ['Tennis', 'Squash'],
      trust: 'Rask levering'
    },
    {
      name: 'Nordic Badminton Care',
      city: 'Oslo',
      fromPrice: 170,
      waitTime: '24-48 timer',
      sports: ['Badminton', 'Squash'],
      trust: 'Turneringsklar strenging'
    },
    {
      name: 'Vestlandet String Hub',
      city: 'Bergen',
      fromPrice: 185,
      waitTime: '48 timer',
      sports: ['Tennis', 'Badminton'],
      trust: 'Pålitelig klubbpartner'
    }
  ];

  const params = new URLSearchParams(window.location.search);

  function normalize(value) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  function titleCase(value) {
    return String(value || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  function safeParse(rawValue, fallback) {
    try {
      const parsed = JSON.parse(rawValue);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function parsePrice(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : NaN;
    }

    const raw = String(value || '').trim();
    if (!raw) return NaN;
    const normalized = raw.replace(/\s+/g, '').replace(',', '.');
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : NaN;
  }

  function canonicalSport(value) {
    const raw = normalize(value);
    if (!raw) return '';
    const knownSports = ['tennis', 'squash', 'badminton'];
    const hit = knownSports.find((sport) => sport.startsWith(raw));
    return hit ? hit.charAt(0).toUpperCase() + hit.slice(1) : '';
  }

  function toStringerCardData(entry) {
    const fallbackName = String(entry?.ownerName || '').trim();
    const name = String(entry?.businessName || entry?.name || '').trim() || (fallbackName ? `${fallbackName} Stringer` : '');
    const city = titleCase(entry?.city);
    const fromPrice = parsePrice(entry?.fromPrice);
    const waitTime = String(entry?.waitTime || '').trim();
    const trust = String(entry?.trustSignal || entry?.trust || 'Ny stringer').trim();
    const mappedSports = Array.isArray(entry?.sports)
      ? entry.sports
          .map((sport) => canonicalSport(sport))
          .filter(Boolean)
      : [];
    const sports = mappedSports.length > 0 ? mappedSports : ['Tennis'];

    if (!name || !city) {
      return null;
    }

    return {
      name,
      city,
      fromPrice: Number.isFinite(fromPrice) && fromPrice > 0 ? Math.round(fromPrice) : 175,
      waitTime: waitTime || 'Ikke oppgitt',
      sports,
      trust
    };
  }

  function readLocalCommunityStringers() {
    const raw = safeParse(localStorage.getItem(LISTINGS_KEY), []);
    if (!Array.isArray(raw)) return [];
    return raw.map(toStringerCardData).filter(Boolean);
  }

  async function readApiCommunityStringers() {
    try {
      const response = await fetch('/api/stringers');
      if (!response.ok) return [];
      const data = await response.json();
      if (!Array.isArray(data)) return [];
      return data.map(toStringerCardData).filter(Boolean);
    } catch {
      return [];
    }
  }

  function dedupeStringers(stringers) {
    const seen = new Set();
    return stringers.filter((stringer) => {
      const key = [
        normalize(stringer.name),
        normalize(stringer.city),
        Number(stringer.fromPrice),
        normalize(stringer.waitTime),
        [...stringer.sports].map(normalize).sort().join(',')
      ].join('|');

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function bestCity(value, stringers) {
    const raw = normalize(value);
    if (!raw) return '';

    const knownCities = [...new Set(stringers.map((stringer) => stringer.city))];
    const exact = knownCities.find((city) => normalize(city) === raw);
    if (exact) return exact;

    const partial = knownCities.find((city) => normalize(city).includes(raw));
    return partial || titleCase(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function render(stringers) {
    const location = bestCity(params.get('location'), stringers);
    const sport = canonicalSport(params.get('sport'));
    const displayLocation = location || params.get('location') || 'alle steder';
    const displaySport = sport || params.get('sport') || 'alle sporter';

    selectedFiltersEl.textContent = `Valgt søk: ${displaySport} i ${displayLocation}`;
    changeSearchLink.href = `./index.html#hjem`;

    const filtered = stringers.filter((stringer) => {
      const normalizedCity = normalize(stringer.city);
      const normalizedLocation = normalize(location);
      const cityMatch =
        !location ||
        normalizedCity === normalizedLocation ||
        normalizedCity.includes(normalizedLocation) ||
        normalizedLocation.includes(normalizedCity);
      const sportMatch = !sport || stringer.sports.includes(sport);
      return cityMatch && sportMatch;
    });

    if (filtered.length === 0) {
      emptyEl.hidden = false;
      gridEl.innerHTML = '';
      metaEl.textContent = `0 treff for ${displaySport} i ${displayLocation}`;
      return;
    }

    emptyEl.hidden = true;
    metaEl.textContent = `${filtered.length} stringer${filtered.length === 1 ? '' : 'e'} for ${displaySport} i ${displayLocation}`;

    gridEl.innerHTML = filtered
      .map((stringer) => {
        const selectedSport = sport && stringer.sports.includes(sport) ? sport : stringer.sports[0];
        const bookingParams = new URLSearchParams({
          location: stringer.city,
          sport: selectedSport,
          stringer: stringer.name,
          price: String(stringer.fromPrice),
          wait: stringer.waitTime
        });

        return `
          <article class="stringer-card">
            <h3>${escapeHtml(stringer.name)}</h3>
            <p class="card-city">${escapeHtml(stringer.city)}</p>
            <ul class="stringer-meta">
              <li>Fra NOK ${stringer.fromPrice}</li>
              <li>Ventetid: ${escapeHtml(stringer.waitTime)}</li>
              <li>Sporter: ${escapeHtml(stringer.sports.join(', '))}</li>
            </ul>
            <span class="trust-pill">${escapeHtml(stringer.trust)}</span>
            <a class="card-link" href="./booking.html?${bookingParams.toString()}">Velg stringer</a>
          </article>
        `;
      })
      .join('');
  }

  async function initStringerPicker() {
    const local = readLocalCommunityStringers();
    const api = await readApiCommunityStringers();
    const all = dedupeStringers([...api, ...local, ...DEMO_STRINGERS]);
    render(all);
  }

  initStringerPicker();
}
