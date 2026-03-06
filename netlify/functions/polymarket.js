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
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing endpoint' }) };
  }

  let targetUrl = '';

  try {
    if (endpoint === 'btc') {
      // CoinGecko — no region restrictions
      targetUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
    } else if (endpoint === 'markets') {
      targetUrl = 'https://gamma-api.polymarket.com/markets?active=true&tag=crypto&limit=50';
    } else if (endpoint === 'trades') {
      const marketId = params.market_id;
      if (!marketId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing market_id' }) };
      targetUrl = `https://data-api.polymarket.com/activity?market=${marketId}&limit=100`;
    } else if (endpoint === 'wallet') {
      const address = params.address || params.user;
      if (!address) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing address' }) };
      // Try both API endpoints
      try {
        const d1 = await fetchUrl(`https://data-api.polymarket.com/activity?user=${address}&limit=50`);
        return { statusCode: 200, headers, body: d1 };
      } catch(e1) {
        try {
          const d2 = await fetchUrl(`https://gamma-api.polymarket.com/trades?user=${address}&limit=50`);
          return { statusCode: 200, headers, body: d2 };
        } catch(e2) {
          return { statusCode: 200, headers, body: JSON.stringify([]) };
        }
      }
    } else if (endpoint === 'positions') {
      const address = params.address || params.user;
      if (!address) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing address' }) };
      try {
        const d1 = await fetchUrl(`https://data-api.polymarket.com/positions?user=${address}&sizeThreshold=0`);
        return { statusCode: 200, headers, body: d1 };
      } catch(e1) {
        try {
          const d2 = await fetchUrl(`https://gamma-api.polymarket.com/positions?user=${address}`);
          return { statusCode: 200, headers, body: d2 };
        } catch(e2) {
          return { statusCode: 200, headers, body: JSON.stringify([]) };
        }
      }
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown endpoint' }) };
    }

    const data = await fetchUrl(targetUrl);
    return { statusCode: 200, headers, body: data };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
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
