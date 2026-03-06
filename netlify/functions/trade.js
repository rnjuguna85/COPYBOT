const https = require('https');
const crypto = require('crypto');

// Your Cloudflare Worker URL (US proxy)
const WORKER = 'orange-pine-941a.reuben-njuguna.workers.dev';

const CREDS = {
  key: '44c916f2-a6e7-3cc7-9a17-d9b7969e5960',
  secret: 'ccStQQiZBJLNIei-DPSnFV0wvx--h0S8SCNKR-hNje8=',
  passphrase: 'ef6d912800357da4e74b2f551a50525765fef8fe166f3340026b879f3d4ea09c',
  wallet: '0x59C4538942576428A7EC8Ea3A0966AA3d6416A96'
};

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const params = event.queryStringParameters || {};
  const action = params.action;

  try {
    if (action === 'balance') {
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = sign('GET', '/balance', '', ts);
      const data = await workerReq({ method: 'GET', path: '/balance', sig, ts });
      return { statusCode: 200, headers, body: data };
    }

    if (action === 'orders') {
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = sign('GET', '/orders', '', ts);
      const data = await workerReq({ method: 'GET', path: '/orders', sig, ts });
      return { statusCode: 200, headers, body: data };
    }

    if (action === 'price') {
      const tokenId = params.token_id;
      if (!tokenId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing token_id' }) };
      const data = await workerReq({ method: 'GET', path: '/midpoint?token_id=' + tokenId });
      return { statusCode: 200, headers, body: data };
    }

    if (action === 'buy') {
      const body = event.body ? JSON.parse(event.body) : {};
      const { tokenId, price, size } = body;
      if (!tokenId || !price || !size) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing tokenId, price, or size' }) };
      }
      const order = buildOrder(tokenId, price, size, 'BUY');
      const ts = Math.floor(Date.now() / 1000).toString();
      const orderBody = JSON.stringify({ order, owner: CREDS.wallet, orderType: 'GTC' });
      const sig = sign('POST', '/order', orderBody, ts);
      const data = await workerReq({ method: 'POST', path: '/order', body: orderBody, sig, ts });
      return { statusCode: 200, headers, body: data };
    }

    if (action === 'cancel') {
      const orderId = params.order_id;
      if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing order_id' }) };
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = sign('DELETE', '/order/' + orderId, '', ts);
      const data = await workerReq({ method: 'DELETE', path: '/order/' + orderId, sig, ts });
      return { statusCode: 200, headers, body: data };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function sign(method, path, body, timestamp) {
  const msg = timestamp + method + path + (body || '');
  const hmac = crypto.createHmac('sha256', Buffer.from(CREDS.secret, 'base64'));
  hmac.update(msg);
  return hmac.digest('base64');
}

function buildOrder(tokenId, price, size, side) {
  return {
    salt: Date.now(),
    maker: CREDS.wallet,
    signer: CREDS.wallet,
    taker: '0x0000000000000000000000000000000000000000',
    tokenId: tokenId,
    makerAmount: side === 'BUY' ? String(Math.round(size * price * 1e6)) : String(Math.round(size * 1e6)),
    takerAmount: side === 'BUY' ? String(Math.round(size * 1e6)) : String(Math.round(size * price * 1e6)),
    expiration: '0',
    nonce: '0',
    feeRateBps: '0',
    side: side === 'BUY' ? '0' : '1',
    signatureType: '2'
  };
}

// ── Route through Cloudflare Worker (US IP) ──────────────────
function workerReq({ method, path, body, sig, ts }) {
  return new Promise((resolve, reject) => {
    const reqHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (sig) {
      reqHeaders['POLY_ADDRESS'] = CREDS.wallet;
      reqHeaders['POLY_API_KEY'] = CREDS.key;
      reqHeaders['POLY_PASSPHRASE'] = CREDS.passphrase;
      reqHeaders['POLY_SIGNATURE'] = sig;
      reqHeaders['POLY_TIMESTAMP'] = ts;
    }
    if (body) reqHeaders['Content-Length'] = Buffer.byteLength(body);

    // Route via Cloudflare Worker: /?target=/path
    const workerPath = '/?target=' + encodeURIComponent(path);
    const options = {
      hostname: WORKER,
      path: workerPath,
      method: method || 'GET',
      headers: reqHeaders
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}
