import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../../styles/map.css';
import { infrastructureAssets } from '../../data/infrastructureAssets';
import { transmissionRoutes } from '../../data/transmissionRoutes';
import {
  COASTAL_TANKER_CORRIDORS,
  DOEB_REGIONAL_CLUSTERS,
  DoebDepotCluster,
  PROVINCE_DOWNSTREAM_DATA,
  getProvinceDepotId
} from '../../data/thailandDownstreamData';
import { DOWNSTREAM_SPOKE_ROUTES } from '../../data/downstreamSpokeRoutes';
import { AssetCategory, InfrastructureAsset } from '../../types/asset';
import { RouteMode, TransmissionRoute } from '../../types/route';
import { PinnedDataInspector, InspectorItem } from './PinnedDataInspector';
import { MapLegendDock, FilterCategory } from './MapLegendDock';
import { useWebsiteData } from '../../data/websiteData';
import {
  formatSourceHost,
  resolveAssetSourceLinks,
  resolveCoastalSourceLinks,
  resolveRouteSourceLinks
} from '../../utils/sourceLinks';
import {
  EncodingMode,
  formatNumber,
  parseEnergyGjPerDay,
} from '../../utils/lci';
import {
  DepotScenario,
  getAssetDisplayColor,
  getProvinceMetricValue,
  HeatmapMetric,
  heatmapRampColor,
  isAssetInStageRange,
  isCoastalInStageRange,
  isDepotInScenario,
  isDownstreamOverlayStage,
  isRouteInStageRange,
  LIGHT_SPECIAL_ROUTE_COLORS,
  LIGHT_ROUTE_COLORS,
  MapViewMode,
  NodeColorMode,
  routeEmissionColor,
  StageRange
} from '../../utils/mapThemes';

const ALL_CATEGORIES: AssetCategory[] = [
  'oil',
  'gas',
  'refinery',
  'gsp',
  'power',
  'depot',
  'airport',
  'petchem'
];

const AUTO_HIDE_NAMES_AT_ZOOM = 7;
const NETWORK_PATH_OPACITY = 1;
const NETWORK_PATH_WEIGHT = 2;
const NETWORK_PATH_DASH = '1 5';
const ALL_ROUTE_VISIBILITY: Record<RouteMode, boolean> = {
  'subsea-gas': true,
  'onshore-gas': true,
  'crude-rail': true,
  'onshore-oil': true,
  'road-truck': true,
  'marine-tanker': true
};
const NO_ROUTE_VISIBILITY: Record<RouteMode, boolean> = {
  'subsea-gas': false,
  'onshore-gas': false,
  'crude-rail': false,
  'onshore-oil': false,
  'road-truck': false,
  'marine-tanker': false
};

type ProvincePolygons = (typeof PROVINCE_DOWNSTREAM_DATA)[number]['polygons'];

function pointInRing(point: [number, number], ring: [number, number][]): boolean {
  const [lat, lng] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    const crosses = (latI > lat) !== (latJ > lat) &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI || Number.EPSILON) + lngI;
    if (crosses) inside = !inside;
  }
  return inside;
}

function findProvinceRoadEndpoint(
  coords: [number, number][],
  polygons: ProvincePolygons,
  center: [number, number]
): number {
  let closestIndex = coords.length - 1;
  let closestDistance = Number.POSITIVE_INFINITY;

  coords.forEach(([lat, lng], index) => {
    const insideProvince = polygons.some((polygon) => {
      const [outerRing, ...holes] = polygon;
      return Boolean(outerRing) && pointInRing([lat, lng], outerRing) &&
        !holes.some((hole) => pointInRing([lat, lng], hole));
    });
    if (!insideProvince) return;

    const distance = (lat - center[0]) ** 2 + (lng - center[1]) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return closestIndex;
}

const ASSET_COUNTS: Record<AssetCategory, number> = ALL_CATEGORIES.reduce(
  (acc, cat) => {
    acc[cat] = infrastructureAssets.filter((a) => a.category === cat).length;
    return acc;
  },
  {} as Record<AssetCategory, number>
);

const MAX_ENERGY_GJ = Math.max(
  ...infrastructureAssets.map((a) => parseEnergyGjPerDay(a.prodValue)),
  1
);

const GHG_VALUES = transmissionRoutes
  .map((r) => r.ghgFactorKgCo2ePerTkm)
  .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));

const GHG_RANGE = {
  min: GHG_VALUES.length ? Math.min(...GHG_VALUES) : 0.008,
  max: GHG_VALUES.length ? Math.max(...GHG_VALUES) : 0.141
};

const ASSET_GHG_VALUES = infrastructureAssets
  .map((a) => a.ghgKgCo2ePerFu)
  .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));

const ASSET_GHG_RANGE = {
  min: ASSET_GHG_VALUES.length ? Math.min(...ASSET_GHG_VALUES) : 0,
  max: ASSET_GHG_VALUES.length ? Math.max(...ASSET_GHG_VALUES) : 3.0
};

export const ThailandMap: React.FC = () => {
  const { catalog } = useWebsiteData();
  const sourceCards = catalog?.data.sourceCards ?? [];
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const facilityNameLayerRef = useRef<HTMLDivElement | null>(null);
  const labelLeaderLayerRef = useRef<SVGSVGElement | null>(null);
  const heatmapLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const spokeLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const routeLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const spokeRendererRef = useRef<L.SVG | null>(null);
  const routeRendererRef = useRef<L.SVG | null>(null);
  const depotLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const markerLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const [selectedItem, setSelectedItem] = useState<InspectorItem | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('all');
  const [showLocations, setShowLocations] = useState<boolean>(true);
  const [routeVisibility, setRouteVisibility] = useState<Record<RouteMode, boolean>>(ALL_ROUTE_VISIBILITY);
  const [hideNames, setHideNames] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(6);
  const hideNamesRef = useRef(hideNames);
  const [encoding, setEncoding] = useState<EncodingMode>('throughput');

  // Phase 2 Teacher-Proof Controls
  const [viewMode, setViewMode] = useState<MapViewMode>('transport');
  // Open on the requested cradle-to-gate project boundary. Other lifecycle
  // stages remain selectable for users who need to inspect them separately.
  const [stageRange] = useState<StageRange>('up-to-mid');
  const [nodeColorMode, setNodeColorMode] = useState<NodeColorMode>('category');
  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetric>('co2e');
  const [depotScenario, setDepotScenario] = useState<DepotScenario>('tier1');
  const [showDoebDepots, setShowDoebDepots] = useState<boolean>(false);
  const [showValhallaSpokes, setShowValhallaSpokes] = useState<boolean>(false);
  const [showCoastalTankers, setShowCoastalTankers] = useState<boolean>(true);
  const [showDemoMidPaths, setShowDemoMidPaths] = useState<boolean>(false);
  const isProvinceDistributionFocus = stageRange === 'mid-to-down' && showValhallaSpokes;

  const handleFilterChange = useCallback((category: FilterCategory) => {
    setShowLocations(true);
    setActiveFilter(category);
  }, []);

  const handleSelectAllLocations = useCallback(() => {
    setShowLocations(true);
    setActiveFilter('all');
    setShowDoebDepots(true);
  }, []);

  const handleUnselectAllLocations = useCallback(() => {
    setShowLocations(false);
    setActiveFilter('all');
    setSelectedItem((current) =>
      current?.type === 'asset' || current?.type === 'depot' ? null : current
    );
    setShowDoebDepots(false);
  }, []);

  const handleSelectAllPaths = useCallback(() => {
    setRouteVisibility(ALL_ROUTE_VISIBILITY);
    setShowCoastalTankers(true);
    setShowValhallaSpokes(true);
    setShowDemoMidPaths(true);
  }, []);

  const handleUnselectAllPaths = useCallback(() => {
    setRouteVisibility(NO_ROUTE_VISIBILITY);
    setSelectedItem((current) => current?.type === 'route' ? null : current);
    setShowCoastalTankers(false);
    setShowValhallaSpokes(false);
    setShowDemoMidPaths(false);
  }, []);

  // Sync top mode switch cleanly with encoding & downstream overlays
  // Filter core assets and routes by the selected category and process stage.
  const visibleAssets = useMemo(() => {
    if (!showLocations || isProvinceDistributionFocus) return [];
    return infrastructureAssets.filter((asset) => {
      if (!isAssetInStageRange(asset, stageRange)) return false;
      if (activeFilter === 'all') return true;
      if (activeFilter === 'upstream') return asset.stage === 'upstream';
      return asset.category === activeFilter;
    });
  }, [activeFilter, stageRange, showLocations, isProvinceDistributionFocus]);

  const visibleRoutes = useMemo(() => {
    if (isProvinceDistributionFocus) return [];
    return transmissionRoutes.filter((route) => isRouteInStageRange(route, stageRange));
  }, [stageRange, isProvinceDistributionFocus]);

  const demoMidCount = useMemo(
    () => visibleRoutes.filter((route) => route.isDemoPath).length,
    [visibleRoutes]
  );

  const handleToggleRouteMode = useCallback((mode: RouteMode) => {
    setRouteVisibility((current) => ({ ...current, [mode]: !current[mode] }));
  }, []);

  // Keep facility labels to the right of their marker and link each with a leader line.
  const syncFacilityLabels = useCallback(() => {
    const map = mapInstanceRef.current;
    const nameLayer = facilityNameLayerRef.current;
    const leaderLayer = labelLeaderLayerRef.current;
    if (!map || !nameLayer) return;

    leaderLayer?.replaceChildren();
    const shouldHide = hideNamesRef.current || map.getZoom() <= AUTO_HIDE_NAMES_AT_ZOOM;
    nameLayer.classList.toggle('is-hidden', shouldHide);
    if (shouldHide) {
      return;
    }

    nameLayer.classList.toggle('is-zoomed-out', map.getZoom() <= 7);
    const labels = Array.from(nameLayer.querySelectorAll('.facility-name-overlay')) as HTMLElement[];
    if (labels.length === 0) return;

    const mapSize = map.getSize();
    leaderLayer?.setAttribute('viewBox', `0 0 ${mapSize.x} ${mapSize.y}`);
    const svgNs = 'http://www.w3.org/2000/svg';

    labels.forEach((label) => {
      label.style.left = '0px';
      label.style.top = '0px';
      const height = label.getBoundingClientRect().height;
      const latitude = Number(label.dataset.latitude);
      const longitude = Number(label.dataset.longitude);
      const color = label.dataset.labelColor || '#68735c';
      const anchor = map.latLngToContainerPoint([latitude, longitude]);
      const anchorX = anchor.x;
      const anchorY = anchor.y;
      const left = anchorX + 12;
      const top = Math.max(4, Math.min(mapSize.y - height - 4, anchorY - height / 2));
      const box = { left, top, bottom: top + height };
      label.style.left = `${Math.round(left)}px`;
      label.style.top = `${Math.round(top)}px`;

      if (!leaderLayer) return;
      const endX = box.left;
      const endY = Math.max(box.top, Math.min(anchorY, box.bottom));
      const lineDx = endX - anchorX;
      const lineDy = endY - anchorY;
      const lineLength = Math.max(1, Math.hypot(lineDx, lineDy));
      const line = document.createElementNS(svgNs, 'line');
      line.setAttribute('x1', `${anchorX + (lineDx / lineLength) * 6}`);
      line.setAttribute('y1', `${anchorY + (lineDy / lineLength) * 6}`);
      line.setAttribute('x2', `${endX}`);
      line.setAttribute('y2', `${endY}`);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-opacity', '0.72');
      line.setAttribute('stroke-linecap', 'round');
      leaderLayer.appendChild(line);
    });
  }, []);

  useEffect(() => {
    hideNamesRef.current = hideNames;
    syncFacilityLabels();
  }, [hideNames, syncFacilityLabels]);

  // Initialize Leaflet Map once with Light CartoDB Positron Tiles
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [12.8, 101.2],
      zoom: 6,
      minZoom: 5,
      maxZoom: 16,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true
    });

    // Dedicated ordered overlay panes for crisp visual hierarchy on light map
    map.createPane('provinceHeatmapPane').style.zIndex = '350';
    map.createPane('spokeRoutePane').style.zIndex = '390';
    map.createPane('routePane').style.zIndex = '410';
    map.createPane('depotClusterPane').style.zIndex = '430';
    map.createPane('assetPane').style.zIndex = '450';

    spokeRendererRef.current = L.svg({ pane: 'spokeRoutePane', padding: 0.5 });
    routeRendererRef.current = L.svg({ pane: 'routePane', padding: 0.5 });

    const esriLightBase = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
        maxZoom: 16
      }
    );

    const esriLightRef = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 16,
        opacity: 0.72,
        pane: 'overlayPane'
      }
    );

    const osmFallback = L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
        className: 'osm-light-muted-tiles'
      }
    );

    let switchedToFallback = false;
    esriLightBase.on('tileerror', () => {
      if (!switchedToFallback) {
        switchedToFallback = true;
        osmFallback.addTo(map);
      }
    });
    esriLightBase.addTo(map);
    esriLightRef.addTo(map);

    heatmapLayerGroupRef.current = L.layerGroup().addTo(map);
    spokeLayerGroupRef.current = L.layerGroup().addTo(map);
    routeLayerGroupRef.current = L.layerGroup().addTo(map);
    depotLayerGroupRef.current = L.layerGroup().addTo(map);
    markerLayerGroupRef.current = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;
    const leaderLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    leaderLayer.classList.add('facility-label-leaders');
    leaderLayer.setAttribute('aria-hidden', 'true');
    leaderLayer.setAttribute('preserveAspectRatio', 'none');
    map.getContainer().appendChild(leaderLayer);
    labelLeaderLayerRef.current = leaderLayer;

    const nameLayer = document.createElement('div');
    nameLayer.className = 'facility-name-layer';
    map.getContainer().appendChild(nameLayer);
    facilityNameLayerRef.current = nameLayer;

    let labelSyncFrame = 0;
    const scheduleFacilityLabelSync = () => {
      if (labelSyncFrame) return;
      labelSyncFrame = requestAnimationFrame(() => {
        labelSyncFrame = 0;
        syncFacilityLabels();
      });
    };

    const syncZoomLevel = () => {
      setZoomLevel(map.getZoom());
      syncFacilityLabels();
    };

    map.on('zoomend', syncZoomLevel);
    map.on('move', scheduleFacilityLabelSync);
    map.on('moveend', syncFacilityLabels);
    map.on('click', () => setSelectedItem(null));

    // Reflow Leaflet tiles & SVG layers seamlessly when left sidebar collapses/expands
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      requestAnimationFrame(syncFacilityLabels);
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      if (labelSyncFrame) cancelAnimationFrame(labelSyncFrame);
      map.off('zoomend', syncZoomLevel);
      map.off('move', scheduleFacilityLabelSync);
      map.off('moveend', syncFacilityLabels);
      leaderLayer.remove();
      nameLayer.remove();
      labelLeaderLayerRef.current = null;
      facilityNameLayerRef.current = null;
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [syncFacilityLabels]);

  // 1. Render 77-Province Choropleth & Radial Heatmap Layer
  useEffect(() => {
    const group = heatmapLayerGroupRef.current;
    if (!group) return;
    group.clearLayers();

    const showProvinces =
      viewMode === 'emissions' && isDownstreamOverlayStage(stageRange);
    if (!showProvinces) return;

    const metricVals = PROVINCE_DOWNSTREAM_DATA.map((p) =>
      getProvinceMetricValue(p, heatmapMetric, depotScenario)
    );
    const minVal =
      heatmapMetric === 'co2e'
        ? depotScenario === 'baseline2'
          ? 0.001
          : 0.0005
        : Math.min(...metricVals);
    const maxVal =
      heatmapMetric === 'co2e'
        ? depotScenario === 'baseline2'
          ? 0.032
          : 0.011
        : Math.max(...metricVals);

    PROVINCE_DOWNSTREAM_DATA.forEach((prov) => {
      const metricVal = getProvinceMetricValue(prov, heatmapMetric, depotScenario);
      const fillColor = heatmapRampColor(metricVal, minVal, maxVal);
      const isSelected =
        selectedItem?.type === 'province' && selectedItem.data.proCode === prov.proCode;

      // Soft thermal hotspot halo around provincial demand centroid
      const ratio = Math.max(0, Math.min(1, (metricVal - minVal) / (maxVal - minVal || 1)));
      L.circle([prov.lat, prov.lng], {
        pane: 'provinceHeatmapPane',
        radius: 14000 + ratio * 24000,
        color: 'transparent',
        fillColor,
        fillOpacity: 0.22 + ratio * 0.16,
        interactive: false
      }).addTo(group);

      // Interactive 77-Province polygon choropleth
      const poly = L.polygon(prov.polygons as unknown as L.LatLngExpression[][][], {
        pane: 'provinceHeatmapPane',
        color: isSelected ? '#20231e' : '#ffffff',
        weight: isSelected ? 2.2 : 0.9,
        opacity: isSelected ? 0.95 : 0.75,
        fillColor,
        fillOpacity: isSelected ? 0.62 : 0.42
      });

      const activeKm =
        depotScenario === 'baseline2'
          ? prov.baseline2CentralKm
          : depotScenario === 'all44'
          ? prov.allDoebKm
          : prov.tier1Km;
      const activeCo2 =
        depotScenario === 'baseline2'
          ? prov.baseline2CentralKgCo2eL
          : depotScenario === 'all44'
          ? prov.allDoebKgCo2eL
          : prov.tier1KgCo2eL;

      const tooltipHtml = `
        <div class="light-tooltip-card">
          <div class="lt-title">${prov.provinceEn} (${prov.provinceTh})</div>
          <div class="lt-sub">${prov.region} · ${prov.doebStations.toLocaleString()} DOEB pumps</div>
          <div class="lt-grid">
            <span>Last-mile (${depotScenario === 'baseline2' ? '2 Central' : depotScenario === 'all44' ? '44 All' : '31 Tier-1'}):</span>
            <b>${activeKm.toFixed(1)} km · ${activeCo2.toFixed(5)} kgCO₂e/L</b>
            <span>Vehicles / pump:</span>
            <b>${prov.vehiclesPerStation.toLocaleString()} : 1</b>
          </div>
          <div class="lt-source-hint font-mono">Sources: doeb.go.th · data.doeb.go.th · rocketmedialab.co · web.dlt.go.th · valhalla.openstreetmap.de (คลิกเพื่อเปิดลิงก์เว็บ)</div>
        </div>
      `;

      poly.bindTooltip(tooltipHtml, {
        sticky: true,
        direction: 'top',
        className: 'light-map-tooltip'
      });

      poly.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedItem({ type: 'province', data: prov });
      });

      poly.addTo(group);
    });
  }, [viewMode, stageRange, heatmapMetric, depotScenario, selectedItem]);

  // 2. Render Valhalla Last-Mile Spokes + Coastal 342 nm Tanker Corridors
  useEffect(() => {
    const group = spokeLayerGroupRef.current;
    if (!group) return;
    group.clearLayers();

    // Coastal 342 nm Tanker routes (Sriracha -> Songkhla / Surat Thani)
    if (!isProvinceDistributionFocus && showCoastalTankers && isCoastalInStageRange(stageRange)) {
      COASTAL_TANKER_CORRIDORS.forEach((corridor) => {
        const coastalLinks = resolveCoastalSourceLinks(corridor, sourceCards);
        const hostText = coastalLinks.map((l) => formatSourceHost(l.url)).join(' · ');
        const line = L.polyline(corridor.coords, {
          pane: 'spokeRoutePane',
          renderer: spokeRendererRef.current ?? undefined,
          className: 'network-flow-path',
          color: LIGHT_SPECIAL_ROUTE_COLORS.coastalTanker,
          weight: NETWORK_PATH_WEIGHT,
          opacity: NETWORK_PATH_OPACITY,
          dashArray: NETWORK_PATH_DASH,
          lineCap: 'round',
          lineJoin: 'round'
        });

        line.bindTooltip(
          `<div class="light-tooltip-card"><div class="lt-title">${corridor.nameTh || corridor.nameEn}</div><div class="lt-sub">${corridor.distanceNm} ไมล์ทะเล (${corridor.distanceKm} กม.) · ${corridor.voyageTime} · ${corridor.sourceId}</div><div class="lt-source-hint font-mono">Source: ${hostText} (คลิกเพื่อเปิดลิงก์เว็บ)</div></div>`,
          { sticky: true, className: 'light-map-tooltip' }
        );
        line.on('click', (event) => {
          L.DomEvent.stopPropagation(event);
          setSelectedItem({ type: 'coastal', data: corridor });
        });
        line.addTo(group);
      });
    }

    // Valhalla hub-to-province highway spokes when regional downstream overlay is active
    const shouldDrawSpokes =
      showValhallaSpokes &&
      (stageRange === 'mid-to-down' || (viewMode === 'emissions' && isDownstreamOverlayStage(stageRange)));
    if (!shouldDrawSpokes) return;

    PROVINCE_DOWNSTREAM_DATA.forEach((prov) => {
      const hubId = getProvinceDepotId(prov, depotScenario);
      const matched = DOEB_REGIONAL_CLUSTERS.find((d) => d.id === hubId);
      const origin: [number, number] = matched ? [matched.lat, matched.lng] : [prov.hubLat, prov.hubLng];
      const spokeColor = LIGHT_SPECIAL_ROUTE_COLORS.downstreamSpokes;
      const spokeCoords = DOWNSTREAM_SPOKE_ROUTES[`${hubId}:${prov.proCode}`] ?? [
        origin,
        [prov.hubLat, prov.hubLng]
      ];
      const provinceCenter: [number, number] = [prov.lat, prov.lng];
      const endpointIndex = findProvinceRoadEndpoint(spokeCoords, prov.polygons, provinceCenter);
      const provinceRouteCoords = spokeCoords.slice(0, endpointIndex + 1);
      const provinceEndpoint = provinceRouteCoords[provinceRouteCoords.length - 1] || spokeCoords[spokeCoords.length - 1];

      L.polyline(provinceRouteCoords, {
        pane: 'spokeRoutePane',
        renderer: spokeRendererRef.current ?? undefined,
        className: 'network-flow-path',
        color: spokeColor,
        weight: NETWORK_PATH_WEIGHT,
        opacity: NETWORK_PATH_OPACITY,
        dashArray: NETWORK_PATH_DASH,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false
      }).addTo(group);

      const provincePoint = L.circleMarker(provinceEndpoint, {
        pane: 'spokeRoutePane',
        renderer: spokeRendererRef.current ?? undefined,
        radius: 5,
        color: '#ffffff',
        weight: 1.5,
        fillColor: spokeColor,
        fillOpacity: 1
      });
      provincePoint.bindTooltip(
        `<div class="light-tooltip-card"><div class="lt-title">${prov.provinceTh} (${prov.provinceEn})</div><div class="lt-sub">จุดบนเส้นทางใกล้ใจกลางจังหวัดที่สุด · สถานีบริการ DOEB ${prov.doebStations.toLocaleString()} แห่ง</div><div class="lt-grid"><span>คลังต้นทางตัวแทน:</span><b>${matched?.province || 'ไม่ระบุ'} · ${hubId}</b></div><div class="lt-source-hint font-mono">Sources: doeb.go.th · data.doeb.go.th · valhalla.openstreetmap.de (คลิกเพื่อเปิดลิงก์เว็บ)</div></div>`,
        { sticky: true, direction: 'top', className: 'light-map-tooltip' }
      );
      provincePoint.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        setSelectedItem({ type: 'province', data: prov });
      });
      provincePoint.addTo(group);
    });
  }, [viewMode, stageRange, depotScenario, showValhallaSpokes, showCoastalTankers, isProvinceDistributionFocus, sourceCards]);

  // 3. Render Verified LCI & Clearly Marked Option B Demo Transmission Routes
  useEffect(() => {
    const group = routeLayerGroupRef.current;
    if (!group) return;
    group.clearLayers();

    visibleRoutes.forEach((route: TransmissionRoute) => {
      const isDemo = Boolean(route.isDemoPath);
      if (isDemo && !showDemoMidPaths) return;
      if (!isDemo && !routeVisibility[route.mode]) return;

      const useGhgColor = viewMode === 'emissions' || encoding === 'emissions';
      const color = isDemo
        ? LIGHT_SPECIAL_ROUTE_COLORS.demoMid
        : useGhgColor
          ? routeEmissionColor(route.ghgFactorKgCo2ePerTkm ?? GHG_RANGE.min, GHG_RANGE.min, GHG_RANGE.max)
          : LIGHT_ROUTE_COLORS[route.mode] || '#517b9d';

      const polyline = L.polyline(route.coords, {
        pane: 'routePane',
        renderer: routeRendererRef.current ?? undefined,
        className: isDemo ? 'demo-proxy-path' : 'network-flow-path',
        color,
        weight: isDemo ? 2.3 : NETWORK_PATH_WEIGHT,
        opacity: isDemo ? 0.88 : NETWORK_PATH_OPACITY,
        dashArray: isDemo
          ? '6 5'
          : route.mode === 'crude-rail'
            ? route.dashArray
            : route.mode === 'onshore-oil'
              ? undefined
              : NETWORK_PATH_DASH,
        lineJoin: 'round',
        lineCap: 'round'
      });

      const ghgLabel =
        route.ghgFactorKgCo2ePerTkm !== undefined
          ? `${route.ghgFactorKgCo2ePerTkm.toFixed(4)} kgCO₂e/t·km`
          : 'Pipeline (kWh undisclosed)';
      const routeHosts = resolveRouteSourceLinks(route, sourceCards)
        .map((l) => formatSourceHost(l.url))
        .slice(0, 3)
        .join(' · ');

      const tooltipHtml = isDemo
        ? `<div class="light-tooltip-card">
            <div class="lt-demo-badge">DEMO / PROXY · ไม่มีข้อมูลต้นทางรายคลังในสาธารณะ</div>
            <div class="lt-title">${route.nameTh}</div>
            <div class="lt-sub">${route.from} → ${route.to}</div>
            <div class="lt-grid">
              <span>สถานะข้อมูล:</span><b>Option B Demo (No Source)</b>
              <span>ระยะเชื่อมสาธิต:</span><b>~${route.distanceKm ?? '—'} km</b>
            </div>
            <div class="lt-source-hint font-mono">Context: ${routeHosts} (คลิกเพื่อเปิดลิงก์เว็บ)</div>
          </div>`
        : `<div class="light-tooltip-card">
            <div class="lt-title">${route.nameEn}</div>
            <div class="lt-sub">${route.from} → ${route.to}</div>
            <div class="lt-grid">
              <span>Spec:</span><b>${route.specs}</b>
              <span>Intensity:</span><b>${ghgLabel}${route.distanceKm ? ` · ${route.distanceKm} km` : ''}</b>
            </div>
            <div class="lt-source-hint font-mono">Source: ${routeHosts || 'web_catalog.json'} (คลิกเพื่อเปิดลิงก์เว็บ)</div>
          </div>`;

      polyline.bindTooltip(tooltipHtml, {
        sticky: true,
        className: 'light-map-tooltip'
      });

      polyline.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedItem({ type: 'route', data: route });
      });

      polyline.addTo(group);
    });
  }, [
    visibleRoutes,
    routeVisibility,
    viewMode,
    encoding,
    stageRange,
    showDemoMidPaths,
    sourceCards
  ]);

  // 4. Render 44 DOEB Regional Petroleum Depot Clusters (Section 7 & 16)
  useEffect(() => {
    const group = depotLayerGroupRef.current;
    if (!group) return;
    group.clearLayers();

    if (!showDoebDepots || !isDownstreamOverlayStage(stageRange)) return;

    const clusters = DOEB_REGIONAL_CLUSTERS.filter((d) => isDepotInScenario(d, depotScenario));

    clusters.forEach((depot: DoebDepotCluster) => {
      const isSelected = selectedItem?.type === 'depot' && selectedItem.data.id === depot.id;
      const sizePx = Math.max(10, Math.min(22, 9 + Math.sqrt(Math.max(1, depot.totalMl)) * 0.28));

      const icon = L.divIcon({
        className: 'doeb-depot-pin-wrapper',
        iconSize: [sizePx, sizePx],
        iconAnchor: [sizePx / 2, sizePx / 2],
        html: `<div class="doeb-depot-diamond ${depot.isBaselineCentral ? 'central' : depot.isMajorOil ? 'tier1' : 'minor'} ${isSelected ? 'active' : ''}" style="width:${sizePx}px;height:${sizePx}px;"></div>`
      });

      const marker = L.marker([depot.lat, depot.lng], {
        pane: 'depotClusterPane',
        icon
      });

      marker.bindTooltip(
        `<div class="light-tooltip-card">
          <div class="lt-title">${depot.id} · ${depot.province} (${depot.amphoe})</div>
          <div class="lt-sub">${depot.repCompany} · ${depot.depotCount} DOEB license(s)</div>
          <div class="lt-grid"><span>Certified Capacity:</span><b>${depot.totalMl.toLocaleString()} ML</b></div>
          <div class="lt-source-hint font-mono">Source: data.doeb.go.th (TSRC-50 · คลิกเพื่อเปิดลิงก์เว็บ)</div>
        </div>`,
        { direction: 'top', offset: [0, -8], className: 'light-map-tooltip' }
      );

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedItem({ type: 'depot', data: depot });
      });

      marker.addTo(group);
    });
  }, [showDoebDepots, stageRange, depotScenario, selectedItem]);

  // 5. Render 47 Core Verified LCI Facilities
  useEffect(() => {
    const group = markerLayerGroupRef.current;
    if (!group) return;
    group.clearLayers();
    facilityNameLayerRef.current?.replaceChildren();

    visibleAssets.forEach((asset: InfrastructureAsset) => {
      const isSelected = selectedItem?.type === 'asset' && selectedItem.data.id === asset.id;

      const energyGj = parseEnergyGjPerDay(asset.prodValue);
      const color = getAssetDisplayColor(
        asset,
        viewMode,
        nodeColorMode,
        MAX_ENERGY_GJ,
        ASSET_GHG_RANGE.min,
        ASSET_GHG_RANGE.max
      );

      const dotSize = 11;
      const flowShapeClass = `flow-${asset.stage}`;

      const markerHtml = `
        <div class="light-radar-pin ${flowShapeClass} ${isSelected ? 'selected' : ''}" style="--pin-color:${color};width:${dotSize + 10}px;height:${dotSize + 10}px;">
          <span class="light-pin-core ${flowShapeClass}" style="width:${dotSize}px;height:${dotSize}px;background:${color}"></span>
        </div>
      `;

      const icon = L.divIcon({
        className: 'light-marker-container',
        iconSize: [dotSize + 10, dotSize + 10],
        iconAnchor: [(dotSize + 10) / 2, (dotSize + 10) / 2],
        html: markerHtml
      });

      const marker = L.marker([asset.lat, asset.lng], {
        pane: 'assetPane',
        icon,
        zIndexOffset: isSelected ? 1000 : asset.stage === 'midstream' ? 300 : 100
      });

      const nameLayer = facilityNameLayerRef.current;
      if (nameLayer) {
        const label = document.createElement('div');
        label.className = 'facility-name-overlay';
        label.dataset.latitude = String(asset.lat);
        label.dataset.longitude = String(asset.lng);
        label.dataset.labelColor = color;
        label.dataset.selected = String(isSelected);
        const name = document.createElement('span');
        name.className = 'facility-name-pill';
        name.textContent = asset.nameTh || asset.nameEn;
        label.appendChild(name);
        nameLayer.appendChild(label);
      }

      const volumeTag = energyGj > 0 ? `${formatNumber(energyGj, 0)} GJ/day` : asset.prodValue;
      const assetHosts = resolveAssetSourceLinks(asset, sourceCards)
        .map((l) => formatSourceHost(l.url))
        .slice(0, 3)
        .join(' · ');
      marker.bindPopup(
        `<div class="light-tooltip-card">
          <div class="lt-title">${asset.nameTh || asset.nameEn}${asset.nameTh ? ` (${asset.nameEn})` : ''}</div>
          <div class="lt-sub">${asset.operator} · ${asset.stage === 'upstream' ? 'ต้นน้ำ' : asset.stage === 'midstream' ? 'กลางน้ำ' : 'ปลายน้ำ'}</div>
          <div class="lt-grid">
            <span>ผลผลิต:</span><b>${asset.prodValue}</b>
            <span>พลังงานเทียบเท่า:</span><b>${volumeTag}</b>
            <span>GHG ในบัญชี LCI:</span><b>${typeof asset.ghgKgCo2ePerFu === 'number' ? `${asset.ghgKgCo2ePerFu} kgCO₂e` : 'มีบันทึก'}</b>
          </div>
          <div class="lt-source-hint font-mono">Source (${asset.sourceId}): ${assetHosts || 'ดูลิงก์เว็บ'} (คลิกเพื่อเปิดลิงก์เว็บ)</div>
        </div>`,
        { className: 'light-map-popup', closeButton: false, offset: [0, -6] }
      );

      marker.on('mouseover', () => marker.openPopup());
      marker.on('mouseout', () => marker.closePopup());
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedItem({ type: 'asset', data: asset });
      });

      marker.addTo(group);
    });

    requestAnimationFrame(syncFacilityLabels);
  }, [visibleAssets, viewMode, nodeColorMode, selectedItem, syncFacilityLabels, sourceCards]);

  const handleSelectItem = useCallback((newItem: InspectorItem) => {
    setSelectedItem(newItem);
    const map = mapInstanceRef.current;
    if (!map) return;

    if (newItem.type === 'asset' || newItem.type === 'depot' || newItem.type === 'province') {
      map.flyTo([newItem.data.lat, newItem.data.lng], Math.max(map.getZoom(), 8), {
        duration: 0.65
      });
    } else if ((newItem.type === 'route' || newItem.type === 'coastal') && newItem.data.coords.length > 0) {
      map.fitBounds(L.latLngBounds(newItem.data.coords), { padding: [80, 80], duration: 0.65 });
    }
  }, []);

  return (
    <div className="map-page-scroll-container">
      {/* Section 1: Interactive Full-Viewport LCI Map */}
      <section className="map-canvas-wrapper" aria-label="Thailand Petroleum LCI Interactive Map">
        <div ref={mapContainerRef} className="map-leaflet-container" />

        {/* Pinned Technical Dossier Inspector (Top-Left) */}
        {selectedItem && (
          <PinnedDataInspector
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            onSelectItem={handleSelectItem}
            allAssets={infrastructureAssets}
            allRoutes={transmissionRoutes}
            depotScenario={depotScenario}
          />
        )}

        {/* Legend & Category Controls Dock (Bottom-Right) */}
        <MapLegendDock
            activeFilter={activeFilter}
            onFilterChange={handleFilterChange}
            showLocations={showLocations}
            allLocationsSelected={showLocations && activeFilter === 'all' && showDoebDepots}
            allPathsSelected={Object.values(routeVisibility).every(Boolean) && showCoastalTankers && showValhallaSpokes && showDemoMidPaths}
            onSelectAllLocations={handleSelectAllLocations}
            onUnselectAllLocations={handleUnselectAllLocations}
            onSelectAllPaths={handleSelectAllPaths}
            onUnselectAllPaths={handleUnselectAllPaths}
            routeVisibility={routeVisibility}
            onToggleRouteMode={handleToggleRouteMode}
            hideNames={hideNames}
            autoHideNames={zoomLevel <= AUTO_HIDE_NAMES_AT_ZOOM}
            onToggleHideNames={() => setHideNames((p) => !p)}
            encoding={encoding}
            onEncodingChange={setEncoding}
            ghgRange={GHG_RANGE}
            assetCounts={ASSET_COUNTS}
            viewMode={viewMode}
            nodeColorMode={nodeColorMode}
            onNodeColorModeChange={setNodeColorMode}
            heatmapMetric={heatmapMetric}
            depotScenario={depotScenario}
          />

      </section>
    </div>
  );
};
