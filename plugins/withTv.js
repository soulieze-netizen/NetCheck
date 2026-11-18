// Rend l'APK utilisable sur Chromecast avec Google TV / Android TV :
// icône dans le menu de la télé (LEANBACK_LAUNCHER + bannière), écran tactile non obligatoire.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

function withTvManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const m = cfg.modResults.manifest;
    m['uses-feature'] = m['uses-feature'] || [];
    for (const name of ['android.hardware.touchscreen', 'android.software.leanback']) {
      if (!m['uses-feature'].some((f) => f.$['android:name'] === name)) {
        m['uses-feature'].push({ $: { 'android:name': name, 'android:required': 'false' } });
      }
    }
    const app = m.application[0];
    app.$['android:banner'] = '@drawable/tv_banner';
    for (const act of app.activity || []) {
      for (const filter of act['intent-filter'] || []) {
        const isLauncher = (filter.category || []).some((c) => c.$['android:name'] === 'android.intent.category.LAUNCHER');
        const hasTv = (filter.category || []).some((c) => c.$['android:name'] === 'android.intent.category.LEANBACK_LAUNCHER');
        if (isLauncher && !hasTv) filter.category.push({ $: { 'android:name': 'android.intent.category.LEANBACK_LAUNCHER' } });
      }
    }
    return cfg;
  });
}

function withTvBanner(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/drawable');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(cfg.modRequest.projectRoot, 'assets/tv-banner.png'), path.join(dir, 'tv_banner.png'));
      return cfg;
    },
  ]);
}

module.exports = (config) => withTvBanner(withTvManifest(config));
