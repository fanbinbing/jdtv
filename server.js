const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// 简易 XML 转 JSON（SeaCMS vod 格式）
function parseVodXml(xmlStr) {
  try {
    const getTag = (str, tag) => {
      const m = str.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    const getAttr = (str, tag, attr) => {
      const m = str.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'));
      return m ? m[1] : '';
    };
    const getAllTags = (str, tag) => {
      const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
      return str.match(re) || [];
    };

    const page = parseInt(getTag(xmlStr, 'page')) || 1;
    const pagecount = parseInt(getTag(xmlStr, 'pagecount')) || 1;
    const total = parseInt(getTag(xmlStr, 'recordcount')) || 0;

    const vodBlocks = getAllTags(xmlStr, 'video');
    const list = vodBlocks.map(block => {
      const ddBlocks = getAllTags(block, 'dd');
      let vod_play_from = [];
      let vod_play_url = [];
      ddBlocks.forEach(dd => {
        const flag = dd.match(/flag="([^"]*)"/i);
        const content = dd.replace(/<[^>]+>/g, '').trim();
        if (flag) {
          vod_play_from.push(flag[1]);
          vod_play_url.push(content);
        }
      });
      return {
        vod_id: getTag(block, 'id') || getAttr(block, 'id', 'id'),
        vod_name: getTag(block, 'name'),
        vod_pic: getTag(block, 'pic'),
        vod_remarks: getTag(block, 'note'),
        vod_year: getTag(block, 'year'),
        vod_area: getTag(block, 'area'),
        vod_lang: getTag(block, 'lang'),
        vod_director: getTag(block, 'director'),
        vod_actor: getTag(block, 'actor'),
        vod_content: getTag(block, 'des'),
        vod_time: getTag(block, 'last'),
        type_name: getTag(block, 'type'),
        vod_class: '',
        vod_play_from: vod_play_from.join('$$$'),
        vod_play_url: vod_play_url.join('$$$'),
      };
    });

    return { page, pagecount, total, list };
  } catch (e) {
    return null;
  }
}

const PORT = 8080;

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// API Proxy
function handleApiProxy(req, res) {
  const queryStr = req.url.split('?')[1] || '';
  const params = new URLSearchParams(queryStr);
  const targetUrl = params.get('url');

  if (!targetUrl) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'Missing url parameter' }));
    return;
  }

  console.log('[Proxy]', targetUrl);

  try {
    new URL(targetUrl);
  } catch (e) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'Invalid URL' }));
    return;
  }

  const protocol = targetUrl.startsWith('https') ? https : http;

  const requestOptions = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    timeout: 10000,
    rejectUnauthorized: false
  };

  protocol.get(targetUrl, requestOptions, (proxyRes) => {
    // Handle redirect
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      const redirectUrl = proxyRes.headers.location;
      console.log('[Proxy] Redirect to:', redirectUrl);
      const redirectProto = redirectUrl.startsWith('https') ? https : http;
      redirectProto.get(redirectUrl, requestOptions, (redirRes) => {
        let redirData = '';
        redirRes.on('data', c => redirData += c);
        redirRes.on('end', () => {
          try {
            const json = JSON.parse(redirData);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(json));
          } catch (e) {
            const xmlResult = parseVodXml(redirData);
            if (xmlResult) {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify(xmlResult));
            } else {
              console.error('[Proxy] Redirect JSON/XML parse error');
              res.writeHead(502);
              res.end(JSON.stringify({ error: 'Invalid response from redirect' }));
            }
          }
        });
      }).on('error', (err) => {
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'Redirect failed: ' + err.message }));
      });
      return;
    }

    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      console.log('[Proxy] Status:', proxyRes.statusCode, 'Length:', data.length);
      // 尝试 JSON 解析，失败则尝试 XML 解析
      try {
        const json = JSON.parse(data);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(json));
      } catch (e) {
        // 尝试 XML 解析（量子/豪华/红牛等 XML 接口）
        const xmlResult = parseVodXml(data);
        if (xmlResult) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(xmlResult));
        } else {
          console.error('[Proxy] JSON/XML parse error, first 200 chars:', data.substring(0, 200));
          res.writeHead(502);
          res.end(JSON.stringify({ error: 'Invalid JSON/XML response' }));
        }
      }
    });
    proxyRes.on('error', (err) => {
      console.error('[Proxy] Stream error:', err.message);
    });
  }).on('error', (err) => {
    console.error('[Proxy] Request error:', err.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'Proxy failed: ' + err.message }));
  });
}

// Static file server
function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = filePath.split('?')[0];
  filePath = path.join(__dirname, filePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not Found' : 'Server Error');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// Create server
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url.startsWith('/api')) {
    handleApiProxy(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log('Server running at http://localhost:' + PORT);
});
