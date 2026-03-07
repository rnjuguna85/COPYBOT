const crypto = require('crypto');
const https = require('https');
const http = require('http');

const CREDS = {
  key: '44c916f2-a6e7-3cc7-9a17-d9b7969e5960',
  secret: 'ccStQQiZBJLNIei-DPSnFV0wvx--h0S8SCNKR-hNje8=',
  passphrase: 'ef6d912800357da4e74b2f551a50525765fef8fe166f3340026b879f3d4ea09c',
  wallet: '0x59C4538942576428A7EC8Ea3A0966AA3d6416A96'
};

const PROXY_HOST = 'p.webshare.io';
const PROXY_PORT = 80;
const PROXY_USER = 'yuxojbiw-AE-CH-FM-GB-GD-GF-GI-GM-GT-JE-JO-JP-KE-KG-KN-KR-KW-KZ-LA-LB-LC-LI-LK-LR-LS-LT-LU-LV-LY-MA-MC-MD-ME-MF-MG-MH-MK-ML-MM-MN-MO-MP-MQ-MR-MS-MT-MU-MV-MW-MX-MY-MZ-NA-NC-NE-NG-NI-NL-NO-NP-NZ-OM-PA-PE-PG-PH-PK-PL-PR-PS-PT-PW-PY-QA-RE-RO-RS-RU-RW-SA-SB-SC-SD-SE-SG-SH-SI-SK-SL-SM-SN-SO-SR-SS-ST-SX-SY-TC-TG-TH-TJ-TL-TN-TO-TR-TT-TW-TZ-UA-UG-UY-UZ-VC-VE-VG-VI-VN-VU-WS-YE-YT-ZA-ZM-ZW-US-rotate';
const PROXY_PASS = '4sfnpgej42vg';

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
      const sig = sign('GET', '/data/balance', '', ts);
      const data = await proxyReq({ method: 'GET', path: '/data/balance', sig, ts });
      return { statusCode: 200, headers, body: data };
    }
    if (action === 'orders') {
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = sign('GET', '/data/orders', '', ts);
      const data = await proxyReq({ method: 'GET', path: '/data/orders', sig, ts });
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
      const { tokenId, price, size, side } = body;
      if (!tokenId || !price || !size) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing tokenId, price, or size' }) };
      }
      const tradeSide = side || 'BUY';
      const orderBody = JSON.stringify({
        order: buildOrder(tokenId, price, size, tradeSide),
        owner: CREDS.wallet,
        orderType: 'GTC'
      });
      const ts = Math.floor(Date.now() / 1000).toString();
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
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: ' + action }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function sign(method, path, body, timestamp) {
  const pathOnly = path.split('?')[0];
  const msg = timestamp + method + pathOnly + (body || '');
  const hmac = crypto.createHmac('sha256', Buffer.from(CREDS.secret, 'base64'));
  hmac.update(msg);
  return hmac.digest('base64');
}

function buildOrder(tokenId, price, size, side) {
  const isBuy = side === 'BUY';
  const priceNum = parseFloat(price);
  const sizeNum = parseFloat(size);
  const makerAmount = isBuy
    ? String(Math.round(sizeNum * priceNum * 1e6))
    : String(Math.round(sizeNum * 1e6));
  const takerAmount = isBuy
    ? String(Math.round(sizeNum * 1e6))
    : String(Math.round(sizeNum * priceNum * 1e6));
  return {
    salt: String(Date.now()),
    maker: CREDS.wallet,
    signer: CREDS.wallet,
    taker: '0x0000000000000000000000000000000000000000',
    tokenId: String(tokenId),
    makerAmount,
    takerAmount,
    expiration: '0',
    nonce: '0',
    feeRateBps: '0',
    side: isBuy ? '0' : '1',
    signatureType: '0',
    signature: '0x'
  };
}

// Two-step: 1) HTTP CONNECT tunnel via proxy, 2) HTTPS request inside tunnel
function proxyReq({ method, path, body, sig, ts }) {
  return new Promise((resolve, reject) => {
    const targetHost = 'clob.polymarket.com';
    const targetPort = 443;
    const proxyAuth = 'Basic ' + Buffer.from(PROXY_USER + ':' + PROXY_PASS).toString('base64');

    // Step 1: Open HTTP connection to proxy and send CONNECT
    const connectReq = http.request({
      host: PROXY_HOST,
      port: PROXY_PORT,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: {
        'Host': `${targetHost}:${targetPort}`,
        'Proxy-Authorization': proxyAuth
      }
    });

    connectReq.setTimeout(15000, () => {
      connectReq.destroy();
      reject(new Error('CONNECT timeout'));
    });

    connectReq.on('connect', (res, socket, head) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error('Proxy CONNECT failed: HTTP/' + res.statusCode));
        return;
      }

      // Step 2: HTTPS request through the tunnel
      const reqHeaders = {
        'Host': targetHost,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Connection': 'close',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://polymarket.com',
        'Referer': 'https://polymarket.com/'
      };
      if (sig && ts) {
        reqHeaders['POLY_ADDRESS'] = CREDS.wallet;
        reqHeaders['POLY_API_KEY'] = CREDS.key;
        reqHeaders['POLY_PASSPHRASE'] = CREDS.passphrase;
        reqHeaders['POLY_SIGNATURE'] = sig;
        reqHeaders['POLY_TIMESTAMP'] = ts;
      }
      if (body) reqHeaders['Content-Length'] = String(Buffer.byteLength(body));

      const tlsReq = https.request({
        host: targetHost,
        port: targetPort,
        path: path,
        method: method || 'GET',
        headers: reqHeaders,
        socket: socket,
        agent: false,
        rejectUnauthorized: true
      }, (tlsRes) => {
        let data = '';
        tlsRes.on('data', chunk => data += chunk);
        tlsRes.on('end', () => resolve(data || '{}'));
      });

      tlsReq.setTimeout(15000, () => {
        tlsReq.destroy();
        reject(new Error('HTTPS request timeout'));
      });

      if (body) tlsReq.write(body);
      tlsReq.end();
      tlsReq.on('error', reject);
    });

    connectReq.on('error', reject);
    connectReq.end();
  });
}
