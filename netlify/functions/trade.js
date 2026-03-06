const https = require('https');
const crypto = require('crypto');

const CLOB = 'https://clob.polymarket.com';

// Your credentials
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const action = params.action;

  try {
    // ── GET BALANCE ──────────────────────────────────────────
    if (action === 'balance') {
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = sign('GET', '/balance', '', ts);
      const data = await clobGet('/balance', sig, ts);
      return { statusCode: 200, headers, body: data };
    }

    // ── GET OPEN ORDERS ──────────────────────────────────────
    if (action === 'orders') {
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = sign('GET', '/orders', '', ts);
      const data = await clobGet('/orders', sig, ts);
      return { statusCode: 200, headers, body: data };
    }

    // ── GET MARKET PRICE ─────────────────────────────────────
    if (action === 'price') {
      const tokenId = params.token_id;
      if (!tokenId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing token_id' }) };
      const data = await clobGetPublic('/midpoint?token_id=' + tokenId);
      return { statusCode: 200, headers, body: data };
    }

    // ── PLACE ORDER ──────────────────────────────────────────
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
      const data = await clobPost('/order', orderBody, sig, ts);
      return { statusCode: 200, headers, body: data };
    }

    // ── CANCEL ORDER ─────────────────────────────────────────
    if (action === 'cancel') {
      const orderId = params.order_id;
      if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing order_id' }) };
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = sign('DELETE', '/order/' + orderId, '', ts);
      const data = await clobDelete('/order/' + orderId, sig, ts);
      return { statusCode: 200, headers, body: data };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ── HMAC-SHA256 signature ────────────────────────────────────
function sign(method, path, body, timestamp) {
  const msg = timestamp + method + path + (body || '');
  const hmac = crypto.createHmac('sha256', Buffer.from(CREDS.secret, 'base64'));
  hmac.update(msg);
  return hmac.digest('base64');
}

// ── Build a simple market order ──────────────────────────────
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

// ── CLOB authenticated GET ───────────────────────────────────
function clobGet(path, sig, ts) {
  return new Promise((resolve, reject) => {
    const req = https.get(CLOB + path, {
      headers: {
        'POLY_ADDRESS': CREDS.wallet,
        'POLY_API_KEY': CREDS.key,
        'POLY_PASSPHRASE': CREDS.passphrase,
        'POLY_SIGNATURE': sig,
        'POLY_TIMESTAMP': ts,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── CLOB public GET ──────────────────────────────────────────
function clobGetPublic(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(CLOB + path, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── CLOB authenticated POST ──────────────────────────────────
function clobPost(path, body, sig, ts) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'clob.polymarket.com',
      path: path,
      method: 'POST',
      headers: {
        'POLY_ADDRESS': CREDS.wallet,
        'POLY_API_KEY': CREDS.key,
        'POLY_PASSPHRASE': CREDS.passphrase,
        'POLY_SIGNATURE': sig,
        'POLY_TIMESTAMP': ts,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// ── CLOB authenticated DELETE ────────────────────────────────
function clobDelete(path, sig, ts) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'clob.polymarket.com',
      path: path,
      method: 'DELETE',
      headers: {
        'POLY_ADDRESS': CREDS.wallet,
        'POLY_API_KEY': CREDS.key,
        'POLY_PASSPHRASE': CREDS.passphrase,
        'POLY_SIGNATURE': sig,
        'POLY_TIMESTAMP': ts,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}
