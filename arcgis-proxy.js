// Proxy tipis untuk layanan ArcGIS REST / GeoServer milik instansi pemerintah.
// Dipakai hanya bila peramban menolak akses langsung (CORS).
// Pemakaian: /.netlify/functions/arcgis-proxy?url=<alamat-layanan-terenkode>
// Daftar host yang diizinkan bisa diganti lewat variabel lingkungan ALLOWED_HOSTS
// (pisahkan dengan koma) di pengaturan situs Netlify.

const DEFAULT_HOSTS = [
  'gistaru.atrbpn.go.id',
  'geosvc.atrbpn.go.id',
  'inalandmap.bpn.go.id',
  'bhumi.atrbpn.go.id',
];
const MAX_BYTES = 5.5 * 1024 * 1024;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const reply = (statusCode, body, extra) => ({
  statusCode,
  headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8', ...(extra || {}) },
  body,
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return reply(405, 'Metode tidak didukung.');

  const raw = (event.queryStringParameters || {}).url;
  if (!raw) return reply(400, 'Parameter url wajib diisi.');

  let target;
  try { target = new URL(raw); } catch (e) { return reply(400, 'Alamat tidak valid.'); }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return reply(400, 'Hanya http/https.');

  const hosts = (process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(',') : DEFAULT_HOSTS)
    .map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!hosts.includes(target.hostname.toLowerCase())) return reply(403, 'Host tidak ada dalam daftar izin: ' + target.hostname);
  if (!/\/rest\/services\/|\/geoserver\//i.test(target.pathname)) return reply(403, 'Jalur harus layanan /rest/services/ atau /geoserver/.');

  const init = { method: event.httpMethod, redirect: 'manual', signal: AbortSignal.timeout(25000), headers: {} };
  if (event.httpMethod === 'POST') {
    init.headers['content-type'] = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || 'application/x-www-form-urlencoded';
    init.body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : (event.body || '');
  }

  let res;
  try { res = await fetch(target.toString(), init); }
  catch (e) { return reply(502, 'Server layanan tidak dapat dihubungi: ' + (e.name === 'TimeoutError' ? 'waktu habis' : e.message)); }
  if (res.status >= 300 && res.status < 400) return reply(502, 'Server layanan mengalihkan permintaan (HTTP ' + res.status + '), tidak diikuti.');

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) return reply(502, 'Jawaban terlalu besar untuk proxy (' + Math.round(buf.length / 1024) + ' KB). Perkecil area atau pakai layer lain.');

  return {
    statusCode: res.status,
    headers: { ...CORS, 'content-type': res.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};
