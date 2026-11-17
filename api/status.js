// Co jest skonfigurowane na serwerze (bez ujawniania żadnych wartości).
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    sync: !!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
             (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)),
    track17: !!process.env.TRACK17_KEY,
  });
}
