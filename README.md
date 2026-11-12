# NetCheck

Contrôle de la connexion internet (VOO) : **mesure en continu** pour voir les micro-coupures,
et **tests de débit** réguliers comparés aux vitesses du contrat. Rapport PDF à envoyer à l'opérateur.

## Ce qui est mesuré
- **Chaque seconde** : la box (téléphone uniquement), Cloudflare (1.1.1.1) et Google.
  - box muette → problème de Wi-Fi / box
  - box OK mais internet muet → problème sur la ligne / le réseau VOO
  - tout répond mais > 300 ms → connexion lente
  - coupure = au moins 2 s sans internet ; 1 seule seconde = « perte »
- **Toutes les 15 / 30 / 60 min** : débit descendant, montant et ping (serveurs Cloudflare).
- Frise minute par minute, bilans jour par jour, verdict, export PDF.

## Où l'utiliser
- **Téléphone Android** (Wi-Fi) : APK dans l'onglet *Releases* du dépôt (« NetCheck pour Android »).
  La mesure continue écran éteint (notification « NetCheck surveille »).
- **PC** (branché en câble à la box) : https://soulieze-netizen.github.io/NetCheck/ dans le navigateur.
  Laisser l'onglet ouvert et désactiver la mise en veille de Windows. (La box n'est pas testable depuis une page web.)

## Compilation
- Chaque push sur `main` : GitHub Actions fabrique l'APK (`.github/workflows/android.yml`, sans Expo)
  et met en ligne la version PC (`.github/workflows/web.yml`, GitHub Pages).
- Données gardées 45 jours sur l'appareil.
