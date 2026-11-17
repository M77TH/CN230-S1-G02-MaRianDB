import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { HeaderCommandBar, ActiveTab } from './components/layout/HeaderCommandBar';
import { useWebsiteData, WebsiteDataProvider } from './data/websiteData';
import './styles/index.css';

const SourceRegistryView = lazy(() => import('./components/registry/SourceRegistryView').then((module) => ({ default: module.SourceRegistryView })));
const PipelineStoryView = lazy(() => import('./components/pipeline/PipelineStoryView').then((module) => ({ default: module.PipelineStoryView })));
const DataExplorerView = lazy(() => import('./components/explorer/DataExplorerView').then((module) => ({ default: module.DataExplorerView })));

const AppShell: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('pipeline');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(true);
  const [registrySourceId, setRegistrySourceId] = useState<string>();
  const { catalog, loading, error, reload } = useWebsiteData();

  useEffect(() => {
    const pageShortcuts: ActiveTab[] = ['pipeline', 'registry', 'explorer'];
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable ||
        target.closest('input, textarea, select, [role="textbox"]')
      )) return;

      if (!event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const currentIndex = pageShortcuts.indexOf(activeTab);
        const nextIndex = currentIndex + (event.key === 'ArrowDown' ? 1 : -1);
        if (nextIndex >= 0 && nextIndex < pageShortcuts.length) {
          event.preventDefault();
          setActiveTab(pageShortcuts[nextIndex]);
        }
        return;
      }

      const number = Number(event.key);
      if (number >= 1 && number <= pageShortcuts.length) {
        setActiveTab(pageShortcuts[number - 1]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab]);

  const openRegistry = useCallback((sourceId?: string) => {
    setRegistrySourceId(sourceId);
    setActiveTab('registry');
  }, []);

  return (
    <div className="app-container">
      <HeaderCommandBar
        activeTab={activeTab}
        onTabChange={(tab) => tab === 'registry' ? openRegistry() : setActiveTab(tab)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
      />

      {/* Main Content Area (Tab Driven) */}
      <main
        className={`main-content view-${activeTab}`}
        id="workspace-view"
        role="tabpanel"
        aria-label={activeTab === 'pipeline' ? 'ขั้นตอนการประมวลผลข้อมูล' : activeTab === 'registry' ? 'ทะเบียนแหล่งข้อมูลโครงการ' : 'สำรวจข้อมูล'}
      >
        {loading && !catalog && <div className="website-data-state" role="status"><strong>Loading saved project data</strong><span>Reading the packaged catalog and lineage from web/data/.</span></div>}
        {error && !catalog && <div className="website-data-state is-error" role="alert"><strong>Saved website data could not be loaded</strong><span>{error}</span><button type="button" onClick={reload}>Retry</button></div>}
        {catalog && <Suspense fallback={<div className="website-data-state" role="status">กำลังโหลดมุมมอง…</div>}>
          {activeTab === 'pipeline' && <PipelineStoryView />}
          {activeTab === 'registry' && (
            <SourceRegistryView
              sourceId={registrySourceId}
              onClearSource={() => setRegistrySourceId(undefined)}
            />
          )}
          {activeTab === 'explorer' && <DataExplorerView />}
        </Suspense>}
      </main>
    </div>
  );
};

export const App: React.FC = () => <WebsiteDataProvider><AppShell /></WebsiteDataProvider>;
