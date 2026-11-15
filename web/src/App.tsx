import React, { useState } from 'react';
import { HeaderCommandBar, ActiveTab } from './components/layout/HeaderCommandBar';
import { ThailandMap } from './components/map/ThailandMap';
import { ProcessLifecycleDashboard } from './components/dashboard/ProcessLifecycleDashboard';
import { PipelineStoryView } from './components/pipeline/PipelineStoryView';
import { DataExplorerView } from './components/explorer/DataExplorerView';
import { SourceRegistryView } from './components/registry/SourceRegistryView';
import './styles/index.css';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('map');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(true);

  return (
    <div className="app-container">
      <HeaderCommandBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
      />

      {/* Main Content Area (Tab Driven) */}
      <main
        className={`main-content view-${activeTab}`}
        id="workspace-view"
        role="tabpanel"
        aria-label={
          activeTab === 'map'
            ? 'แผนที่ระบบพลังงานไทย'
            : activeTab === 'dashboard'
              ? 'แดชบอร์ดวิเคราะห์ LCI'
              : activeTab === 'pipeline'
                ? 'ขั้นตอนการประมวลผลข้อมูล'
                : activeTab === 'explorer'
                  ? 'สำรวจชุดข้อมูล'
                  : 'ทะเบียนแหล่งข้อมูลโครงการ'
        }
      >
        {activeTab === 'map' && <ThailandMap />}
        {activeTab === 'dashboard' && (
          <div className="dashboard-scroll-shell">
            <ProcessLifecycleDashboard onScrollToTop={() => setActiveTab('map')} />
          </div>
        )}
        {activeTab === 'pipeline' && <PipelineStoryView />}
        {activeTab === 'explorer' && <DataExplorerView />}
        {activeTab === 'registry' && <SourceRegistryView />}
      </main>
    </div>
  );
};
