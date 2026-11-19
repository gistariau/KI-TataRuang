/**
 * ============================================================================
 * CLOUDFLARE PAGES FUNCTIONS - API PROXY
 * File: functions/api/[[path]].js
 * Alur: index.html (/api) -> Cloudflare Pages Functions -> Google Apps Script
 * ============================================================================
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate'
};

function jsonResponse(status, success, data, message, extra = {}) {
  return new Response(
    JSON.stringify({
      success,
      data,
      message,
      ...extra
    }),
    {
      status,
      headers: JSON_HEADERS
    }
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Validasi keberadaan Environment Variables Cloudflare Pages
  const gasWebAppUrl = env && env.GAS_WEB_APP_URL ? String(env.GAS_WEB_APP_URL).trim() : '';
  const proxySecret = env && env.PROXY_SECRET ? String(env.PROXY_SECRET).trim() : '';

  if (!gasWebAppUrl || !proxySecret) {
    return jsonResponse(
      500,
      false,
      null,
      'Konfigurasi server belum lengkap. Pastikan environment variable GAS_WEB_APP_URL dan PROXY_SECRET sudah diatur di Cloudflare Pages.'
    );
  }

  // Validasi format dasar URL Google Apps Script
  if (!gasWebAppUrl.startsWith('https://script.google.com/')) {
    return jsonResponse(
      500,
      false,
      null,
      'Konfigurasi GAS_WEB_APP_URL tidak valid. Harus diawali dengan https://script.google.com/.'
    );
  }

  // 2. Baca dan validasi JSON dari frontend
  let incomingBody;
  try {
    incomingBody = await request.json();
  } catch (err) {
    return jsonResponse(400, false, null, 'Format permintaan API harus berupa JSON yang valid.');
  }

  if (!incomingBody || typeof incomingBody !== 'object' || !incomingBody.action) {
    return jsonResponse(400, false, null, 'Permintaan tidak lengkap: parameter action wajib diisi.');
  }

  // 3. Sisipkan PROXY_SECRET di sisi server (tidak pernah terekspos ke browser)
  const upstreamPayload = {
    secret: proxySecret,
    action: String(incomingBody.action),
    token: incomingBody.token ? String(incomingBody.token) : '',
    payload: incomingBody.payload && typeof incomingBody.payload === 'object' ? incomingBody.payload : {}
  };

  // 4. Teruskan permintaan ke Google Apps Script dengan batas waktu (timeout 25 detik)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const gasResponse = await fetch(gasWebAppUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(upstreamPayload),
      redirect: 'follow',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const rawText = await gasResponse.text();

    let parsedGasJson;
    try {
      parsedGasJson = JSON.parse(rawText);
    } catch (parseErr) {
      return jsonResponse(
        502,
        false,
        null,
        'Gagal membaca respons dari Google Apps Script. Pastikan Web App sudah di-deploy dengan akses "Anyone" (Siapa saja).'
      );
    }

    const httpStatus = parsedGasJson.code === 'SESSION_EXPIRED' ? 401 : 200;
    return new Response(JSON.stringify(parsedGasJson), {
      status: httpStatus,
      headers: JSON_HEADERS
    });
  } catch (fetchErr) {
    clearTimeout(timeoutId);

    if (fetchErr && fetchErr.name === 'AbortError') {
      return jsonResponse(
        504,
        false,
        null,
        'Koneksi ke database Google Spreadsheet melebihi batas waktu (timeout). Silakan coba beberapa saat lagi.'
      );
    }

    return jsonResponse(
      502,
      false,
      null,
      'Terjadi gangguan koneksi antara Cloudflare Pages dan Google Apps Script.'
    );
  }
}

export async function onRequest(context) {
  if (context.request.method === 'POST') {
    return onRequestPost(context);
  }
  if (context.request.method === 'OPTIONS') {
    return onRequestOptions();
  }
  return jsonResponse(405, false, null, 'Metode HTTP tidak diizinkan. Gunakan POST.');
}