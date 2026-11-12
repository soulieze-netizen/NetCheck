import { registerRootComponent } from 'expo';

import App from './App';
import { registerBackgroundTask } from './src/background';

// Tâche qui garde la mesure active écran éteint (Android)
registerBackgroundTask();

registerRootComponent(App);
