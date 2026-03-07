const crypto = require('crypto');
const net = require('net');
const tls = require('tls');

const CREDS = {
  key: '44c916f2-a6e7-3cc7-9a17-d9b7969e5960',
  secret: 'ccStQQiZBJLNIei-DPSnFV0wvx--h0S8SCNKR-hNje8=',
  passphrase: 'ef6d912800357da4e74b2f551a50525765fef8fe166f3340026b879f3d4ea09c',
  wallet: '0x59C4538942576428A7EC8Ea3A0966AA3d6416A96'
};

// Webshare rotating residential - correct port for auth
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

function proxyReq({ method, path, body, sig, ts }) {
  return new Promise((resolve, reject) => {
    const targetHost = 'clob.polymarket.com';
    const targetPort = 443;
    const auth = Buffer.from(PROXY_USER + ':' + PROXY_PASS).toString('base64');

    const socket = net.createConnection(PROXY_PORT, PROXY_HOST, () => {
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        `Proxy-Authorization: Basic ${auth}\r\n` +
        `Proxy-Connection: Keep-Alive\r\n` +
        `\r\n`
      );
    });

    socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('Socket timeout')); });

    let connectResponse = '';
    let upgraded = false;

    socket.on('data', (chunk) => {
      if (upgraded) return;
      connectResponse += chunk.toString();
      if (connectResponse.includes('\r\n\r\n')) {
        if (!connectResponse.includes('200')) {
          socket.destroy();
          reject(new Error('Proxy CONNECT failed: ' + connectResponse.split('\r\n')[0]));
          return;
        }
        upgraded = true;
        socket.removeAllListeners('data');

        const tlsSocket = tls.connect({ socket, servername: targetHost, rejectUnauthorized: true }, () => {
          const reqHeaders = {
            'Host': targetHost,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Accept-Encoding': 'identity',
            'Connection': 'close',
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
          if (body) reqHeaders['Content-Length'] = String(Buffer.byteLength(body));

          let req = `${method || 'GET'} ${path} HTTP/1.1\r\n`;
          for (const [k, v] of Object.entries(reqHeaders)) req += `${k}: ${v}\r\n`;
          req += '\r\n';
          if (body) req += body;
          tlsSocket.write(req);

          let raw = Buffer.alloc(0);
          tlsSocket.on('data', (chunk) => { raw = Buffer.concat([raw, chunk]); });
          tlsSocket.on('end', () => {
            const str = raw.toString('utf8');
            const idx = str.indexOf('\r\n\r\n');
            if (idx === -1) { resolve('{}'); return; }
            let respBody = str.slice(idx + 4);
            if (str.toLowerCase().includes('transfer-encoding: chunked')) respBody = unchunk(respBody);
            resolve(respBody.trim() || '{}');
          });
          tlsSocket.on('error', reject);
        });
        tlsSocket.on('error', reject);
      }
    });
    socket.on('error', reject);
  });
}

function unchunk(data) {
  let result = '', pos = 0;
  while (pos < data.length) {
    const lineEnd = data.indexOf('\r\n', pos);
    if (lineEnd === -1) break;
    const size = parseInt(data.slice(pos, lineEnd), 16);
    if (isNaN(size) || size === 0) break;
    result += data.slice(lineEnd + 2, lineEnd + 2 + size);
    pos = lineEnd + 2 + size + 2;
  }
  return result || data;
}
