import type { CoastalTankerCorridor } from '../data/thailandDownstreamData';
import type { InfrastructureAsset } from '../types/asset';
import type { TransmissionRoute } from '../types/route';
import { isHttpUrl } from './format';

export interface SourceLink {
  id: string;
  label: string;
  url: string;
}

export interface CatalogSourceCardLike {
  source_id: string;
  title?: string;
  url_or_document_id?: string;
}

export const VERIFIED_SOURCE_LINKS: Record<string, SourceLink> = {
  'TSRC-36': {
    id: 'TSRC-36',
    label: 'Vessbook Maritime Route Planner',
    url: 'https://vessbook.com/'
  },
  'TSRC-36-SRIRACHA': {
    id: 'TSRC-36',
    label: 'Vessbook (Sriracha → Songkhla 342 nm)',
    url: 'https://vessbook.com/tools/route-planner?stops=Sriracha%2C100.8700%2C13.1000%2CTH%3BSongkhla%2C100.6000%2C7.2000%2CTH&speed=12&dep=2026-11-15T00%3A00'
  },
  'TSRC-36-MTP': {
    id: 'TSRC-36',
    label: 'Vessbook (Map Ta Phut → Songkhla)',
    url: 'https://vessbook.com/tools/route-planner?stops=Map+Ta+Phut%2C101.1500%2C12.6700%2CTH%3BSongkhla%2C100.6000%2C7.2000%2CTH&speed=12&dep=2026-11-15T00%3A00'
  },
  'TSRC-47': {
    id: 'TSRC-47',
    label: 'DOEB Fuel Station Registry',
    url: 'https://www.doeb.go.th/'
  },
  'TSRC-48': {
    id: 'TSRC-48',
    label: 'Rocket Media Lab Gas Stations',
    url: 'https://rocketmedialab.co/database-gas-station/'
  },
  'TSRC-49': {
    id: 'TSRC-49',
    label: 'DLT Registered Vehicles',
    url: 'https://web.dlt.go.th/statistics/'
  },
  'TSRC-50': {
    id: 'TSRC-50',
    label: 'DOEB OpenData Oil Depots',
    url: 'https://data.doeb.go.th/dataset/oil-depot'
  },
  'TSRC-50-XLSX': {
    id: 'TSRC-50',
    label: 'DOEB Depot Registry (XLSX)',
    url: 'https://data.doeb.go.th/dataset/97ff5521-4fc7-4244-87e6-eaab74c15f47/resource/171b62fa-d843-4e5f-9625-52d5a8d7d820/download/depot.xlsx'
  },
  'TSRC-52': {
    id: 'TSRC-52',
    label: 'PTG Energy FY2025 MD&A',
    url: 'https://investor.ptgenergy.co.th/th/downloads/mdna'
  },
  'TSRC-53': {
    id: 'TSRC-53',
    label: 'Valhalla OSM Road Router',
    url: 'https://valhalla.openstreetmap.de/'
  },
  'TSRC-53-API': {
    id: 'TSRC-53',
    label: 'Valhalla Route API Spec',
    url: 'https://valhalla.github.io/valhalla/api/route/api-reference/'
  },
  'TSRC-54': {
    id: 'TSRC-54',
    label: 'HeiGIT Ohsome OSM API',
    url: 'https://docs.ohsome.org/ohsome-api/v2/'
  },
  'TSRC-55': {
    id: 'TSRC-55',
    label: 'OpenGISData-Thailand',
    url: 'https://github.com/chingchai/OpenGISData-Thailand'
  },
  'TSRC-56': {
    id: 'TSRC-56',
    label: 'Thailand Geography JSON',
    url: 'https://github.com/thailand-geography-data/thailand-geography-json'
  },
  'TSRC-58': {
    id: 'TSRC-58',
    label: 'Prima Marine 56-1 One Report 2025',
    url: 'https://www.primamarine.co.th/th/investor-relations/downloads/one-report'
  },
  'TSRC-59': {
    id: 'TSRC-59',
    label: 'AMA Marine 56-1 One Report 2025',
    url: 'https://amamarine.co.th/annual-report.php'
  },
  'TSRC-60': {
    id: 'TSRC-60',
    label: 'Thai Pipeline Network (TPN)',
    url: 'https://tpnthai.com/projects/'
  },
  'EMEP-2023': {
    id: 'EMEP/EEA 2023',
    label: 'EMEP/EEA 2023 Road Transport Guidebook',
    url: 'https://copert.emisia.com/wp-content/uploads/2025/10/1.A.3.b.i-iv-Road-transport-2025.pdf'
  },
  'TGO-CFO': {
    id: 'TGO EF',
    label: 'Thailand TGO Emission Factor',
    url: 'https://thaicarbonlabel.tgo.or.th/index.php?lang=EN&mod=YjNKbllXNXBlbUYwYVc5dVgyVnRhWE56YVc5dQ'
  },
  'OR-56-1': {
    id: 'OR 56-1',
    label: 'OR 56-1 One Report 2025',
    url: 'https://investor.pttor.com/th/document/annual-reports'
  },
  BAFS: {
    id: 'BAFS',
    label: 'BAFS Utilities & Aviation Fuel',
    url: 'https://www.bafsthai.com/th/businesses/utilities-and-power-business'
  },
  'PTTEP-S1': {
    id: 'PTTEP S1',
    label: 'PTTEP EIA (Sirikit / Rail Terminal)',
    url: 'https://sustainability.pttep.com/storage/document/sustainability/pttep-eia-report-of-onshore-petroleum-production-th.pdf'
  },
  'THAPPLINE-SPRC': {
    id: 'Thappline',
    label: 'SPRC EGM 2023 Encl. 3 (Thappline)',
    url: 'https://investor.sprc.co.th/storage/downloads/shareholders-meeting/2023/egm202301/20221229-sprc-egm-202301-enc03-en.pdf'
  },
  'EPPO-OIL': {
    id: 'EPPO',
    label: 'EPPO Petroleum Statistics',
    url: 'https://www.eppo.go.th/data-energy-statistic/energy-statistic/oil-energy-stat/petroleum/'
  },
  'DMF-FACT': {
    id: 'DMF',
    label: 'DMF Thailand Petroleum Facts',
    url: 'https://www.dmf.go.th/resources/announcement/th/fact_V2.pdf'
  },
  'OSM-COPY': {
    id: 'OpenStreetMap',
    label: 'OpenStreetMap Contributors',
    url: 'https://www.openstreetmap.org/copyright'
  }
};

const KEYWORD_LINK_MAP: Array<[RegExp, string]> = [
  [/thappline/i, 'THAPPLINE-SPRC'],
  [/\bdoeb\b|กรมธุรกิจพลังงาน/i, 'TSRC-50'],
  [/\brml\b|rocket media/i, 'TSRC-48'],
  [/\bdlt\b|กรมการขนส่ง/i, 'TSRC-49'],
  [/valhalla/i, 'TSRC-53'],
  [/ohsome/i, 'TSRC-54'],
  [/vessbook/i, 'TSRC-36'],
  [/\bprm\b|prima marine/i, 'TSRC-58'],
  [/\bama\b|ama marine/i, 'TSRC-59'],
  [/\bptg\b/i, 'TSRC-52'],
  [/\btpn\b/i, 'TSRC-60'],
  [/\bor 56-1\b|\bor\b/i, 'OR-56-1'],
  [/\bbafs\b/i, 'BAFS'],
  [/\bemep\b/i, 'EMEP-2023'],
  [/\btgo\b/i, 'TGO-CFO']
];

/** Deduplicate source links by trimmed URL while preserving order. */
export function dedupeSourceLinks(links: SourceLink[]): SourceLink[] {
  const seen = new Set<string>();
  const out: SourceLink[] = [];
  for (const item of links) {
    const cleanUrl = item.url?.trim();
    if (!isHttpUrl(cleanUrl) || seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);
    out.push({ ...item, url: cleanUrl });
  }
  return out;
}

/** Extract compact hostname label (e.g. data.doeb.go.th) for UI badges and tooltips. */
export function formatSourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Resolve SRC-* and TSRC-* IDs against catalog sourceCards and VERIFIED_SOURCE_LINKS. */
export function resolveSourceIds(
  ids: string[],
  sourceCards: CatalogSourceCardLike[] = []
): SourceLink[] {
  const cardMap = new Map(sourceCards.map((c) => [c.source_id.toUpperCase(), c]));
  const out: SourceLink[] = [];

  for (const rawId of ids) {
    const id = rawId.trim().toUpperCase();
    if (!id) continue;
    const preset = VERIFIED_SOURCE_LINKS[id];
    if (preset) {
      out.push(preset);
      continue;
    }
    const card = cardMap.get(id);
    if (card && isHttpUrl(card.url_or_document_id)) {
      out.push({
        id: card.source_id,
        label: card.title ? `${card.source_id}: ${card.title}` : card.source_id,
        url: card.url_or_document_id
      });
    }
  }
  return dedupeSourceLinks(out);
}

/** Extract clickable links from free-form text containing SRC/TSRC IDs or known agency names. */
export function resolveSourceLinksFromText(
  text: string | undefined,
  sourceCards: CatalogSourceCardLike[] = []
): SourceLink[] {
  if (!text) return [];
  const tokenIds = Array.from(text.matchAll(/\bT?SRC-\d+\b/gi), (m) => m[0].toUpperCase());
  const keywordIds = KEYWORD_LINK_MAP.filter(([re]) => re.test(text)).map(([, key]) => key);
  return resolveSourceIds([...tokenIds, ...keywordIds], sourceCards);
}

/** Resolve all verifiable webpage links for an InfrastructureAsset. */
export function resolveAssetSourceLinks(
  asset: InfrastructureAsset,
  sourceCards: CatalogSourceCardLike[] = []
): SourceLink[] {
  const links: SourceLink[] = [];
  if (asset.pipelineObservation && isHttpUrl(asset.pipelineObservation.sourceUrl)) {
    links.push({
      id: asset.pipelineObservation.sourceId || 'Pipeline Data',
      label: `Pipeline Snapshot (${formatSourceHost(asset.pipelineObservation.sourceUrl)})`,
      url: asset.pipelineObservation.sourceUrl
    });
  }
  if (isHttpUrl(asset.produceSourceUrl)) {
    links.push({
      id: 'Production',
      label: asset.produceSourceDoc || formatSourceHost(asset.produceSourceUrl),
      url: asset.produceSourceUrl
    });
  }
  if (isHttpUrl(asset.transportSourceUrl)) {
    links.push({
      id: 'Transport',
      label: asset.transportSourceDoc || formatSourceHost(asset.transportSourceUrl),
      url: asset.transportSourceUrl
    });
  }
  links.push(...resolveSourceLinksFromText(asset.sourceId, sourceCards));
  return dedupeSourceLinks(links);
}

/** Resolve all verifiable webpage links for a TransmissionRoute (verified or Option B Demo). */
export function resolveRouteSourceLinks(
  route: TransmissionRoute,
  sourceCards: CatalogSourceCardLike[] = []
): SourceLink[] {
  const links: SourceLink[] = [];
  if (isHttpUrl(route.produceSourceUrl)) {
    links.push({
      id: 'Origin',
      label: route.produceSourceDoc || formatSourceHost(route.produceSourceUrl),
      url: route.produceSourceUrl
    });
  }
  if (isHttpUrl(route.transportSourceUrl)) {
    links.push({
      id: 'Corridor',
      label: route.transportSourceDoc || formatSourceHost(route.transportSourceUrl),
      url: route.transportSourceUrl
    });
  }
  if (isHttpUrl(route.sourceUrl)) {
    links.push({
      id: 'Primary',
      label: formatSourceHost(route.sourceUrl),
      url: route.sourceUrl
    });
  }
  links.push(
    ...resolveSourceLinksFromText(
      `${route.sourceRef ?? ''} ${route.specs ?? ''} ${route.evidenceNote ?? ''}`,
      sourceCards
    )
  );
  if (route.isDemoPath) {
    links.push(VERIFIED_SOURCE_LINKS['TSRC-50'], VERIFIED_SOURCE_LINKS['TSRC-53']);
  } else {
    links.push(VERIFIED_SOURCE_LINKS['EMEP-2023'], VERIFIED_SOURCE_LINKS['TGO-CFO']);
  }
  return dedupeSourceLinks(links);
}

/** Resolve clickable webpage links for a CoastalTankerCorridor. */
export function resolveCoastalSourceLinks(
  corridor: CoastalTankerCorridor,
  sourceCards: CatalogSourceCardLike[] = []
): SourceLink[] {
  const links: SourceLink[] = [];
  if (corridor.id === 'COASTAL-SRIRACHA-SONGKHLA') {
    links.push(VERIFIED_SOURCE_LINKS['TSRC-36-SRIRACHA']);
  } else if (corridor.id === 'COASTAL-MTP-SURAT-SONGKHLA') {
    links.push(VERIFIED_SOURCE_LINKS['TSRC-36-MTP']);
  }
  links.push(...resolveSourceLinksFromText(`${corridor.sourceId} ${corridor.voyageTime}`, sourceCards));
  if (corridor.sourceId.includes('SRC-097') || corridor.voyageTime.includes('PRM')) {
    links.push(VERIFIED_SOURCE_LINKS['TSRC-58']);
  }
  links.push(VERIFIED_SOURCE_LINKS['TSRC-50']);
  return dedupeSourceLinks(links);
}
