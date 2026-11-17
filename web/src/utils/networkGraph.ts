import type { InfrastructureAsset } from '../types/asset';
import type { TransmissionRoute, RouteMode } from '../types/route';

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

export interface RouteConnection {
  routeId: string;
  fromId: string;
  toIds: string[];
}

export interface RoutePreset {
  id: string;
  labelTh: string;
  labelEn: string;
  fromId: string;
  toId: string;
  badge: string;
}

interface GraphEdge {
  toAssetId: string;
  route: TransmissionRoute;
  distanceKm: number;
}

function buildAdjacencyList(
  assets: InfrastructureAsset[],
  routes: TransmissionRoute[],
  connections: RouteConnection[],
  bidirectional: boolean
): Map<string, GraphEdge[]> {
  const assetIds = new Set(assets.map((asset) => asset.id));
  const routeMap = new Map(routes.map((route) => [route.id, route]));
  const adjacency = new Map<string, GraphEdge[]>();
  const addEdge = (fromId: string, toId: string, route: TransmissionRoute) => {
    if (!assetIds.has(fromId) || !assetIds.has(toId)) return;
    const edges = adjacency.get(fromId) ?? [];
    edges.push({ toAssetId: toId, route, distanceKm: route.distanceKm || 10 });
    adjacency.set(fromId, edges);
  };

  for (const connection of connections) {
    const route = routeMap.get(connection.routeId);
    if (!route) continue;
    for (const toId of connection.toIds) {
      addEdge(connection.fromId, toId, route);
      if (bidirectional) addEdge(toId, connection.fromId, route);
    }
  }
  return adjacency;
}

/** Find a shortest path using route and topology records loaded from the data catalog. */
export function findPath(
  startAssetId: string,
  endAssetId: string,
  graph: { assets: InfrastructureAsset[]; routes: TransmissionRoute[]; connections: RouteConnection[] },
  options: { allowBidirectional?: boolean } = {}
): PathResult | null {
  if (startAssetId === endAssetId) return null;
  const assetMap = new Map(graph.assets.map((asset) => [asset.id, asset]));
  const startAsset = assetMap.get(startAssetId);
  const endAsset = assetMap.get(endAssetId);
  if (!startAsset || !endAsset) return null;

  const adjacency = buildAdjacencyList(
    graph.assets,
    graph.routes,
    graph.connections,
    options.allowBidirectional ?? true
  );
  const distances = new Map<string, number>([[startAssetId, 0]]);
  const previous = new Map<string, { fromId: string; route: TransmissionRoute }>();
  const visited = new Set<string>();

  const getMinDistanceNode = (): string | null => {
    let minNode: string | null = null;
    let minDistance = Infinity;
    for (const [node, distance] of distances.entries()) {
      if (!visited.has(node) && distance < minDistance) {
        minDistance = distance;
        minNode = node;
      }
    }
    return minNode;
  };

  while (true) {
    const currentId = getMinDistanceNode();
    if (!currentId) break;
    if (currentId === endAssetId) break;
    visited.add(currentId);
    const currentDistance = distances.get(currentId)!;
    for (const edge of adjacency.get(currentId) ?? []) {
      if (visited.has(edge.toAssetId)) continue;
      const newDistance = currentDistance + edge.distanceKm;
      if (newDistance < (distances.get(edge.toAssetId) ?? Infinity)) {
        distances.set(edge.toAssetId, newDistance);
        previous.set(edge.toAssetId, { fromId: currentId, route: edge.route });
      }
    }
  }
  if (!previous.has(endAssetId)) return null;

  const nodes: InfrastructureAsset[] = [];
  const pathRoutes: TransmissionRoute[] = [];
  const legs: PathLeg[] = [];
  let currentId = endAssetId;
  while (currentId !== startAssetId) {
    const previousNode = previous.get(currentId);
    const currentAsset = assetMap.get(currentId);
    const fromAsset = previousNode && assetMap.get(previousNode.fromId);
    if (!previousNode || !currentAsset || !fromAsset) return null;
    const route = previousNode.route;
    nodes.unshift(currentAsset);
    pathRoutes.unshift(route);
    legs.unshift({
      fromAsset,
      toAsset: currentAsset,
      route,
      distanceKm: route.distanceKm || 0,
      energyMj: fromAsset.energyMjPerFu || 0,
      ghgKgCo2e: fromAsset.ghgKgCo2ePerFu || 0,
    });
    currentId = previousNode.fromId;
  }
  nodes.unshift(startAsset);

  return {
    nodes,
    routes: pathRoutes,
    legs,
    totalDistanceKm: legs.reduce((total, leg) => total + leg.distanceKm, 0),
    totalEnergyMj: legs.reduce((total, leg) => total + leg.energyMj, 0),
    totalGhgKgCo2e: legs.reduce((total, leg) => total + leg.ghgKgCo2e, 0),
    modes: Array.from(new Set(pathRoutes.map((route) => route.mode))),
    startAsset,
    endAsset,
  };
}
