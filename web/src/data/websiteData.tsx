import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { RouteConnection, RoutePreset } from '../utils/networkGraph';

export interface WebsiteCatalog {
  schemaVersion: string;
  generatedAt: string;
  catalogSource: string;
  lineageMethod: string;
  lineage: Array<{
    dataset: string;
    recordCount: number;
    recordsWithSourceId: number;
    recordsWithUrl: number;
    recordsWithNamedReference: number;
    recordsWithRelatedRecord: number;
    unlinkedCount: number;
    unlinkedRecordIds: string[];
  }>;
  provenance: Record<string, string>;
  artifact?: { path: string; sha256: string; modifiedAt: string };
  data: {
    assets: typeof import('./infrastructureAssets').infrastructureAssets;
    routes: typeof import('./transmissionRoutes').transmissionRoutes;
    routeConnections: RouteConnection[];
    routePresets: RoutePreset[];
    downstream: {
      coastalTankerCorridors: typeof import('./thailandDownstreamData').COASTAL_TANKER_CORRIDORS;
      depotClusters: typeof import('./thailandDownstreamData').DOEB_REGIONAL_CLUSTERS;
      provinceData: typeof import('./thailandDownstreamData').PROVINCE_DOWNSTREAM_DATA;
      summary: typeof import('./thailandDownstreamData').DOWNSTREAM_SUMMARY;
    };
    lciModel: {
      functionalUnitConfigs: typeof import('./lciMasterDataset').functionalUnitConfigs;
      exchanges: typeof import('./lciMasterDataset').lciExchanges;
      nationalPetroleumBalance: typeof import('./lciMasterDataset').nationalPetroleumBalance;
      otherProducts: typeof import('./lciMasterDataset').otherProductsLci;
      processChainItems: typeof import('./lciMasterDataset').processChainItems;
      benchmarkComparisons: typeof import('../components/dashboard/dashboardData').BENCHMARK_COMPARISONS;
      functionalUnitPathways: typeof import('../components/dashboard/dashboardData').FU_PATHWAYS;
      gasSpeciation: typeof import('../components/dashboard/dashboardData').GAS_SPECIATION_DATA;
      hotspotCards: typeof import('../components/dashboard/dashboardData').HOTSPOT_CARDS;
      isoAuditPhases: typeof import('../components/dashboard/dashboardData').ISO_AUDIT_PHASES;
      scopeSplitByFunctionalUnit: typeof import('../components/dashboard/dashboardData').SCOPE_SPLIT_BY_FU;
      supplyChainStages: typeof import('../components/dashboard/dashboardData').SUPPLY_CHAIN_STAGES;
      simulatorSpecs: Record<string, any>;
    };
    processDashboard: typeof import('./processDashboardData.json') & {
      functionalUnits: Record<string, { title: string; label: string; unit: string; linkedProcesses: string[]; note: string }>;
      lifecycleLanes: Array<{ id: number; title: string; range: string }>;
    };
    pipelineSteps: typeof import('./pipelineSteps').pipelineSteps;
    mapJoins: typeof import('./pipelineMapJoins').pipelineMapJoins;
    mapConfig: {
      heatmapLegends: Record<string, Record<string, {
        title: string; unit: string; min: number; max: number; source: string; sourceIds: string[];
        stops: Array<{ color: string; label: string }>;
      }>>;
    };
    sourceCards: typeof import('./comprehensiveSources').comprehensiveSources;
    tsrcEvidence: Array<Record<string, unknown>>;
    validatedDatasets: {
      productionRecords: typeof import('./validatedDatasets').validatedProductionRecords;
      refineryRecords: typeof import('./validatedDatasets').validatedRefineryRecords;
    };
  };
}

interface WebsiteDataState {
  catalog: WebsiteCatalog | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

const WebsiteDataContext = createContext<WebsiteDataState | null>(null);

export const WebsiteDataProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [catalog, setCatalog] = useState<WebsiteCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(import.meta.env.BASE_URL + 'web_catalog.json', { headers: { Accept: 'application/json' } }),
      fetch(import.meta.env.BASE_URL + 'presentation_manifest.json', { headers: { Accept: 'application/json' } }),
    ])
      .then(async ([catalogResponse, manifestResponse]) => {
        const payload = await catalogResponse.json();
        const manifest = await manifestResponse.json();
        if (!catalogResponse.ok || !manifestResponse.ok) throw new Error('Could not load the saved website data package.');
        if (!payload?.data || !payload?.lineage || !payload?.provenance) {
          throw new Error('The project data catalog is missing lineage metadata.');
        }
        payload.artifact = manifest.catalogArtifact;
        return payload as WebsiteCatalog;
      })
      .then((payload) => {
        if (cancelled) return;
        setCatalog(payload);
        setError('');
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load the static web/data package.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [requestVersion]);

  const state = useMemo<WebsiteDataState>(() => ({
    catalog,
    loading,
    error,
    reload: () => setRequestVersion((version) => version + 1),
  }), [catalog, loading, error]);

  return <WebsiteDataContext.Provider value={state}>{children}</WebsiteDataContext.Provider>;
};

export function useWebsiteData(): WebsiteDataState {
  const context = useContext(WebsiteDataContext);
  if (!context) throw new Error('useWebsiteData must be used inside WebsiteDataProvider.');
  return context;
}
