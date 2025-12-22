const EMAIL_ALLOWED_CHARS = /[^A-Za-z0-9@.]/g;

export function sanitizeText(value) {
  if (value === null || value === undefined) return undefined;
  let str = String(value);
  // Strip any HTML and control chars to block HTML/CSS/JS in input.
  str = str.replace(/<[^>]*>/g, "");
  str = str.replace(/javascript\s*:/gi, "");
  str = str.replace(/data\s*:\s*text\/html/gi, "");
  str = str.replace(/[\u0000-\u001F\u007F]/g, "");
  return str.trim();
}

export function sanitizeEmail(value) {
  if (value === null || value === undefined) return undefined;
  let str = String(value);
  str = sanitizeText(str);
  str = str.replace(EMAIL_ALLOWED_CHARS, "");
  const firstAt = str.indexOf("@");
  if (firstAt !== -1 && firstAt !== str.lastIndexOf("@")) {
    str = str.slice(0, firstAt + 1) + str.slice(firstAt + 1).replace(/@/g, "");
  }
  return str.trim();
}

export function sanitizeDeep(input, key) {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map((v) => sanitizeDeep(v, key));
  if (input instanceof Date) return input;
  if (typeof input === "object") {
    const out = {};
    for (const [key, val] of Object.entries(input)) {
      out[key] = sanitizeDeep(val, key);
    }
    return out;
  }
  if (typeof input === "string") {
    if (typeof key === "string" && key.toLowerCase().includes("email")) {
      return sanitizeEmail(input);
    }
    return sanitizeText(input);
  }
  return input;
}
