import { render } from 'preact';
import { App } from './ui/App';
import { toast } from './ui/services';
import './ui/styles/base.css';
import './ui/styles/reader.css';
import './ui/styles/mobile.css';

render(<App />, document.getElementById('app')!);

// Spec 12: the service worker updates itself (autoUpdate). The page keeps running the old code
// until it reloads, so say so instead of reloading mid-sentence. The first install also changes
// the controller; that one is not an update.
if ('serviceWorker' in navigator) {
  const hadController = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('Update available. Reload the app to use the new version.');
  });
}
