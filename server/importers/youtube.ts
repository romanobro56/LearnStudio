import { fetchHtml } from './web.ts';

export function isYoutube(url: string) {
  return /(?:youtube\.com|youtu\.be)\//.test(url);
}

export function videoId(url: string): string | null {
  const m = url.match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})|\/embed\/([\w-]{11})|\/shorts\/([\w-]{11})/);
  return m ? m[1] || m[2] || m[3] || m[4] : null;
}

export async function videoTitle(url: string): Promise<string> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (r.ok) return (await r.json()).title;
  } catch {}
  return 'Video';
}

// Expand a YouTube URL into its videos (a single video, or every video of a playlist).
export async function expandYoutube(url: string): Promise<{ url: string; title: string }[]> {
  const list = url.match(/[?&]list=([\w-]+)/)?.[1];
  const vid = videoId(url);
  if (list && (!vid || /playlist/.test(url))) {
    const html = await fetchHtml(`https://www.youtube.com/playlist?list=${list}`);
    const out: { url: string; title: string }[] = [];
    const seen = new Set<string>();
    const add = (id?: string, title?: string) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ url: `https://www.youtube.com/watch?v=${id}`, title: title || 'Video' });
    };
    const data = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
    if (data) {
      // Both the older playlistVideoRenderer and the newer lockupViewModel layouts.
      const walk = (o: any) => {
        if (!o || typeof o !== 'object') return;
        if (o.playlistVideoRenderer) add(o.playlistVideoRenderer.videoId, o.playlistVideoRenderer.title?.runs?.[0]?.text);
        if (o.lockupViewModel?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') add(o.lockupViewModel.contentId, o.lockupViewModel.metadata?.lockupMetadataViewModel?.title?.content);
        for (const k in o) walk(o[k]);
      };
      try { walk(JSON.parse(data)); } catch {}
    }
    if (out.length) return out;
  }
  if (vid) return [{ url: `https://www.youtube.com/watch?v=${vid}`, title: await videoTitle(url) }];
  throw new Error('Could not read that YouTube link');
}
