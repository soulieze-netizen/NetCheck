import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class NetCheckBackgroundNative extends NativeModule<{}> {
  start(title: string, text: string): boolean;
  update(title: string, text: string): void;
  stop(): void;
  gateway(): string | null;
  networkType(): 'wifi' | 'cellular' | 'ethernet' | 'other' | 'none';
}

// Absent sur le web (PC) : la mesure tourne alors tant que l'onglet est ouvert
export default requireOptionalNativeModule<NetCheckBackgroundNative>('NetCheckBackground');
