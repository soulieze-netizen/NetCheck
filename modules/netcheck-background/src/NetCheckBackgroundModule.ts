import { NativeModule, requireOptionalNativeModule } from 'expo';

export type WifiInfo = {
  ssid: string | null;
  bssid: string | null;
  rssi: number;
  frequency: number;
  linkSpeed: number;
  txSpeed: number | null;
  rxSpeed: number | null;
  standard: number | null; // 4 = Wi-Fi 4 (n), 5 = Wi-Fi 5 (ac), 6 = Wi-Fi 6 (ax), 7 = Wi-Fi 7
};

export type ScanNet = { ssid: string; bssid: string; level: number; frequency: number; center: number; width: number };
export type ScanOutcome = { ok: boolean; fresh: boolean; error?: string; results: ScanNet[] };

declare class NetCheckBackgroundNative extends NativeModule<{}> {
  start(title: string, text: string): boolean;
  update(title: string, text: string): void;
  stop(): void;
  gateway(): string | null;
  networkType(): 'wifi' | 'cellular' | 'ethernet' | 'other' | 'none';
  locationEnabled(): boolean;
  wifiInfo(): WifiInfo | null;
  scanWifi(): Promise<ScanOutcome>;
  /** Temps d'ouverture d'une connexion (ms), null si pas de réponse */
  tcpPing(host: string, port: number, timeoutMs: number): Promise<number | null>;
}

// Absent sur le web (PC) : la mesure tourne alors tant que l'onglet est ouvert
export default requireOptionalNativeModule<NetCheckBackgroundNative>('NetCheckBackground');
