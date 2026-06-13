import { useState, useCallback, useRef, useEffect } from 'react';
import { AppProvider } from './store/AppContext';
import { Sidebar, type SidebarMode } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { TopBar } from './components/TopBar';
import { Toast, ConnectionBanner } from './components/Toast';

function AppLayout() {
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('expanded');
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleCollapse = useCallback(() => setSidebarMode('collapsed'), []);
  const handleExpand = useCallback(() => setSidebarMode('expanded'), []);

  const handleHotZoneEnter = useCallback(() => {
    setSidebarMode('floating');
  }, []);

  const handleFloatingMouseEnter = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  const handleFloatingMouseLeave = useCallback(() => {
    hideTimerRef.current = setTimeout(() => {
      setSidebarMode('collapsed');
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return (
    <div className="h-full flex gap-3 overflow-hidden bg-[var(--app-bg)] p-3 text-[var(--app-text)]">
      {sidebarMode === 'collapsed' && (
        <div
          className="fixed left-0 top-0 h-full w-[5px] z-40 cursor-pointer"
          onMouseEnter={handleHotZoneEnter}
        />
      )}

      {sidebarMode === 'floating' && (
        <div
          className="fixed inset-0 z-30 bg-black/30 transition-opacity"
          onClick={() => setSidebarMode('collapsed')}
        />
      )}

      <Sidebar
        mode={sidebarMode}
        onCollapse={handleCollapse}
        onExpand={handleExpand}
        onFloatingMouseEnter={handleFloatingMouseEnter}
        onFloatingMouseLeave={handleFloatingMouseLeave}
      />

      <div
        className="flex-1 flex min-h-0 flex-col min-w-0 overflow-hidden rounded-xl"
        style={{ backgroundColor: 'var(--panel-bg)', border: '0.5px solid var(--app-border)' }}
      >
        <TopBar />
        <ConnectionBanner />
        <ChatArea />
      </div>
      <Toast />
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <AppLayout />
    </AppProvider>
  );
}

export default App;
