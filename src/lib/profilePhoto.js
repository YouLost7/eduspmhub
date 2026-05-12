/** Same-origin URL; session cookie is sent for img requests on the app origin. */
export function profilePhotoSrc(userId, avatarUploadedAt) {
  if (!userId) return "";
  const v = avatarUploadedAt ? encodeURIComponent(String(avatarUploadedAt)) : "0";
  return `/api/profile/photo/${encodeURIComponent(userId)}?v=${v}`;
}
