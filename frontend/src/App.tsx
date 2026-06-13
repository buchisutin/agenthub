import { AppProvider } from './store/AppContext';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { TopBar } from './components/TopBar';
import { Toast, ConnectionBanner } from './components/Toast';

function AppLayout() {
  return (
    <div className="h-full flex overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)]">
      <Sidebar />
      <div className="flex-1 flex min-h-0 flex-col min-w-0">
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
