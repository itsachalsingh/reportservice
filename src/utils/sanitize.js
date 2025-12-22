export function sanitizeText(value) {
  if (value === null || value === undefined) return undefined;
  let str = String(value);
  // Strip scripts/embedded active content and control chars.
  str = str.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  str = str.replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, "");
  str = str.replace(/<\s*object[^>]*>[\s\S]*?<\s*\/\s*object\s*>/gi, "");
  str = str.replace(/<\s*embed[^>]*>[\s\S]*?<\s*\/\s*embed\s*>/gi, "");
  str = str.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "");
  str = str.replace(/\son\w+\s*=\s*[^ >]+/gi, "");
  str = str.replace(/javascript\s*:/gi, "");
  str = str.replace(/data\s*:\s*text\/html/gi, "");
  str = str.replace(/[\u0000-\u001F\u007F]/g, "");
  return str.trim();
}

export function sanitizeDeep(input) {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map(sanitizeDeep);
  if (input instanceof Date) return input;
  if (typeof input === "object") {
    const out = {};
    for (const [key, val] of Object.entries(input)) {
      out[key] = sanitizeDeep(val);
    }
    return out;
  }
  if (typeof input === "string") return sanitizeText(input);
  return input;
}
