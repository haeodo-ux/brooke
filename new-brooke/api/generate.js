module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, systemPrompt, history, stream, imageData, imageMime } = req.body;

    const messages = [];

    if (history && history.length > 0) {
      for (let i = 0; i < history.length; i++) {
        messages.push({ role: history[i].role, content: String(history[i].content) });
      }
    } else {
      if (imageData) {
        messages.push({
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imageMime || 'image/jpeg', data: imageData } },
            { type: 'text', text: prompt || 'Analyze this image.' }
          ]
        });
      } else {
        messages.push({ role: 'user', content: prompt || '' });
      }
    }

    const apiKey = process.env.ANTHROPIC_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    if (stream) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt || '',
          messages: messages,
          stream: true
        })
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(500).json({ error: err });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'content_block_delta' && data.delta && data.delta.text) {
                res.write(JSON.stringify({ text: data.delta.text }) + '\n');
              }
            } catch (e) {}
          }
        }
      }
      return res.end();

    } else {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          system: systemPrompt || '',
          messages: messages
        })
      });

      const data = await response.json();
      if (data.content && data.content[0] && data.content[0].text) {
        return res.status(200).json({ text: data.content[0].text });
      }
      return res.status(500).json({ error: 'No content returned', raw: data });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
