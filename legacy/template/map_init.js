mapboxgl.accessToken = 'REDACTED_MAPBOX_TOKEN';
// Assigning constants to sources of the layers
const districtBoundarySource = {
    type: 'geojson',
    data: 'http://172.18.1.4:8080/geoserver/abdul_sattar/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=abdul_sattar%3AProvincial_Boundary&outputFormat=application%2Fjson'
};
//_______________________________________________________________________________________________________________________
const map1 = new mapboxgl.Map({
    container: 'map',
    zoom: 7,
    center: [72.98695108531231, 35.323007094843575],
    pitch: 60,
    bearing: 0,
    style: 'mapbox://styles/mapbox/satellite-streets-v12',
});

const fullscreenContainer = document.body;

function updateFullscreenToggleButtonState() {
    const fullscreenToggle = document.getElementById('fullscreenToggle');
    if (!fullscreenToggle) {
        return;
    }

    const isFullscreen = document.fullscreenElement === fullscreenContainer;
    fullscreenToggle.setAttribute('aria-pressed', String(isFullscreen));
    fullscreenToggle.title = isFullscreen ? 'Exit map fullscreen' : 'Enter map fullscreen';
    fullscreenToggle.innerHTML = isFullscreen
        ? '<svg xmlns="http://www.w3.org/2000/svg" class="fullscreen-icon" viewBox="0 0 16 16" fill="white" aria-hidden="true"><path d="M5 1v2H3v2H1V1h4zm6 0h4v4h-2V3h-2V1zM1 11h2v2h2v2H1v-4zm12 0h2v4h-4v-2h2v-2z"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" class="fullscreen-icon" viewBox="0 0 16 16" fill="white" aria-hidden="true"><path d="M1 1h5v2H3v3H1V1zm10 0h4v5h-2V3h-2V1zM1 10h2v3h3v2H1v-5zm12 0h2v5h-5v-2h3v-3z"/></svg>';

    if (map1) {
        window.requestAnimationFrame(() => {
            map1.resize();
        });
    }
}

async function toggleMapFullscreen() {
    if (!fullscreenContainer) {
        return;
    }

    if (document.fullscreenElement === fullscreenContainer) {
        if (document.exitFullscreen) {
            await document.exitFullscreen();
        }
        return;
    }

    if (fullscreenContainer.requestFullscreen) {
        await fullscreenContainer.requestFullscreen();
    }
}

document.addEventListener('fullscreenchange', updateFullscreenToggleButtonState);
updateFullscreenToggleButtonState();

// Custom 3D / 2D toggle control
class PitchToggleControl {
    constructor() {
        this._is3D = true; // map starts at pitch:60
    }
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        this._btn = document.createElement('button');
        this._btn.className = 'pitch-toggle-btn';
        this._btn.title = 'Toggle 3D / Flat view';
        this._btn.innerHTML = '2D';
        this._btn.onclick = () => {
            this._is3D = !this._is3D;
            map.easeTo({
                pitch: this._is3D ? 60 : 0,
                bearing: 0,
                duration: 800
            });
            this._btn.innerHTML = this._is3D ? '2D' : '3D';
            this._btn.title = this._is3D ? 'Switch to Flat view' : 'Switch to 3D view';
        };
        this._container.appendChild(this._btn);
        return this._container;
    }
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}

class PopulatedPlacesSearchControl {
    constructor(options = {}) {
        this._defaultZoom = Number.isFinite(options.defaultZoom) ? options.defaultZoom : 10;
        this._placesByNormalizedName = new Map();
        this._placesList = [];
        this._isOpen = false;
    }

    onAdd(map) {
        this._map = map;

        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl populated-places-search-control';

        this._toggleButton = document.createElement('button');
        this._toggleButton.className = 'populated-places-search-toggle-btn';
        this._toggleButton.type = 'button';
        this._toggleButton.setAttribute('aria-label', 'Open populated places search');
        this._toggleButton.setAttribute('aria-expanded', 'false');
        this._toggleButton.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10.5 3a7.5 7.5 0 0 1 5.966 12.046l4.244 4.245a1 1 0 1 1-1.414 1.414l-4.245-4.244A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>';

        this._panel = document.createElement('div');
        this._panel.className = 'populated-places-search-panel';

        this._form = document.createElement('form');
        this._form.className = 'populated-places-search-form';
        this._form.setAttribute('role', 'search');

        this._input = document.createElement('input');
        this._input.className = 'populated-places-search-input';
        this._input.type = 'search';
        this._input.placeholder = 'Search populated place';
        this._input.setAttribute('aria-label', 'Search populated places by name');
        this._input.setAttribute('autocomplete', 'off');

        const datalistId = `populated-places-search-options-${Date.now()}`;
        this._input.setAttribute('list', datalistId);

        this._datalist = document.createElement('datalist');
        this._datalist.id = datalistId;

        this._button = document.createElement('button');
        this._button.className = 'populated-places-search-btn';
        this._button.type = 'submit';
        this._button.textContent = 'Go';
        this._button.setAttribute('aria-label', 'Search and zoom to place');

        this._status = document.createElement('div');
        this._status.className = 'populated-places-search-status';
        this._status.setAttribute('aria-live', 'polite');

        this._form.appendChild(this._input);
        this._form.appendChild(this._button);
        this._panel.appendChild(this._form);
        this._panel.appendChild(this._status);

        this._container.appendChild(this._toggleButton);
        this._container.appendChild(this._panel);
        this._container.appendChild(this._datalist);

        this._handleSubmit = (event) => {
            event.preventDefault();
            this._searchAndZoom(this._input.value);
        };

        this._handleToggleButtonClick = () => {
            this._setOpen(!this._isOpen);
        };

        this._handleOutsideClick = (event) => {
            if (this._isOpen && this._container && !this._container.contains(event.target)) {
                this._setOpen(false);
            }
        };

        this._handleInputKeydown = (event) => {
            if (event.key === 'Escape') {
                this._setOpen(false);
                this._toggleButton.focus();
            }
        };

        this._handleSourceData = (event) => {
            if (event && event.sourceId === 'populatedPlaces' && event.isSourceLoaded) {
                this._refreshPlacesIndex();
            }
        };

        this._handleStyleLoad = () => {
            this._refreshPlacesIndex();
        };

        this._form.addEventListener('submit', this._handleSubmit);
        this._toggleButton.addEventListener('click', this._handleToggleButtonClick);
        this._input.addEventListener('keydown', this._handleInputKeydown);
        document.addEventListener('pointerdown', this._handleOutsideClick);
        map.on('sourcedata', this._handleSourceData);
        map.on('style.load', this._handleStyleLoad);

        this._refreshPlacesIndex();
        return this._container;
    }

    onRemove() {
        if (this._form && this._handleSubmit) {
            this._form.removeEventListener('submit', this._handleSubmit);
        }

        if (this._toggleButton && this._handleToggleButtonClick) {
            this._toggleButton.removeEventListener('click', this._handleToggleButtonClick);
        }

        if (this._input && this._handleInputKeydown) {
            this._input.removeEventListener('keydown', this._handleInputKeydown);
        }

        document.removeEventListener('pointerdown', this._handleOutsideClick);

        if (this._map) {
            this._map.off('sourcedata', this._handleSourceData);
            this._map.off('style.load', this._handleStyleLoad);
        }

        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }

        this._map = undefined;
    }

    _setOpen(isOpen) {
        this._isOpen = Boolean(isOpen);

        if (!this._container || !this._toggleButton) {
            return;
        }

        this._container.classList.toggle('is-open', this._isOpen);
        this._toggleButton.setAttribute('aria-expanded', String(this._isOpen));

        if (this._isOpen && this._input) {
            this._input.focus();
            this._input.select();
        }
    }

    _normalizePlaceName(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    _extractPlaceName(feature) {
        const properties = feature && feature.properties ? feature.properties : {};
        const candidateNames = [properties.name, properties.Name, properties.NAME];

        for (let i = 0; i < candidateNames.length; i += 1) {
            const candidate = candidateNames[i];
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate.trim();
            }
        }

        return '';
    }

    _extractPointCoordinates(feature) {
        if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) {
            return null;
        }

        if (feature.geometry.type === 'Point' && feature.geometry.coordinates.length >= 2) {
            const lng = Number(feature.geometry.coordinates[0]);
            const lat = Number(feature.geometry.coordinates[1]);
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
                return [lng, lat];
            }
        }

        return null;
    }

    _setStatus(message, isError) {
        if (!this._status) {
            return;
        }

        this._status.textContent = message || '';
        this._status.classList.toggle('is-error', Boolean(isError && message));
    }

    _syncDatalist() {
        if (!this._datalist) {
            return;
        }

        this._datalist.innerHTML = '';

        const maxOptions = 400;
        this._placesList.slice(0, maxOptions).forEach((place) => {
            const option = document.createElement('option');
            option.value = place.name;
            this._datalist.appendChild(option);
        });
    }

    _refreshPlacesIndex() {
        if (!this._map || !this._map.getSource('populatedPlaces')) {
            return;
        }

        let features = [];
        try {
            features = this._map.querySourceFeatures('populatedPlaces');
        } catch (error) {
            return;
        }

        if (!Array.isArray(features) || features.length === 0) {
            return;
        }

        const nextByName = new Map();
        const nextList = [];

        features.forEach((feature) => {
            const name = this._extractPlaceName(feature);
            const normalizedName = this._normalizePlaceName(name);
            const coordinates = this._extractPointCoordinates(feature);

            if (!normalizedName || !coordinates || nextByName.has(normalizedName)) {
                return;
            }

            const record = {
                name,
                normalizedName,
                coordinates
            };

            nextByName.set(normalizedName, record);
            nextList.push(record);
        });

        if (!nextList.length) {
            return;
        }

        nextList.sort((a, b) => a.name.localeCompare(b.name));
        this._placesByNormalizedName = nextByName;
        this._placesList = nextList;
        this._syncDatalist();
    }

    _showPopulatedPlacesLayers() {
        const layerIds = [
            'populated-places-points-layer',
            'populated-places-name-label-layer',
            'populated-places-population-label-layer'
        ];

        layerIds.forEach((layerId) => {
            if (this._map.getLayer(layerId)) {
                this._map.setLayoutProperty(layerId, 'visibility', 'visible');
            }
        });
    }

    _searchAndZoom(rawQuery) {
        const normalizedQuery = this._normalizePlaceName(rawQuery);

        if (!normalizedQuery) {
            this._setStatus('Type a populated place name.', true);
            return;
        }

        if (!this._placesList.length) {
            this._refreshPlacesIndex();
        }

        let match = this._placesByNormalizedName.get(normalizedQuery);
        if (!match) {
            match = this._placesList.find((place) => place.normalizedName.includes(normalizedQuery));
        }

        if (!match) {
            this._setStatus('No populated place found.', true);
            return;
        }

        this._showPopulatedPlacesLayers();

        this._map.flyTo({
            center: match.coordinates,
            zoom: Math.max(this._map.getZoom(), this._defaultZoom),
            duration: 1100,
            essential: true
        });

        this._input.value = match.name;
        this._setStatus(`Zoomed to ${match.name}.`, false);
        this._setOpen(false);
    }
}
map1.addControl(new PopulatedPlacesSearchControl({ defaultZoom: 10 }), 'top-right');
map1.addControl(new mapboxgl.FullscreenControl({ container: fullscreenContainer }), 'top-right');
map1.addControl(new mapboxgl.NavigationControl(), 'top-right');
map1.addControl(
    new mapboxgl.GeolocateControl({
        positionOptions: {
            enableHighAccuracy: true
        },
        trackUserLocation: true,
        showUserHeading: true
    }),
    'top-right'
);
map1.addControl(new PitchToggleControl(), 'top-right');
//________________________________________________________________________________________________________________________________________________________________________________________
map1.on('style.load', () => {
    map1.addSource('mapbox-dem', {
        'type': 'raster-dem',
        'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
        'tileSize': 512,
        'maxzoom': 14
    });
    // add the DEM source as a terrain layer with exaggerated height
    map1.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
});