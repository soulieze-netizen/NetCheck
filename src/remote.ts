// « 📺 Ça coupe sur la télé » : le bouton du téléphone fait enregistrer la coupure par le Chromecast, avec SES mesures.
// Passe par ntfy.sh (service gratuit, sans compte) : le téléphone publie « mark » sur « <canal>-cmd », le Chromecast le lit
// toutes les 10 s et enregistre la coupure à l'heure de l'appui. Aucune alerte n'est envoyée (choix d'Etienne).
// Le message ne contient que « mark ». Le nom du canal sert de mot de passe : il doit rester secret.
import { fetch as expoFetch } from 'expo/fetch';
import { IS_WEB } from './net';

const NTFY = 'https://ntfy.sh';
const POLL_MS = 10000; // ntfy.sh limite le nombre de requêtes : pas plus souvent

const doFetch: typeof fetch = IS_WEB ? fetch : (expoFetch as unknown as typeof fetch);

/** Nom de canal valable pour ntfy : lettres, chiffres, - et _ */
export const cleanTopic = (t: string | undefined) =>
  (t ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64);

/** Nouveau nom de canal, facile à recopier mais impossible à deviner */
export function newTopic() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `netcheck-${s}`;
}

export type RemoteStatus = { lastError: string | null; lastMarkSentAt: number | null; lastMarkReceivedAt: number | null };

export class Remote {
  private pollAt = 0;
  private polling = false;
  private since: string | null = null;
  private pollTopic = '';
  status: RemoteStatus = { lastError: null, lastMarkSentAt: null, lastMarkReceivedAt: null };

  constructor(
    private topic: () => string,
    private onMark: (at: number) => void,
    private changed: () => void
  ) {}

  /** Télé : à appeler chaque seconde, lit les demandes du téléphone toutes les 10 s */
  tick(now: number) {
    const topic = this.topic();
    if (!topic || this.polling || now - this.pollAt < POLL_MS) return;
    this.poll(now, topic);
  }

  private async poll(now: number, topic: string) {
    this.polling = true;
    this.pollAt = now;
    if (this.pollTopic !== topic) {
      // nouveau canal : on ne lit que ce qui arrive à partir de maintenant
      this.pollTopic = topic;
      this.since = String(Math.floor(now / 1000));
    }
    try {
      const res = await doFetch(`${NTFY}/${topic}-cmd/json?poll=1&since=${this.since}`);
      if (!res.ok) return;
      const text = await res.text();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let m: any;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.event !== 'message') continue;
        if (m.id) this.since = m.id;
        if (String(m.message).trim() === 'mark') {
          this.status = { ...this.status, lastMarkReceivedAt: now };
          this.onMark(Math.min(now, (m.time ?? now / 1000) * 1000));
        }
      }
    } catch {
      // réseau coupé : on réessaiera
    } finally {
      this.polling = false;
    }
  }

  /** Téléphone : demande à la télé d'enregistrer une coupure maintenant */
  async sendMark(): Promise<boolean> {
    const topic = this.topic();
    if (!topic) return false;
    try {
      const res = await doFetch(`${NTFY}/${topic}-cmd`, { method: 'POST', body: 'mark' });
      if (!res.ok) throw new Error(`ntfy a répondu ${res.status}`);
      this.status = { ...this.status, lastMarkSentAt: Date.now(), lastError: null };
      return true;
    } catch (e: any) {
      this.status = { ...this.status, lastError: `envoi impossible (${String(e?.message ?? e)})` };
      return false;
    } finally {
      this.changed();
    }
  }
}
