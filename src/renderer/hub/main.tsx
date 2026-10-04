import { createRoot } from 'react-dom/client';
import { createHubStore } from '../shell/hubStore';
import { HubApp } from './HubApp';

const store = createHubStore();
void window.ade.getSettings().then(settings => store.getState().setSettings(settings));
window.ade.onEvent(event => store.getState().applyEvent(event));
createRoot(document.getElementById('root')!).render(<HubApp store={store} api={window.ade} shell={window.adeShell} />);
