// Liaison téléphone ↔ Chromecast par ntfy (https://ntfy.sh), service de notifications gratuit et sans compte.
// - Alertes : l'appareil surveillé (Chromecast) publie sur le canal « <canal> » ; l'appli ntfy du téléphone affiche la notification.
// - « Ça coupe sur la télé » : le téléphone publie « mark » sur « <canal>-cmd » ; le Chromecast le lit (toutes les 10 s)
//   et enregistre la coupure avec SES mesures, à l'heure de l'appui.
// Les messages ne contiennent que l'heure et le type de problème. Le nom du canal sert de mot de passe : il doit rester secret.
import { fetch as expoFetch } from 'expo/fetch';
import { IS_WEB } from './net';

const NTFY = 'https://ntfy.sh';
const ALERT_MIN_GAP_MS = 60000; // au plus une notification par minute (les alertes sont regroupées)
const POLL_MS = 10000; // lecture des demandes du téléphone (ntfy.sh limite le nombre de requêtes : pas plus souvent)

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

export type RemoteStatus = { lastSentAt: number | null; lastError: string | null; lastMarkSentAt: number | null };

export class Remote {
  private queue: string[] = [];
  private lastSent = 0;
  private sending = false;
  private pollAt = 0;
  private polling = false;
  private since: string | null = null;
  private pollTopic = '';
  status: RemoteStatus = { lastSentAt: null, lastError: null, lastMarkSentAt: null };

  constructor(
    private topic: () => string,
    private title: () => string,
    private onMark: (at: number) => void,
    private changed: () => void
  ) {}

  /** Met une alerte en file (envoyée au plus une fois par minute, regroupée) */
  alert(text: string) {
    if (!this.topic()) return;
    this.queue.push(text);
    if (this.queue.length > 15) this.queue.shift();
  }

  /** À appeler chaque seconde */
  tick(now: number, sendAlerts: boolean, listen: boolean) {
    const topic = this.topic();
    if (!topic) return;
    if (sendAlerts && this.queue.length && !this.sending && now - this.lastSent >= ALERT_MIN_GAP_MS) this.send(now, topic);
    if (listen && !this.polling && now - this.pollAt >= POLL_MS) this.poll(now, topic);
  }

  private async send(now: number, topic: string) {
    this.sending = true;
    const items = this.queue.splice(0);
    try {
      const res = await doFetch(`${NTFY}/${topic}`, {
        method: 'POST',
        body: items.join('\n'),
        headers: { Title: this.title(), Tags: 'warning' },
      });
      if (!res.ok) throw new Error(`ntfy a répondu ${res.status}`);
      this.lastSent = now;
      this.status = { ...this.status, lastSentAt: now, lastError: null };
    } catch (e: any) {
      // pas de réseau ou refus : on réessaie à la prochaine minute
      this.queue.unshift(...items);
      this.queue.splice(15);
      this.lastSent = now;
      this.status = { ...this.status, lastError: String(e?.message ?? e) };
    } finally {
      this.sending = false;
      this.changed();
    }
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
        if (String(m.message).trim() === 'mark') this.onMark(Math.min(now, (m.time ?? now / 1000) * 1000));
      }
    } catch {
      // réseau coupé : on réessaiera
    } finally {
      this.polling = false;
    }
  }

  /** Téléphone : demande au Chromecast d'enregistrer une coupure maintenant */
  async sendMark(): Promise<boolean> {
    const topic = this.topic();
    if (!topic) return false;
    try {
      const res = await doFetch(`${NTFY}/${topic}-cmd`, { method: 'POST', body: 'mark' });
      if (!res.ok) throw new Error(`ntfy a répondu ${res.status}`);
      this.status = { ...this.status, lastMarkSentAt: Date.now(), lastError: null };
      return true;
    } catch (e: any) {
      this.status = { ...this.status, lastError: String(e?.message ?? e) };
      return false;
    } finally {
      this.changed();
    }
  }
}
