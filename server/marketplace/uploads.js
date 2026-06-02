import path from "node:path";

const PHOTO_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DIGITAL_EXT = new Set([".pdf", ".zip"]);

export function resolvedMarketplacePhotoMeta(file) {
  const original = String(file?.originalname || "").toLowerCase();
  const ext = path.extname(original);
  if (!PHOTO_EXT.has(ext)) return null;
  const mime = String(file?.mimetype || "").toLowerCase();
  if (mime.startsWith("image/")) return { ext };
  return null;
}

export function resolvedMarketplaceDigitalMeta(file) {
  const original = String(file?.originalname || "").toLowerCase();
  const ext = path.extname(original);
  if (!DIGITAL_EXT.has(ext)) return null;
  if (ext === ".pdf" && file?.mimetype === "application/pdf") return { ext };
  if (
    ext === ".zip" &&
    (file?.mimetype === "application/zip" ||
      file?.mimetype === "application/x-zip-compressed")
  ) {
    return { ext };
  }
  if (ext === ".pdf" || ext === ".zip") return { ext };
  return null;
}

function keySuffixMatchesListing(key, listingId, extPattern) {
  const k = String(key || "");
  const lid = String(listingId || "");
  const prefix = `${lid}-`;
  if (!lid || !k.startsWith(prefix)) return false;
  return new RegExp(`^${extPattern}$`, "i").test(k.slice(prefix.length));
}

export function isSafeMarketplacePhotoKey(key, listingId) {
  return keySuffixMatchesListing(key, listingId, "[a-f0-9-]{36}\\.(jpg|jpeg|png|webp)");
}

export function isSafeMarketplaceDigitalKey(key, listingId) {
  return keySuffixMatchesListing(key, listingId, "[a-f0-9-]{36}\\.(pdf|zip)");
}
