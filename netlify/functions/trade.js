const https = require('https');
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');

const CREDS = {
  key: '44c916f2-a6e7-3cc7-9a17-d9b7969e5960',
  secret: 'ccStQQiZBJLNIei-DPSnFV0wvx--h0S8SCNKR-hNje8=',
  passphrase: 'ef6d912800357da4e74b2f551a50525765fef8fe166f3340026b879f3d4ea09c',
  wallet: '0x59C4538942576428A7EC8Ea3A0966AA3d6416A96'
};

// US residential proxies from Webshare
const PROXIES = [
  { host: '23.95.150.145', port: 6114 },
  { host: '198.23.239.134', port: 6540 },
  { host: '107.172.163.27', port: 6543 },
  { host: '216.10.27.159', port: 6837 }
];
const PROXY_USER = 'yuxojbiw';
const PROXY_PASS = '4sfnpgej42vg';

function getProxy() {
  return PROXIES[Math.floor(Math.random() * PROXIES.length)];
}

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
      const data = await proxyReq({ method: 'GET', path: '/balance', sig, ts });
      return { statusCode: 200, headers, body: data };
    }

    if (action === 'orders') {
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = sign('GET', '/orders', '', ts);
      const data = await proxyReq({ method: 'GET', path: '/orders', sig, ts });
      return { statusCode: 200, headers, body: data };
    }

    if (action === 'price') {
      const tokenId = params.token_id;
      if (!tokenId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing token_id' }) };
      const data = await proxyReq({ method: 'GET', path: '/midpoint?token_id=' + tokenId });
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
      const data = await proxyReq({ method: 'POST', path: '/order', body: orderBody, sig, ts });
      return { statusCode: 200, headers, body: data };
    }

    if (action === 'cancel') {
      const orderId = params.order_id;
      if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing order_id' }) };
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = sign('DELETE', '/order/' + orderId, '', ts);
      const data = await proxyReq({ method: 'DELETE', path: '/order/' + orderId, sig, ts });
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

// ── Route through US residential proxy ──────────────────────
function proxyReq({ method, path, body, sig, ts }) {
  return new Promise((resolve, reject) => {
    const proxy = getProxy();
    const targetHost = 'clob.polymarket.com';
    const auth = Buffer.from(PROXY_USER + ':' + PROXY_PASS).toString('base64');

    // First establish CONNECT tunnel through proxy
    const connectReq = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: targetHost + ':443',
      headers: {
        'Proxy-Authorization': 'Basic ' + auth,
        'Host': targetHost + ':443'
      }
    });

    connectReq.setTimeout(10000, () => {
      connectReq.destroy();
      reject(new Error('Proxy CONNECT timeout'));
    });

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error('Proxy CONNECT failed: ' + res.statusCode));
        return;
      }

      // Now make HTTPS request over the tunnel
      const reqHeaders = {
        'Host': targetHost,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://polymarket.com',
        'Referer': 'https://polymarket.com/'
      };

      if (sig) {
        reqHeaders['POLY_ADDRESS'] = CREDS.wallet;
        reqHeaders['POLY_API_KEY'] = CREDS.key;
        reqHeaders['POLY_PASSPHRASE'] = CREDS.passphrase;
        reqHeaders['POLY_SIGNATURE'] = sig;
        reqHeaders['POLY_TIMESTAMP'] = ts;
      }
      if (body) reqHeaders['Content-Length'] = Buffer.byteLength(body);

      const tlsSocket = require('tls').connect({
        host: targetHost,
        socket: socket,
        rejectUnauthorized: false
      }, () => {
        const reqLine = (method || 'GET') + ' ' + path + ' HTTP/1.1\r\n';
        const headerStr = Object.entries(reqHeaders).map(([k, v]) => k + ': ' + v).join('\r\n');
        tlsSocket.write(reqLine + headerStr + '\r\n\r\n');
        if (body) tlsSocket.write(body);

        let rawData = '';
        tlsSocket.on('data', chunk => rawData += chunk.toString('binary'));
        tlsSocket.on('end', () => {
          const bodyStart = rawData.indexOf('\r\n\r\n');
          if (bodyStart === -1) { resolve('{}'); return; }
          const responseBody = rawData.slice(bodyStart + 4);
          // Strip chunked encoding if present
          const cleaned = responseBody.replace(/^[0-9a-f]+\r\n/gmi, '').replace(/\r\n/g, '');
          resolve(cleaned);
        });
        tlsSocket.on('error', reject);
      });

      tlsSocket.on('error', reject);
    });

    connectReq.on('error', reject);
    connectReq.end();
  });
}
