import React from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentBuilderView } from '../../../src/DocumentBuilderView';
import { Library } from '../../../src/Library';
import '../../../src/App.css';

const params = new URLSearchParams(location.search);
const kind = params.get('kind') === 'manual' ? 'manual' : 'sop';
createRoot(document.getElementById('root')!).render(<React.StrictMode>
  {params.get('view') === 'library' ? <Library /> :
    <div className="workflow-workspace" style={{ height: '100dvh' }}><div className="workflow-stage">
      <DocumentBuilderView sessionId="synthetic-recording" kind={kind} sourceConfirmed={params.get('confirmed') === '1'} onClose={() => {}} />
    </div></div>}
</React.StrictMode>);
