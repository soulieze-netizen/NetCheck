# NetCheck — règles du projet

Appli Expo (SDK 58) Android + web (PC) de contrôle de la connexion internet d'Etienne (opérateur VOO, Belgique).
Propriétaire : Etienne (non-développeur, travaille depuis son téléphone). Répondre en français, simplement.
Une question (« tu sais faire X ? ») n'est pas un feu vert : répondre et demander avant de construire.

## Compilation
- APK : GitHub Actions (`.github/workflows/android.yml`) → `expo prebuild` + `gradlew assembleRelease` (signé avec la clé debug du modèle),
  publié dans la Release `android` (NetCheck.apk). Pas d'Expo/EAS, pas de mise à jour OTA : chaque modif = nouvel APK à réinstaller.
- PC : GitHub Pages (`.github/workflows/web.yml`), `experiments.baseUrl` = `/NetCheck`.
- Je peux suivre les GitHub Actions de ce dépôt avec `gh run list / gh run view` et lire les Releases via `gh api` (REST ; GraphQL bloqué).

## Vérifs avant push
- `npx tsc --noEmit`
- `npx expo export --platform web --output-dir /tmp/nc-web` et `EXPO_OFFLINE=1 npx expo export --platform android --output-dir /tmp/nc-and`

## Repères
- Moteur : src/engine.ts (sonde chaque seconde, minutes, coupures, tests de débit). Réseau : src/net.ts.
- Données : src/storage.ts (AsyncStorage, une fiche par jour, minutes = tableau compact). Bilans / verdict : src/analysis.ts.
  MinuteStat : 7 champs d'origine + 13 ajoutés le 18/11/2026 (gigue internet/box, pics, requêtes perdues, IPTV 1 et 2) + 5 le 19/11
  (Wi-Fi : rssiSum/rssiN/rssiMin/linkMin/roams) → index dans `M` / `IPTV_M`, lire avec `mv()` (absent = 0 ; rssiMin/linkMin : 0 = pas de relevé).
- Box (Android) : `tcpPing` natif (temps d'ouverture de connexion port 80), pas la page web d'admin (lente, irrégulière : faussait la gigue box).
  Repli sur la page web si 5 échecs alors qu'internet répond (`tcpBroken`). Verdict : gigue box > 1,2 × gigue internet = mesure non fiable.
- Wi-Fi (Android, toutes les 5 s, `maybeWifi`) : signal, vitesse de liaison, BSSID → `day.aps` (A, B, C…), `day.wifiEvents` (roam / lost / back).
  BSSID = permission position + localisation activée, sinon bascule détectée seulement par changement de bande.
- Mémoire (Android, `memInfo` natif, relevée avec le Wi-Fi toutes les 5 s) : minute = memMin (Mo) + memLowN ; « basse » = signalée par
  Android ou < 10 % libre (`memIsLow`). Ajoutée le 19/11 : le « recharge 15 s » de l'IPTV n'était lié à aucun souci réseau mesuré.
- « ⚠️ Ça vient de couper » (`engine.mark`) : résumé des 2 min d'avant dans `day.marks`, causes via `markCauses` (analysis.ts).
- « 📺 Ça coupe sur la télé » par ntfy.sh (src/remote.ts, réglages `ntfyTopic` + `alertsOn` = « cet appareil est la télé », oui par défaut
  sur la télé) : le téléphone publie `mark` sur `<canal>-cmd`, la télé le lit toutes les 10 s (limite ntfy.sh) → `engine.mark(heure de l'appui)`.
  Historique gardé 3 min pour ça. PAS d'alertes vers le téléphone : Etienne n'en veut pas (19/11/2026).
- Serveurs IPTV (réglages `iptvUrl` et `iptvUrl2`, réduits à l'origine par `iptvOrigin`, jamais les identifiants) : un `IptvMonitor` par serveur,
  sondé toutes les 2 s hors du tick (ne le bloque pas), compté seulement si internet répond ; ≥ 2 échecs de suite = `day.iptvCuts` (`srv: 2` pour le 2e). Sur PC + serveur http (contenu mixte) : il faut autoriser « Contenu non sécurisé » pour le site dans Chrome ;
  tant qu'aucune réponse n'est arrivée, rien n'est compté (`iptvSeenOk`) et l'écran Direct affiche l'astuce.
- Écran éteint (Android) : module natif local `modules/netcheck-background` (service de premier plan + verrous CPU/Wi-Fi,
  tâche JS « NetCheckKeepAlive »), piloté par src/background.ts. Donne aussi la passerelle (box) et le type de réseau.
  Kotlin dans `modules/netcheck-background/android/` (le .gitignore n'exclut que `/android/` à la racine : avant le 17/11/2026
  il excluait tous les dossiers `android/`, le Kotlin n'était pas dans le dépôt et l'APK tournait sans le module).
- Chromecast / Android TV (`IS_TV` = `Platform.isTV`) : plugin `plugins/withTv.js` (LEANBACK_LAUNCHER, bannière `assets/tv-banner.png`,
  écran tactile non requis). Sur la télé : surveillance lancée à l'ouverture, jamais de test de débit automatique (couperait la chaîne),
  cartes et boutons sélectionnables à la télécommande (contour jaune, `useFocus` dans src/ui.tsx).
- Diagnostic box (onglet 🩺 Box) : src/diagnostic.ts + src/screens/BoxScreen.tsx. Scan Wi-Fi natif (`scanWifi`, `wifiInfo`),
  réactivité box/internet, lecture des pages 192.168.0.1 et 192.168.100.1 (modèle, signal si lisible sans mot de passe).
  Connexion à la box avec mot de passe : pas encore faite, dépend du modèle.
- Web : sondes en `no-cors`, horloge dans un Web Worker (pas ralentie en arrière-plan), box non testable.
  Débit descendant PC = `webDownloadMbps` (6 flux, 8 s, octets réellement reçus). L’'ancienne méthode (Resource Timing / no-cors) donnait 0,8 Mb/s au lieu de 166.
