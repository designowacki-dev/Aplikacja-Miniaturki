import { kv } from '@vercel/kv';

const KEY = 'ts-sync';

export default async function handler(req, res) {
    try {
          if (req.method === 'GET') {
                  const data = await kv.get(KEY);
                  res.status(200).json({ value: data || null });
                  return;
          }
          if (req.method === 'POST') {
                  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
                          await kv.set(KEY, body);
                          res.status(200).json({ ok: true });
                  return;
          }
          res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
          res.status(500).json({ error: String(e) });
    }
}
