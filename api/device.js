// Sterowanie urządzeniami smart home.
//
// POST { action: 'on'|'off'|'level'|'open'|'dock', level?: 0-100, conn: { kind, entity?, onUrl?, offUrl? } }
//   kind 'ha'      → Home Assistant (zmienne HA_URL i HA_TOKEN w Vercelu), entity np. light.salon
//   kind 'webhook' → wywołuje podany adres https (onUrl / offUrl), np. z IFTTT, Tuya, Shelly Cloud
//   kind 'demo'    → nic nie wysyła (stan tylko w aplikacji)
// GET ?entities=light.salon,switch.ekspres → aktualny stan z Home Assistant

function ha() {
  const url = (process.env.HA_URL || '').replace(/\/+$/, '');
  const token = process.env.HA_TOKEN;
  if (!url || !token) return null;
  return async (path, body) => {
    const r = await fetch(url + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`Home Assistant HTTP ${r.status}`);
    return r.json();
  };
}

const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const call = ha();
      if (!call) { res.status(503).json({ error: 'no-ha' }); return; }
      const ids = String((req.query && req.query.entities) || '').split(',').filter((e) => ENTITY.test(e)).slice(0, 50);
      const out = {};
      for (const id of ids) {
        try {
          const s = await call(`/api/states/${id}`);
          const b = s.attributes && s.attributes.brightness;
          out[id] = { on: s.state === 'on' || s.state === 'playing' || s.state === 'heat' || s.state === 'cool', state: s.state, level: b != null ? Math.round((b / 255) * 100) : null };
        } catch (e) { out[id] = { error: String(e.message || e) }; }
      }
      res.status(200).json(out);
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { action, level } = body;
    const conn = body.conn || {};
    if (!['on', 'off', 'level', 'open', 'dock'].includes(action)) { res.status(400).json({ error: 'Złe polecenie' }); return; }

    if (conn.kind === 'ha') {
      const call = ha();
      if (!call) { res.status(503).json({ error: 'Brak HA_URL / HA_TOKEN w Vercelu' }); return; }
      if (!ENTITY.test(conn.entity || '')) { res.status(400).json({ error: 'Nieprawidłowe entity_id' }); return; }
      const domain = conn.entity.split('.')[0];
      // „otwórz” (brama, winda, szlaban): właściwa usługa zależnie od rodzaju encji
      const OPEN = { cover: 'open_cover', lock: 'unlock', button: 'press', input_button: 'press', automation: 'trigger', vacuum: 'start' };
      const service = action === 'dock' ? (domain === 'vacuum' ? 'return_to_base' : 'turn_on')
        : action === 'open' ? (OPEN[domain] || 'turn_on') : action === 'off' ? 'turn_off' : 'turn_on';
      const data = { entity_id: conn.entity };
      if (domain === 'light' && action !== 'off' && Number.isFinite(level)) data.brightness_pct = Math.max(1, Math.min(100, Math.round(level)));
      await call(`/api/services/${domain}/${service}`, data);
      res.status(200).json({ ok: true });
      return;
    }

    if (conn.kind === 'webhook') {
      const url = action === 'off' ? conn.offUrl : conn.onUrl;
      if (!url || !/^https:\/\//i.test(url)) { res.status(400).json({ error: 'Brak adresu webhooka (https)' }); return; }
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, level }) });
      if (!r.ok) { res.status(502).json({ error: `Webhook HTTP ${r.status}` }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(200).json({ ok: true, demo: true });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
