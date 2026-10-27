import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const ArenaDemoPage = lazy(() =>
  import('./routes/ArenaDemoPage').then((m) => ({ default: m.ArenaDemoPage })),
);
const SpikePage = lazy(() => import('./routes/SpikePage').then((m) => ({ default: m.SpikePage })));

function Router() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  switch (path) {
    case '/spike':
      return <SpikePage />;
    case '/sim-debug':
      return <ArenaDemoPage debug />;
    default:
      return <ArenaDemoPage />;
  }
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
