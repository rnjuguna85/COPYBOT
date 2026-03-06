const https = require('https');

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
  const endpoint = params.endpoint;

  if (!endpoint) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing endpoint parameter' })
    };
  }

  const allowed = [
    'gamma-api.polymarket.com',
    'data-api.polymarket.com',
    'clob.polymarket.com'
  ];

  let targetUrl = '';

  try {
    if (endpoint === 'markets') {
      targetUrl = 'https://gamma-api.polymarket.com/markets?active=true&tag=crypto&limit=50';
    } else if (endpoint === 'trades') {
      const marketId = params.market_id;
      if (!marketId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing market_id' }) };
      targetUrl = `https://data-api.polymarket.com/activity?market=${marketId}&limit=100`;
    } else if (endpoint === 'wallet') {
      const address = params.address;
      if (!address) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing address' }) };
      targetUrl = `https://data-api.polymarket.com/activity?user=${address}&limit=50`;
    } else if (endpoint === 'positions') {
      const address = params.address;
      if (!address) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing address' }) };
      targetUrl = `https://data-api.polymarket.com/positions?user=${address}&sizeThreshold=0`;
    } else if (endpoint === 'btc') {
      targetUrl = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown endpoint' }) };
    }

    const data = await fetchUrl(targetUrl);
    return { statusCode: 200, headers, body: data };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, url: targetUrl })
    };
  }
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
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
