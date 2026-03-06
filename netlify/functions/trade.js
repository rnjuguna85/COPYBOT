const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');

const CLOB = 'clob.polymarket.com';

const CREDS = {
  key: '44c916f2-a6e7-3cc7-9a17-d9b7969e5960',
  secret: 'ccStQQiZBJLNIei-DPSnFV0wvx--h0S8SCNKR-hNje8=',
  passphrase: 'ef6d912800357da4e74b2f551a50525765fef8fe166f3340026b879f3d4ea09c',
  wallet: '0x59C4538942576428A7EC8Ea3A0966AA3d6416A96'
};

const SPOOF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://polymarket.com',
  'Referer': 'https://polymarket.com/',
  'CF-IPCountry': 'US',
  'X-Forwarded-For': '172.217.164.46',
  'X-Real-IP': '172.217.164.46',
  'Content-Type': 'application/json'
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
      const data = await clobReq({ method: 'GET', path: '/balance', sig, ts });
      return { statusCode: 200, headers, body: data };
    }

    if (action === 'orders') {
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = sign('GET', '/orders', '', ts);
      const data = await clobReq({ method: 'GET', path: '/orders', sig, ts });
      return { statusCode: 200, headers, body: data };
    }

    if (action === 'price') {
      const tokenId = params.token_id;
      if (!tokenId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing token_id' }) };
      const data = await clobReq({ method: 'GET', path: '/midpoint?token_id=' + tokenId });
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
      const data = await clobReq({ method: 'POST', path: '/order', body: orderBody, sig, ts });
      return { statusCode: 200, headers, body: data };
    }

    if (action === 'cancel') {
      const orderId = params.order_id;
      if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing order_id' }) };
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = sign('DELETE', '/order/' + orderId, '', ts);
      const data = await clobReq({ method: 'DELETE', path: '/order/' + orderId, sig, ts });
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

// ── Universal CLOB request with gzip decompression ───────────
function clobReq({ method, path, body, sig, ts }) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { ...SPOOF_HEADERS };
    if (sig) {
      reqHeaders['POLY_ADDRESS'] = CREDS.wallet;
      reqHeaders['POLY_API_KEY'] = CREDS.key;
      reqHeaders['POLY_PASSPHRASE'] = CREDS.passphrase;
      reqHeaders['POLY_SIGNATURE'] = sig;
      reqHeaders['POLY_TIMESTAMP'] = ts;
    }
    if (body) reqHeaders['Content-Length'] = Buffer.byteLength(body);

    const options = { hostname: CLOB, path, method: method || 'GET', headers: reqHeaders };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];
        if (encoding === 'gzip') {
          zlib.gunzip(buf, (err, decoded) => {
            if (err) reject(err);
            else resolve(decoded.toString('utf8'));
          });
        } else if (encoding === 'br') {
          zlib.brotliDecompress(buf, (err, decoded) => {
            if (err) reject(err);
            else resolve(decoded.toString('utf8'));
          });
        } else if (encoding === 'deflate') {
          zlib.inflate(buf, (err, decoded) => {
            if (err) reject(err);
            else resolve(decoded.toString('utf8'));
          });
        } else {
          resolve(buf.toString('utf8'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}
