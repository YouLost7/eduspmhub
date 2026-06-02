export const STUDENT_MAX_PRICE_CENTS = 5000;

export const LISTING_CATEGORIES = [
  { id: "books", label: "Books & textbooks" },
  { id: "notes", label: "Notes & summaries" },
  { id: "practice", label: "Practice questions" },
  { id: "other", label: "Other study materials" },
];

export const ITEM_TYPES = new Set(["physical", "digital"]);

export const LISTING_STATUSES = new Set(["draft", "active", "sold", "removed"]);

export const ORDER_STATUSES = new Set(["paid", "seller_ready", "completed", "cancelled"]);

export const CATEGORY_IDS = new Set(LISTING_CATEGORIES.map((c) => c.id));

export const MAX_PHOTOS = 4;

export const MAX_TITLE_LEN = 120;
export const MAX_DESC_LEN = 4000;
