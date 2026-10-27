import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const ArenaDemoPage = lazy(() =>
  import('./routes/ArenaDemoPage').then((m) => ({ default: m.ArenaDemoPage })),
);
const SpikePage = lazy(() => import('./routes/SpikePage').then((m) => ({ default: m.SpikePage })));
const LabPage = lazy(() => import('./routes/LabPage').then((m) => ({ default: m.LabPage })));
const App = lazy(() => import('./ui/App').then((m) => ({ default: m.App })));

function Router() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  switch (path) {
    case '/spike':
      return <SpikePage />;
    case '/sim-debug':
      return <ArenaDemoPage debug />;
    case '/demo':
      return <ArenaDemoPage />;
    case '/lab':
      return <LabPage />;
    default:
      return <App />;
  }
}

// Test hook (?test=1): run the hand model on a still image (verifies shapes on real model output).
if (new URLSearchParams(window.location.search).has('test')) {
  (window as unknown as Record<string, unknown>).__ffVision = {
    classify: async (url: string) =>
      (await import('./input/camera/vision-image')).classifyImage(url),
  };
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <Suspense fallback={<div className="boot">FRACTURE FIELD</div>}>
      <Router />
    </Suspense>
  </StrictMode>,
);
