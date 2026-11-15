import { InfrastructureAsset } from '../types/asset';
import { TransmissionRoute, RouteMode } from '../types/route';
import { infrastructureAssets } from '../data/infrastructureAssets';
import { transmissionRoutes } from '../data/transmissionRoutes';

export interface PathLeg {
  fromAsset: InfrastructureAsset;
  toAsset: InfrastructureAsset;
  route: TransmissionRoute;
  distanceKm: number;
  energyMj: number;
  ghgKgCo2e: number;
}

export interface PathResult {
  nodes: InfrastructureAsset[];
  routes: TransmissionRoute[];
  legs: PathLeg[];
  totalDistanceKm: number;
  totalEnergyMj: number;
  totalGhgKgCo2e: number;
  modes: RouteMode[];
  startAsset: InfrastructureAsset;
  endAsset: InfrastructureAsset;
}

interface EdgeDefinition {
  routeId: string;
  fromId: string;
  toIds: string[];
}

// Canonical topology connections based on engineering GIS data
const ROUTE_CONNECTIONS: EdgeDefinition[] = [
  { routeId: 'ROUTE-ERAWAN-RAYONG', fromId: 'ERAWAN', toIds: ['GSP-RAYONG'] },
  { routeId: 'ROUTE-ERAWAN-KHANOM', fromId: 'ERAWAN', toIds: ['GSP-KHANOM'] },
  { routeId: 'ROUTE-BONGKOT-ERAWAN', fromId: 'BONGKOT-NORTH', toIds: ['ERAWAN'] },
  { routeId: 'ROUTE-BONGKOT-S-N', fromId: 'BONGKOT-SOUTH', toIds: ['BONGKOT-NORTH'] },
  { routeId: 'ROUTE-ARTHIT-RAYONG', fromId: 'ARTHIT', toIds: ['GSP-RAYONG'] },
  { routeId: 'ROUTE-PAILIN-TRUNK', fromId: 'PAILIN', toIds: ['ERAWAN', 'GSP-RAYONG'] },
  { routeId: 'ROUTE-PLATHONG-ERAWAN', fromId: 'PLATHONG', toIds: ['ERAWAN'] },
  { routeId: 'ROUTE-SATUN-ERAWAN', fromId: 'SATUN', toIds: ['ERAWAN'] },
  { routeId: 'ROUTE-FUNAN-ERAWAN', fromId: 'FUNAN', toIds: ['ERAWAN'] },
  { routeId: 'ROUTE-JDA-CHANA', fromId: 'JDA-MTJA', toIds: ['GSP-CHANA'] },
  { routeId: 'ROUTE-SINPHUHORM-NP', fromId: 'SINPHUHORM', toIds: ['GATE-EGAT-NP'] },
  { routeId: 'ROUTE-NAMPHONG-NP', fromId: 'NAMPHONG', toIds: ['GATE-EGAT-NP'] },
  { routeId: 'ROUTE-S1-RAIL', fromId: 'SIRIKIT-S1', toIds: ['REF-BCP'] },
  { routeId: 'ROUTE-FANG-PIPE', fromId: 'FANG', toIds: ['REF-FANG'] },
  { routeId: 'ROUTE-UTHONG-TRUCK', fromId: 'UTHONG', toIds: ['REF-BCP'] },
  { routeId: 'ROUTE-KPS-TRUCK', fromId: 'KAMPHAENGSAEN', toIds: ['REF-BCP'] },
  { routeId: 'ROUTE-WICHIAN-TRUCK', fromId: 'WICHIANBURI', toIds: ['REF-BCP', 'REF-IRPC'] },
  { routeId: 'ROUTE-BENCHAMAS-SPM', fromId: 'BENCHAMAS', toIds: ['REF-TOP', 'REF-SPRC'] },
  { routeId: 'ROUTE-JASMINE-SPM', fromId: 'JASMINE', toIds: ['REF-TOP', 'REF-BSRC'] },
  { routeId: 'ROUTE-NONGYAO-SPM', fromId: 'NONGYAO', toIds: ['REF-SPRC'] },
  { routeId: 'ROUTE-BUALUANG-IRPC', fromId: 'BUALUANG', toIds: ['REF-IRPC'] },
  { routeId: 'ROUTE-SONGKHLA-SPM', fromId: 'SONGKHLA', toIds: ['REF-TOP', 'REF-BSRC'] },
  { routeId: 'ROUTE-WASANA-SPM', fromId: 'WASANA', toIds: ['REF-TOP', 'REF-BSRC'] },
  { routeId: 'ROUTE-NANGNUAN-IRPC', fromId: 'NANGNUAN', toIds: ['REF-IRPC'] },
  { routeId: 'ROUTE-BUENGYA-SIRIKIT', fromId: 'BUENG-YA', toIds: ['SIRIKIT-S1'] },
  { routeId: 'ROUTE-NASANUN-WICHIAN', fromId: 'NASANUN', toIds: ['WICHIANBURI'] },
  { routeId: 'ROUTE-GSP-PTTGC', fromId: 'GSP-RAYONG', toIds: ['REF-PTTGC'] },
  { routeId: 'ROUTE-TOP-BSRC', fromId: 'REF-TOP', toIds: ['REF-BSRC'] },
  // Downstream connections (SRC-064..072)
  { routeId: 'ROUTE-THAPPLINE-MAIN', fromId: 'REF-TOP', toIds: ['DEPOT-SARABURI', 'DEPOT-LAMLUKKA'] },
  { routeId: 'ROUTE-THAPPLINE-BKK-AIR', fromId: 'DEPOT-LAMLUKKA', toIds: ['AIR-SUVARNABHUMI'] },
  { routeId: 'ROUTE-FPT-BKK-BPI', fromId: 'REF-BCP', toIds: ['AIR-DONMUEANG'] },
  { routeId: 'ROUTE-PTT-RAYONG-BANGPAKONG', fromId: 'GSP-RAYONG', toIds: ['EGAT-BANGPAKONG'] },
  { routeId: 'ROUTE-PTT-BANGPAKONG-SOUTHBKK', fromId: 'EGAT-BANGPAKONG', toIds: ['EGAT-SOUTH-BKK'] },
  { routeId: 'ROUTE-PTT-BANGPAKONG-WANGNOI', fromId: 'EGAT-BANGPAKONG', toIds: ['EGAT-WANG-NOI'] },
  { routeId: 'ROUTE-PTT-RAYONG-GULFPD', fromId: 'GSP-RAYONG', toIds: ['IPP-GULF-PD'] },
  { routeId: 'ROUTE-CHANA-GSP-EGAT', fromId: 'GSP-CHANA', toIds: ['EGAT-CHANA'] },
  { routeId: 'ROUTE-GSP-PETCHEM-PTTGC', fromId: 'GSP-RAYONG', toIds: ['PETCHEM-PTTGC'] },
  { routeId: 'ROUTE-GSP-PETCHEM-SCGC', fromId: 'GSP-RAYONG', toIds: ['PETCHEM-SCGC'] }
];

interface GraphEdge {
  toAssetId: string;
  route: TransmissionRoute;
  distanceKm: number;
}

const buildAdjacencyList = (bidirectional: boolean): Map<string, GraphEdge[]> => {
  const adj = new Map<string, GraphEdge[]>();
  const routeMap = new Map<string, TransmissionRoute>();
  transmissionRoutes.forEach(r => routeMap.set(r.id, r));

  const addEdge = (u: string, v: string, route: TransmissionRoute) => {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u)!.push({
      toAssetId: v,
      route,
      distanceKm: route.distanceKm || 10
    });
  };

  ROUTE_CONNECTIONS.forEach(conn => {
    const route = routeMap.get(conn.routeId);
    if (!route) return;

    conn.toIds.forEach(toId => {
      addEdge(conn.fromId, toId, route);
      if (bidirectional) {
        addEdge(toId, conn.fromId, route);
      }
    });
  });

  return adj;
};

const directedAdjacency = buildAdjacencyList(false);
const bidirectionalAdjacency = buildAdjacencyList(true);

const assetMap = new Map<string, InfrastructureAsset>();
infrastructureAssets.forEach(a => assetMap.set(a.id, a));

/**
 * Finds optimal (shortest distance) path between two assets using Dijkstra
 */
export function findPath(
  startAssetId: string,
  endAssetId: string,
  options: { allowBidirectional?: boolean } = {}
): PathResult | null {
  if (startAssetId === endAssetId) return null;

  const startAsset = assetMap.get(startAssetId);
  const endAsset = assetMap.get(endAssetId);
  if (!startAsset || !endAsset) return null;

  const adj = (options.allowBidirectional ?? true) ? bidirectionalAdjacency : directedAdjacency;

  // Dijkstra data structures
  const distances = new Map<string, number>();
  const previous = new Map<string, { fromId: string; route: TransmissionRoute }>();
  const visited = new Set<string>();

  distances.set(startAssetId, 0);

  const getMinDistanceNode = (): string | null => {
    let minNode: string | null = null;
    let minDist = Infinity;
    for (const [node, dist] of distances.entries()) {
      if (!visited.has(node) && dist < minDist) {
        minDist = dist;
        minNode = node;
      }
    }
    return minNode;
  };

  while (true) {
    const currNode = getMinDistanceNode();
    if (!currNode) break;
    if (currNode === endAssetId) break;

    visited.add(currNode);
    const currDist = distances.get(currNode)!;

    const neighbors = adj.get(currNode) || [];
    for (const edge of neighbors) {
      if (visited.has(edge.toAssetId)) continue;

      const newDist = currDist + edge.distanceKm;
      const prevDist = distances.get(edge.toAssetId) ?? Infinity;

      if (newDist < prevDist) {
        distances.set(edge.toAssetId, newDist);
        previous.set(edge.toAssetId, { fromId: currNode, route: edge.route });
      }
    }
  }

  // If no path was found
  if (!previous.has(endAssetId)) {
    return null;
  }

  // Reconstruct path
  const nodes: InfrastructureAsset[] = [];
  const routes: TransmissionRoute[] = [];
  const legs: PathLeg[] = [];

  let currentId = endAssetId;
  while (currentId !== startAssetId) {
    const prevInfo = previous.get(currentId);
    if (!prevInfo) break;

    const currentAsset = assetMap.get(currentId)!;
    const fromAsset = assetMap.get(prevInfo.fromId)!;
    const route = prevInfo.route;

    nodes.unshift(currentAsset);
    routes.unshift(route);

    const dist = route.distanceKm || 0;
    const energy = fromAsset.energyMjPerFu || 0;
    const ghg = fromAsset.ghgKgCo2ePerFu || 0;

    legs.unshift({
      fromAsset,
      toAsset: currentAsset,
      route,
      distanceKm: dist,
      energyMj: energy,
      ghgKgCo2e: ghg
    });

    currentId = prevInfo.fromId;
  }
  nodes.unshift(startAsset);

  const totalDistanceKm = legs.reduce((acc, l) => acc + l.distanceKm, 0);
  const totalEnergyMj = legs.reduce((acc, l) => acc + l.energyMj, 0);
  const totalGhgKgCo2e = legs.reduce((acc, l) => acc + l.ghgKgCo2e, 0);
  const modes = Array.from(new Set(routes.map(r => r.mode)));

  return {
    nodes,
    routes,
    legs,
    totalDistanceKm,
    totalEnergyMj,
    totalGhgKgCo2e,
    modes,
    startAsset,
    endAsset
  };
}

/**
 * Common preset routes that showcase key national energy corridors
 */
export const PRESET_ROUTES = [
  {
    id: 'fu1-diesel-corridor',
    labelTh: 'FU-1 ดีเซล: แหล่งเบญจมาศ ➔ ไทยออยล์ ➔ ท่อ Thappline ➔ คลังสระบุรี',
    labelEn: 'FU-1 Diesel: Benchamas FSO ➔ Thai Oil ➔ Thappline ➔ Saraburi Depot',
    fromId: 'BENCHAMAS',
    toId: 'DEPOT-SARABURI',
    badge: 'FU-1 Cradle-to-Grave Diesel'
  },
  {
    id: 'fu2-gas-power',
    labelTh: 'FU-2 ไฟฟ้า: บงกชใต้ ➔ โรงแยกก๊าซระยอง ➔ ท่อ ปตท. ➔ กฟผ. บางปะกง (3,248 MW)',
    labelEn: 'FU-2 Power: Bongkot South ➔ Rayong GSP ➔ PTT 2nd Line ➔ EGAT Bang Pakong',
    fromId: 'BONGKOT-SOUTH',
    toId: 'EGAT-BANGPAKONG',
    badge: 'FU-2 Gas to Power (0.596 kg/kWh)'
  },
  {
    id: 'fu3-petchem-gc',
    labelTh: 'FU-3 ปิโตรเคมี: แหล่งอาทิตย์ ➔ โรงแยกก๊าซระยอง ➔ โอเลฟินส์ PTTGC',
    labelEn: 'FU-3 Petchem: Arthit ➔ Rayong GSP ➔ PTTGC Olefins Complex',
    fromId: 'ARTHIT',
    toId: 'PETCHEM-PTTGC',
    badge: 'FU-3 Petrochemical Feedstock'
  },
  {
    id: 'aviation-jet-flow',
    labelTh: 'การบิน: โรงกลั่นบางจาก ➔ ท่อ FPT ➔ คลังน้ำมันอากาศยานดอนเมือง BAFS',
    labelEn: 'Aviation: Bangchak ➔ FPT Pipeline ➔ Don Mueang BAFS Depot',
    fromId: 'REF-BCP',
    toId: 'AIR-DONMUEANG',
    badge: 'BAFS Jet A-1 Fuel System'
  },
  {
    id: 'bongkot-rayong-gc',
    labelTh: 'อ่าวไทย: บงกชใต้ ➔ ระยอง GSP ➔ PTTGC',
    labelEn: 'Gulf Gas: Bongkot South ➔ Rayong GSP ➔ PTTGC',
    fromId: 'BONGKOT-SOUTH',
    toId: 'REF-PTTGC',
    badge: 'Subsea Gas + Condensate'
  },
  {
    id: 'sirikit-bcp',
    labelTh: 'ภาคเหนือ: แหล่งสิริกิติ์ ➔ รถไฟ SRT ➔ บางจาก',
    labelEn: 'Northern Crude: Sirikit ➔ Dedicated Rail ➔ Bangchak',
    fromId: 'SIRIKIT-S1',
    toId: 'REF-BCP',
    badge: 'Crude Freight Train'
  },
  {
    id: 'sinphuhorm-egat',
    labelTh: 'อีสาน: สินภูฮ่อม ➔ โรงไฟฟ้าน้ำพอง EGAT',
    labelEn: 'Isan Gas: Sinphuhorm ➔ EGAT Nam Phong Power',
    fromId: 'SINPHUHORM',
    toId: 'GATE-EGAT-NP',
    badge: 'Onshore Gas Pipeline'
  },
  {
    id: 'benchamas-top',
    labelTh: 'อ่าวไทย: เบญจมาศ FSO ➔ เรือขนส่ง ➔ ไทยออยล์',
    labelEn: 'Offshore Crude: Benchamas FSO ➔ Tanker ➔ Thai Oil',
    fromId: 'BENCHAMAS',
    toId: 'REF-TOP',
    badge: 'Marine Coastal Tanker'
  },
  {
    id: 'nasanun-irpc',
    labelTh: 'วิเชียรบุรี: นาเสนุน ➔ รถบรรทุก ➔ ไออาร์พีซี',
    labelEn: 'Central Basin: Na Sanun ➔ Road Tanker ➔ IRPC Rayong',
    fromId: 'NASANUN',
    toId: 'REF-IRPC',
    badge: 'Onshore Road Tanker'
  }
];
