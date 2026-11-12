// Service Android « NetCheck surveille… » : garde la mesure active écran éteint.
// Sur PC (navigateur) il n'existe pas : la mesure tourne tant que l'onglet est ouvert.
import { AppRegistry, PermissionsAndroid, Platform } from 'react-native';
import Native from '../modules/netcheck-background/src/NetCheckBackgroundModule';

type Want = { title: string; text: string } | null;

let shown: string | null = null;
let release: (() => void) | null = null;
let hold: Promise<void> | null = null;
let askedNotif = false;

function askNotificationPermission() {
  if (askedNotif || Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  askedNotif = true;
  const p = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  PermissionsAndroid.check(p)
    .then((ok) => (ok ? undefined : PermissionsAndroid.request(p)))
    .catch(() => {});
}

function stopHold() {
  release?.();
  release = null;
  hold = null;
}

export function setBackground(want: Want) {
  if (!Native) return;
  const key = want ? `${want.title}|${want.text}` : null;
  if (key === shown) return;
  if (!want) {
    shown = null;
    stopHold();
    try {
      Native.stop();
    } catch {}
    return;
  }
  if (shown) {
    shown = key;
    try {
      Native.update(want.title, want.text);
    } catch {}
    return;
  }
  hold = new Promise<void>((r) => (release = r));
  askNotificationPermission();
  let ok = false;
  try {
    ok = Native.start(want.title, want.text);
  } catch {}
  if (ok) shown = key;
  else stopHold();
}

/** À appeler une fois au lancement */
export function registerBackgroundTask() {
  if (Platform.OS !== 'android') return;
  AppRegistry.registerHeadlessTask('NetCheckKeepAlive', () => async () => {
    if (hold) await hold;
  });
}
