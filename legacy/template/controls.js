// ── Vulnerable Sites 2026 — icon points toggle ─────────────────────────────
function toggleVulSites2026(map) {
    const layer = 'vul-sites-2026-layer';
    const isVisible = map.getLayoutProperty(layer, 'visibility') === 'visible';
    map.setLayoutProperty(layer, 'visibility', isVisible ? 'none' : 'visible');
}
// ── Chatiboi Lake toggle ───────────────────────────────────────────────────
function toggleChatiboiLayer(map) {
    const fill    = 'chatiboi-lake-fill';
    const outline = 'chatiboi-lake-outline';
    const isVisible = map.getLayoutProperty(fill, 'visibility') === 'visible';
    const next = isVisible ? 'none' : 'visible';
    map.setLayoutProperty(fill,    'visibility', next);
    map.setLayoutProperty(outline, 'visibility', next);
}
// ───────────────────────────────────────────────────────────────────────────
// ── Vulnerable Lakes 2026 — blinking outline toggle ──────────────────────
let glofLakesBlinkInterval = null;

function toggleGlofLakes(map) {
    const fillLayer = 'glof-lakes-fill';
    const outLayer  = 'glof-lakes-outline';
    const pinLayer  = 'glof-lakes-centroid';
    const isVisible = map.getLayoutProperty(pinLayer, 'visibility') === 'visible';

    if (!isVisible) {
        // Keep polygon layers hidden, show centroid ring layer only
        if (map.getLayer(fillLayer)) map.setLayoutProperty(fillLayer, 'visibility', 'none');
        if (map.getLayer(outLayer)) map.setLayoutProperty(outLayer, 'visibility', 'none');
        if (map.getLayer(pinLayer)) map.setLayoutProperty(pinLayer, 'visibility', 'visible');

        // Blink ring icon similar to 2025 marker blinking behavior
        let iconOn = true;
        glofLakesBlinkInterval = setInterval(function () {
            if (map.getLayer(pinLayer)) {
                map.setPaintProperty(pinLayer, 'icon-opacity', iconOn ? 1 : 0);
            }
            iconOn = !iconOn;
        }, 500);
    } else {
        // Stop blinking and hide
        if (glofLakesBlinkInterval !== null) {
            clearInterval(glofLakesBlinkInterval);
            glofLakesBlinkInterval = null;
        }
        if (map.getLayer(pinLayer)) {
            map.setPaintProperty(pinLayer, 'icon-opacity', 1); // reset for next show
            map.setLayoutProperty(pinLayer, 'visibility', 'none');
        }
        if (map.getLayer(fillLayer)) map.setLayoutProperty(fillLayer, 'visibility', 'none');
        if (map.getLayer(outLayer)) map.setLayoutProperty(outLayer, 'visibility', 'none');
    }
}
// ─────────────────────────────────────────────────────────────────────────────

function isLayerVisible(layerId) {
    return !!(map1 && map1.getLayer(layerId) && map1.getLayoutProperty(layerId, 'visibility') === 'visible');
}

function setLayerVisibility(layerId, isVisible) {
    if (!map1 || !map1.getLayer(layerId)) {
        return;
    }
    map1.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
    refreshActiveLayersLegend();
}

function refreshActiveLayersLegend() {
    const legendItemsContainer = document.getElementById('active-layers-legend-items');
    const legendPanel = document.getElementById('active-layers-legend');
    const menu = document.getElementById('menu');

    if (!legendItemsContainer || !legendPanel || !menu) {
        return;
    }

    const checkedInputs = Array.from(menu.querySelectorAll('input.form-check-input[type="checkbox"]:checked'));
    const enabledLayers = checkedInputs
        .map((inputElement) => {
            const label = menu.querySelector(`label[for="${inputElement.id}"]`);
            const layerName = label ? label.textContent.trim() : '';
            return {
                id: inputElement.id,
                layerName
            };
        })
        .filter((layer) => layer.layerName.length > 0);

    legendItemsContainer.innerHTML = '';

    if (!enabledLayers.length) {
        legendPanel.classList.add('is-hidden');
        return;
    }

    legendPanel.classList.remove('is-hidden');

    enabledLayers.forEach((layer) => {
        const item = document.createElement('div');
        item.className = 'active-layers-legend-item';

        const icon = document.createElement('span');
        icon.className = `active-layers-legend-icon ${getLegendIconClass(layer.id, layer.layerName)}`;
        icon.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.textContent = layer.layerName;

        item.appendChild(icon);
        item.appendChild(text);
        legendItemsContainer.appendChild(item);
    });
}

function getLegendIconClass(inputId, layerName) {
    const normalizedName = String(layerName || '').toLowerCase();

    if (inputId === 'quick-gmrc-wapda-toggle') {
        return 'icon-blue-destination';
    }

    if (inputId === 'quick-glof-ii-toggle') {
        return 'icon-yellow-destination';
    }

    if (
        inputId === 'quick-glof-ii-damaged-toggle' ||
        inputId === 'quick-high-temp-2026-toggle' ||
        normalizedName.includes('damaged') ||
        normalizedName.includes('warning')
    ) {
        return 'icon-warning';
    }

    if (
        inputId === 'quick-akah-stations-toggle' ||
        inputId === 'quick-undp-all-sensors-toggle' ||
        normalizedName.includes('station') ||
        normalizedName.includes('sensor')
    ) {
        return 'icon-green-destination';
    }

    return 'icon-default';
}

function initializeActiveLayersLegend() {
    const menu = document.getElementById('menu');
    if (!menu || menu.__activeLayersLegendBound) {
        refreshActiveLayersLegend();
        return;
    }

    menu.addEventListener('change', refreshActiveLayersLegend);
    menu.__activeLayersLegendBound = true;
    refreshActiveLayersLegend();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeActiveLayersLegend);
} else {
    initializeActiveLayersLegend();
}

function toggleGlacialLakesInventory(isChecked) {
    setLayerVisibility('glacial-lakes-inventory-fill', isChecked);
    setLayerVisibility('glacial-lakes-inventory-outline', isChecked);
    setLayerVisibility('glacial-lakes-inventory-centers', isChecked);
}

function toggleQuickAkahLayer(isChecked) {
    setLayerVisibility('akah-infrastructure-layer', isChecked);
}

function toggleQuickPopulatedPlaces(isChecked) {
    setLayerVisibility('populated-places-points-layer', isChecked);
    setLayerVisibility('populated-places-name-label-layer', isChecked);
    setLayerVisibility('populated-places-population-label-layer', isChecked);

    if (!isChecked && typeof window.hidePopulatedPlacesHoverAnimationMarker === 'function') {
        window.hidePopulatedPlacesHoverAnimationMarker();
    }
}

function toggleQuickGmrcWapda(isChecked) {
    setLayerVisibility('gmrc-wapda-points-layer', isChecked);
}

function toggleQuickGlofII(isChecked) {
    setLayerVisibility('glof-ii-stations-layer', isChecked);
}

function toggleQuickGlofIIDamagedStations(isChecked) {
    setLayerVisibility('glof-ii-damaged-stations-layer', isChecked);
}

function toggleQuickAkahStations(isChecked) {
    setLayerVisibility('akah-stations-layer', isChecked);
}

function toggleQuickUndpAllSensors(isChecked) {
    setLayerVisibility('undp-all-sensors-layer', isChecked);
}

function toggleFloodSusceptibility(isChecked) {
    setLayerVisibility('flood-susceptibility-layer', isChecked);
}

const akahHazardTypeLayerMap = {
    ava: ['akah-hzd-ava-layer', 'akah-hzd-ava-outline-layer'],
    dbf: ['akah-hzd-dbf-layer', 'akah-hzd-dbf-outline-layer'],
    bnk: ['akah-hzd-bnk-layer', 'akah-hzd-bnk-outline-layer'],
    fld: ['akah-hzd-fld-layer', 'akah-hzd-fld-outline-layer'],
    lds: ['akah-hzd-lds-layer', 'akah-hzd-lds-outline-layer'],
    rkf: ['akah-hzd-rkf-layer', 'akah-hzd-rkf-outline-layer'],
    ufl: ['akah-hzd-ufl-layer', 'akah-hzd-ufl-outline-layer']
};

function toggleAkahHazardType(typeCode, isChecked) {
    const layerIds = akahHazardTypeLayerMap[typeCode];
    if (!Array.isArray(layerIds)) {
        return;
    }
    layerIds.forEach((layerId) => setLayerVisibility(layerId, isChecked));
}

function toggleQuickVulnerableSites2025(isChecked) {
    setLayerVisibility('vulSites', isChecked);
    if (isChecked) {
        changeVideo1(DEFAULT_TOP_VIDEO);
        changeVideo2(DEFAULT_BOTTOM_VIDEO);
    }
}

function toggleQuickVulnerableLakes2025(isChecked) {
    setLayerVisibility('vulLakes', isChecked);
}

function toggleQuickIncident2025(isChecked) {
    const incidentIsVisible = isLayerVisible('incident');
    if (incidentIsVisible !== isChecked) {
        handleIncidentButton();
    }
}

function toggleQuickVulnerableSites2026(isChecked) {
    setLayerVisibility('vul-sites-2026-layer', isChecked);
}

function toggleQuickVulnerableLakes2026(isChecked) {
    const lakesVisible = isLayerVisible('glof-lakes-centroid');
    if (lakesVisible !== isChecked) {
        toggleGlofLakes(map1);
    }
}

function toggleQuickStationPoints(isChecked) {
    setLayerVisibility('station-points-layer', false);
    setLayerVisibility('station-points-animated-halo-layer', isChecked);
    setLayerVisibility('station-points-animated-layer', isChecked);
    setLayerVisibility('station-points-label-layer', isChecked);

    if (isChecked) {
        enableStationPointAnimation();
        return;
    }

    disableStationPointAnimation();
    closeStationForecastWidget();
}

const STATION_FORECAST_CSV_URL = 'data/station%20forecast%20data.csv';
const STATION_POINTS_GEOJSON_URL = 'data/geojsons/station_points.geojson';
const STATION_ANIMATION_SPEED_PER_SECOND = 1.6;

let stationForecastLoadPromise = null;
let stationForecastHeaders = [];
let stationForecastHeaderLookup = {};
let stationForecastSeries = {};
let stationForecastTimeline = [];
let stationForecastChart = null;
let stationAnimationMetadataLoadPromise = null;
let stationAnimationStationNames = [];
let stationAnimationHeaderByStationName = {};
let stationAnimationCurrentPosition = 0;
let stationAnimationPlayRafId = null;
let stationAnimationLastFrameTs = 0;
let stationAnimationMinValue = 0;
let stationAnimationMaxValue = 1;

function normalizeStationName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function splitCsvRow(rowText) {
    const fields = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < rowText.length; i += 1) {
        const char = rowText[i];

        if (char === '"') {
            if (inQuotes && rowText[i + 1] === '"') {
                currentField += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            fields.push(currentField);
            currentField = '';
        } else {
            currentField += char;
        }
    }

    fields.push(currentField);
    return fields;
}

function buildStationForecastTimeline(dateValues) {
    const countsByDate = {};
    const indexByDate = {};

    dateValues.forEach((dateValue) => {
        countsByDate[dateValue] = (countsByDate[dateValue] || 0) + 1;
    });

    return dateValues.map((dateValue) => {
        const currentIndex = indexByDate[dateValue] || 0;
        const totalCount = countsByDate[dateValue] || 1;
        const stepHours = 24 / totalCount;
        const hour = Math.max(0, Math.min(23, Math.round(currentIndex * stepHours)));

        indexByDate[dateValue] = currentIndex + 1;

        return `${dateValue} ${String(hour).padStart(2, '0')}:00`;
    });
}

function parseStationForecastCsv(csvText) {
    const lines = csvText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    if (lines.length < 2) {
        throw new Error('Station forecast CSV is empty or invalid.');
    }

    const allHeaders = splitCsvRow(lines[0]).map((header) => header.trim());
    const headers = allHeaders.slice(1);

    if (!headers.length) {
        throw new Error('No station columns found in station forecast CSV.');
    }

    const rows = [];

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
        const fields = splitCsvRow(lines[lineIndex]);
        const dateValue = (fields[0] || '').trim();

        if (!dateValue) {
            continue;
        }

        const values = headers.map((_, valueIndex) => {
            const rawValue = (fields[valueIndex + 1] || '').trim();
            const numericValue = Number.parseFloat(rawValue);
            return Number.isFinite(numericValue) ? numericValue : null;
        });

        rows.push({
            date: dateValue,
            values
        });
    }

    if (!rows.length) {
        throw new Error('No forecast records found in station forecast CSV.');
    }

    stationForecastHeaders = headers;
    stationForecastSeries = {};
    stationForecastHeaderLookup = {};
    stationForecastTimeline = buildStationForecastTimeline(rows.map((row) => row.date));

    headers.forEach((header, headerIndex) => {
        stationForecastSeries[header] = rows.map((row) => row.values[headerIndex]);
        stationForecastHeaderLookup[normalizeStationName(header)] = header;
    });
}

async function ensureStationForecastDataLoaded() {
    if (stationForecastHeaders.length && stationForecastTimeline.length) {
        return;
    }

    if (stationForecastLoadPromise) {
        return stationForecastLoadPromise;
    }

    stationForecastLoadPromise = (async () => {
        const response = await fetch(STATION_FORECAST_CSV_URL, { cache: 'no-store' });

        if (!response.ok) {
            throw new Error('Unable to load data/station forecast data.csv');
        }

        const csvText = await response.text();
        parseStationForecastCsv(csvText);
    })().finally(() => {
        stationForecastLoadPromise = null;
    });

    return stationForecastLoadPromise;
}

function resolveStationForecastHeader(stationName) {
    const exactInput = String(stationName || '').trim();

    if (!exactInput) {
        return null;
    }

    // Primary path: exact station name match between GeoJSON and CSV header.
    if (Object.prototype.hasOwnProperty.call(stationForecastSeries, exactInput)) {
        return exactInput;
    }

    // Strict fallback only for casing/diacritic formatting differences.
    const normalizedInput = normalizeStationName(exactInput);

    if (!normalizedInput) {
        return null;
    }

    if (stationForecastHeaderLookup[normalizedInput]) {
        return stationForecastHeaderLookup[normalizedInput];
    }

    const compactInput = normalizedInput.replace(/\s+/g, '');
    if (compactInput) {
        const normalizedHeaderKey = Object.keys(stationForecastHeaderLookup).find((key) => {
            return key.replace(/\s+/g, '') === compactInput;
        });

        if (normalizedHeaderKey) {
            return stationForecastHeaderLookup[normalizedHeaderKey];
        }
    }

    return null;
}

function getStationAnimationElements() {
    const panel = document.getElementById('station-animation-panel');
    const date = document.getElementById('station-animation-date');
    const slider = document.getElementById('station-animation-slider');
    const playButton = document.getElementById('station-animation-play-btn');
    const range = document.getElementById('station-animation-range');

    if (!panel || !date || !slider || !playButton || !range) {
        return null;
    }

    return { panel, date, slider, playButton, range };
}

function getStationTimelineDateLabel(index) {
    const rawLabel = stationForecastTimeline[index];
    if (typeof rawLabel !== 'string') {
        return '';
    }

    const dateOnly = rawLabel.split(' ')[0];
    return dateOnly || rawLabel;
}

function clampStationAnimationIndex(index) {
    if (!stationForecastTimeline.length) {
        return 0;
    }
    return Math.max(0, Math.min(stationForecastTimeline.length - 1, index));
}

function setStationAnimationPanelVisible(isVisible) {
    const elements = getStationAnimationElements();
    if (!elements) {
        return;
    }

    elements.panel.classList.toggle('is-visible', isVisible);
}

function setStationAnimationPlayButtonState(isPlaying) {
    const elements = getStationAnimationElements();
    if (!elements) {
        return;
    }

    elements.playButton.textContent = isPlaying ? '\u23F8' : '\u25B6';
    elements.playButton.setAttribute(
        'aria-label',
        isPlaying ? 'Pause station forecast animation' : 'Play station forecast animation'
    );
}

function stopStationAnimationPlayback() {
    if (stationAnimationPlayRafId !== null) {
        cancelAnimationFrame(stationAnimationPlayRafId);
        stationAnimationPlayRafId = null;
    }

    stationAnimationLastFrameTs = 0;

    setStationAnimationPlayButtonState(false);
}

function syncStationAnimationSliderBounds() {
    const elements = getStationAnimationElements();
    if (!elements) {
        return;
    }

    const maxIndex = Math.max(0, stationForecastTimeline.length - 1);
    elements.slider.min = '0';
    elements.slider.max = String(maxIndex);
    elements.slider.step = '0.01';
    elements.slider.value = String(clampStationAnimationIndex(stationAnimationCurrentPosition));
}

function computeStationAnimationValueExtents() {
    let minValue = Number.POSITIVE_INFINITY;
    let maxValue = Number.NEGATIVE_INFINITY;

    Object.values(stationForecastSeries).forEach((series) => {
        if (!Array.isArray(series)) {
            return;
        }

        series.forEach((value) => {
            if (!Number.isFinite(value)) {
                return;
            }
            minValue = Math.min(minValue, value);
            maxValue = Math.max(maxValue, value);
        });
    });

    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
        stationAnimationMinValue = 0;
        stationAnimationMaxValue = 1;
        return;
    }

    if (maxValue <= minValue) {
        stationAnimationMinValue = minValue;
        stationAnimationMaxValue = minValue + 1;
        return;
    }

    stationAnimationMinValue = minValue;
    stationAnimationMaxValue = maxValue;
}

function extractStationPointNamesFromGeojson(geojson) {
    if (!geojson || !Array.isArray(geojson.features)) {
        return [];
    }

    const seen = new Set();
    const names = [];

    geojson.features.forEach((feature) => {
        const properties = feature && feature.properties ? feature.properties : {};
        const stationName = String(properties.name || properties.Name || '').trim();

        if (!stationName || seen.has(stationName)) {
            return;
        }

        seen.add(stationName);
        names.push(stationName);
    });

    return names;
}

async function ensureStationAnimationMetadataLoaded() {
    if (stationAnimationStationNames.length && Object.keys(stationAnimationHeaderByStationName).length) {
        return;
    }

    if (stationAnimationMetadataLoadPromise) {
        return stationAnimationMetadataLoadPromise;
    }

    stationAnimationMetadataLoadPromise = (async () => {
        await ensureStationForecastDataLoaded();

        const response = await fetch(STATION_POINTS_GEOJSON_URL, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error('Unable to load station points GeoJSON for animation.');
        }

        const stationGeojson = await response.json();
        stationAnimationStationNames = extractStationPointNamesFromGeojson(stationGeojson);
        stationAnimationHeaderByStationName = {};

        stationAnimationStationNames.forEach((stationName) => {
            const header = resolveStationForecastHeader(stationName);
            if (header) {
                stationAnimationHeaderByStationName[stationName] = header;
            }
        });

        computeStationAnimationValueExtents();
        syncStationAnimationSliderBounds();
    })().finally(() => {
        stationAnimationMetadataLoadPromise = null;
    });

    return stationAnimationMetadataLoadPromise;
}

function getInterpolatedStationSeriesValue(series, position) {
    if (!Array.isArray(series) || !series.length) {
        return null;
    }

    const lowerIndex = Math.max(0, Math.min(series.length - 1, Math.floor(position)));
    const upperIndex = Math.max(0, Math.min(series.length - 1, Math.ceil(position)));
    const interpolationFactor = Math.max(0, Math.min(1, position - lowerIndex));

    const lowerValue = series[lowerIndex];
    const upperValue = series[upperIndex];

    if (Number.isFinite(lowerValue) && Number.isFinite(upperValue)) {
        return lowerValue + ((upperValue - lowerValue) * interpolationFactor);
    }

    if (Number.isFinite(lowerValue)) {
        return lowerValue;
    }

    if (Number.isFinite(upperValue)) {
        return upperValue;
    }

    return null;
}

function buildStationAnimationValueByStationMap(position) {
    const valueByStation = {};

    stationAnimationStationNames.forEach((stationName) => {
        const header = stationAnimationHeaderByStationName[stationName];
        if (!header) {
            return;
        }

        const series = stationForecastSeries[header];
        if (!Array.isArray(series)) {
            return;
        }

        const value = getInterpolatedStationSeriesValue(series, position);
        if (Number.isFinite(value)) {
            valueByStation[stationName] = value;
        }
    });

    return valueByStation;
}

function buildStationValueMatchExpression(valueByStation, fallbackValue) {
    const expression = [
        'match',
        ['to-string', ['coalesce', ['get', 'name'], ['get', 'Name'], '']]
    ];

    Object.keys(valueByStation).forEach((stationName) => {
        expression.push(stationName, valueByStation[stationName]);
    });

    expression.push(fallbackValue);
    return expression;
}

function buildStationAnimationRadiusExpression(valueByStation) {
    const valueExpression = buildStationValueMatchExpression(valueByStation, stationAnimationMinValue);
    const range = stationAnimationMaxValue - stationAnimationMinValue;

    return [
        'interpolate', ['linear'], valueExpression,
        stationAnimationMinValue, 5.8,
        stationAnimationMinValue + (range * 0.45), 9.8,
        stationAnimationMinValue + (range * 0.75), 14.2,
        stationAnimationMaxValue, 18.8
    ];
}

function buildStationAnimationHaloRadiusExpression(valueByStation) {
    const valueExpression = buildStationValueMatchExpression(valueByStation, stationAnimationMinValue);
    const range = stationAnimationMaxValue - stationAnimationMinValue;

    return [
        'interpolate', ['linear'], valueExpression,
        stationAnimationMinValue, 12,
        stationAnimationMinValue + (range * 0.45), 17,
        stationAnimationMinValue + (range * 0.75), 22.5,
        stationAnimationMaxValue, 28
    ];
}

function buildStationAnimationColorExpression(valueByStation) {
    const valueExpression = buildStationValueMatchExpression(valueByStation, stationAnimationMinValue);
    const range = stationAnimationMaxValue - stationAnimationMinValue;

    return [
        'interpolate', ['linear'], valueExpression,
        stationAnimationMinValue, '#00b6ff',
        stationAnimationMinValue + (range * 0.45), '#ffef00',
        stationAnimationMinValue + (range * 0.75), '#ff8c00',
        stationAnimationMaxValue, '#ff1744'
    ];
}

function updateStationAnimationMetadataText(position, valueByStation) {
    const elements = getStationAnimationElements();
    if (!elements) {
        return;
    }

    const frameValues = Object.values(valueByStation).filter((value) => Number.isFinite(value));
    const lowerIndex = clampStationAnimationIndex(Math.floor(position));
    const upperIndex = clampStationAnimationIndex(Math.ceil(position));
    const lowerDateLabel = getStationTimelineDateLabel(lowerIndex);
    const upperDateLabel = getStationTimelineDateLabel(upperIndex);
    const dateLabel = lowerIndex === upperIndex
        ? lowerDateLabel
        : `${lowerDateLabel} to ${upperDateLabel}`;

    elements.date.textContent = `Date: ${dateLabel || '--'}`;

    if (!frameValues.length) {
        elements.range.textContent = 'Values: --';
        return;
    }

    const minValue = Math.min(...frameValues);
    const maxValue = Math.max(...frameValues);
    elements.range.textContent = `Values: ${minValue.toFixed(2)} to ${maxValue.toFixed(2)}`;
}

function applyStationPointAnimationFrame(position) {
    if (!stationForecastTimeline.length) {
        return;
    }

    const clampedPosition = clampStationAnimationIndex(position);
    stationAnimationCurrentPosition = clampedPosition;

    const elements = getStationAnimationElements();
    if (elements) {
        elements.slider.value = String(clampedPosition);
    }

    const valueByStation = buildStationAnimationValueByStationMap(clampedPosition);
    const radiusExpression = buildStationAnimationRadiusExpression(valueByStation);
    const haloRadiusExpression = buildStationAnimationHaloRadiusExpression(valueByStation);
    const colorExpression = buildStationAnimationColorExpression(valueByStation);

    if (map1 && map1.getLayer('station-points-animated-layer')) {
        map1.setPaintProperty('station-points-animated-layer', 'circle-radius', radiusExpression);
        map1.setPaintProperty('station-points-animated-layer', 'circle-color', colorExpression);
    }

    if (map1 && map1.getLayer('station-points-animated-halo-layer')) {
        map1.setPaintProperty('station-points-animated-halo-layer', 'circle-radius', haloRadiusExpression);
        map1.setPaintProperty('station-points-animated-halo-layer', 'circle-color', colorExpression);
    }

    updateStationAnimationMetadataText(clampedPosition, valueByStation);
}

function handleStationAnimationSlider(value) {
    const parsedValue = Number.parseFloat(value);
    if (!Number.isFinite(parsedValue)) {
        return;
    }

    stopStationAnimationPlayback();
    applyStationPointAnimationFrame(parsedValue);
}

function runStationAnimationFrame(timestamp) {
    if (stationAnimationPlayRafId === null || !stationForecastTimeline.length) {
        return;
    }

    if (!stationAnimationLastFrameTs) {
        stationAnimationLastFrameTs = timestamp;
    }

    const elapsedSeconds = Math.max(0, (timestamp - stationAnimationLastFrameTs) / 1000);
    stationAnimationLastFrameTs = timestamp;

    const maxPosition = Math.max(0, stationForecastTimeline.length - 1);
    let nextPosition = stationAnimationCurrentPosition + (elapsedSeconds * STATION_ANIMATION_SPEED_PER_SECOND);

    if (maxPosition > 0) {
        while (nextPosition > maxPosition) {
            nextPosition -= maxPosition;
        }
    } else {
        nextPosition = 0;
    }

    applyStationPointAnimationFrame(nextPosition);
    stationAnimationPlayRafId = requestAnimationFrame(runStationAnimationFrame);
}

function startStationAnimationPlayback() {
    if (stationAnimationPlayRafId !== null || !stationForecastTimeline.length) {
        return;
    }

    setStationAnimationPlayButtonState(true);
    stationAnimationLastFrameTs = 0;
    stationAnimationPlayRafId = requestAnimationFrame(runStationAnimationFrame);
}

function toggleStationAnimationPlay() {
    if (stationAnimationPlayRafId !== null) {
        stopStationAnimationPlayback();
        return;
    }

    startStationAnimationPlayback();
}

async function enableStationPointAnimation() {
    setStationAnimationPanelVisible(true);

    try {
        await ensureStationAnimationMetadataLoaded();
        syncStationAnimationSliderBounds();
        applyStationPointAnimationFrame(stationAnimationCurrentPosition);
        startStationAnimationPlayback();
    } catch (error) {
        const elements = getStationAnimationElements();
        if (elements) {
            elements.date.textContent = 'Date: Unable to load station animation data';
            elements.range.textContent = error && error.message ? error.message : 'Station animation is unavailable.';
        }
        console.error(error);
    }
}

function disableStationPointAnimation() {
    stopStationAnimationPlayback();
    setStationAnimationPanelVisible(false);
}

function reapplyStationPointAnimationFrame() {
    if (!isLayerVisible('station-points-animated-layer')) {
        return;
    }
    applyStationPointAnimationFrame(stationAnimationCurrentPosition);
}

window.handleStationAnimationSlider = handleStationAnimationSlider;
window.toggleStationAnimationPlay = toggleStationAnimationPlay;
window.enableStationPointAnimation = enableStationPointAnimation;
window.disableStationPointAnimation = disableStationPointAnimation;
window.reapplyStationPointAnimationFrame = reapplyStationPointAnimationFrame;

function getStationForecastElements() {
    const widget = document.getElementById('station-forecast-widget');
    const title = document.getElementById('station-forecast-title');
    const subtitle = document.getElementById('station-forecast-subtitle');
    const canvas = document.getElementById('stationForecastChart');

    if (!widget || !title || !subtitle || !canvas) {
        return null;
    }

    return { widget, title, subtitle, canvas };
}

function ensureStationForecastChart() {
    if (stationForecastChart) {
        return stationForecastChart;
    }

    const elements = getStationForecastElements();
    if (!elements) {
        return null;
    }

    const context = elements.canvas.getContext('2d');
    if (!context) {
        return null;
    }

    stationForecastChart = new Chart(context, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Station Forecast',
                    data: [],
                    borderColor: '#38bdf8',
                    borderWidth: 2.4,
                    backgroundColor: (chartContext) => {
                        const chart = chartContext.chart;
                        const chartArea = chart.chartArea;

                        if (!chartArea) {
                            return 'rgba(56, 189, 248, 0.22)';
                        }

                        const gradient = chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        gradient.addColorStop(0, 'rgba(56, 189, 248, 0.40)');
                        gradient.addColorStop(1, 'rgba(56, 189, 248, 0.04)');

                        return gradient;
                    },
                    fill: true,
                    tension: 0.34,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHitRadius: 12,
                    pointBackgroundColor: '#f8fafc',
                    pointBorderColor: '#1d4ed8',
                    pointBorderWidth: 1.5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 900,
                easing: 'easeOutQuart'
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(13, 27, 42, 0.95)',
                    borderColor: '#1d4ed8',
                    borderWidth: 1,
                    titleColor: '#dbeafe',
                    bodyColor: '#e2e8f0',
                    padding: 10,
                    callbacks: {
                        label: (tooltipItem) => {
                            const value = tooltipItem.parsed.y;
                            return `Value: ${Number(value).toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(148, 163, 184, 0.15)'
                    },
                    ticks: {
                        color: '#bfdbfe',
                        autoSkip: true,
                        maxTicksLimit: 8,
                        maxRotation: 0,
                        callback: function (value) {
                            const rawLabel = this.getLabelForValue(value);
                            if (typeof rawLabel !== 'string') {
                                return rawLabel;
                            }
                            return rawLabel.split(' ')[0];
                        },
                        font: {
                            size: 10
                        }
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(148, 163, 184, 0.15)'
                    },
                    ticks: {
                        color: '#bfdbfe',
                        font: {
                            size: 10
                        }
                    }
                }
            }
        }
    });

    return stationForecastChart;
}

function openStationForecastWidget() {
    const elements = getStationForecastElements();
    if (!elements) {
        return;
    }

    elements.widget.classList.add('is-visible');

    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.classList.add('station-forecast-active');
    }

    if (typeof window.renderRiskZonationLegend === 'function') {
        window.renderRiskZonationLegend();
    }
}

function closeStationForecastWidget() {
    const elements = getStationForecastElements();
    if (!elements) {
        return;
    }

    elements.widget.classList.remove('is-visible');

    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.classList.remove('station-forecast-active');
    }

    if (typeof window.renderRiskZonationLegend === 'function') {
        window.renderRiskZonationLegend();
    }
}

function renderStationForecastUnavailable(stationName, message) {
    const elements = getStationForecastElements();
    if (!elements) {
        return;
    }

    elements.title.textContent = `${stationName} Forecast`;
    elements.subtitle.textContent = message;

    const chart = ensureStationForecastChart();
    if (chart) {
        chart.data.labels = [];
        chart.data.datasets[0].label = 'Station Forecast';
        chart.data.datasets[0].data = [];
        chart.update();
    }

    openStationForecastWidget();
}

function renderStationForecastSeries(stationName, matchedHeader, values) {
    const elements = getStationForecastElements();
    const chart = ensureStationForecastChart();

    if (!elements || !chart) {
        return;
    }

    const firstDate = stationForecastTimeline.length ? stationForecastTimeline[0].split(' ')[0] : '';
    const lastDate = stationForecastTimeline.length ? stationForecastTimeline[stationForecastTimeline.length - 1].split(' ')[0] : '';

    elements.title.textContent = `${stationName} Forecast`;
    elements.subtitle.textContent = `${matchedHeader} | ${values.length} values | ${firstDate} to ${lastDate}`;

    chart.data.labels = stationForecastTimeline;
    chart.data.datasets[0].label = `${matchedHeader} Forecast`;
    chart.data.datasets[0].data = values;
    chart.update();

    openStationForecastWidget();
}

async function handleStationPointSelection(stationName) {
    const displayName = String(stationName || 'Station').trim();

    try {
        await ensureStationForecastDataLoaded();
    } catch (error) {
        renderStationForecastUnavailable(displayName, error.message || 'Unable to load station forecast data.');
        return;
    }

    const matchedHeader = resolveStationForecastHeader(displayName);
    if (!matchedHeader) {
        renderStationForecastUnavailable(displayName, 'No matching station column found in station forecast data.');
        return;
    }

    const values = stationForecastSeries[matchedHeader];
    if (!Array.isArray(values) || !values.length) {
        renderStationForecastUnavailable(displayName, 'No forecast values found for this station.');
        return;
    }

    renderStationForecastSeries(displayName, matchedHeader, values);
}

window.handleStationPointSelection = handleStationPointSelection;
window.closeStationForecastWidget = closeStationForecastWidget;

function toggleUlterRiskZonation(isChecked) {
    const ulterRiskLayers = [
        'ulter-risk-high-layer',
        'ulter-risk-medium-layer',
        'ulter-risk-low-layer'
    ];

    const availableLayers = ulterRiskLayers.filter((layerId) => map1 && map1.getLayer(layerId));

    if (!availableLayers.length) {
        const ulterToggle = document.getElementById('ulter-rz-toggle');
        if (ulterToggle) {
            ulterToggle.checked = false;
        }
        console.warn('Ulter Risk Zonation layers are not added yet. Add data source/layers after URL is available.');
        return;
    }

    availableLayers.forEach((layerId) => setLayerVisibility(layerId, isChecked));
}

function toggleAlertsArchive(isChecked) {
    if (isChecked) {
        openPanelModal('alertsArchive');
        return;
    }

    const modal = document.getElementById('panelModal');
    if (modal && modal.dataset.activePanel === 'alertsArchive') {
        closePanelModal();
    }
}

let alertsArchiveImageItems = [];
let alertsArchiveViewerIndex = -1;

function updateAlertsArchiveViewer() {
    if (!alertsArchiveImageItems.length || alertsArchiveViewerIndex < 0) {
        return;
    }

    const imageEl = document.getElementById('alerts-archive-viewer-image');
    const captionEl = document.getElementById('alerts-archive-viewer-caption');
    const counterEl = document.getElementById('alerts-archive-viewer-count');
    const current = alertsArchiveImageItems[alertsArchiveViewerIndex];

    if (!imageEl || !captionEl || !counterEl || !current) {
        return;
    }

    imageEl.src = current.href;
    imageEl.alt = current.fileName;
    captionEl.textContent = current.fileName;
    counterEl.textContent = `${alertsArchiveViewerIndex + 1} / ${alertsArchiveImageItems.length}`;
}

function openAlertsArchiveViewer(index) {
    if (!alertsArchiveImageItems.length) {
        return;
    }

    const viewer = document.getElementById('alerts-archive-viewer');
    if (!viewer) {
        return;
    }

    const length = alertsArchiveImageItems.length;
    alertsArchiveViewerIndex = ((index % length) + length) % length;
    updateAlertsArchiveViewer();
    viewer.classList.add('is-open');
    viewer.setAttribute('aria-hidden', 'false');
}

function stepAlertsArchiveViewer(step) {
    if (!alertsArchiveImageItems.length) {
        return;
    }

    alertsArchiveViewerIndex = (alertsArchiveViewerIndex + step + alertsArchiveImageItems.length) % alertsArchiveImageItems.length;
    updateAlertsArchiveViewer();
}

function closeAlertsArchiveViewer() {
    const viewer = document.getElementById('alerts-archive-viewer');
    if (!viewer) {
        return;
    }

    viewer.classList.remove('is-open');
    viewer.setAttribute('aria-hidden', 'true');
    alertsArchiveViewerIndex = -1;
}

function handleAlertsArchiveViewerBackdrop(event) {
    if (event.target && event.target.id === 'alerts-archive-viewer') {
        closeAlertsArchiveViewer();
    }
}

async function renderAlertsArchive() {
    const modal = document.getElementById('panelModal');
    const body = document.getElementById('panelModalBody');
    if (!modal || !body || modal.dataset.activePanel !== 'alertsArchive') {
        return;
    }

    const alertsFolderPath = 'Alerts/';
    const imageExtRegex = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;

    try {
        const response = await fetch(alertsFolderPath, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error('Unable to access Alerts folder listing');
        }

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const images = Array.from(doc.querySelectorAll('a[href]'))
            .map((anchor) => anchor.getAttribute('href'))
            .filter(Boolean)
            .map((href) => {
                try {
                    return new URL(href, new URL(alertsFolderPath, window.location.href));
                } catch (_error) {
                    return null;
                }
            })
            .filter((url) => url && /\/alerts\//i.test(url.pathname) && imageExtRegex.test(url.pathname));

        const uniqueImages = images.filter((url, idx, arr) =>
            arr.findIndex((other) => other.pathname === url.pathname) === idx
        );

        alertsArchiveImageItems = uniqueImages.map((url) => ({
            href: url.href,
            fileName: decodeURIComponent(url.pathname.split('/').pop() || 'Alert Image')
        }));
        alertsArchiveViewerIndex = -1;

        if (!alertsArchiveImageItems.length) {
            body.innerHTML = `
                <div class="alerts-archive-empty">
                    <i class="fas fa-folder-open"></i>
                    <h4>No Alerts Found</h4>
                    <p>Add images to the Alerts folder and reopen Alerts Archive.</p>
                </div>
            `;
            return;
        }

        const cardsHtml = alertsArchiveImageItems.map((item, index) => {
            return `
                <figure class="alerts-archive-card">
                    <button type="button" class="alerts-archive-thumb-btn" onclick="openAlertsArchiveViewer(${index})" aria-label="Open alert image">
                        <img src="${item.href}" alt="${item.fileName}" loading="lazy">
                    </button>
                    <figcaption>${item.fileName}</figcaption>
                </figure>
            `;
        }).join('');

        body.innerHTML = `
            <div class="alerts-archive-wrap">
                <div class="alerts-archive-head">
                    <span><i class="fas fa-images"></i> Alerts Gallery</span>
                    <strong>${alertsArchiveImageItems.length} Image${alertsArchiveImageItems.length === 1 ? '' : 's'}</strong>
                </div>
                <div class="alerts-archive-grid">${cardsHtml}</div>

                <div id="alerts-archive-viewer" class="alerts-archive-viewer" aria-hidden="true" onclick="handleAlertsArchiveViewerBackdrop(event)">
                    <button type="button" class="alerts-archive-nav alerts-archive-nav-prev" onclick="stepAlertsArchiveViewer(-1)" aria-label="Previous alert image">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <div class="alerts-archive-viewer-stage">
                        <button type="button" class="alerts-archive-viewer-close" onclick="closeAlertsArchiveViewer()" aria-label="Close full image">&times;</button>
                        <img id="alerts-archive-viewer-image" src="" alt="Full alert image">
                        <div class="alerts-archive-viewer-meta">
                            <span id="alerts-archive-viewer-caption"></span>
                            <strong id="alerts-archive-viewer-count"></strong>
                        </div>
                    </div>
                    <button type="button" class="alerts-archive-nav alerts-archive-nav-next" onclick="stepAlertsArchiveViewer(1)" aria-label="Next alert image">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            </div>
        `;
    } catch (error) {
        alertsArchiveImageItems = [];
        alertsArchiveViewerIndex = -1;
        body.innerHTML = `
            <div class="alerts-archive-empty">
                <i class="fas fa-triangle-exclamation"></i>
                <h4>Unable to Load Alerts Archive</h4>
                <p>${error.message}</p>
            </div>
        `;
    }
}

function hideHighTempWarningPanel() {
    const warningPanel = document.getElementById('top_video_warning_chart');
    if (warningPanel) {
        warningPanel.style.display = 'none';
    }
}

let highTempWarningPopup = null;

function showHighTempWarningPopup() {
    const warningCoordinates = [75.33670798647735, 35.86669398878782];

    if (highTempWarningPopup) {
        highTempWarningPopup.remove();
        highTempWarningPopup = null;
    }

    const popupHTML = `
        <div class="incident-video-container">
            <button class="popup-close-btn" onclick="closeHighTempWarningPopup()">&times;</button>
            <video controls autoplay muted loop style="width: 300px; height: 200px; border-radius: 8px; border: 3px solid #ff0037; display: block;">
                <source src="data/arando.mp4" type="video/mp4">
                Your browser does not support the video tag.
            </video>
            <div class="incident-info" style="text-align: center; margin-top: 8px; font-size: 14px; color: white;">
                <strong>Latest Imagery, March 2026</strong>
            </div>
        </div>
    `;

    highTempWarningPopup = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        anchor: 'bottom',
        offset: [0, -18],
        className: 'incident-video-popup-mapbox'
    })
    .setLngLat(warningCoordinates)
    .setHTML(popupHTML)
    .addTo(map1);
}

function closeHighTempWarningPopup() {
    if (highTempWarningPopup) {
        highTempWarningPopup.remove();
        highTempWarningPopup = null;
    }
}

function showHighTempWarning(forceVisible = null) {
    const topVideo = document.getElementById('top_video');
    const warningPanel = document.getElementById('top_video_warning_chart');
    const warningLayerId = 'high-temp-warning-area';
    const currentVisible = isLayerVisible(warningLayerId);
    const shouldShow = typeof forceVisible === 'boolean' ? forceVisible : !currentVisible;

    if (shouldShow) {
        if (topVideo) {
            topVideo.pause();
            topVideo.style.display = 'none';
        }

        if (warningPanel) {
            warningPanel.style.display = 'block';
        }

        if (map1.getLayer(warningLayerId)) {
            map1.setLayoutProperty(warningLayerId, 'visibility', 'visible');
        }

        showHighTempWarningPopup();

        map1.flyTo({
            center: [75.33, 35.86],
            zoom: 10,
            essential: true
        });
    } else {
        if (map1.getLayer(warningLayerId)) {
            map1.setLayoutProperty(warningLayerId, 'visibility', 'none');
        }

        closeHighTempWarningPopup();
        hideHighTempWarningPanel();

        if (topVideo) {
            topVideo.style.display = 'block';
            topVideo.play().catch(() => {});
        }
    }

    const highTempToggle = document.getElementById('quick-high-temp-2026-toggle');
    if (highTempToggle) {
        highTempToggle.checked = shouldShow;
    }
}

document.getElementById("menuToggle").addEventListener("click", function() {
    var menu = document.getElementById("menu");
    
    if (menu.style.display === "none" || menu.style.display === "") {
      menu.style.display = "block"; // Show menu
    } else {
      menu.style.display = "none"; // Hide menu
    }
  });

let layerTourTimer = null;
let layerTourStops = [];
let layerTourCurrentIndex = 0;
let layerTourRunning = false;
const layerTourGeojsonCache = {};
let layerTourSpeedLevel = 3;

const layerTourSpeedProfiles = {
    1: { label: 'Slow', intervalMs: 4800 },
    2: { label: 'Easy', intervalMs: 3900 },
    3: { label: 'Normal', intervalMs: 3200 },
    4: { label: 'Fast', intervalMs: 2500 },
    5: { label: 'Max', intervalMs: 1800 }
};

function getLayerTourElements() {
    return {
        select: document.getElementById('layer-tour-select'),
        button: document.getElementById('layer-tour-btn'),
        status: document.getElementById('layer-tour-status')
    };
}

function setLayerTourStatus(text) {
    const { status } = getLayerTourElements();
    if (status) {
        status.textContent = text;
    }
}

function getLayerTourIntervalMs() {
    const profile = layerTourSpeedProfiles[layerTourSpeedLevel] || layerTourSpeedProfiles[3];
    return profile.intervalMs;
}

function restartLayerTourTimer() {
    if (!layerTourRunning || !layerTourStops.length) {
        return;
    }

    if (layerTourTimer) {
        clearInterval(layerTourTimer);
        layerTourTimer = null;
    }

    layerTourTimer = setInterval(() => {
        layerTourCurrentIndex = (layerTourCurrentIndex + 1) % layerTourStops.length;
        flyToLayerTourStop(layerTourCurrentIndex);
    }, getLayerTourIntervalMs());
}

function isLikelyCustomLayer(layer) {
    if (!layer || !layer.source) {
        return false;
    }
    const sourceId = String(layer.source);
    return sourceId !== 'composite' && !sourceId.toLowerCase().includes('mapbox');
}

function parseLayerIdsFromToggleInput(inputElement) {
    const ids = [];
    if (!inputElement) {
        return ids;
    }

    const directLayerId = inputElement.dataset ? inputElement.dataset.layer : '';
    if (directLayerId) {
        ids.push(directLayerId);
    }

    const onClick = inputElement.getAttribute('onclick') || '';
    const listMatch = onClick.match(/\[([^\]]+)\]/);
    if (!listMatch || !listMatch[1]) {
        return ids;
    }

    listMatch[1]
        .split(',')
        .map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
        .forEach((layerId) => ids.push(layerId));

    return ids;
}

function getCheckedToggleLayerIds() {
    const checkedInputs = Array.from(document.querySelectorAll('#menu input[type="checkbox"]:checked'));
    const unique = new Set();
    checkedInputs.forEach((input) => {
        parseLayerIdsFromToggleInput(input).forEach((layerId) => unique.add(layerId));
    });
    return Array.from(unique);
}

function getLayerFriendlyName(layerId) {
    const candidates = Array.from(document.querySelectorAll('#menu input[type="checkbox"]'));
    for (const input of candidates) {
        const linkedIds = parseLayerIdsFromToggleInput(input);
        if (!linkedIds.includes(layerId)) {
            continue;
        }

        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label && label.textContent) {
            return label.textContent.trim();
        }
    }
    return layerId;
}

function refreshLayerTourOptions() {
    const { select } = getLayerTourElements();
    if (!select || !map1 || !map1.getStyle()) {
        return;
    }

    const selectedValue = select.value;
    const checkedLayerIds = getCheckedToggleLayerIds();
    const styleLayers = map1.getStyle().layers || [];
    const visibleLayerIds = styleLayers
        .filter((layer) => {
            if (!isLikelyCustomLayer(layer)) {
                return false;
            }
            return map1.getLayoutProperty(layer.id, 'visibility') === 'visible';
        })
        .map((layer) => layer.id);

    const candidateIds = Array.from(new Set([...checkedLayerIds, ...visibleLayerIds]))
        .filter((layerId) => map1.getLayer(layerId))
        .filter((layerId) => {
            const layer = map1.getLayer(layerId);
            return ['circle', 'symbol', 'line', 'fill'].includes(layer.type);
        });

    select.innerHTML = '<option value="">Select opened layer</option>';
    candidateIds.forEach((layerId) => {
        const option = document.createElement('option');
        option.value = layerId;
        option.textContent = getLayerFriendlyName(layerId);
        select.appendChild(option);
    });

    if (selectedValue && candidateIds.includes(selectedValue)) {
        select.value = selectedValue;
    }
}

function flattenCoordinates(coords, collector) {
    if (!Array.isArray(coords)) {
        return;
    }

    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        collector.push([coords[0], coords[1]]);
        return;
    }

    coords.forEach((child) => flattenCoordinates(child, collector));
}

function getRepresentativeCoordinatesFromGeometry(geometry) {
    if (!geometry || !geometry.type) {
        return null;
    }

    if (geometry.type === 'Point') {
        return geometry.coordinates;
    }

    if (geometry.type === 'MultiPoint') {
        return Array.isArray(geometry.coordinates) && geometry.coordinates.length
            ? geometry.coordinates[0]
            : null;
    }

    const allPoints = [];
    flattenCoordinates(geometry.coordinates, allPoints);
    if (!allPoints.length) {
        return null;
    }

    if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
        return allPoints[Math.floor(allPoints.length / 2)];
    }

    let minLng = Number.POSITIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;

    allPoints.forEach((point) => {
        minLng = Math.min(minLng, point[0]);
        maxLng = Math.max(maxLng, point[0]);
        minLat = Math.min(minLat, point[1]);
        maxLat = Math.max(maxLat, point[1]);
    });

    return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

async function getGeojsonFeaturesFromSource(sourceId) {
    if (!map1 || !sourceId) {
        return [];
    }

    const style = map1.getStyle && map1.getStyle();
    const sourceDef = style && style.sources ? style.sources[sourceId] : null;
    if (!sourceDef || sourceDef.type !== 'geojson') {
        return [];
    }

    if (sourceDef.data && typeof sourceDef.data === 'object' && Array.isArray(sourceDef.data.features)) {
        return sourceDef.data.features;
    }

    if (typeof sourceDef.data === 'string') {
        const sourceUrl = sourceDef.data;
        if (Array.isArray(layerTourGeojsonCache[sourceUrl])) {
            return layerTourGeojsonCache[sourceUrl];
        }

        const response = await fetch(sourceUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Unable to load layer source: ${sourceId}`);
        }

        const geojson = await response.json();
        const features = Array.isArray(geojson && geojson.features) ? geojson.features : [];
        layerTourGeojsonCache[sourceUrl] = features;
        return features;
    }

    return [];
}

async function getLayerTourStops(layerId) {
    if (!map1 || !map1.getLayer(layerId)) {
        return [];
    }

    const layer = map1.getLayer(layerId);
    const sourceFeatures = await getGeojsonFeaturesFromSource(layer.source);
    let features = [];

    if (sourceFeatures.length) {
        features = sourceFeatures;
    } else {
        try {
            const queryOptions = {};
            if (layer['source-layer']) {
                queryOptions.sourceLayer = layer['source-layer'];
            }
            features = map1.querySourceFeatures(layer.source, queryOptions) || [];
        } catch (_error) {
            features = [];
        }
    }

    if (!features.length) {
        features = map1.queryRenderedFeatures({ layers: [layerId] }) || [];
    }

    const stops = [];
    const layerType = layer.type;
    const targetZoom = layerType === 'fill' ? 10.8 : (layerType === 'line' ? 11.3 : 12.5);
    const seenNonPoint = new Set();

    features.forEach((feature, index) => {
        const coordinates = getRepresentativeCoordinatesFromGeometry(feature.geometry);
        if (!coordinates) {
            return;
        }

        if (layerType !== 'symbol' && layerType !== 'circle') {
            const key = `${coordinates[0].toFixed(6)}|${coordinates[1].toFixed(6)}`;
            if (seenNonPoint.has(key)) {
                return;
            }
            seenNonPoint.add(key);
        }

        stops.push({
            center: coordinates,
            zoom: targetZoom,
            index
        });
    });

    return stops;
}

function flyToLayerTourStop(index) {
    if (!layerTourRunning || !layerTourStops.length) {
        return;
    }

    const boundedIndex = ((index % layerTourStops.length) + layerTourStops.length) % layerTourStops.length;
    layerTourCurrentIndex = boundedIndex;
    const stop = layerTourStops[boundedIndex];

    map1.flyTo({
        center: stop.center,
        zoom: stop.zoom,
        speed: 0.7,
        curve: 1.25,
        essential: true
    });

    setLayerTourStatus(`Stop ${boundedIndex + 1} / ${layerTourStops.length}`);
}

function stopLayerTourIfRunning() {
    if (layerTourTimer) {
        clearInterval(layerTourTimer);
        layerTourTimer = null;
    }

    layerTourRunning = false;
    layerTourStops = [];
    layerTourCurrentIndex = 0;

    const { button } = getLayerTourElements();
    if (button) {
        button.textContent = 'Start Tour';
    }

    setLayerTourStatus('Idle');
}

function updateLayerTourSpeed(value) {
    const numericValue = Number.parseInt(value, 10);
    if (!Number.isFinite(numericValue) || !layerTourSpeedProfiles[numericValue]) {
        return;
    }

    layerTourSpeedLevel = numericValue;
    const profile = layerTourSpeedProfiles[layerTourSpeedLevel];
    const speedValueEl = document.getElementById('layer-tour-speed-value');
    if (speedValueEl) {
        speedValueEl.textContent = profile.label;
    }

    if (layerTourRunning) {
        restartLayerTourTimer();
    }
}

async function toggleLayerTour() {
    if (!map1) {
        return;
    }

    if (layerTourRunning) {
        stopLayerTourIfRunning();
        return;
    }

    refreshLayerTourOptions();
    const { select, button } = getLayerTourElements();
    if (!select) {
        return;
    }

    const selectedLayerId = select.value;
    if (!selectedLayerId) {
        setLayerTourStatus('Select a layer first');
        return;
    }

    setLayerTourStatus('Loading points...');
    let stops = [];
    try {
        stops = await getLayerTourStops(selectedLayerId);
    } catch (error) {
        setLayerTourStatus((error && error.message) ? error.message : 'Unable to read layer source');
        return;
    }

    if (!stops.length) {
        setLayerTourStatus('No features found in selected layer');
        return;
    }

    layerTourStops = stops;
    layerTourCurrentIndex = 0;
    layerTourRunning = true;
    if (button) {
        button.textContent = 'Stop Tour';
    }

    flyToLayerTourStop(layerTourCurrentIndex);

    restartLayerTourTimer();
}

window.refreshLayerTourOptions = refreshLayerTourOptions;
window.toggleLayerTour = toggleLayerTour;
window.stopLayerTourIfRunning = stopLayerTourIfRunning;
window.updateLayerTourSpeed = updateLayerTourSpeed;

document.addEventListener('change', function (event) {
    const target = event.target;
    if (target && target.matches && target.matches('#menu input[type="checkbox"]')) {
        setTimeout(refreshLayerTourOptions, 0);
    }
});

function openPanelModal(panelType) {
    const modal = document.getElementById('panelModal');
    const title = document.getElementById('panelModalTitle');
    const body = document.getElementById('panelModalBody');
    const alertsArchiveToggle = document.getElementById('alerts-archive-toggle');

    if (!modal || !title || !body) {
        return;
    }

    modal.dataset.activePanel = panelType;
    body.classList.remove('alerts-archive-mode');
    if (alertsArchiveToggle) {
        alertsArchiveToggle.checked = panelType === 'alertsArchive';
    }

    if (panelType === 'controlChart') {
        title.textContent = 'Control Chart';
        body.innerHTML = '<iframe src="https://flo.uri.sh/visualisation/27852382/embed" frameborder="0" allowfullscreen scrolling="no" title="Control Chart"></iframe>';
    } else if (panelType === 'top_video_warning_chart') {
        title.textContent = 'High Temp Warning';
        body.innerHTML = '<iframe src="https://flo.uri.sh/visualisation/28273388/embed#theme=dark" frameborder="0" allowfullscreen scrolling="no" title="High Temp Warning"></iframe>';
    } else if (panelType === 'alertsArchive') {
        title.textContent = 'Alerts Archive';
        body.classList.add('alerts-archive-mode');
        body.innerHTML = '<div class="alerts-archive-loading"><i class="fas fa-spinner fa-spin"></i> Loading alerts archive...</div>';
        renderAlertsArchive();
    } else if (panelType === 'glaciersDataContainer') {
        title.textContent = 'Glaciers Data';
        body.innerHTML = '<img src="data/basemap-icons/Glaciers_data.png" alt="Glaciers Data">';
    } else if (panelType === 'lakeMapPreview') {
        const previewImg = document.getElementById('lake-map-preview-img');
        const previewCaption = document.getElementById('lake-map-preview-caption');
        const previewSrc = previewImg ? previewImg.getAttribute('src') : '';

        if (!previewSrc) {
            return;
        }

        const previewTitle = (previewCaption && previewCaption.textContent) ? previewCaption.textContent : 'Map Preview';
        title.textContent = `${previewTitle} Map`;
        body.innerHTML = `<img src="${previewSrc}" alt="${previewTitle} map">`;
    } else {
        return;
    }

    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
}

function closePanelModal() {
    const modal = document.getElementById('panelModal');
    const body = document.getElementById('panelModalBody');
    const alertsArchiveToggle = document.getElementById('alerts-archive-toggle');

    if (!modal || !body) {
        return;
    }

    const activePanel = modal.dataset.activePanel;

    modal.classList.remove('is-open');
    closeAlertsArchiveViewer();
    body.classList.remove('alerts-archive-mode');
    body.innerHTML = '';
    document.body.style.overflow = '';
    modal.dataset.activePanel = '';
    alertsArchiveImageItems = [];
    alertsArchiveViewerIndex = -1;

    if (activePanel === 'alertsArchive' && alertsArchiveToggle) {
        alertsArchiveToggle.checked = false;
    }
}

function handlePanelModalBackdrop(event) {
    if (event.target && event.target.id === 'panelModal') {
        closePanelModal();
    }
}

document.addEventListener('keydown', function (event) {
    const modal = document.getElementById('panelModal');
    const viewer = document.getElementById('alerts-archive-viewer');
    const alertsViewerOpen = !!(modal && modal.classList.contains('is-open') && modal.dataset.activePanel === 'alertsArchive' && viewer && viewer.classList.contains('is-open'));

    if (alertsViewerOpen && event.key === 'ArrowLeft') {
        event.preventDefault();
        stepAlertsArchiveViewer(-1);
        return;
    }

    if (alertsViewerOpen && event.key === 'ArrowRight') {
        event.preventDefault();
        stepAlertsArchiveViewer(1);
        return;
    }

    if (event.key === 'Escape') {
        if (alertsViewerOpen) {
            event.preventDefault();
            closeAlertsArchiveViewer();
            return;
        }
        closePanelModal();
    }
});

const DEFAULT_TOP_VIDEO = 'data/badswat1.mp4';
const DEFAULT_BOTTOM_VIDEO = 'data/badswat2.mp4';

const accordionVideoStates = {
    'badswat-collapse': {
        topVideo: DEFAULT_TOP_VIDEO,
        bottomVideo: 'data/36Sites.mp4'
    },
    'pindoru-collapse': {
        topVideo: 'data/Pindoru_Chaat.mp4',
        bottomVideo: DEFAULT_BOTTOM_VIDEO
    },
    'thalu-collapse': {
        topVideo: 'data/thalu2.mp4',
        bottomVideo: 'data/thalu.mp4'
    },
    'darkot-collapse': {
        topVideo: 'data/darkut_lake.mp4',
        hideBottom: true
    }
};

const accordionVideoStack = [];

const accordionMapImageStates = {
    'pindoru-collapse': {
        src: 'Maps/Pindoru chaat.jpg',
        title: 'Pindoru Chaat'
    },
    'chatiboi-collapse': {
        src: 'Maps/Chatboi lake.jpg',
        title: 'Chatboi Lake'
    },
    'ishokoman-collapse': {
        src: 'Maps/Ishkoman.jpg',
        title: 'Ishkoman'
    },
    'lusht-collapse': {
        src: 'Maps/Lusht.jpg',
        title: 'Lusht'
    },
    'ulter-collapse': {
        src: 'Maps/Ulter.jpg',
        title: 'Ulter'
    }
};

const accordionMapImageStack = [];

const accordionChartLakeMap = {
    'badswat-collapse': 'Badswat',
    'pindoru-collapse': 'Pindoru Chaat',
    'reshun-collapse': 'Reshun',
    'thalu-collapse': 'Thalo 1',
    'darkot-collapse': 'Darkut',
    'chatiboi-collapse': 'Chatiboi',
    'brep-collapse': 'Brep',
    'ishokoman-collapse': 'Ishkoman',
    'lusht-collapse': 'Lasht',
    'ulter-collapse': 'Ultar'
};

function syncChartsForAccordion(accordionId) {
    const lakeName = accordionChartLakeMap[accordionId];
    if (!lakeName) {
        return;
    }

    const areaSelect = document.getElementById('lake-select');
    if (areaSelect) {
        areaSelect.value = lakeName;
        if (typeof updateLakeChart === 'function') {
            updateLakeChart();
        }
    }

    const volumeSelect = document.getElementById('vol-lake-select');
    if (volumeSelect) {
        volumeSelect.value = lakeName;
        if (typeof updateVolumeChart === 'function') {
            updateVolumeChart();
        }
    }
}

function registerAccordionChartHandlers() {
    const menuAccordion = document.getElementById('menu-accordion');
    if (!menuAccordion) {
        return;
    }

    menuAccordion.addEventListener('show.bs.collapse', function (event) {
        const collapseId = event && event.target ? event.target.id : null;
        if (!collapseId) {
            return;
        }
        syncChartsForAccordion(collapseId);
    });
}

function setLakeMapPreview(state) {
    const preview = document.getElementById('lake-map-preview');
    const previewImg = document.getElementById('lake-map-preview-img');
    const previewCaption = document.getElementById('lake-map-preview-caption');

    if (!preview || !previewImg || !previewCaption) {
        return;
    }

    if (!state) {
        preview.style.display = 'none';
        previewImg.removeAttribute('src');
        previewCaption.textContent = 'Map Preview';
        return;
    }

    previewImg.src = state.src;
    previewCaption.textContent = state.title;
    preview.style.display = 'block';
}

function syncAccordionMapPreview() {
    const activeAccordionId = accordionMapImageStack[accordionMapImageStack.length - 1];
    const state = activeAccordionId ? accordionMapImageStates[activeAccordionId] : null;
    setLakeMapPreview(state || null);
}

function registerAccordionMapPreviewHandlers() {
    const menuAccordion = document.getElementById('menu-accordion');
    if (menuAccordion) {
        menuAccordion.addEventListener('show.bs.collapse', function (event) {
            const collapseId = event && event.target ? event.target.id : null;
            if (!collapseId || accordionMapImageStates[collapseId]) {
                return;
            }
            accordionMapImageStack.length = 0;
            setLakeMapPreview(null);
        });
    }

    Object.keys(accordionMapImageStates).forEach((accordionId) => {
        const collapseElement = document.getElementById(accordionId);

        if (!collapseElement) {
            return;
        }

        collapseElement.addEventListener('show.bs.collapse', function () {
            const existingIndex = accordionMapImageStack.indexOf(accordionId);
            if (existingIndex !== -1) {
                accordionMapImageStack.splice(existingIndex, 1);
            }
            accordionMapImageStack.push(accordionId);
            syncAccordionMapPreview();
        });

        collapseElement.addEventListener('hide.bs.collapse', function () {
            const existingIndex = accordionMapImageStack.indexOf(accordionId);
            if (existingIndex !== -1) {
                accordionMapImageStack.splice(existingIndex, 1);
            }
            syncAccordionMapPreview();
        });
    });
}

function showvideo(videoDivId) {
    const videoElement = document.getElementById(videoDivId);
    if (videoElement) {
        if (videoDivId === 'top_video') {
            hideHighTempWarningPanel();
        }
        videoElement.style.display = 'block';
    }
}

function changeVideo1(newPath) {
    const videoElement = document.getElementById("top_video"); // Assuming it's a <video> tag
    hideHighTempWarningPanel();
    videoElement.style.display = "block";
    videoElement.src = newPath;
    videoElement.load(); // Reload video source
    videoElement.play(); // Play new video
}

function changeVideo2(newPath) {
    const videoElement = document.getElementById("bot_video"); // Assuming it's a <video> tag
    videoElement.style.display = "block";
    videoElement.src = newPath;
    videoElement.load(); // Reload video source
    videoElement.play(); // Play new video
}

function hidevideo(videoDivId) {
    const videoElement = document.getElementById(videoDivId);
    if (videoElement) {
        videoElement.style.display = "none";
    } else {
        console.warn("No element found with ID:", videoDivId);
    }
}

function restoreDefaultVideos() {
    showvideo('top_video');
    showvideo('bot_video');
    changeVideo1(DEFAULT_TOP_VIDEO);
    changeVideo2(DEFAULT_BOTTOM_VIDEO);
}

function applyAccordionVideoState(accordionId) {
    const state = accordionVideoStates[accordionId];

    if (!state) {
        restoreDefaultVideos();
        return;
    }

    showvideo('top_video');
    if (state.topVideo) {
        changeVideo1(state.topVideo);
    }

    if (state.hideBottom) {
        hidevideo('bot_video');
        return;
    }

    showvideo('bot_video');
    changeVideo2(state.bottomVideo || DEFAULT_BOTTOM_VIDEO);
}

function syncAccordionVideos() {
    const activeAccordionId = accordionVideoStack[accordionVideoStack.length - 1];

    if (!activeAccordionId) {
        restoreDefaultVideos();
        return;
    }

    applyAccordionVideoState(activeAccordionId);
}

function registerAccordionVideoHandlers() {
    Object.keys(accordionVideoStates).forEach((accordionId) => {
        const collapseElement = document.getElementById(accordionId);

        if (!collapseElement) {
            return;
        }

        collapseElement.addEventListener('show.bs.collapse', function () {
            const existingIndex = accordionVideoStack.indexOf(accordionId);
            if (existingIndex !== -1) {
                accordionVideoStack.splice(existingIndex, 1);
            }
            accordionVideoStack.push(accordionId);
            syncAccordionVideos();
        });

        collapseElement.addEventListener('hide.bs.collapse', function () {
            const existingIndex = accordionVideoStack.indexOf(accordionId);
            if (existingIndex !== -1) {
                accordionVideoStack.splice(existingIndex, 1);
            }
            syncAccordionVideos();
        });
    });
}

document.addEventListener('DOMContentLoaded', registerAccordionVideoHandlers);
document.addEventListener('DOMContentLoaded', registerAccordionChartHandlers);
document.addEventListener('DOMContentLoaded', registerAccordionMapPreviewHandlers);
document.addEventListener('DOMContentLoaded', refreshLayerTourOptions);
document.addEventListener('DOMContentLoaded', function () {
    updateLayerTourSpeed(layerTourSpeedLevel);
});


//____________________________________________________________________________________________________________________________________________________________________________________
function setMapCenter(map, longitude, latitude, zoomLevel = null, bearing = 0, pitch = 0) {
    // Use map.flyTo() for smooth transition
    map.flyTo({
        center: [longitude, latitude],
        zoom: zoomLevel,
        pitch: 40,
        bearing: bearing,
        essential: true // Ensures the animation happens even if the user prefers reduced motion
    });
}

function accordionZoom(map, layerId, zoomLevel, lat, lng) {
    const visibility = map.getLayoutProperty(layerId, 'visibility');

    if (visibility === 'visible') {
        map.setLayoutProperty(layerId, 'visibility', 'none');
    } else {
        map.setLayoutProperty(layerId, 'visibility', 'visible');
        setMapCenter(map, Number(lng), Number(lat), Number(zoomLevel));
    }
}
let blinkingIntervals = {}; // Store blinking intervals for multiple layers

function makeLayerBlink(map, layerId, interval = 500) {
    // If blinking is already active, stop it
    if (blinkingIntervals[layerId]) {
        clearInterval(blinkingIntervals[layerId]);
        delete blinkingIntervals[layerId]; // Remove reference
        map.setPaintProperty(layerId, 'circle-stroke-opacity', 1); // Ensure it's fully visible
        console.log(`Stopped blinking for layer: ${layerId}`);
        return;
    }

    // Ensure the layer exists
    if (!map.getLayer(layerId)) {
        console.error(`Layer ${layerId} not found!`);
        return;
    }

    let isVisible = true;

    // Start blinking and store the interval ID
    blinkingIntervals[layerId] = setInterval(() => {
        isVisible = !isVisible;
        map.setPaintProperty(layerId, 'circle-stroke-opacity', isVisible ? 1 : 0);
    }, interval);

    console.log(`Started blinking for layer: ${layerId}`);
}
// Generic popup function
function addPopup(layerId, contentCallback) {
    map1.on('click', layerId, (e) => {
        const coordinates = e.lngLat;
        const properties = e.features[0].properties;

        const popupContent = contentCallback(properties);

        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(popupContent)
            .addTo(map1);
    });

    // Optional: change the cursor on hover
    map1.on('mouseenter', layerId, () => {
        map1.getCanvas().style.cursor = 'pointer';
    });
    map1.on('mouseleave', layerId, () => {
        map1.getCanvas().style.cursor = '';
    });
}

//____________________________________________________________________________________________________________________________________________________________________________________
function toggleLayersVisibility(map, layerIds) {
    layerIds.forEach(layerId => {
        const visibility = map.getLayoutProperty(layerId, 'visibility');

        map.setLayoutProperty(
            layerId, 
            'visibility', 
            visibility === 'visible' ? 'none' : 'visible'
        );
    });
}//____________________________________________________________________________________________________________________________________________________________________________________
function changeBasemap(type) {
    console.log("Selected Basemap:", type);
    
    if (!map1) {
        console.error("Map instance is not available.");
        return;
    }

    let styleUrl = "";
    switch (type) {
        case "hybrid":
            styleUrl = "mapbox://styles/sarim240/clzme7200005801pb0o9tcw7r";
            break;
        case "terrain":
            styleUrl = "mapbox://styles/mapbox/outdoors-v11";
            break;
        case "light":
            styleUrl = "mapbox://styles/mapbox/light-v10";
            break;
        case "dark":
            styleUrl = "mapbox://styles/mapbox/dark-v10";
            break;
    }

    // Save only visible layers
    const visibleLayers = map1.getStyle().layers
        .filter(layer => map1.getLayoutProperty(layer.id, 'visibility') === 'visible')
        .map(layer => layer.id);

    console.log("Visible layers before basemap change:", visibleLayers);

    // Change the basemap style
    map1.setStyle(styleUrl);

    // Re-add layers once the new style has loaded
    map1.on('style.load', function () {
        visibleLayers.forEach(layerId => {
            if (map1.getLayer(layerId)) {
                map1.setLayoutProperty(layerId, 'visibility', 'visible');
            } else {
                console.warn(`Layer ${layerId} was not found in the new style.`);
            }
        });

        if (typeof window.reapplyStationPointAnimationFrame === 'function') {
            window.reapplyStationPointAnimationFrame();
        }

        console.log("Restored visibility for layers:", visibleLayers);
    });
}

//____________________________________________________________________________________________________________________________________________________________________________________
// Function to handle incident button click
let incidentPopup = null;

function handleIncidentButton() {
    console.log("Incident button clicked!");
    
    // Check if incident layer is currently visible
    const currentVisibility = map1.getLayoutProperty('incident', 'visibility');
    const isIncidentVisible = currentVisibility === 'visible';
    
    // Toggle incident layer visibility
    toggleLayersVisibility(map1, ['incident']);
    
    if (!isIncidentVisible) {
        // Incident is being shown - show video popup
        showIncidentVideo();
        
        // Zoom to the incident location
        const incidentCoords = [74.574942, 36.350894]; // Coordinates from your geojson
        map1.flyTo({
            center: incidentCoords,
            zoom: 12,
            essential: true
        });
    } else {
        // Incident is being hidden - hide video popup
        closeIncidentVideo();
    }
}

// Function to show incident video popup attached to the map point
function showIncidentVideo() {
    // Incident coordinates (same as in incident.js)
    const incidentCoordinates = [74.574942, 36.350894];
    
    // Create popup HTML with video
    const popupHTML = `
        <div class="incident-video-container">
            <button class="popup-close-btn" onclick="closeIncidentVideo()">&times;</button>
            <video id="incident-popup-video" controls autoplay muted loop style="width: 300px; height: 200px; border-radius: 8px; border: 3px solid #00b0b6; display: block;">
                <source src="data/Hassanabad.mp4" type="video/mp4">
                Your browser does not support the video tag.
            </video>
            <div class="incident-info" style="text-align: center; margin-top: 8px; font-size: 14px; color: white;">
                <strong>Hassanabad Incident</strong><br>
                <small>GLOF Event Location</small>
            </div>
        </div>
    `;
    
    // Create and show the popup attached to the incident point
    incidentPopup = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        anchor: 'bottom',
        offset: [0, -25],
        className: 'incident-video-popup-mapbox'
    })
    .setLngLat(incidentCoordinates)
    .setHTML(popupHTML)
    .addTo(map1);
}

// Function to close incident video popup
function closeIncidentVideo() {
    if (incidentPopup) {
        incidentPopup.remove();
        incidentPopup = null;
    }
}

//____________________________________________________________________________________________________________________________________________________________________________________
// Land Surface Temperature (LST) Controls
const lstMonthNames = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
let currentLSTMonth = 1;
let lstPlayInterval = null;

function toggleLST(isChecked) {
    const panel = document.getElementById('lst-panel');
    if (isChecked) {
        panel.style.display = 'block';
        // Reset to January
        currentLSTMonth = 1;
        document.getElementById('lst-month-slider').value = 1;
        document.getElementById('lst-month-label').textContent = lstMonthNames[0];
        document.getElementById('lst-opacity-slider').value = 100;
        document.getElementById('lst-opacity-value').textContent = '100%';
        document.getElementById('lst-opacity-row').style.display = 'none';
        document.getElementById('lst-play-btn').textContent = '\u25B6';
        map1.setPaintProperty('lst-month-1', 'raster-opacity', 1.0);
        map1.setLayoutProperty('lst-month-1', 'visibility', 'visible');
    } else {
        _lstStopPlay();
        panel.style.display = 'none';
        for (let i = 1; i <= 12; i++) {
            map1.setLayoutProperty(`lst-month-${i}`, 'visibility', 'none');
        }
    }
}

function changeLSTMonth(value) {
    const newMonth = parseInt(value);
    const opacity = parseInt(document.getElementById('lst-opacity-slider').value) / 100;
    map1.setLayoutProperty(`lst-month-${currentLSTMonth}`, 'visibility', 'none');
    map1.setLayoutProperty(`lst-month-${newMonth}`, 'visibility', 'visible');
    map1.setPaintProperty(`lst-month-${newMonth}`, 'raster-opacity', opacity);
    currentLSTMonth = newMonth;
    document.getElementById('lst-month-label').textContent = lstMonthNames[newMonth - 1];
    document.getElementById('lst-month-slider').value = newMonth;
}

function changeLSTOpacity(value) {
    const opacity = parseInt(value) / 100;
    document.getElementById('lst-opacity-value').textContent = value + '%';
    map1.setPaintProperty(`lst-month-${currentLSTMonth}`, 'raster-opacity', opacity);
}

function toggleLSTOpacityBar() {
    const row = document.getElementById('lst-opacity-row');
    const visible = row.style.display === 'flex';
    row.style.display = visible ? 'none' : 'flex';
}

function toggleLSTPlay() {
    if (lstPlayInterval) {
        _lstStopPlay();
    } else {
        document.getElementById('lst-play-btn').textContent = '\u23F8';
        lstPlayInterval = setInterval(() => {
            const next = (currentLSTMonth % 12) + 1;
            changeLSTMonth(next);
        }, 1200);
    }
}

function _lstStopPlay() {
    if (lstPlayInterval) {
        clearInterval(lstPlayInterval);
        lstPlayInterval = null;
    }
    const btn = document.getElementById('lst-play-btn');
    if (btn) btn.textContent = '\u25B6';
}

function closeLSTPanel() {
    _lstStopPlay();
    document.getElementById('lst-panel').style.display = 'none';
    document.getElementById('lst-opacity-row').style.display = 'none';
    const toggle = document.getElementById('lst-layer-toggle');
    if (toggle) toggle.checked = false;
    for (let i = 1; i <= 12; i++) {
        map1.setLayoutProperty(`lst-month-${i}`, 'visibility', 'none');
    }
}
