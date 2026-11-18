// Synchronizacja przesyłek, rzeczy do kupienia, listy zakupów i zadań między telefonami.
// Baza: Upstash Redis (Vercel → Storage → Upstash). Każde urządzenie wysyła swoją listę,
// serwer łączy ją z zapisaną (nowsza wersja paczki wygrywa, usunięte zostają usunięte)
// i odsyła wynik — dzięki temu paczki dodane na dwóch telefonach naraz się nie gubią.

const KEY = 'parcels-sync-v2';
const OLD_KEY = 'parcels-sync';
const TOMBSTONE_TTL = 60 * 24 * 3600 * 1000; // pamiętaj usunięcia przez 60 dni

function db() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return async (cmd) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || `Redis HTTP ${r.status}`);
    return j.result;
  };
}

function parse(raw) {
  if (!raw) return null;
  try {
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
}

export function mergeState(a, b) {
  const deleted = { ...(a.deleted || {}) };
  for (const [id, ts] of Object.entries(b.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts || 0);
  const now = Date.now();
  for (const id of Object.keys(deleted)) if (now - deleted[id] > TOMBSTONE_TTL) delete deleted[id];

  const out = { deleted };
  for (const key of ['parcels', 'items', 'groceries', 'tasks']) {   // przesyłki, do kupienia, lista zakupów, zadania
    const byId = new Map();
    for (const p of [...(a[key] || []), ...(b[key] || [])]) {
      if (!p || !p.id) continue;
      const have = byId.get(p.id);
      if (!have || (p.u || 0) > (have.u || 0)) byId.set(p.id, p);
    }
    out[key] = [...byId.values()]
      .filter((p) => !(deleted[p.id] && deleted[p.id] >= (p.u || 0)))
      .sort((x, y) => new Date(y.created || 0) - new Date(x.created || 0));
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const redis = db();
  if (!redis) {
    res.status(503).json({ error: 'no-db' });
    return;
  }
  try {
    let stored = parse(await redis(['GET', KEY]));
    if (!stored) {
      const old = parse(await redis(['GET', OLD_KEY]));
      stored = old && Array.isArray(old.parcels) ? { parcels: old.parcels, deleted: {} } : { parcels: [], deleted: {} };
    }

    if (req.method === 'GET') {
      res.status(200).json(stored);
      return;
    }
    if (req.method === 'POST') {
      const body = parse(req.body) || {};
      const merged = mergeState(stored, { parcels: body.parcels || [], items: body.items || [], groceries: body.groceries || [], tasks: body.tasks || [], deleted: body.deleted || {} });
      await redis(['SET', KEY, JSON.stringify(merged)]);
      res.status(200).json(merged);
      return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
