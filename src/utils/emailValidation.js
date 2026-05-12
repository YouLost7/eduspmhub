export function getEmailDomain(email) {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return "";
  return email.slice(atIndex + 1).toLowerCase();
}

export function isLikelySchoolEmail(email) {
  const domain = getEmailDomain(email);
  if (!domain) return false;

  const freeProviders = [
    "gmail.com",
    "yahoo.com",
    "yahoo.co.uk",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "aol.com",
    "icloud.com",
    "protonmail.com",
    "proton.me",
    "mail.com",
  ];
  if (freeProviders.includes(domain)) return false;

  return domain.includes("edu") || domain.includes("school");
}
