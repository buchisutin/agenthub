import { AppProvider } from './store/AppContext';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { TopBar } from './components/TopBar';
import { Toast, ConnectionBanner } from './components/Toast';

function AppLayout() {
  return (
    <div className="h-full flex gap-3 overflow-hidden bg-[var(--app-bg)] p-3 text-[var(--app-text)]">
      <Sidebar />
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
