// StudioVault Cloudflare Worker API
// Handles audio streaming, metadata tagging (ID3v2), and R2 storage

function encodeSynchsafe(num) {
  return [
    (num >> 21) & 0x7f,
    (num >> 14) & 0x7f,
    (num >> 7) & 0x7f,
    num & 0x7f
  ];
}

function createTextFrame(id, text) {
  if (!text) return null;
  // UTF-16LE with BOM (0xFF, 0xFE)
  const encoder = new TextEncoder();
  const textChars = Array.from(String(text));
  const utf16Bytes = new Uint8Array(textChars.length * 2);
  for (let i = 0; i < textChars.length; i++) {
    const code = textChars[i].charCodeAt(0);
    utf16Bytes[i * 2] = code & 0xff;
    utf16Bytes[i * 2 + 1] = (code >> 8) & 0xff;
  }
  const payload = new Uint8Array(3 + utf16Bytes.length);
  payload[0] = 0x01; // UTF-16 with BOM
  payload[1] = 0xff;
  payload[2] = 0xfe;
  payload.set(utf16Bytes, 3);

  const header = new Uint8Array(10);
  const idBytes = encoder.encode(id);
  header.set(idBytes.subarray(0, 4), 0);
  const len = payload.length;
  header[4] = (len >> 24) & 0xff;
  header[5] = (len >> 16) & 0xff;
  header[6] = (len >> 8) & 0xff;
  header[7] = len & 0xff;

  const result = new Uint8Array(10 + payload.length);
  result.set(header, 0);
  result.set(payload, 10);
  return result;
}

function createApicFrame(imageBytes, mimeType) {
  if (!imageBytes || imageBytes.length === 0) return null;
  const encoder = new TextEncoder();
  const mime = encoder.encode((mimeType || 'image/jpeg') + '\0');
  const prefix = new Uint8Array(1 + mime.length + 2);
  prefix[0] = 0x00; // ISO-8859-1
  prefix.set(mime, 1);
  prefix[1 + mime.length] = 0x03; // Front cover
  prefix[1 + mime.length + 1] = 0x00; // Empty description null terminator

  const payload = new Uint8Array(prefix.length + imageBytes.length);
  payload.set(prefix, 0);
  payload.set(imageBytes, prefix.length);

  const header = new Uint8Array(10);
  header.set(encoder.encode('APIC'), 0);
  const len = payload.length;
  header[4] = (len >> 24) & 0xff;
  header[5] = (len >> 16) & 0xff;
  header[6] = (len >> 8) & 0xff;
  header[7] = len & 0xff;

  const result = new Uint8Array(10 + payload.length);
  result.set(header, 0);
  result.set(payload, 10);
  return result;
}

function injectId3v2(audioBytes, metadata, imageBytes) {
  const frames = [];
  if (metadata.title) frames.push(createTextFrame('TIT2', metadata.title));
  if (metadata.artist) frames.push(createTextFrame('TPE1', metadata.artist));
  if (metadata.album) frames.push(createTextFrame('TALB', metadata.album));
  if (metadata.albumArtist) frames.push(createTextFrame('TPE2', metadata.albumArtist));
  if (metadata.trackNumber) frames.push(createTextFrame('TRCK', String(metadata.trackNumber)));
  if (metadata.year) frames.push(createTextFrame('TYER', String(metadata.year)));
  if (imageBytes && imageBytes.length > 0) frames.push(createApicFrame(imageBytes, metadata.mimeType));

  const validFrames = frames.filter(Boolean);
  let totalFramesLen = 0;
  for (const f of validFrames) totalFramesLen += f.length;

  const id3Header = new Uint8Array(10);
  id3Header[0] = 0x49; // 'I'
  id3Header[1] = 0x44; // 'D'
  id3Header[2] = 0x33; // '3'
  id3Header[3] = 0x03; // v2.3
  id3Header[4] = 0x00;
  id3Header[5] = 0x00; // flags
  const synchsafe = encodeSynchsafe(totalFramesLen);
  for (let i = 0; i < 4; i++) {
    id3Header[6 + i] = synchsafe[i];
  }

  const out = new Uint8Array(10 + totalFramesLen + audioBytes.length);
  out.set(id3Header, 0);
  let offset = 10;
  for (const f of validFrames) {
    out.set(f, offset);
    offset += f.length;
  }
  out.set(audioBytes, offset);
  return out;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const r2PublicUrl = (env.R2_PUBLIC_URL || 'https://pub-12f92613d64a4104a74fb7662f0ddb07.r2.dev').replace(/\/+$/, '');

    // GET /api/tracks
    if (request.method === 'GET' && (url.pathname === '/api/tracks' || url.pathname === '/tracks.json')) {
      try {
        const obj = await env.BUCKET.get('tracks.json');
        if (!obj) {
          return new Response(JSON.stringify([]), {
            headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
          });
        }
        const text = await obj.text();
        return new Response(text, {
          headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        });
      } catch (err) {
        return new Response(JSON.stringify([]), {
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }
    }

    // POST /api/upload (Protected by x-admin-key)
    if (request.method === 'POST' && url.pathname === '/api/upload') {
      const adminKey = request.headers.get('x-admin-key') || '';
      const expectedKey = env.ADMIN_PASSWORD || 'ThoriiiAdmin2026!';
      if (adminKey !== expectedKey) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Incorrect Admin Password' }), {
          status: 401,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }

      try {
        const formData = await request.formData();
        const audioFile = formData.get('audio');
        const coverFile = formData.get('cover');
        const title = (formData.get('title') || '').trim();
        const artist = (formData.get('artist') || '').trim();
        const album = (formData.get('album') || '').trim();
        const albumArtist = (formData.get('albumArtist') || artist).trim();
        const trackNumber = (formData.get('trackNumber') || '').trim();
        const year = (formData.get('year') || new Date().getFullYear().toString()).trim();
        const author = (formData.get('author') || '').trim();
        const producer = (formData.get('producer') || '').trim();

        if (!audioFile || !title || !artist) {
          return new Response(JSON.stringify({ error: 'Audio file, title, and artist are required.' }), {
            status: 400,
            headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
          });
        }

        const trackId = `sv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const rawAudioBuffer = await audioFile.arrayBuffer();
        const rawAudioBytes = new Uint8Array(rawAudioBuffer);

        let coverBytes = null;
        let mimeType = 'image/jpeg';
        if (coverFile && typeof coverFile === 'object' && coverFile.size > 0) {
          coverBytes = new Uint8Array(await coverFile.arrayBuffer());
          mimeType = coverFile.type || 'image/jpeg';
        }

        // Inject ID3 Metadata tags & artwork directly into audio
        const metadata = {
          title,
          artist,
          album: album || 'StudioVault Singles',
          albumArtist: albumArtist || artist,
          trackNumber: trackNumber || '1',
          year: year || new Date().getFullYear().toString(),
          mimeType,
        };
        const taggedAudio = injectId3v2(rawAudioBytes, metadata, coverBytes);

        // Upload Tagged Audio to Cloudflare R2
        const audioPath = `audio/${trackId}.mp3`;
        const cleanDownloadName = `${artist} - ${title}.mp3`.replace(/[/\\?%*:|"<>]/g, '');
        await env.BUCKET.put(audioPath, taggedAudio, {
          httpMetadata: {
            contentType: 'audio/mpeg',
            contentDisposition: `attachment; filename="${cleanDownloadName}"`,
          },
        });

        // Upload Cover Art to Cloudflare R2 (if provided)
        let coverUrl = null;
        if (coverBytes && coverBytes.length > 0) {
          const coverPath = `covers/${trackId}.jpg`;
          await env.BUCKET.put(coverPath, coverBytes, {
            httpMetadata: { contentType: mimeType },
          });
          coverUrl = `${r2PublicUrl}/${coverPath}`;
        }

        const audioUrl = `${r2PublicUrl}/${audioPath}`;

        const newTrack = {
          id: trackId,
          title,
          artist,
          album: album || '',
          albumArtist: albumArtist || artist,
          trackNumber: trackNumber ? parseInt(trackNumber) : 1,
          year,
          author,
          producer,
          hasCover: !!coverUrl,
          coverUrl,
          audioUrl,
          downloadUrl: audioUrl,
          createdAt: new Date().toISOString(),
        };

        // Update tracks.json in R2
        let tracks = [];
        try {
          const existingObj = await env.BUCKET.get('tracks.json');
          if (existingObj) {
            tracks = JSON.parse(await existingObj.text());
          }
        } catch (e) {
          tracks = [];
        }

        // Add to beginning of tracklist
        tracks.unshift(newTrack);

        await env.BUCKET.put('tracks.json', JSON.stringify(tracks, null, 2), {
          httpMetadata: { contentType: 'application/json' },
        });

        return new Response(JSON.stringify({ success: true, track: newTrack, totalTracks: tracks.length }), {
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'Upload failed' }), {
          status: 500,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }
    }

    // DELETE /api/tracks/:id (Protected by x-admin-key)
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/tracks/')) {
      const adminKey = request.headers.get('x-admin-key') || '';
      const expectedKey = env.ADMIN_PASSWORD || 'ThoriiiAdmin2026!';
      if (adminKey !== expectedKey) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }

      const trackId = url.pathname.replace('/api/tracks/', '').trim();
      try {
        await env.BUCKET.delete(`audio/${trackId}.mp3`);
        await env.BUCKET.delete(`covers/${trackId}.jpg`);

        let tracks = [];
        const existingObj = await env.BUCKET.get('tracks.json');
        if (existingObj) {
          tracks = JSON.parse(await existingObj.text());
        }
        tracks = tracks.filter((t) => t.id !== trackId);
        await env.BUCKET.put('tracks.json', JSON.stringify(tracks, null, 2), {
          httpMetadata: { contentType: 'application/json' },
        });

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('StudioVault Cloudflare API', {
      headers: { ...corsHeaders(), 'Content-Type': 'text/plain' },
    });
  },
};
