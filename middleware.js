// Hasło do aplikacji — sprawdzane na serwerze Vercel, zanim cokolwiek się wczyta.
// Hasło ustawiasz w Vercel: Settings → Environment Variables → APP_PASSWORD.

// ikony i manifest muszą być dostępne bez logowania (iPhone pobiera je przy dodawaniu na ekran główny)
export const config = { matcher: ['/((?!favicon\\.ico|favicon-32\\.png|apple-touch-icon\\.png|icon-192\\.png|icon-512\\.png|icon\\.svg|manifest\\.webmanifest).*)'] };

const COOKIE = 'przesylki_auth';
const YEAR = 60 * 60 * 24 * 365;

async function tokenFor(password) {
  const data = new TextEncoder().encode('przesylki:v1:' + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const all = request.headers.get('cookie') || '';
  for (const part of all.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function page(body, status = 200, headers = {}) {
  return new Response(
    `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Nasze mieszkanie">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="robots" content="noindex">
<title>Nasze mieszkanie</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{color-scheme:light;--bg:#EEF1F6;--s1:#fff;--t1:#0E1F45;--t2:#6B7894;--bord:rgba(14,31,69,.08);--acc:#0E1F45;--acc-t:#fff;--err:#E5484D}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#080F21;--s1:#111B33;--t1:#EEF2FA;--t2:#8E9BB8;--bord:rgba(255,255,255,.07);--acc:#DCE6F8;--acc-t:#0E1F45;--err:#FF6B6F}}
body{min-height:100vh;background:var(--bg);color:var(--t1);font-family:'Outfit',system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px 16px;-webkit-font-smoothing:antialiased}
.box{width:100%;max-width:360px}
.ic{width:72px;height:72px;border-radius:22px;display:block;margin-bottom:24px}
h1{font-size:30px;font-weight:600;letter-spacing:-.5px;margin-bottom:24px}
p{font-size:15px;color:var(--t2);margin:6px 0 24px;line-height:1.45}
input{width:100%;height:56px;border-radius:28px;border:1.5px solid transparent;background:var(--s1);color:var(--t1);padding:0 22px;font-size:17px;box-shadow:0 10px 30px -18px rgba(14,31,69,.35);outline:none;-webkit-appearance:none;font-family:inherit}
input:focus{border-color:var(--acc)}
button{width:100%;height:56px;border-radius:28px;border:0;background:var(--acc);color:var(--acc-t);font-size:17px;font-weight:500;margin-top:10px;cursor:pointer;font-family:inherit}
.err{color:var(--err);font-size:14px;font-weight:600;margin-top:12px}
code{font-family:ui-monospace,Menlo,monospace;font-size:13px;background:var(--bord);padding:2px 6px;border-radius:6px;color:var(--t1)}
</style></head><body><div class="box">
<img class="ic" src="/icon-192.png" alt="" width="72" height="72">
${body}</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers } }
  );
}

function loginPage(error) {
  return page(
    `<h1>Wpisz Hasło do Domu:</h1>
<form method="POST" action="/__login">
<input type="password" name="password" placeholder="Hasło" autocomplete="current-password" autofocus required>
<button type="submit">Wejdź</button>
${error ? '<div class="err">Nieprawidłowe hasło</div>' : ''}
</form>`,
    error ? 401 : 200
  );
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const password = process.env.APP_PASSWORD;

  if (!password) {
    return page(
      `<h1>Ustaw hasło</h1><p>Aplikacja jest zablokowana, dopóki nie ustawisz hasła. W Vercelu wejdź w projekt → <b>Settings → Environment Variables</b>, dodaj zmienną <code>APP_PASSWORD</code> z wybranym hasłem i zrób <b>Redeploy</b>.</p>`,
      503
    );
  }

  const expected = await tokenFor(password);

  if (url.pathname === '/__logout') {
    return new Response(null, {
      status: 303,
      headers: { Location: '/', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
    });
  }

  if (url.pathname === '/__login' && request.method === 'POST') {
    let given = '';
    try {
      const form = await request.formData();
      given = String(form.get('password') || '');
    } catch {}
    if (sameText(await tokenFor(given), expected)) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: '/',
          'Set-Cookie': `${COOKIE}=${expected}; Path=/; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    await new Promise((r) => setTimeout(r, 800)); // spowolnienie zgadywania
    return loginPage(true);
  }

  const cookie = readCookie(request, COOKIE);
  if (cookie && sameText(cookie, expected)) return; // zalogowany — przepuść dalej

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Wymagane logowanie' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return loginPage(false);
}
