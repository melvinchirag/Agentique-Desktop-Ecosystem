import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(null);
window.ade.onEvent(event => console.debug('[overlay]', event.type));
