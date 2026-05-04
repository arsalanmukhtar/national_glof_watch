const pakNationalBoundarySource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/Pak_Boundaries/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=Pak_Boundaries%3ANational_Boundary&outputFormat=application%2Fjson'
};
const pakProvincialBoundarySource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/Pak_Boundaries/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=Pak_Boundaries%3AProvincial_Boundary&outputFormat=application%2Fjson'
};
const pakDistrictBoundarySource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/Pak_Boundaries/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=Pak_Boundaries%3ADistrict_Boundary_Updated&outputFormat=application%2Fjson'
};

const vulSitesSrc={
    type: 'geojson',
    data: glof_sites
}
const vulLakesSrc={
    type: 'geojson',
    data: glof_lakes
}
const incidentSrc={
    type: 'geojson',
    data: incident_data
}
const glacialLakesInventorySource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AHKH_PK&outputFormat=application%2Fjson'
}
const akahInfrastructureSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AAKAHP_Infrastructure_Data_Final&outputFormat=application%2Fjson'
}
const populatedPlacesSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3APopulated-Points-North&outputFormat=application%2Fjson',
    promoteId: 'OBJECTID'
}
const gmrcWapdaSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AGMRC_Points&outputFormat=application%2Fjson'
}
const glofIISource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3Astations&outputFormat=application%2Fjson'
}
const glofIIDamagedStationsSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3ADamage_Stations&outputFormat=application%2Fjson'
}
const AKAH_STATIONS_XLSX_URL = 'data/WMP%20AWS%20EWS.xlsx';
const UNDP_ALL_SENSORS_CSV_URL = 'data/279_EWS_List_GLOF-II.csv';

function parseWorkbookNumber(rawValue) {
    const cleaned = String(rawValue ?? '').replace(/[^0-9.+-]/g, '');
    if (!cleaned) {
        return null;
    }

    const parsedValue = Number.parseFloat(cleaned);
    return Number.isFinite(parsedValue) ? parsedValue : null;
}

function buildAkahStationsFeatureCollection(rows) {
    if (!Array.isArray(rows) || rows.length < 2) {
        return { type: 'FeatureCollection', features: [] };
    }

    const features = [];

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        if (!Array.isArray(row) || row.length < 5) {
            continue;
        }

        const stationNumber = String(row[0] ?? '').trim();
        const villageName = String(row[1] ?? '').trim();
        const district = String(row[2] ?? '').trim();
        let latitude = parseWorkbookNumber(row[3]);
        let longitude = parseWorkbookNumber(row[4]);
        const type = String(row[5] ?? '').trim();
        const hazard = String(row[6] ?? '').trim();

        if (!villageName || latitude === null || longitude === null) {
            continue;
        }

        if (Math.abs(latitude) > 60 && Math.abs(longitude) < 60) {
            const swappedLatitude = longitude;
            longitude = latitude;
            latitude = swappedLatitude;
        }

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            continue;
        }

        features.push({
            type: 'Feature',
            id: stationNumber || `${rowIndex}`,
            properties: {
                'S.#': stationNumber,
                'Village Name': villageName,
                District: district,
                Latitude: latitude,
                Longitude: longitude,
                Type: type,
                Hazard: hazard
            },
            geometry: {
                type: 'Point',
                coordinates: [longitude, latitude]
            }
        });
    }

    return {
        type: 'FeatureCollection',
        features
    };
}

function splitCsvRow(rowText) {
    const fields = [];
    let currentField = '';
    let inQuotes = false;

    for (let index = 0; index < rowText.length; index += 1) {
        const character = rowText[index];

        if (character === '"') {
            if (inQuotes && rowText[index + 1] === '"') {
                currentField += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (character === ',' && !inQuotes) {
            fields.push(currentField);
            currentField = '';
        } else {
            currentField += character;
        }
    }

    fields.push(currentField);
    return fields;
}

function parseNumericValue(rawValue) {
    const cleanedValue = String(rawValue ?? '').replace(/[^0-9.+-]/g, '');
    if (!cleanedValue) {
        return null;
    }

    const parsedValue = Number.parseFloat(cleanedValue);
    return Number.isFinite(parsedValue) ? parsedValue : null;
}

function buildUndpAllSensorsFeatureCollection(csvText) {
    const lines = String(csvText || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    if (lines.length < 2) {
        return { type: 'FeatureCollection', features: [] };
    }

    const headers = splitCsvRow(lines[0]).map((header) => header.trim());
    const features = [];

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
        const fields = splitCsvRow(lines[lineIndex]);

        const stationNumber = String(fields[0] ?? '').trim();
        const code = String(fields[1] ?? '').trim();
        const stationName = String(fields[2] ?? '').trim();
        let latitude = parseNumericValue(fields[3]);
        let longitude = parseNumericValue(fields[4]);
        const elevation = String(fields[5] ?? '').trim();
        const gsmSignal = String(fields[6] ?? '').trim();
        const satellite = String(fields[7] ?? '').trim();
        const province = String(fields[8] ?? '').trim();
        const status = String(fields[9] ?? '').trim();

        if (!stationName || latitude === null || longitude === null) {
            continue;
        }

        if (Math.abs(latitude) > 60 && Math.abs(longitude) < 60) {
            const swappedLatitude = longitude;
            longitude = latitude;
            latitude = swappedLatitude;
        }

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            continue;
        }

        features.push({
            type: 'Feature',
            id: stationNumber || `${lineIndex}`,
            properties: {
                'S.NO': stationNumber,
                Code: code,
                StationNames: stationName,
                Lat: latitude,
                Long: longitude,
                Elev: elevation,
                'GSM Signal': gsmSignal,
                Satellite: satellite,
                Province: province,
                Status: status
            },
            geometry: {
                type: 'Point',
                coordinates: [longitude, latitude]
            }
        });
    }

    return {
        type: 'FeatureCollection',
        features
    };
}
const floodSusceptibilityRasterSource = {
    type: 'raster',
    tiles: [
        'http://172.18.1.85:8080/geoserver/GLOF/wms?service=WMS&version=1.1.0&request=GetMap&layers=GLOF:glof_susceptibility&bbox={bbox-epsg-3857}&width=256&height=256&srs=EPSG:3857&styles=&format=image/png&transparent=true'
    ],
    tileSize: 256
}
const akahHazardExposureSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AAKAHP_HazardExposure_Final&outputFormat=application%2Fjson'
}
const highTempWarningSrc = {
    type: 'geojson',
    data: {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                properties: {
                    title: 'High Temp Warning Area'
                },
                geometry: {
                    type: 'Point',
                    coordinates: [75.33670798647735, 35.86669398878782]
                }
            }
        ]
    }
}
const stationPointsSrc = {
    type: 'geojson',
    data: 'data/geojsons/station_points.geojson'
}
const badswatBoundSource = {
    type: 'geojson',
    data: 'http://172.18.1.4:8080/geoserver/abdul_sattar/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=abdul_sattar%3ADistrict_Boundary&outputFormat=application%2Fjson&CQL_FILTER=DISTRICT=%27GHIZER%27'
};
const badswatfaultlineSource = {
    type: 'geojson',
    data: badswat_faultine
};
const badswatGlacierSource = {
    type: 'geojson',
    data: badswat_glaciers
};
const badswat_lakeSource = {
    type: 'geojson',
    data: badswat_lake
};
const badswat_risk_zonationSource = {
    type: 'geojson',
    data: badswat_risk_zonation
};
const ishkomanRiverSource = {
    type: 'geojson',
    data: ishkoman_river
};
const karambarLakeSource = {
    type: 'geojson',
    data: karambar_lake
};

const hiranchiBoundSource = {
    type: 'geojson',
    data: 'http://172.18.1.4:8080/geoserver/abdul_sattar/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=abdul_sattar%3ADistrict_Boundary&outputFormat=application%2Fjson&CQL_FILTER=DISTRICT=%27GILGIT%27'
};
const hiranchiGlacierSource = {
    type: 'geojson',
    data: hiranchi_glaciers
};
const hiranchiLakeSource = {
    type: 'geojson',
    data: hiranchi_lake
};
const hiranchiRiskZonationSource = {
    type: 'geojson',
    data: hiranchi_risk_zonation
};

const reshunBoundSource = {
    type: 'geojson',
    data: 'http://172.18.1.4:8080/geoserver/abdul_sattar/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=abdul_sattar%3ADistrict_Boundary&outputFormat=application%2Fjson&CQL_FILTER=DISTRICT=%27CHITRAL%27'
};
const reshunGlacierSource = {
    type: 'geojson',
    data: glacier_reshun
};
const chitralRiverSource={
    type: 'geojson',
    data: chitral_river
}
const faultlineReshunSource={
    type: 'geojson',
    data: faultline_reshun
}
const nullahReshunSource={
    type: 'geojson',
    data: nullah_reshun
}
const reshunRiskZonationSource={
    type: 'geojson',
    data: risk_zonation_reshun
}
const tersetHundurLakeSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3Alakes_THundur&outputFormat=application%2Fjson'
};
const tersetHundurRiverSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3ARiver_THundur&outputFormat=application%2Fjson'
};
const tersetHundurRiskHighSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AHigh_THundur&outputFormat=application%2Fjson'
};
const tersetHundurRiskMediumSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AMedium_THundur&outputFormat=application%2Fjson'
};
const tersetHundurRiskLowSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3ALow_THundur&outputFormat=application%2Fjson'
};
const ishokomanRiskHighSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AIshokoman_High&outputFormat=application%2Fjson'
};
const ishokomanRiskMediumSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AIshokoman_Medium&outputFormat=application%2Fjson'
};
const ishokomanRiskLowSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AIshokoman_Low&outputFormat=application%2Fjson'
};
const lushtRiskHighSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3ALusht_High&outputFormat=application%2Fjson'
};
const lushtRiskMediumSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3ALusht_Medium&outputFormat=application%2Fjson'
};
const lushtRiskLowSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3ALusht_Low&outputFormat=application%2Fjson'
};
const ulterRiskHighSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AHigh_Risk_Ultar_Lake&outputFormat=application%2Fjson'
};
const ulterRiskMediumSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AMedium_Risk_Ultar_Lake&outputFormat=application%2Fjson'
};
const ulterRiskLowSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3ALow_Risk_Ultar_Lake&outputFormat=application%2Fjson'
};
const shisperRiskHighSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AShisper_High&outputFormat=application%2Fjson'
};
const shisperRiskMediumSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AShisper_Medium&outputFormat=application%2Fjson'
};
const shisperRiskLowSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AShisper_Low&outputFormat=application%2Fjson'
};
const shisperLakeSource = {
    type: 'geojson',
    data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AShisper_Lake&outputFormat=application%2Fjson'
};
const brep_zonationSource={
    type: 'geojson',
    data: brep_zonation
}
const darkot_zonationSrc={
    type: 'geojson',
    data: darkotRz
}
const darkotSchoolsSrc={
    type: 'geojson',
    data: darkotSchools
}
const darkotBuildingsSrc={
    type: 'geojson',
    data: darkotBuildings
}
const darkotRiversSrc={
    type: 'geojson',
    data: darkot_river
}
const darkotGlacierSrc={
    type: 'geojson',
    data: darkot_glaciers    
}
const gulmitLineSrc= {
    type: 'geojson',
    data: 'http://172.18.1.4:8080/geoserver/abdul_sattar/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=abdul_sattar%3ADistrict_Boundary&outputFormat=application%2Fjson&CQL_FILTER=DISTRICT=%27HUNZA%20NAGAR%27'
}
const gulmit_zonationSource={
    type: 'geojson',
    data: gulmitRz
}
const gulmitBuildingsSrc={
    type: 'geojson',
    data: gulmitBuildings
}
const gulmitRoadsSrc={
    type: 'geojson',
    data: gulmitRoads
}
const gulmitRiversSrc={
    type: 'geojson',
    data: gulmitRivers
}
const gulmitSchoolsSrc={
    type: 'geojson',
    data: gulmitSchools
}
const thalu_zonationSource={
    type: 'geojson',
    data: thaluRz
}

let akahHazardOutlineAnimationInterval = null;
let populatedPlacesHoverMarker = null;
let populatedPlacesHoverMarkerVisible = false;
let populatedPlacesHoverEventsBound = false;
let populatedPlacesHoverZoomEventBound = false;
let populatedPlacesHoveredFeatureId = null;

const populatedPlacesIconNativeSizePx = 640;

function getPopulatedPlacesIconScale(zoom) {
    if (zoom <= 6) {
        return 0.07;
    }
    if (zoom <= 10) {
        return 0.07 + ((zoom - 6) * (0.1 - 0.07)) / 4;
    }
    if (zoom <= 13) {
        return 0.1 + ((zoom - 10) * (0.12 - 0.1)) / 3;
    }
    return 0.12;
}

function updatePopulatedPlacesHoverMarkerSize() {
    if (!populatedPlacesHoverMarker) {
        return;
    }

    const markerElement = populatedPlacesHoverMarker.getElement();
    if (!markerElement) {
        return;
    }

    const iconScale = getPopulatedPlacesIconScale(map1.getZoom());
    const iconSizePx = Math.max(16, Math.round(populatedPlacesIconNativeSizePx * iconScale));
    markerElement.style.width = `${iconSizePx}px`;
    markerElement.style.height = `${iconSizePx}px`;
}

function clearPopulatedPlacesFeatureHoverState() {
    if (populatedPlacesHoveredFeatureId === null) {
        return;
    }

    if (map1.getSource('populatedPlaces')) {
        map1.setFeatureState(
            { source: 'populatedPlaces', id: populatedPlacesHoveredFeatureId },
            { hover: false }
        );
    }

    populatedPlacesHoveredFeatureId = null;
}

function setPopulatedPlacesFeatureHoverState(feature) {
    if (!feature || feature.id === undefined || feature.id === null || !map1.getSource('populatedPlaces')) {
        return;
    }

    if (populatedPlacesHoveredFeatureId !== null && populatedPlacesHoveredFeatureId !== feature.id) {
        map1.setFeatureState(
            { source: 'populatedPlaces', id: populatedPlacesHoveredFeatureId },
            { hover: false }
        );
    }

    if (populatedPlacesHoveredFeatureId !== feature.id) {
        map1.setFeatureState(
            { source: 'populatedPlaces', id: feature.id },
            { hover: true }
        );
        populatedPlacesHoveredFeatureId = feature.id;
    }
}

function startAkahHazardOutlineAnimation() {
    const outlineLayerIds = [
        'akah-hzd-ava-outline-layer',
        'akah-hzd-dbf-outline-layer',
        'akah-hzd-bnk-outline-layer',
        'akah-hzd-fld-outline-layer',
        'akah-hzd-lds-outline-layer',
        'akah-hzd-rkf-outline-layer',
        'akah-hzd-ufl-outline-layer'
    ];

    const dashArraySequence = [
        [0, 2, 3],
        [0.5, 2, 2.5],
        [1, 2, 2],
        [1.5, 2, 1.5],
        [2, 2, 1],
        [2.5, 2, 0.5],
        [3, 2, 0],
        [0, 0.5, 3, 2.5],
        [0, 1, 3, 2],
        [0, 1.5, 3, 1.5],
        [0, 2, 3, 1],
        [0, 2.5, 3, 0.5]
    ];

    if (akahHazardOutlineAnimationInterval !== null) {
        clearInterval(akahHazardOutlineAnimationInterval);
    }

    let dashIndex = 0;
    akahHazardOutlineAnimationInterval = setInterval(() => {
        const dashArray = dashArraySequence[dashIndex];
        outlineLayerIds.forEach((layerId) => {
            if (map1.getLayer(layerId)) {
                map1.setPaintProperty(layerId, 'line-dasharray', dashArray);
            }
        });
        dashIndex = (dashIndex + 1) % dashArraySequence.length;
    }, 150);
}

function showPopulatedPlacesHoverAnimationMarker(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return;
    }

    if (!populatedPlacesHoverMarker) {
        const markerImage = document.createElement('img');
        markerImage.src = 'data/location.gif';
        markerImage.alt = 'Populated Place';
        markerImage.style.pointerEvents = 'none';
        markerImage.style.userSelect = 'none';

        populatedPlacesHoverMarker = new mapboxgl.Marker({
            element: markerImage,
            anchor: 'bottom'
        });
    }

    updatePopulatedPlacesHoverMarkerSize();

    populatedPlacesHoverMarker.setLngLat(coordinates);

    if (!populatedPlacesHoverMarkerVisible) {
        populatedPlacesHoverMarker.addTo(map1);
        populatedPlacesHoverMarkerVisible = true;
    }
}

function hidePopulatedPlacesHoverAnimationMarker() {
    clearPopulatedPlacesFeatureHoverState();

    if (populatedPlacesHoverMarker && populatedPlacesHoverMarkerVisible) {
        populatedPlacesHoverMarker.remove();
        populatedPlacesHoverMarkerVisible = false;
    }
}

function bindPopulatedPlacesHoverAnimationEvents() {
    if (populatedPlacesHoverEventsBound) {
        return;
    }

    map1.on('mouseenter', 'populated-places-points-layer', (e) => {
        map1.getCanvas().style.cursor = 'pointer';
        const feature = e && e.features && e.features[0] ? e.features[0] : null;
        setPopulatedPlacesFeatureHoverState(feature);
        const coordinates = feature && feature.geometry && feature.geometry.coordinates
            ? feature.geometry.coordinates.slice()
            : null;
        if (coordinates) {
            showPopulatedPlacesHoverAnimationMarker(coordinates);
        }
    });

    map1.on('mousemove', 'populated-places-points-layer', (e) => {
        const feature = e && e.features && e.features[0] ? e.features[0] : null;
        setPopulatedPlacesFeatureHoverState(feature);
        const coordinates = feature && feature.geometry && feature.geometry.coordinates
            ? feature.geometry.coordinates.slice()
            : null;
        if (coordinates) {
            showPopulatedPlacesHoverAnimationMarker(coordinates);
        }
    });

    map1.on('mouseleave', 'populated-places-points-layer', () => {
        map1.getCanvas().style.cursor = '';
        hidePopulatedPlacesHoverAnimationMarker();
    });

    if (!populatedPlacesHoverZoomEventBound) {
        map1.on('zoom', () => {
            if (populatedPlacesHoverMarkerVisible) {
                updatePopulatedPlacesHoverMarkerSize();
            }
        });
        populatedPlacesHoverZoomEventBound = true;
    }

    populatedPlacesHoverEventsBound = true;
}

window.hidePopulatedPlacesHoverAnimationMarker = hidePopulatedPlacesHoverAnimationMarker;
//____________________________________________________________________________________________________________________________________________________________________________________
map1.loadImage('https://i.ibb.co/20MBc92N/glacier-icon.png', function (error, image) {
    if (error) throw error;
    
    // Add the image to Mapbox
    if (!map1.hasImage('glofIcon')) {
        map1.addImage('glofIcon', image);
    }
});
//____________________________________________________________________________________________________________________________________________________________________________________
map1.on('style.load', () => {
    hidePopulatedPlacesHoverAnimationMarker();

    map1.addSource('pakNationalBoundary', pakNationalBoundarySource);
    map1.addSource('pakProvincialBoundary', pakProvincialBoundarySource);
    map1.addSource('pakDistrictBoundary', pakDistrictBoundarySource);
    map1.addSource('vulSites', vulSitesSrc);
    map1.addSource('vulLakes', vulLakesSrc);
    map1.addSource('incident', incidentSrc);
    map1.addSource('glacialLakesInventory', glacialLakesInventorySource);
    map1.addSource('akahInfrastructure', akahInfrastructureSource);
    map1.addSource('populatedPlaces', populatedPlacesSource);
    map1.addSource('gmrcWapdaPoints', gmrcWapdaSource);
    map1.addSource('glofIIStations', glofIISource);
    map1.addSource('glofIIDamagedStations', glofIIDamagedStationsSource);
    map1.addSource('akahStations', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });
    map1.addSource('undpAllSensors', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });
    map1.addSource('floodSusceptibilityRaster', floodSusceptibilityRasterSource);
    map1.addSource('akahHazardExposure', akahHazardExposureSource);
    map1.addSource('highTempWarning', highTempWarningSrc);
    map1.addSource('stationPoints', stationPointsSrc);
    map1.addSource('badswatBound', badswatBoundSource);
    map1.addSource('badswatfaultline', badswatfaultlineSource);
    map1.addSource('badswatGlacier', badswatGlacierSource);
    map1.addSource('badswatLake', badswat_lakeSource);
    map1.addSource('ishkomanRiver', ishkomanRiverSource);
    map1.addSource('karambarLake', karambarLakeSource);
    map1.addSource('badswatRiskZonation', badswat_risk_zonationSource);
    map1.addSource('hiranchiBounds', hiranchiBoundSource);
    map1.addSource('hiranchiGlaciers', hiranchiGlacierSource);
    map1.addSource('hiranchiLake', hiranchiLakeSource);
    map1.addSource('hiranchiRiskZonation', hiranchiRiskZonationSource);
    map1.addSource('reshunBound', reshunBoundSource);
    map1.addSource('reshunGlacier', reshunGlacierSource);
    map1.addSource('chitralRiverSource', chitralRiverSource);
    map1.addSource('faultlineReshunSource', faultlineReshunSource);
    map1.addSource('nullahReshunSource', nullahReshunSource);
    map1.addSource('reshunRiskZonationSource', reshunRiskZonationSource);
    map1.addSource('tersetHundurLake', tersetHundurLakeSource);
    map1.addSource('tersetHundurRiver', tersetHundurRiverSource);
    map1.addSource('tersetHundurRiskHigh', tersetHundurRiskHighSource);
    map1.addSource('tersetHundurRiskMedium', tersetHundurRiskMediumSource);
    map1.addSource('tersetHundurRiskLow', tersetHundurRiskLowSource);
    map1.addSource('ishokomanRiskHigh', ishokomanRiskHighSource);
    map1.addSource('ishokomanRiskMedium', ishokomanRiskMediumSource);
    map1.addSource('ishokomanRiskLow', ishokomanRiskLowSource);
    map1.addSource('lushtRiskHigh', lushtRiskHighSource);
    map1.addSource('lushtRiskMedium', lushtRiskMediumSource);
    map1.addSource('lushtRiskLow', lushtRiskLowSource);
    map1.addSource('ulterRiskHigh', ulterRiskHighSource);
    map1.addSource('ulterRiskMedium', ulterRiskMediumSource);
    map1.addSource('ulterRiskLow', ulterRiskLowSource);
    map1.addSource('shisperRiskHigh', shisperRiskHighSource);
    map1.addSource('shisperRiskMedium', shisperRiskMediumSource);
    map1.addSource('shisperRiskLow', shisperRiskLowSource);
    map1.addSource('shisperLake', shisperLakeSource);
    map1.addSource('brepZonation', brep_zonationSource);
    map1.addSource('darkotRz', darkot_zonationSrc);
    map1.addSource('darkotSchools', darkotSchoolsSrc);
    map1.addSource('darkotBuildings', darkotBuildingsSrc);
    map1.addSource('darkotRivers', darkotRiversSrc);
    map1.addSource('darkotGlacier', darkotGlacierSrc);
    map1.addSource('gulmitLine', gulmitLineSrc);
    map1.addSource('gulmitRz', gulmit_zonationSource);
    map1.addSource('gulmitBuildings', gulmitBuildingsSrc);
    map1.addSource('gulmitRoads', gulmitRoadsSrc);
    map1.addSource('gulmitRivers', gulmitRiversSrc);
    map1.addSource('gulmitSchools', gulmitSchoolsSrc);
    map1.addSource('thaluRz', thalu_zonationSource);


    //_________________________________________________________________________________________________
    map1.addLayer({
        id: 'national-boundary-layer',
        type: 'line',
        source: 'pakNationalBoundary',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'line-color': '#000000',
            'line-width': 3.2,
            'line-opacity': 0.95
        }
    });
    map1.addLayer({
        id: 'provincial-boundary-layer',
        type: 'line',
        source: 'pakProvincialBoundary',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'line-color': '#000000',
            'line-width': 2.2,
            'line-opacity': 0.95
        }
    });
    map1.addLayer({
        id: 'district-boundary-layer',
        type: 'line',
        source: 'pakDistrictBoundary',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'line-color': '#000000',
            'line-width': 1.5,
            'line-opacity': 0.9
        }
    });
    map1.addLayer({
        id: 'district-boundary-label-layer',
        type: 'symbol',
        source: 'pakDistrictBoundary',
        minzoom: 7.5,
        layout: {
            'visibility': 'none',
            'symbol-placement': 'point',
            'text-field': [
                'coalesce',
                ['get', 'Districts'],
                ['get', 'districts'],
                ['get', 'DISTRICT'],
                ['get', 'District'],
                ['get', 'district'],
                ['get', 'DIST_NAME'],
                ['get', 'DISTRICT_N'],
                ['get', 'NAME_2'],
                ['get', 'NAME'],
                ''
            ],
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                7.5, 10,
                10, 13,
                12, 15
            ],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-allow-overlap': false
        },
        paint: {
            'text-color': '#f8fafc',
            'text-halo-color': '#0f172a',
            'text-halo-width': 1.4
        }
    });

    const akahHazardTypeStyles = [
        { code: 'ava', fillId: 'akah-hzd-ava-layer', outlineId: 'akah-hzd-ava-outline-layer', color: '#e31a1c' },
        { code: 'dbf', fillId: 'akah-hzd-dbf-layer', outlineId: 'akah-hzd-dbf-outline-layer', color: '#ff7f00' },
        { code: 'bnk', fillId: 'akah-hzd-bnk-layer', outlineId: 'akah-hzd-bnk-outline-layer', color: '#ffd92f' },
        { code: 'fld', fillId: 'akah-hzd-fld-layer', outlineId: 'akah-hzd-fld-outline-layer', color: '#1f78b4' },
        { code: 'lds', fillId: 'akah-hzd-lds-layer', outlineId: 'akah-hzd-lds-outline-layer', color: '#6a3d9a' },
        { code: 'rkf', fillId: 'akah-hzd-rkf-layer', outlineId: 'akah-hzd-rkf-outline-layer', color: '#33a02c' },
        { code: 'ufl', fillId: 'akah-hzd-ufl-layer', outlineId: 'akah-hzd-ufl-outline-layer', color: '#00bcd4' }
    ];

    akahHazardTypeStyles.forEach((hazardType) => {
        map1.addLayer({
            id: hazardType.fillId,
            type: 'fill',
            source: 'akahHazardExposure',
            layout: {
                'visibility': 'none'
            },
            filter: [
                'match',
                ['get', 'hzd_type'],
                [hazardType.code, hazardType.code.toUpperCase()],
                true,
                false
            ],
            paint: {
                'fill-color': hazardType.color,
                'fill-opacity': 0.5
            }
        });

        map1.addLayer({
            id: hazardType.outlineId,
            type: 'line',
            source: 'akahHazardExposure',
            layout: {
                'visibility': 'none',
                'line-cap': 'round',
                'line-join': 'round'
            },
            filter: [
                'match',
                ['get', 'hzd_type'],
                [hazardType.code, hazardType.code.toUpperCase()],
                true,
                false
            ],
            paint: {
                'line-color': hazardType.color,
                'line-width': 2,
                'line-opacity': 1,
                'line-dasharray': [0, 2, 3]
            }
        });
    });

    startAkahHazardOutlineAnimation();

    //__________________________________________________________________________________________________
    //GlofSites 
    map1.addLayer({
        'id': 'vulSites',
        'type': 'symbol',
        'source': 'vulSites',
        'layout': {
            'visibility': 'none',
            'icon-image': 'glofIcon', // Use the loaded image
            'icon-size': 1, // Adjust the size as needed
            'icon-allow-overlap': true // Prevent icons from hiding each other
        }
    });
    // Add a click event to show a popup
    map1.on('click', 'vulSites', function (e) {
        const coordinates = e.features[0].geometry.coordinates.slice(); // Get coordinates
        const glacierName = e.features[0].properties["Name"] || 'No information available'; // Fetch "Name" property

        // Create and show the popup
        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(`<strong><u>Glacier Name:</u></strong> ${glacierName}`)
            .addTo(map1);
    });
    map1.on('mouseenter', 'vulSites', function () {
        map1.getCanvas().style.cursor = 'pointer';
    });
    map1.on('mouseleave', 'vulSites', function () {
        map1.getCanvas().style.cursor = '';
    });


    map1.addLayer({
        'id': 'vulLakes',
        'type': 'circle',
        'source': 'vulLakes',
        'layout': {
            'visibility': 'none'
        },
        'paint': {
            'circle-color': 'transparent', // Make the circle itself transparent
            'circle-radius': 14,
            'circle-stroke-color': 'red', // Outline color
            'circle-stroke-width': 3, // Stroke thickness
        }
    });
    map1.on('click', 'vulLakes', function (e) {
        const coordinates = e.features[0].geometry.coordinates.slice(); // Extract coordinates
        const properties = e.features[0].properties; // Extract all properties
    
        // Construct the popup HTML
        const popupContent = `
            <strong><u>Lake Name:</u></strong> ${properties.Lake_Name} <br>
            <strong><u>Elevation:</u></strong> ${properties.Elevation_} m <br>
            <strong><u>Aspect:</u></strong> ${properties.Aspect} <br>
            <strong><u>District:</u></strong> ${properties.Districts} <br>
            <strong><u>Area at Risk:</u></strong> ${properties.Areas_at_R} <br>
            <strong><u>Observed Level:</u></strong> ${properties.Observed_L} <br>
        `;
    
        // Create and show the popup
        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(popupContent)
            .addTo(map1);
    });
    // Change cursor to pointer when hovering over the lake circles
    map1.on('mouseenter', 'vulLakes', function () {
        map1.getCanvas().style.cursor = 'pointer';
    });
    map1.on('mouseleave', 'vulLakes', function () {
        map1.getCanvas().style.cursor = '';
    });
    const blinkingInterval = makeLayerBlink(map1, 'vulLakes', 500);

    map1.addLayer({
        id: 'glacial-lakes-inventory-fill',
        type: 'fill',
        source: 'glacialLakesInventory',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#38bdf8',
            'fill-opacity': 0.28
        }
    });
    map1.addLayer({
        id: 'glacial-lakes-inventory-outline',
        type: 'line',
        source: 'glacialLakesInventory',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'line-color': '#93c5fd',
            'line-width': 1.8,
            'line-opacity': 0.95
        }
    });

    // Center markers make very small polygons visible at low zoom.
    (function addInventoryCenterDot() {
        const size = 42;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const center = size / 2;
        const radius = 5.5;

        ctx.beginPath();
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#00b8ff';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.stroke();

        const image = {
            width: size,
            height: size,
            data: new Uint8Array(ctx.getImageData(0, 0, size, size).data)
        };

        if (!map1.hasImage('inventory-center-dot')) {
            map1.addImage('inventory-center-dot', image);
        }
    })();

    map1.addLayer({
        id: 'glacial-lakes-inventory-centers',
        type: 'symbol',
        source: 'glacialLakesInventory',
        layout: {
            'visibility': 'none',
            'icon-image': 'inventory-center-dot',
            'icon-size': [
                'interpolate', ['linear'], ['zoom'],
                4, 0.9,
                8, 0.6,
                12, 0.4
            ],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        }
    });

    map1.addLayer({
        id: 'akah-infrastructure-layer',
        type: 'circle',
        source: 'akahInfrastructure',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'circle-color': '#ff1f1f',
            'circle-radius': 2.8,
            'circle-opacity': 0.95,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 0.6
        }
    });

    const addPopulatedPlacesPointLayer = (useGifIcon) => {
        if (map1.getLayer('populated-places-points-layer')) {
            return;
        }

        const beforeLayerId = map1.getLayer('populated-places-name-label-layer')
            ? 'populated-places-name-label-layer'
            : undefined;

        if (useGifIcon) {
            map1.addLayer({
                id: 'populated-places-points-layer',
                type: 'symbol',
                source: 'populatedPlaces',
                layout: {
                    'visibility': 'none',
                    'icon-image': 'populated-places-static-icon',
                    'icon-size': [
                        'interpolate', ['linear'], ['zoom'],
                        6, 0.07,
                        10, 0.1,
                        13, 0.12
                    ],
                    'icon-anchor': 'bottom',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true
                },
                paint: {
                    'icon-opacity': [
                        'case',
                        ['boolean', ['feature-state', 'hover'], false],
                        0,
                        1
                    ]
                }
            }, beforeLayerId);
            return;
        }

        // Fallback if GIF cannot be loaded by the browser/runtime.
        map1.addLayer({
            id: 'populated-places-points-layer',
            type: 'circle',
            source: 'populatedPlaces',
            layout: {
                'visibility': 'none'
            },
            paint: {
                'circle-color': '#f8fafc',
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    6, 2,
                    10, 3,
                    13, 4.2
                ],
                'circle-stroke-color': '#0f172a',
                'circle-stroke-width': 1,
                'circle-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0,
                    0.95
                ]
            }
        }, beforeLayerId);
    };

    map1.loadImage('data/location.gif', function (error, image) {
        if (!error && image) {
            if (!map1.hasImage('populated-places-static-icon')) {
                map1.addImage('populated-places-static-icon', image);
            }
            addPopulatedPlacesPointLayer(true);
            bindPopulatedPlacesHoverAnimationEvents();
            return;
        }

        console.warn('Could not load location.gif for populated places static icon. Falling back to circle markers.');
        addPopulatedPlacesPointLayer(false);
        bindPopulatedPlacesHoverAnimationEvents();
    });

    map1.addLayer({
        id: 'populated-places-name-label-layer',
        type: 'symbol',
        source: 'populatedPlaces',
        minzoom: 7,
        layout: {
            'visibility': 'none',
            'text-field': [
                'coalesce',
                ['get', 'name'],
                ['get', 'Name'],
                ['get', 'NAME'],
                'N/A'
            ],
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                7, 10,
                10, 12,
                13, 14
            ],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-offset': [0, 1],
            'text-anchor': 'top',
            'text-allow-overlap': false
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 1.2
        }
    });

    map1.addLayer({
        id: 'populated-places-population-label-layer',
        type: 'symbol',
        source: 'populatedPlaces',
        minzoom: 10,
        layout: {
            'visibility': 'none',
            'text-field': [
                'concat',
                'Population: ',
                ['to-string', ['coalesce', ['get', 'population'], ['get', 'Population'], ['get', 'POPULATION']]]
            ],
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                10, 10,
                13, 12
            ],
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
            'text-offset': [0, 2.1],
            'text-anchor': 'top',
            'text-allow-overlap': true,
            'text-ignore-placement': true
        },
        filter: [
            'all',
            ['any', ['has', 'population'], ['has', 'Population'], ['has', 'POPULATION']],
            ['match',
                ['downcase', ['to-string', ['coalesce', ['get', 'population'], ['get', 'Population'], ['get', 'POPULATION'], '']]],
                ['', 'null', 'n/a', 'na', '-', '--', 'none', 'unknown', 'nil'],
                false,
                true
            ]
        ],
        paint: {
            'text-color': '#ffff00',
            'text-halo-color': '#1f2937',
            'text-halo-width': 1
        }
    });

    map1.addLayer({
        id: 'flood-susceptibility-layer',
        type: 'raster',
        source: 'floodSusceptibilityRaster',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'raster-opacity': 0.75
        }
    }, 'national-boundary-layer');
    //_____________________________________________________________________________________________________________________________________________________________
    // Add the incident layer
    map1.addLayer({
        'id': 'incident',
        'type': 'circle',
        'source': 'incident',
        'layout': {
            'visibility': 'none'
        },
        'paint': {
            'circle-color': '#ff0000', // Red color for incident
            'circle-radius': 15,
            'circle-stroke-color': '#000000', // Black outline for better contrast
            'circle-stroke-width': 4,
            'circle-opacity': 0.9
        }
    });
    
    // Add click event for incident layer
    map1.on('click', 'incident', function (e) {
        const coordinates = e.features[0].geometry.coordinates.slice();
        const properties = e.features[0].properties;
    
        const popupContent = `
            <strong><u>Incident Location</u></strong><br>
            <strong>Name:</strong> ${properties.name || 'Incident Point'}<br>
            <strong>Coordinates:</strong> ${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}
        `;
    
        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(popupContent)
            .addTo(map1);
    });
    
    // Change cursor to pointer when hovering over incident point
    map1.on('mouseenter', 'incident', function () {
        map1.getCanvas().style.cursor = 'pointer';
    });
    map1.on('mouseleave', 'incident', function () {
        map1.getCanvas().style.cursor = '';
    });

    map1.addLayer({
        id: 'high-temp-warning-area',
        type: 'circle',
        source: 'highTempWarning',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'circle-color': 'rgba(255, 0, 47, 0.12)',
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                7, 16,
                10, 36,
                13, 70
            ],
            'circle-stroke-color': '#ff0037',
            'circle-stroke-width': 3,
            'circle-stroke-opacity': 0.95
        }
    });

    map1.on('click', 'high-temp-warning-area', function () {
        showHighTempWarningPopup();
    });
    map1.on('mouseenter', 'high-temp-warning-area', function () {
        map1.getCanvas().style.cursor = 'pointer';
    });
    map1.on('mouseleave', 'high-temp-warning-area', function () {
        map1.getCanvas().style.cursor = '';
    });

    map1.addLayer({
        id: 'station-points-layer',
        type: 'circle',
        source: 'stationPoints',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'circle-color': '#f97316',
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                5, 3,
                8, 5,
                12, 7
            ],
            'circle-stroke-color': '#f8fafc',
            'circle-stroke-width': 1.6,
            'circle-opacity': 0.98,
            'circle-blur': 0.12,
            'circle-emissive-strength': 0.9
        }
    });

    map1.addLayer({
        id: 'station-points-animated-halo-layer',
        type: 'circle',
        source: 'stationPoints',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'circle-color': '#00b6ff',
            'circle-radius': 12,
            'circle-opacity': 0.56,
            'circle-blur': 0.82,
            'circle-emissive-strength': 1,
            'circle-radius-transition': {
                duration: 220,
                delay: 0
            },
            'circle-color-transition': {
                duration: 220,
                delay: 0
            },
            'circle-opacity-transition': {
                duration: 220,
                delay: 0
            },
            'circle-blur-transition': {
                duration: 220,
                delay: 0
            }
        }
    });

    map1.addLayer({
        id: 'station-points-animated-layer',
        type: 'circle',
        source: 'stationPoints',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'circle-color': '#00b6ff',
            'circle-radius': 6.2,
            'circle-stroke-color': '#f8fafc',
            'circle-stroke-width': 1.9,
            'circle-opacity': 1,
            'circle-blur': 0.12,
            'circle-emissive-strength': 1,
            'circle-radius-transition': {
                duration: 220,
                delay: 0
            },
            'circle-color-transition': {
                duration: 220,
                delay: 0
            },
            'circle-blur-transition': {
                duration: 220,
                delay: 0
            }
        }
    });

    map1.addLayer({
        id: 'station-points-label-layer',
        type: 'symbol',
        source: 'stationPoints',
        layout: {
            'visibility': 'none',
            'text-field': ['coalesce', ['get', 'name'], 'Station'],
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                6, 10,
                10, 12,
                13, 14
            ],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-offset': [0, 1.15],
            'text-anchor': 'top',
            'text-allow-overlap': false
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#0f172a',
            'text-halo-width': 1.2
        }
    });

    const ensureGmrcWapdaIcon = () => {
        if (map1.hasImage('gmrc-wapda-icon')) {
            return;
        }

        const size = 48;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');

        const center = size / 2;
        const outerRadius = 16;

        context.beginPath();
        context.moveTo(center, size - 4);
        context.bezierCurveTo(center - 12, 32, 10, 18, center, 7);
        context.bezierCurveTo(size - 10, 18, center + 12, 32, center, size - 4);
        context.closePath();
        context.fillStyle = '#0284c7';
        context.fill();

        context.beginPath();
        context.arc(center, 20, outerRadius, 0, Math.PI * 2);
        context.fillStyle = '#0f172a';
        context.fill();

        context.beginPath();
        context.arc(center, 20, outerRadius - 3, 0, Math.PI * 2);
        context.fillStyle = '#0ea5e9';
        context.fill();

        context.beginPath();
        context.moveTo(center - 8, 24);
        context.lineTo(center - 1, 15);
        context.lineTo(center + 6, 24);
        context.closePath();
        context.fillStyle = '#ffffff';
        context.fill();

        context.beginPath();
        context.moveTo(center - 4, 24);
        context.lineTo(center + 1, 18);
        context.lineTo(center + 5, 24);
        context.closePath();
        context.fillStyle = '#dbeafe';
        context.fill();

        context.beginPath();
        context.arc(center, 20, 3.1, 0, Math.PI * 2);
        context.fillStyle = '#f8fafc';
        context.fill();

        const image = {
            width: size,
            height: size,
            data: new Uint8Array(context.getImageData(0, 0, size, size).data)
        };

        map1.addImage('gmrc-wapda-icon', image);
    };

    ensureGmrcWapdaIcon();

    map1.addLayer({
        id: 'gmrc-wapda-points-layer',
        type: 'symbol',
        source: 'gmrcWapdaPoints',
        layout: {
            'visibility': 'none',
            'icon-image': 'gmrc-wapda-icon',
            'icon-size': [
                'interpolate', ['linear'], ['zoom'],
                4, 0.72,
                8, 0.92,
                12, 1.1
            ],
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'text-field': ['coalesce', ['get', 'Name'], 'GMRC, WAPDA'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                5, 10,
                9, 11,
                12, 13
            ],
            'text-offset': [0, 1.25],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-ignore-placement': false
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#082f49',
            'text-halo-width': 1.3
        }
    });

    map1.on('click', 'gmrc-wapda-points-layer', function (e) {
        const feature = e && e.features && e.features[0] ? e.features[0] : null;
        if (!feature) {
            return;
        }

        const properties = feature.properties || {};
        const coordinates = feature.geometry && Array.isArray(feature.geometry.coordinates)
            ? feature.geometry.coordinates.slice()
            : null;
        const pointName = properties.Name || 'GMRC, WAPDA Point';

        if (!coordinates) {
            return;
        }

        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(`
                <strong><u>GMRC, WAPDA</u></strong><br>
                <strong>Name:</strong> ${pointName}<br>
                <strong>Coordinates:</strong> ${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}
            `)
            .addTo(map1);
    });

    map1.on('mouseenter', 'gmrc-wapda-points-layer', function () {
        map1.getCanvas().style.cursor = 'pointer';
    });
    map1.on('mouseleave', 'gmrc-wapda-points-layer', function () {
        map1.getCanvas().style.cursor = '';
    });

    const ensureGlofIIDestinationIcon = () => {
        if (map1.hasImage('glof-ii-destination-icon')) {
            return;
        }

        const size = 50;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');

        const centerX = size / 2;
        const centerY = 20;

        context.beginPath();
        context.moveTo(centerX, size - 4);
        context.bezierCurveTo(centerX - 13, 33, 11, 19, centerX, 7);
        context.bezierCurveTo(size - 11, 19, centerX + 13, 33, centerX, size - 4);
        context.closePath();
        context.fillStyle = '#facc15';
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 15.5, 0, Math.PI * 2);
        context.fillStyle = '#3f3f46';
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 12, 0, Math.PI * 2);
        context.fillStyle = '#fde047';
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 6.2, 0, Math.PI * 2);
        context.fillStyle = '#f8fafc';
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 3.1, 0, Math.PI * 2);
        context.fillStyle = '#ca8a04';
        context.fill();

        const image = {
            width: size,
            height: size,
            data: new Uint8Array(context.getImageData(0, 0, size, size).data)
        };

        map1.addImage('glof-ii-destination-icon', image);
    };

    ensureGlofIIDestinationIcon();

    map1.addLayer({
        id: 'glof-ii-stations-layer',
        type: 'symbol',
        source: 'glofIIStations',
        layout: {
            'visibility': 'none',
            'icon-image': 'glof-ii-destination-icon',
            'icon-size': [
                'interpolate', ['linear'], ['zoom'],
                4, 0.72,
                8, 0.92,
                12, 1.08
            ],
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'text-field': ['coalesce', ['get', 'StationNam'], ['get', 'Name'], 'GLOF II'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                5, 10,
                9, 11,
                12, 13
            ],
            'text-offset': [0, 1.25],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-ignore-placement': false
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#713f12',
            'text-halo-width': 1.25
        }
    });

    map1.on('click', 'glof-ii-stations-layer', function (e) {
        const feature = e && e.features && e.features[0] ? e.features[0] : null;
        if (!feature) {
            return;
        }

        const properties = feature.properties || {};
        const coordinates = feature.geometry && Array.isArray(feature.geometry.coordinates)
            ? feature.geometry.coordinates.slice()
            : null;
        const stationName = properties.StationNam || properties.Name || 'GLOF II Station';

        if (!coordinates) {
            return;
        }

        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(`
                <strong><u>GLOF II Station</u></strong><br>
                <strong>Name:</strong> ${stationName}<br>
                <strong>Code:</strong> ${properties.Code || '--'}<br>
                <strong>Status:</strong> ${properties.Status || '--'}<br>
                <strong>Coordinates:</strong> ${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}
            `)
            .addTo(map1);
    });

    map1.on('mouseenter', 'glof-ii-stations-layer', function () {
        map1.getCanvas().style.cursor = 'pointer';
    });
    map1.on('mouseleave', 'glof-ii-stations-layer', function () {
        map1.getCanvas().style.cursor = '';
    });

    const ensureGlofIIDamagedStationsIcon = () => {
        if (map1.hasImage('glof-ii-damaged-warning-icon')) {
            return;
        }

        const size = 52;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');

        const centerX = size / 2;
        const centerY = 21;

        context.beginPath();
        context.moveTo(centerX, size - 4);
        context.bezierCurveTo(centerX - 13, 34, 11, 20, centerX, 7);
        context.bezierCurveTo(size - 11, 20, centerX + 13, 34, centerX, size - 4);
        context.closePath();
        context.fillStyle = '#f59e0b';
        context.fill();

        context.beginPath();
        context.moveTo(centerX, 7);
        context.lineTo(centerX - 15, 33);
        context.lineTo(centerX + 15, 33);
        context.closePath();
        context.fillStyle = '#facc15';
        context.fill();
        context.strokeStyle = '#7c2d12';
        context.lineWidth = 2;
        context.stroke();

        context.beginPath();
        context.moveTo(centerX, 16);
        context.lineTo(centerX, 25);
        context.strokeStyle = '#7c2d12';
        context.lineWidth = 3.4;
        context.lineCap = 'round';
        context.stroke();

        context.beginPath();
        context.arc(centerX, 29, 1.9, 0, Math.PI * 2);
        context.fillStyle = '#7c2d12';
        context.fill();

        const image = {
            width: size,
            height: size,
            data: new Uint8Array(context.getImageData(0, 0, size, size).data)
        };

        map1.addImage('glof-ii-damaged-warning-icon', image);
    };

    ensureGlofIIDamagedStationsIcon();

    map1.addLayer({
        id: 'glof-ii-damaged-stations-layer',
        type: 'symbol',
        source: 'glofIIDamagedStations',
        layout: {
            'visibility': 'none',
            'icon-image': 'glof-ii-damaged-warning-icon',
            'icon-size': [
                'interpolate', ['linear'], ['zoom'],
                4, 0.75,
                8, 0.95,
                12, 1.1
            ],
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'text-field': ['coalesce', ['get', 'StationNam'], ['get', 'Name'], 'GLOF II Damaged Station'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                5, 10,
                9, 11,
                12, 13
            ],
            'text-offset': [0, 1.25],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-ignore-placement': false
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#7c2d12',
            'text-halo-width': 1.25
        }
    });

    map1.on('click', 'glof-ii-damaged-stations-layer', function (e) {
        const feature = e && e.features && e.features[0] ? e.features[0] : null;
        if (!feature) {
            return;
        }

        const properties = feature.properties || {};
        const coordinates = feature.geometry && Array.isArray(feature.geometry.coordinates)
            ? feature.geometry.coordinates.slice()
            : null;
        const stationName = properties.StationNam || properties.Name || 'GLOF II Damaged Station';

        if (!coordinates) {
            return;
        }

        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(`
                <strong><u>GLOF II Damaged Stations</u></strong><br>
                <strong>Name:</strong> ${stationName}<br>
                <strong>Damage:</strong> ${properties.Column1 || '--'}<br>
                <strong>Condition:</strong> ${properties.Column2 || '--'}<br>
                <strong>Work Required:</strong> ${properties.Column_3 || '--'}<br>
                <strong>Province:</strong> ${properties.Province || '--'}<br>
                <strong>Coordinates:</strong> ${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}
            `)
            .addTo(map1);
    });

    map1.on('mouseenter', 'glof-ii-damaged-stations-layer', function () {
        map1.getCanvas().style.cursor = 'pointer';
    });
    map1.on('mouseleave', 'glof-ii-damaged-stations-layer', function () {
        map1.getCanvas().style.cursor = '';
    });

    const ensureAkahStationsIcon = () => {
        if (map1.hasImage('akah-stations-destination-icon')) {
            return;
        }

        const size = 50;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');

        const centerX = size / 2;
        const centerY = 20;

        context.beginPath();
        context.moveTo(centerX, size - 4);
        context.bezierCurveTo(centerX - 13, 33, 11, 19, centerX, 7);
        context.bezierCurveTo(size - 11, 19, centerX + 13, 33, centerX, size - 4);
        context.closePath();
        context.fillStyle = '#16a34a';
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 15.5, 0, Math.PI * 2);
        context.fillStyle = '#14532d';
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 12, 0, Math.PI * 2);
        context.fillStyle = '#22c55e';
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 6.2, 0, Math.PI * 2);
        context.fillStyle = '#f8fafc';
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 3.1, 0, Math.PI * 2);
        context.fillStyle = '#166534';
        context.fill();

        const image = {
            width: size,
            height: size,
            data: new Uint8Array(context.getImageData(0, 0, size, size).data)
        };

        map1.addImage('akah-stations-destination-icon', image);
    };

    ensureAkahStationsIcon();

    map1.addLayer({
        id: 'akah-stations-layer',
        type: 'symbol',
        source: 'akahStations',
        layout: {
            'visibility': 'none',
            'icon-image': 'akah-stations-destination-icon',
            'icon-size': [
                'interpolate', ['linear'], ['zoom'],
                4, 0.72,
                8, 0.92,
                12, 1.08
            ],
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        }
    });

    map1.on('click', 'akah-stations-layer', function (e) {
        const feature = e && e.features && e.features[0] ? e.features[0] : null;
        if (!feature) {
            return;
        }

        const properties = feature.properties || {};
        const coordinates = feature.geometry && Array.isArray(feature.geometry.coordinates)
            ? feature.geometry.coordinates.slice()
            : null;

        if (!coordinates) {
            return;
        }

        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(`
                <strong><u>AKAH Stations</u></strong><br>
                <strong>Village:</strong> ${properties['Village Name'] || '--'}<br>
                <strong>District:</strong> ${properties.District || '--'}<br>
                <strong>Type:</strong> ${properties.Type || '--'}<br>
                <strong>Hazard:</strong> ${properties.Hazard || '--'}<br>
                <strong>Coordinates:</strong> ${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}
            `)
            .addTo(map1);
    });

    map1.on('mouseenter', 'akah-stations-layer', function () {
        map1.getCanvas().style.cursor = 'pointer';
    });
    map1.on('mouseleave', 'akah-stations-layer', function () {
        map1.getCanvas().style.cursor = '';
    });

    const loadAkahStationsWorkbook = async () => {
        try {
            if (typeof XLSX === 'undefined') {
                throw new Error('XLSX library is not available.');
            }

            const response = await fetch(AKAH_STATIONS_XLSX_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch workbook: ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const sheetName = workbook && Array.isArray(workbook.SheetNames) ? workbook.SheetNames[0] : null;

            if (!sheetName || !workbook.Sheets[sheetName]) {
                throw new Error('Workbook sheet not found.');
            }

            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
                header: 1,
                defval: '',
                raw: false
            });

            const source = map1.getSource('akahStations');
            if (source && typeof source.setData === 'function') {
                source.setData(buildAkahStationsFeatureCollection(rows));
            }
        } catch (error) {
            console.error('Failed to load AKAH Stations workbook.', error);
        }
    };

    loadAkahStationsWorkbook();

    const ensureUndpAllSensorsIcon = () => {
        if (map1.hasImage('undp-all-sensors-destination-icon')) {
            return;
        }

        const size = 50;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');

        const centerX = size / 2;
        const centerY = 20;

        context.beginPath();
        context.moveTo(centerX, size - 4);
        context.bezierCurveTo(centerX - 13, 33, 11, 19, centerX, 7);
        context.bezierCurveTo(size - 11, 19, centerX + 13, 33, centerX, size - 4);
        context.closePath();
        context.fillStyle = '#16a34a';
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 15.5, 0, Math.PI * 2);
        context.fillStyle = '#14532d';
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 12, 0, Math.PI * 2);
        context.fillStyle = '#22c55e';
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 6.2, 0, Math.PI * 2);
        context.fillStyle = '#f8fafc';
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 3.1, 0, Math.PI * 2);
        context.fillStyle = '#166534';
        context.fill();

        const image = {
            width: size,
            height: size,
            data: new Uint8Array(context.getImageData(0, 0, size, size).data)
        };

        map1.addImage('undp-all-sensors-destination-icon', image);
    };

    ensureUndpAllSensorsIcon();

    map1.addLayer({
        id: 'undp-all-sensors-layer',
        type: 'symbol',
        source: 'undpAllSensors',
        layout: {
            'visibility': 'none',
            'icon-image': 'undp-all-sensors-destination-icon',
            'icon-size': [
                'interpolate', ['linear'], ['zoom'],
                4, 0.72,
                8, 0.92,
                12, 1.08
            ],
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'text-field': ['coalesce', ['get', 'StationNames'], 'UNDP All sensors'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                5, 10,
                9, 11,
                12, 13
            ],
            'text-offset': [0, 1.25],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-ignore-placement': false
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#14532d',
            'text-halo-width': 1.25
        }
    });

    map1.on('click', 'undp-all-sensors-layer', function (e) {
        const feature = e && e.features && e.features[0] ? e.features[0] : null;
        if (!feature) {
            return;
        }

        const properties = feature.properties || {};
        const coordinates = feature.geometry && Array.isArray(feature.geometry.coordinates)
            ? feature.geometry.coordinates.slice()
            : null;

        if (!coordinates) {
            return;
        }

        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(`
                <strong><u>UNDP All sensors</u></strong><br>
                <strong>Station:</strong> ${properties.StationNames || '--'}<br>
                <strong>Code:</strong> ${properties.Code || '--'}<br>
                <strong>Type:</strong> ${properties.Type || '--'}<br>
                <strong>Hazard:</strong> ${properties.Hazard || '--'}<br>
                <strong>Status:</strong> ${properties.Status || '--'}<br>
                <strong>Province:</strong> ${properties.Province || '--'}<br>
                <strong>Coordinates:</strong> ${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}
            `)
            .addTo(map1);
    });

    map1.on('mouseenter', 'undp-all-sensors-layer', function () {
        map1.getCanvas().style.cursor = 'pointer';
    });
    map1.on('mouseleave', 'undp-all-sensors-layer', function () {
        map1.getCanvas().style.cursor = '';
    });

    const loadUndpAllSensorsCsv = async () => {
        try {
            const response = await fetch(UNDP_ALL_SENSORS_CSV_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch CSV: ${response.status}`);
            }

            const csvText = await response.text();
            const source = map1.getSource('undpAllSensors');
            if (source && typeof source.setData === 'function') {
                source.setData(buildUndpAllSensorsFeatureCollection(csvText));
            }
        } catch (error) {
            console.error('Failed to load UNDP All sensors CSV.', error);
        }
    };

    loadUndpAllSensorsCsv();

    if (!map1.__stationPointInteractionsBound) {
        const handleStationPointClick = function (e) {
            const feature = e && e.features && e.features[0] ? e.features[0] : null;
            if (!feature) {
                return;
            }

            const properties = feature.properties || {};
            const stationName = properties.name || properties.Name || 'Station';
            const coordinates = feature.geometry && feature.geometry.coordinates
                ? feature.geometry.coordinates.slice()
                : null;

            if (coordinates) {
                new mapboxgl.Popup()
                    .setLngLat(coordinates)
                    .setHTML(`<strong><u>Station:</u></strong> ${stationName}`)
                    .addTo(map1);
            }

            if (typeof window.handleStationPointSelection === 'function') {
                window.handleStationPointSelection(stationName);
            }
        };

        map1.on('click', 'station-points-layer', handleStationPointClick);
        map1.on('click', 'station-points-animated-layer', handleStationPointClick);
        map1.on('click', 'station-points-label-layer', handleStationPointClick);

        map1.on('mouseenter', 'station-points-layer', function () {
            map1.getCanvas().style.cursor = 'pointer';
        });
        map1.on('mouseenter', 'station-points-animated-layer', function () {
            map1.getCanvas().style.cursor = 'pointer';
        });
        map1.on('mouseenter', 'station-points-label-layer', function () {
            map1.getCanvas().style.cursor = 'pointer';
        });
        map1.on('mouseleave', 'station-points-layer', function () {
            map1.getCanvas().style.cursor = '';
        });
        map1.on('mouseleave', 'station-points-animated-layer', function () {
            map1.getCanvas().style.cursor = '';
        });
        map1.on('mouseleave', 'station-points-label-layer', function () {
            map1.getCanvas().style.cursor = '';
        });

        map1.__stationPointInteractionsBound = true;
    }
    
    //_____________________________________________________________________________________________________________________________________________________________
    // Add the boundary line layer (initially hidden)
    map1.addLayer({
        id: 'badswat-line',
        type: 'line',
        source: 'badswatBound',
        layout: {
            'visibility': 'none' // Hidden by default
        },
        paint: {
            'line-color': '#088', // Change to any color
            'line-width': 6, // Adjust thickness
        }
    });
    map1.addLayer({
        id: 'hiranchi-line',
        type: 'line',
        source: 'hiranchiBounds',
        layout: {
            'visibility': 'none' // Hidden by default
        },
        paint: {
            'line-color': '#088', // Change to any color
            'line-width': 6, // Adjust thickness
        }
    });
    //__________________________________________________________________________________________________
    //Badswat Layers
    map1.addLayer({
        id: 'badswat-glacier-layer',
        type: 'fill',
        source: 'badswatGlacier',
        layout: {
            'visibility': 'none' // ❌ Hidden by default
        },
        paint: {
            'fill-color': '#ADD8E6', // Light blue
            'fill-opacity':0.6
        }
    });
    map1.addLayer({
        id: 'badswat-glacier-line',
        type: 'line',
        source: 'badswatGlacier',
        layout: {
            'visibility': 'none' // Hidden by default
        },
        paint: {
            'line-color': 'black', // Change to any color
            'line-width': 3, // Adjust thickness
        }
    });
    map1.addLayer({
        id: 'badswat-risk-layer',
        type: 'fill',
        source: 'badswatRiskZonation',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': [
                'match',
                ['get', 'ZONATION'], // Attribute to match
                'Low', '#00990f',     // Green for low risk
                'Medium', '#f0e02e',  // Yellow for medium risk
                'High', '#7d0800',    // Red for high risk
                '#000000'             // Default color (black) if no match
            ],
            'fill-opacity': 0.7
        }
    });    
    map1.addLayer({
        id: 'badswat-faultine-layer',
        type: 'line',
        source: 'badswatfaultline',
        layout: {
            'visibility': 'none' // ❌ Hidden by default
        },
        paint: {
            'line-color': 'black',
            'line-width': 3,
        }
    });
    map1.addLayer({
        id: 'badswat-lake-layer',
        type: 'fill',
        source: 'badswatLake',
        layout: {
            'visibility': 'none' // ❌ Hidden by default
        },
        paint: {
            'fill-color': '#02decf', // Blue
            'fill-opacity': 0.8
        }
    });
    map1.addLayer({
        id: 'ishkoman-river-layer',
        type: 'line',
        source: 'ishkomanRiver',
        layout: {
            'visibility': 'none' // ❌ Hidden by default
        },
        paint: {
            'line-color': '#0000FF', // Blue
            'line-width': 4,
            'line-opacity': 0.8
        }
    });
    map1.addLayer({
        id: 'karambar-lake-layer',
        type: 'fill',
        source: 'karambarLake',
        layout: {
            'visibility': 'none' // ❌ Hidden by default
        },
        paint: {
            'fill-color': '#02decf', // Dodger blue
            'fill-opacity': 0.8
        }
    });
    //__________________________________________________________________________________________________
    //Pindoru Chaat Sources
    map1.addSource('pindoru-lake-src', {
        type: 'geojson',
        data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3APindoru_Chaat_Lake&outputFormat=application%2Fjson'
    });
    map1.addSource('pindoru-rz-high-src', {
        type: 'geojson',
        data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3APindoru_Chaat_High_Risk&outputFormat=application%2Fjson'
    });
    map1.addSource('pindoru-rz-medium-src', {
        type: 'geojson',
        data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3APindoru_Chaat_Medium_Risk&outputFormat=application%2Fjson'
    });
    map1.addSource('pindoru-rz-low-src', {
        type: 'geojson',
        data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3APindoru_Chaat_Low_Risk&outputFormat=application%2Fjson'
    });
    //__________________________________________________________________________________________________
    //Pindoru Chaat Layers
    map1.addLayer({
        id: 'pindoru-lake-fill',
        type: 'fill',
        source: 'pindoru-lake-src',
        layout: { 'visibility': 'none' },
        paint: { 'fill-color': '#1e88e5', 'fill-opacity': 0.6 }
    });
    map1.addLayer({
        id: 'pindoru-lake-outline',
        type: 'line',
        source: 'pindoru-lake-src',
        layout: { 'visibility': 'none' },
        paint: { 'line-color': '#90caf9', 'line-width': 2 }
    });
    // Risk Zonation — Low (bottom), Medium, High (top)
    map1.addLayer({
        id: 'pindoru-rz-low',
        type: 'fill',
        source: 'pindoru-rz-low-src',
        layout: { 'visibility': 'none' },
        paint: { 'fill-color': '#00990f', 'fill-opacity': 0.7 }
    });
    map1.addLayer({
        id: 'pindoru-rz-medium',
        type: 'fill',
        source: 'pindoru-rz-medium-src',
        layout: { 'visibility': 'none' },
        paint: { 'fill-color': '#f0e02e', 'fill-opacity': 0.7 }
    });
    map1.addLayer({
        id: 'pindoru-rz-high',
        type: 'fill',
        source: 'pindoru-rz-high-src',
        layout: { 'visibility': 'none' },
        paint: { 'fill-color': '#7d0800', 'fill-opacity': 0.7 }
    });
    //__________________________________________________________________________________________________
    //Hiranchi Layers
    map1.addLayer({
        id: 'hiranchi-glacier-layer',
        type: 'fill',
        source: 'hiranchiGlaciers',
        layout: {
            'visibility': 'none' // ❌ Hidden by default
        },
        paint: {
            'fill-color': '#ADD8E6', // Light blue
            'fill-opacity':0.6
        }
    });
    map1.addLayer({
        id: 'hiranchi-risk-layer',
        type: 'fill',
        source: 'hiranchiRiskZonation',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': [
                'match',
                ['get', 'ZONATION'], // Attribute to match
                'Low', '#00990f',     // Green for low risk
                'Medium', '#f0e02e',  // Yellow for medium risk
                'High', '#7d0800',    // Red for high risk
                '#000000'             // Default color (black) if no match
            ],
            'fill-opacity': 0.7
        }
    });
    map1.addLayer({
        id: 'hiranchi-glacier-line',
        type: 'line',
        source: 'hiranchiGlaciers',
        layout: {
            'visibility': 'none' // Hidden by default
        },
        paint: {
            'line-color': 'black', // Change to any color
            'line-width': 3, // Adjust thickness
        }
    });
    map1.addLayer({
        id: 'hiranchi-lake-layer',
        type: 'fill',
        source: 'hiranchiLake',
        layout: {
            'visibility': 'none' // ❌ Hidden by default
        },
        paint: {
            'fill-color': '#02decf', // Blue
            'fill-opacity': 0.8
        }
    });
    //__________________________________________________________________________________________________
    //Reshun Layers
    map1.addLayer({
        id: 'reshun-line',
        type: 'line',
        source: 'reshunBound',
        layout: {
            'visibility': 'none' // Hidden by default
        },
        paint: {
            'line-color': '#088', // Change to any color
            'line-width': 6, // Adjust thickness
        }
    });
    map1.addLayer({
        id: 'reshun-glacier-layer',
        type: 'fill',
        source: 'reshunGlacier',
        layout: {
            'visibility': 'none' // ❌ Hidden by default
        },
        paint: {
            'fill-color': '#ADD8E6', // Light blue
            'fill-opacity':0.6
        }
    });
    map1.addLayer({
        id: 'reshun-glacier-line',
        type: 'line',
        source: 'reshunGlacier',
        layout: {
            'visibility': 'none' // Hidden by default
        },
        paint: {
            'line-color': 'black', // Change to any color
            'line-width': 3, // Adjust thickness
        }
    });
    map1.addLayer({
        id: 'chitral-river-layer',
        type: 'fill',
        source: 'chitralRiverSource',
        layout: {
            'visibility': 'none' // ❌ Hidden by default
        },
        paint: {
            'fill-color': '#0000FF', // Blue
            'fill-opacity': 0.8
        }
    });
    map1.addLayer({
        id: 'reshun-faultline-layer',
        type: 'line',
        source: 'faultlineReshunSource',
        layout: {
            'visibility': 'none' // ❌ Hidden by default
        },
        paint: {
            'line-color': 'black',
            'line-width': 3,
        }
    });
    map1.addLayer({
        id: 'reshun-nullah-layer',
        type: 'fill',
        source: 'nullahReshunSource',
        layout: {
            'visibility': 'none' // ❌ Hidden by default
        },
        paint: {
            'fill-color': '#02decf', // Blue
            'fill-opacity': 0.8
        }
    });
    map1.addLayer({
        id: 'reshun-risk-layer',
        type: 'fill',
        source: 'reshunRiskZonationSource',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': [
                'match',
                ['get', 'RISK'], // Attribute to match
                'LOW', '#00990f',     // Green for low risk
                'MEDIUM', '#f0e02e',  // Yellow for medium risk
                'HIGH', '#7d0800',    // Red for high risk
                '#000000'             // Default color (black) if no match
            ],
            'fill-opacity': 0.7
        }
    });
//__________________________________________________________________________________________________
//Terset Hundur Layers
    map1.addLayer({
        id: 'terset-hundur-lake-layer',
        type: 'fill',
        source: 'tersetHundurLake',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#02decf',
            'fill-opacity': 0.8
        }
    });
    map1.addLayer({
        id: 'terset-hundur-river-layer',
        type: 'line',
        source: 'tersetHundurRiver',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'line-color': '#0000FF',
            'line-width': 3,
            'line-opacity': 0.85
        }
    });
    map1.addLayer({
        id: 'terset-hundur-risk-low-layer',
        type: 'fill',
        source: 'tersetHundurRiskLow',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#00990f',
            'fill-opacity': 0.7
        }
    });
    map1.addLayer({
        id: 'terset-hundur-risk-medium-layer',
        type: 'fill',
        source: 'tersetHundurRiskMedium',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#f0e02e',
            'fill-opacity': 0.7
        }
    });
    map1.addLayer({
        id: 'terset-hundur-risk-high-layer',
        type: 'fill',
        source: 'tersetHundurRiskHigh',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#7d0800',
            'fill-opacity': 0.7
        }
    });
//__________________________________________________________________________________________________
//Ishokoman Risk Layers
    map1.addLayer({
        id: 'ishokoman-risk-low-layer',
        type: 'fill',
        source: 'ishokomanRiskLow',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#00990f',
            'fill-opacity': 0.7
        }
    });
    map1.addLayer({
        id: 'ishokoman-risk-medium-layer',
        type: 'fill',
        source: 'ishokomanRiskMedium',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#f0e02e',
            'fill-opacity': 0.7
        }
    });
    map1.addLayer({
        id: 'ishokoman-risk-high-layer',
        type: 'fill',
        source: 'ishokomanRiskHigh',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#7d0800',
            'fill-opacity': 0.7
        }
    });
//__________________________________________________________________________________________________
//Lusht Risk Layers
    map1.addLayer({
        id: 'lusht-risk-low-layer',
        type: 'fill',
        source: 'lushtRiskLow',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#00990f',
            'fill-opacity': 0.7
        }
    });
    map1.addLayer({
        id: 'lusht-risk-medium-layer',
        type: 'fill',
        source: 'lushtRiskMedium',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#f0e02e',
            'fill-opacity': 0.7
        }
    });
    map1.addLayer({
        id: 'lusht-risk-high-layer',
        type: 'fill',
        source: 'lushtRiskHigh',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#7d0800',
            'fill-opacity': 0.7
        }
    });
//__________________________________________________________________________________________________
//Ulter Risk Layers
    map1.addLayer({
        id: 'ulter-risk-low-layer',
        type: 'fill',
        source: 'ulterRiskLow',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#00990f',
            'fill-opacity': 0.7
        }
    });
    map1.addLayer({
        id: 'ulter-risk-medium-layer',
        type: 'fill',
        source: 'ulterRiskMedium',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#f0e02e',
            'fill-opacity': 0.7
        }
    });
    map1.addLayer({
        id: 'ulter-risk-high-layer',
        type: 'fill',
        source: 'ulterRiskHigh',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#7d0800',
            'fill-opacity': 0.7
        }
    });

//__________________________________________________________________________________________________
//Shisper Risk Layers
    map1.addLayer({
        id: 'shisper-lake-layer',
        type: 'fill',
        source: 'shisperLake',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#02decf',
            'fill-opacity': 0.8
        }
    });
    map1.addLayer({
        id: 'shisper-risk-low-layer',
        type: 'fill',
        source: 'shisperRiskLow',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#00990f',
            'fill-opacity': 0.7
        }
    });
    map1.addLayer({
        id: 'shisper-risk-medium-layer',
        type: 'fill',
        source: 'shisperRiskMedium',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#f0e02e',
            'fill-opacity': 0.7
        }
    });
    map1.addLayer({
        id: 'shisper-risk-high-layer',
        type: 'fill',
        source: 'shisperRiskHigh',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'fill-color': '#7d0800',
            'fill-opacity': 0.7
        }
    });
//__________________________________________________________________________________________________
//BREP
map1.addLayer({
    id: 'brep-zonation-layer',
    type: 'fill',
    source: 'brepZonation',
    layout: {
        'visibility': 'none'
    },
    paint: {
        'fill-color': [
            'match',
            ['downcase', ['to-string', ['coalesce', ['get', 'Zonation'], ['get', 'zonation'], ['get', 'RISK'], ['get', 'risk'], '']]],
            'low', '#00990f',     // Green for low risk
            'medium', '#f0e02e',  // Yellow for medium risk
            'high', '#7d0800',    // Red for high risk
            '#000000'             // Default color (black) if no match
        ],
        'fill-opacity': 0.7
    }
});
//Darkot
map1.addLayer({
    id: 'darkot-zonation-layer',
    type: 'fill',
    source: 'darkotRz',
    layout: {
        'visibility': 'none'
    },
    paint: {
        'fill-color': [
            'match',
            ['get', 'zonation'], // Attribute to match
            'Low', '#00990f',     // Green for low risk
            'Medium', '#f0e02e',  // Yellow for medium risk
            'High', '#7d0800',    // Red for high risk
            '#000000'             // Default color (black) if no match
        ],
        'fill-opacity': 0.7
    }
});
map1.addLayer({
    id: 'darkot-buildings-layer',
    type: 'fill',
    source: 'darkotBuildings',
    layout: {
        'visibility': 'none'
    },
    paint: {
        'fill-color': 'grey', 
        'fill-opacity': 0.8,
        'fill-outline-color': 'black' // Add this line for the outline
    }
});
map1.addLayer({
    id: 'darkot-roads-layer',
    type: 'line',
    source: 'darkotRivers',
    layout: {
        'visibility': 'none'
    },
    paint: {
        'line-color': '#000000', 
        'line-width': 2
    }
});
map1.addLayer({
    id: 'darkot-rivers-layer',
    type: 'line',
    source: 'darkotRivers',
    layout: {
        'visibility': 'none'
    },
    paint: {
        'line-color': '#0000FF', 
        'line-width': 2
    }
});
map1.loadImage('https://i.ibb.co/5g8k2HMX/school.png', (error, image) => {
    if (error) throw error;

    // Add the image to the map with a unique name
    map1.addImage('school-icon', image);

    map1.addLayer({
        id: 'darkot-schools-layer',
        type: 'symbol',  // Use 'symbol' for custom icons
        source: 'darkotSchools',
        layout: {
            'icon-image': 'school-icon',  // Reference the icon by name
            'icon-size': 0.05  // Adjust size as needed
        }
    });
    map1.setLayoutProperty('darkot-schools-layer', 'visibility', 'none');
});
map1.addLayer({
    id: 'darkot-glacier-layer',
    type: 'fill',
    source: 'darkotGlacier',
    layout: {
        'visibility': 'none' // ❌ Hidden by default
    },
    paint: {
        'fill-color': '#ADD8E6', // Light blue
        'fill-opacity':0.6
    }
});
//__________________________________________________________________________________________________
//Gulmit
map1.addLayer({
    id: 'gulmit-line-layer',
    type: 'line',
    source: 'gulmitLine',
    layout: {
        'visibility': 'none' // Hidden by default
    },
    paint: {
        'line-color': '#088', // Change to any color
        'line-width': 6, // Adjust thickness
    }
});
map1.addLayer({
    id: 'gulmit-zonation-layer',
    type: 'fill',
    source: 'gulmitRz',
    layout: {
        'visibility': 'none'
    },
    paint: {
        'fill-color': [
            'match',
            ['get', 'Name'], // Attribute to match
            'Low', '#00990f',     // Green for low risk
            'Medium', '#f0e02e',  // Yellow for medium risk
            'High', '#7d0800',    // Red for high risk
            '#000000'             // Default color (black) if no match
        ],
        'fill-opacity': 0.7
    }   
});
map1.addLayer({
    id: 'gulmit-buildings-layer',
    type: 'fill',
    source: 'gulmitBuildings',
    layout: {
        'visibility': 'none'
    },
    paint: {
        'fill-color': 'grey', 
        'fill-opacity': 0.8,
        'fill-outline-color': 'black' // Add this line for the outline
    }
});

map1.addLayer({
    id: 'gulmit-roads-layer',
    type: 'line',
    source: 'gulmitRoads',
    layout: {
        'visibility': 'none'
    },
    paint: {
        'line-color': '#000000', 
        'line-width': 2
    }
});
map1.addLayer({
    id: 'gulmit-rivers-layer',
    type: 'line',
    source: 'gulmitRivers',
    layout: {
        'visibility': 'none'
    },
    paint: {
        'line-color': '#0000FF', 
        'line-width': 2
    }
});
map1.loadImage('https://i.ibb.co/5g8k2HMX/school.png', (error, image) => {
    if (error) throw error;

    // Add the image to the map with a unique name
    map1.addImage('school-icon', image);

    map1.addLayer({
        id: 'gulmit-schools-layer',
        type: 'symbol',  // Use 'symbol' for custom icons
        source: 'gulmitSchools',
        layout: {
            'icon-image': 'school-icon',  // Reference the icon by name
            'icon-size': 0.05  // Adjust size as needed
        }
    });
    map1.setLayoutProperty('gulmit-schools-layer', 'visibility', 'none');
});

//__________________________________________________________________________________________________
//Thalu
map1.addLayer({
    id: 'thalu-zonation-layer',
    type: 'fill',
    source: 'thaluRz',
    layout: {
        'visibility': 'none'
    },
    paint: {
        'fill-color': [
            'match',
            ['get', 'Name'], // Attribute to match
            'Low', '#00990f',     // Green for low risk
            'Medium', '#f0e02e',  // Yellow for medium risk
            'High', '#7d0800',    // Red for high risk
            '#f0e02e'             // Default color (black) if no match
        ],
        'fill-opacity': 0.7
    }

});

    const ensureLakeSymbologyIcons = function ensureLakeSymbologyIcons() {
        const size = 80;

        const pinCanvas = document.createElement('canvas');
        pinCanvas.width = size;
        pinCanvas.height = size;
        const pinCtx = pinCanvas.getContext('2d');

        // Pin icon (old Vulnerable Lakes 2026 style)
        pinCtx.shadowColor = 'rgba(0,0,0,0.45)';
        pinCtx.shadowBlur = 6;
        pinCtx.shadowOffsetY = 3;
        const cx = size / 2;
        const topY = 4;
        const r = size * 0.32;
        const pinBottom = size - 6;
        pinCtx.beginPath();
        pinCtx.arc(cx, topY + r, r, Math.PI, 0);
        pinCtx.bezierCurveTo(cx + r, topY + r * 2.1, cx + r * 0.5, pinBottom * 0.75, cx, pinBottom);
        pinCtx.bezierCurveTo(cx - r * 0.5, pinBottom * 0.75, cx - r, topY + r * 2.1, cx - r, topY + r);
        pinCtx.closePath();

        const pinGradient = pinCtx.createRadialGradient(cx - r * 0.25, topY + r * 0.6, 1, cx, topY + r, r);
        pinGradient.addColorStop(0, '#ff4444');
        pinGradient.addColorStop(1, '#c0000a');
        pinCtx.fillStyle = pinGradient;
        pinCtx.fill();
        pinCtx.shadowBlur = 0;
        pinCtx.shadowOffsetY = 0;
        pinCtx.strokeStyle = '#7b0000';
        pinCtx.lineWidth = 2;
        pinCtx.stroke();
        pinCtx.beginPath();
        pinCtx.arc(cx, topY + r, r * 0.42, 0, Math.PI * 2);
        pinCtx.fillStyle = 'white';
        pinCtx.fill();

        // Ring icon (Vulnerable Lakes 2025-like style)
        const ringCanvas = document.createElement('canvas');
        ringCanvas.width = size;
        ringCanvas.height = size;
        const ringCtx = ringCanvas.getContext('2d');
        ringCtx.beginPath();
        ringCtx.arc(size / 2, size / 2, size * 0.31, 0, Math.PI * 2);
        ringCtx.strokeStyle = '#ff1f1f';
        ringCtx.lineWidth = 9;
        ringCtx.stroke();

        const pinImage = {
            width: size,
            height: size,
            data: new Uint8Array(pinCtx.getImageData(0, 0, size, size).data)
        };
        const ringImage = {
            width: size,
            height: size,
            data: new Uint8Array(ringCtx.getImageData(0, 0, size, size).data)
        };

        if (!map1.hasImage('lake-pin')) map1.addImage('lake-pin', pinImage);
        if (!map1.hasImage('lake-ring')) map1.addImage('lake-ring', ringImage);
    };

    ensureLakeSymbologyIcons();

    //__________________________________________________________________________________________________
    // Vulnerable Sites 2026 — use old Vulnerable Lakes 2026 pin style
    map1.addSource('vul-sites-2026', {
        type: 'geojson',
        data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3ALakes_glof_2&outputFormat=application%2Fjson'
    });
    map1.addLayer({
        id: 'vul-sites-2026-layer',
        type: 'symbol',
        source: 'vul-sites-2026',
        layout: {
            'visibility': 'none',
            'icon-image': 'lake-pin',
            'icon-size': [
                'interpolate', ['linear'], ['zoom'],
                4, 0.24,
                8, 0.42,
                12, 0.58
            ],
            'icon-allow-overlap': true,
            'icon-anchor': 'bottom'
        }
    });

    //__________________________________________________________________________________________________
    // Vulnerable Lakes 2026 — Glacial lake polygons from GeoServer WFS
    map1.addSource('glof-lakes', {
        type: 'geojson',
        data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3Aglacial_lakes&outputFormat=application%2Fjson'
    });
    map1.addLayer({
        id: 'glof-lakes-fill',
        type: 'fill',
        source: 'glof-lakes',
        layout: { 'visibility': 'none' },
        paint: { 'fill-color': '#0e7ab5', 'fill-opacity': 0.55 }
    });
    map1.addLayer({
        id: 'glof-lakes-outline',
        type: 'line',
        source: 'glof-lakes',
        layout: { 'visibility': 'none' },
        paint: { 'line-color': '#00e5ff', 'line-width': 3, 'line-opacity': 1 }
    });
    // Vulnerable Lakes 2026 — show as ring points like Vulnerable Lakes 2025
    map1.addLayer({
        id: 'glof-lakes-centroid',
        type: 'symbol',
        source: 'glof-lakes',
        layout: {
            'visibility': 'none',
            'icon-image': 'lake-ring',
            'icon-size': [
                'interpolate', ['linear'], ['zoom'],
                4, 0.22,
                8, 0.34,
                12, 0.46
            ],
            'icon-allow-overlap': true,
            'icon-anchor': 'center'
        },
        paint: {
            'icon-opacity': 1
        }
    });

    //__________________________________________________________________________________________________
    // Chatiboi Lake — polygon from GeoServer WFS
    map1.addSource('chatiboi-lake', {
        type: 'geojson',
        data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AChatiboi_Lake&maxFeatures=50&outputFormat=application%2Fjson'
    });
    map1.addLayer({
        id: 'chatiboi-lake-fill',
        type: 'fill',
        source: 'chatiboi-lake',
        layout: { 'visibility': 'none' },
        paint: { 'fill-color': '#1e88e5', 'fill-opacity': 0.6 }
    });
    map1.addLayer({
        id: 'chatiboi-lake-outline',
        type: 'line',
        source: 'chatiboi-lake',
        layout: { 'visibility': 'none' },
        paint: { 'line-color': '#90caf9', 'line-width': 2, 'line-opacity': 1 }
    });

    map1.addSource('chatiboi-runoff', {
        type: 'geojson',
        data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AChatiboi_Run_Off&outputFormat=application%2Fjson'
    });
    map1.addLayer({
        id: 'chatiboi-runoff-layer',
        type: 'line',
        source: 'chatiboi-runoff',
        layout: { 'visibility': 'none' },
        paint: {
            'line-color': '#38bdf8',
            'line-width': 3,
            'line-opacity': 0.95
        }
    });

    map1.addSource('chatiboi-risk-high', {
        type: 'geojson',
        data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AHigh_Risk_Chatiboi&outputFormat=application%2Fjson'
    });
    map1.addSource('chatiboi-risk-medium', {
        type: 'geojson',
        data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3AMedium_Risk_Zonation&outputFormat=application%2Fjson'
    });
    map1.addSource('chatiboi-risk-low', {
        type: 'geojson',
        data: 'http://172.18.1.85:8080/geoserver/GLOF/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GLOF%3ALow_Risk_Chatiboi&outputFormat=application%2Fjson'
    });

    map1.addLayer({
        id: 'chatiboi-risk-low-layer',
        type: 'fill',
        source: 'chatiboi-risk-low',
        layout: { 'visibility': 'none' },
        paint: { 'fill-color': '#00990f', 'fill-opacity': 0.7 }
    });
    map1.addLayer({
        id: 'chatiboi-risk-medium-layer',
        type: 'fill',
        source: 'chatiboi-risk-medium',
        layout: { 'visibility': 'none' },
        paint: { 'fill-color': '#f0e02e', 'fill-opacity': 0.7 }
    });
    map1.addLayer({
        id: 'chatiboi-risk-high-layer',
        type: 'fill',
        source: 'chatiboi-risk-high',
        layout: { 'visibility': 'none' },
        paint: { 'fill-color': '#7d0800', 'fill-opacity': 0.7 }
    });

    map1.moveLayer('chatiboi-lake-fill');
    map1.moveLayer('chatiboi-lake-outline');
    map1.moveLayer('chatiboi-runoff-layer');

    //__________________________________________________________________________________________________
    // Land Surface Temperature (LST) — 12 Monthly WMS Raster Layers
    // All 12 layers are added upfront (hidden). Show/hide only; no reload after first fetch.
    const lstMonths = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
    for (let month = 1; month <= 12; month++) {
        map1.addSource(`lst-month-${month}`, {
            type: 'raster',
            tiles: [
                `http://172.18.1.85:8080/geoserver/LST/wms?service=WMS&version=1.1.0&request=GetMap&layers=LST:LST_Pakistan_2025_Month_${month}&bbox={bbox-epsg-3857}&width=768&height=558&srs=EPSG:3857&styles=&format=image/png&transparent=true`
            ],
            tileSize: 256
        });
        map1.addLayer({
            id: `lst-month-${month}`,
            type: 'raster',
            source: `lst-month-${month}`,
            layout: { 'visibility': 'none' },
            paint: { 'raster-opacity': 1.0 }
        }, 'national-boundary-layer');
    }

    // Keep all risk/zonation fills behind rivers, lakes and other thematic overlays.
    // This runs on each style load, so ordering is preserved after basemap switches too.
    function moveRiskLayersBehindOverlays() {
        const referenceLayerId = 'vulSites';
        if (!map1.getLayer(referenceLayerId)) {
            return;
        }

        const riskLayerIds = map1.getStyle().layers
            .map((layer) => layer.id)
            .filter((id) => id.includes('risk') || id.includes('zonation') || id.includes('-rz-'));

        riskLayerIds.forEach((layerId) => {
            if (layerId !== referenceLayerId && map1.getLayer(layerId)) {
                map1.moveLayer(layerId, referenceLayerId);
            }
        });
    }

    moveRiskLayersBehindOverlays();

});
//____________________________________________________________________________________________________________________________________________________________________________________

map1.on('click', function (e) {
    console.log('Clicked coordinates:', e.lngLat);
});
addPopup('gulmit-buildings-layer', (props) => `
    <strong><u>Buildings</u></strong><br>
    Confidence: ${props.confidence || 'Unknown'}
`);
addPopup('gulmit-schools-layer', (props) => `
    <strong><u>Schools</u></strong><br>
    Name: ${props.Name || 'Unknown'}<br>
    Enrollment: ${props.Enrolmnt || 'Unknown'}<br>
    Teachers: ${props.Teachers || 'Unknown'}`);

const getLakeField = (props, keys, fallback = 'N/A') => {
    for (const key of keys) {
        const value = props?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return value;
        }
    }
    return fallback;
};

const buildGlofLakesPopup = (props) => {
    const district = getLakeField(props, ['District', 'Districts', 'district']);
    const name = getLakeField(props, ['Name', 'Lake_Name', 'name']);
    const elevation = getLakeField(props, ['Elevation', 'Elevation_', 'Elevation_m', 'Elevation (m)', 'elevation']);
    const aspect = getLakeField(props, ['Aspect', 'Aspect_', 'aspect']);
    const slope = getLakeField(props, ['Slope', 'Slope_', 'slope']);
    const riskAreas = getLakeField(props, ['Risk_Areas', 'RiskAreas', 'Risk Areas', 'Areas_at_R', 'Areas_at_Risk', 'Area_at_Risk', 'Areas at Risk']);

    return `
        <strong><u>District:</u></strong> ${district}<br>
        <strong><u>Name:</u></strong> ${name}<br>
        <strong><u>Elevation:</u></strong> ${elevation}<br>
        <strong><u>Aspect:</u></strong> ${aspect}<br>
        <strong><u>Slope:</u></strong> ${slope}<br>
        <strong><u>Risk Areas:</u></strong> ${riskAreas}
    `;
};

addPopup('glof-lakes-fill', buildGlofLakesPopup);
addPopup('glof-lakes-outline', buildGlofLakesPopup);
addPopup('glof-lakes-centroid', buildGlofLakesPopup);
