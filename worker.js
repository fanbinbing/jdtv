export default {
  async fetch(request) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    // CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    // 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders }
      });
    }

    try {
      new URL(targetUrl);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders }
      });
    }

    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
      });

      const text = await res.text();

      try {
        const json = JSON.parse(text);
        return new Response(JSON.stringify(json), {
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders }
        });
      } catch {
        if (text.trim().startsWith('<?xml') || text.includes('<rss')) {
          return new Response(text, {
            headers: { 'Content-Type': 'application/xml; charset=utf-8', ...corsHeaders }
          });
        }
        return new Response(text, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders }
        });
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders }
      });
    }
  }
};
