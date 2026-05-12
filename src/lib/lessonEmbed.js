/** Parse YouTube or Vimeo URL — free hosts, no API keys. */

export function parseExternalVideoUrl(input) {
  let s = String(input ?? "").trim();
  if (!s) return null;
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");
  s = s.replace(/youtube\.com\/watch\/\?/i, "youtube.com/watch?");
  if (!/^https?:\/\//i.test(s) && /youtube\.com|youtu\.be|vimeo\.com/i.test(s)) {
    s = `https://${s}`;
  }
  const yt =
    /(?:youtube\.com\/(?:watch\?(?:[^#&]*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/.exec(
      s
    );
  if (yt && /^[a-zA-Z0-9_-]{11}$/.test(yt[1])) return { provider: "youtube", id: yt[1] };
  const vmPlayer = /player\.vimeo\.com\/video\/(\d{4,12})(?:\D|$)/.exec(s);
  if (vmPlayer) return { provider: "vimeo", id: vmPlayer[1] };
  const vm = /vimeo\.com\/(?:video\/)?(\d{4,12})(?:\D|$)/.exec(s);
  if (vm) return { provider: "vimeo", id: vm[1] };
  return null;
}

export function isValidEmbedObject(ev) {
  if (!ev || typeof ev !== "object") return false;
  if (ev.provider === "youtube")
    return typeof ev.id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(ev.id);
  if (ev.provider === "vimeo") return typeof ev.id === "string" && /^\d{4,12}$/.test(ev.id);
  return false;
}

export function youtubeEmbedSrc(videoId) {
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?rel=0&modestbranding=1`;
}

export function vimeoEmbedSrc(videoId) {
  return `https://player.vimeo.com/video/${encodeURIComponent(videoId)}`;
}
