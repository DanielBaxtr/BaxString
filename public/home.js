const searchForm = document.getElementById('search-form');
const sportInput = document.getElementById('sport-input');
const locationInput = document.getElementById('location-input');
const categoryCards = Array.from(document.querySelectorAll('.category-card'));
const cityOptions = document.getElementById('city-options');
const LISTINGS_KEY = 'rmr_listings_v1';

if (!searchForm || !sportInput || !locationInput) {
  // Homepage controls not available.
} else {
  const DEFAULT_CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];
  const KNOWN_SPORTS = ['tennis', 'squash', 'badminton', 'padel'];

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

  function readCommunityCities() {
    const raw = safeParse(localStorage.getItem(LISTINGS_KEY), []);
    if (!Array.isArray(raw)) return [];

    return raw
      .map((entry) => titleCase(entry?.city))
      .filter(Boolean);
  }

  function getKnownCities() {
    return [...new Set([...DEFAULT_CITIES, ...readCommunityCities()])];
  }

  function renderCityOptions(cities = getKnownCities()) {
    if (!cityOptions) return;
    cityOptions.innerHTML = cities.map((city) => `<option value="${city}"></option>`).join('');
  }

  async function fetchApiCities() {
    try {
      const response = await fetch('/api/stringers');
      if (!response.ok) return [];
      const data = await response.json();
      if (!Array.isArray(data)) return [];

      return data
        .map((item) => titleCase(item?.city))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function canonicalSport(value) {
    const raw = normalize(value);
    if (!raw) return '';
    const hit = KNOWN_SPORTS.find((sport) => sport.startsWith(raw));
    if (!hit) return '';
    return hit.charAt(0).toUpperCase() + hit.slice(1);
  }

  function bestCity(value) {
    const raw = normalize(value);
    if (!raw) return '';

    const knownCities = getKnownCities();
    const exact = knownCities.find((city) => normalize(city) === raw);
    if (exact) return exact;

    const partial = knownCities.find((city) => normalize(city).includes(raw));
    return partial || titleCase(value);
  }

  function setActiveCategory(selectedSport) {
    categoryCards.forEach((card) => {
      card.classList.toggle('is-active', card.dataset.sport === selectedSport);
    });
  }

  function syncCategoryFromInput() {
    const selectedSport = canonicalSport(sportInput.value);
    setActiveCategory(selectedSport);
  }

  categoryCards.forEach((card) => {
    card.addEventListener('click', () => {
      sportInput.value = card.dataset.sport || '';
      syncCategoryFromInput();
      searchForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  sportInput.addEventListener('input', syncCategoryFromInput);
  sportInput.addEventListener('change', syncCategoryFromInput);

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const location = bestCity(locationInput.value);
    const sport = canonicalSport(sportInput.value);

    if (!location || !sport) {
      return;
    }

    const params = new URLSearchParams({ location, sport });
    window.location.href = `./stringers.html?${params.toString()}`;
  });

  renderCityOptions();
  fetchApiCities().then((apiCities) => {
    if (!apiCities.length) return;
    const merged = [...new Set([...getKnownCities(), ...apiCities])];
    renderCityOptions(merged);
  });
  syncCategoryFromInput();
}
