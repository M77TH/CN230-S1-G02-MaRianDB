import React from 'react';
import {
  ClipboardList,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  Server
} from 'lucide-react';

export type ActiveTab = 'pipeline' | 'registry';

interface HeaderCommandBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const NAV_ITEMS: {
  id: ActiveTab;
  label: string;
  sub: string;
  icon: React.ComponentType<{ size?: number }>;
}[] = [
  { id: 'pipeline', label: 'ขั้นตอนข้อมูล', sub: 'Run · Steps · SQL', icon: GitBranch },
  { id: 'registry', label: 'ทะเบียนแหล่งข้อมูล', sub: 'SRC · หลักฐานประกอบ', icon: ClipboardList }
];

export const HeaderCommandBar: React.FC<HeaderCommandBarProps> = ({
  activeTab,
  onTabChange,
  isCollapsed,
  onToggleCollapse
}) => {
  return (
    <aside
      className={`left-nav-sidebar ${isCollapsed ? 'collapsed' : ''}`}
      aria-label="เมนูหลัก CN230"
    >
      <div className="sidebar-header">
        <button
          type="button"
          className="brand-lockup"
          onClick={() => onTabChange('pipeline')}
          title="ไปหน้าขั้นตอนข้อมูล CN230"
          aria-label="ไปหน้าขั้นตอนข้อมูล CN230"
        >
          <span className="brand-mark" aria-hidden="true">
            <Server size={17} />
          </span>
          <span className="brand-copy" aria-hidden={isCollapsed}>
            <strong>CN230</strong>
            <small>PETROLEUM LCI · G02</small>
          </span>
        </button>

      </div>

      <nav className="sidebar-nav" role="tablist" aria-label="ส่วนต่าง ๆ ของระบบ">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-label={item.label}
              aria-selected={isActive}
              aria-controls="workspace-view"
              className={`sidebar-nav-btn ${isActive ? 'active' : ''}`}
              onClick={() => onTabChange(item.id)}
              title={`${item.label} · ${item.sub}`}
              data-tooltip={item.label}
            >
              <span className="sidebar-nav-icon" aria-hidden="true">
                <Icon size={17} />
              </span>
              {!isCollapsed && (
                <span className="sidebar-nav-text">
                  <span className="sidebar-nav-title">{item.label}</span>
                  <span className="sidebar-nav-sub">{item.sub}</span>
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู'}
          title={isCollapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู'}
        >
          <span
            key={isCollapsed ? 'collapsed' : 'expanded'}
            className={`sidebar-collapse-icon ${isCollapsed ? 'collapsed' : 'expanded'}`}
            aria-hidden="true"
          >
            {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </span>
          <span className="sidebar-collapse-copy" aria-hidden={isCollapsed}>ย่อแถบเมนู</span>
        </button>
      </div>
    </aside>
  );
};
