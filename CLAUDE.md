# NetCheck — règles du projet

Appli Expo (SDK 58) Android + web (PC) de contrôle de la connexion internet d'Etienne (opérateur VOO, Belgique).
Propriétaire : Etienne (non-développeur, travaille depuis son téléphone). Répondre en français, simplement.
Une question (« tu sais faire X ? ») n'est pas un feu vert : répondre et demander avant de construire.

## Compilation
- APK : GitHub Actions (`.github/workflows/android.yml`) → `expo prebuild` + `gradlew assembleRelease` (signé avec la clé debug du modèle),
  publié dans la Release `android` (NetCheck.apk). Pas d'Expo/EAS, pas de mise à jour OTA : chaque modif = nouvel APK à réinstaller.
- PC : GitHub Pages (`.github/workflows/web.yml`), `experiments.baseUrl` = `/NetCheck`.
- Je ne vois pas les GitHub Actions depuis ma session : demander à Etienne l'onglet Actions en cas de doute.

## Vérifs avant push
- `npx tsc --noEmit`
- `npx expo export --platform web --output-dir /tmp/nc-web` et `EXPO_OFFLINE=1 npx expo export --platform android --output-dir /tmp/nc-and`

## Repères
- Moteur : src/engine.ts (sonde chaque seconde, minutes, coupures, tests de débit). Réseau : src/net.ts.
- Données : src/storage.ts (AsyncStorage, une fiche par jour, minutes = tableau compact). Bilans / verdict : src/analysis.ts.
- Écran éteint (Android) : module natif local `modules/netcheck-background` (service de premier plan + verrous CPU/Wi-Fi,
  tâche JS « NetCheckKeepAlive »), piloté par src/background.ts. Donne aussi la passerelle (box) et le type de réseau.
- Web : sondes en `no-cors`, horloge dans un Web Worker (pas ralentie en arrière-plan), box non testable.
