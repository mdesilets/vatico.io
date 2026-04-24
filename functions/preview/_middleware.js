/**
 * Cloudflare Pages Function — gate every request under /preview/* behind a
 * single shared password set as the PREVIEW_PASSWORD environment variable.
 *
 * Auth flow:
 *   1. Compare submitted password (POST form `password`) against PREVIEW_PASSWORD.
 *   2. On match, set an HttpOnly cookie containing sha256(password) and 303-redirect
 *      back to the originally requested path.
 *   3. On every subsequent request, hash PREVIEW_PASSWORD again and require the
 *      cookie to match. No state stored anywhere.
 *
 * The cookie value is a hash, so the raw password is never written to disk or sent
 * back to the browser. Rotating PREVIEW_PASSWORD invalidates every existing cookie.
 */

const COOKIE_NAME = "vatico_preview_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export const onRequest = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  const password = env.PREVIEW_PASSWORD;
  if (!password) {
    return new Response(
      "PREVIEW_PASSWORD environment variable is not set on this deployment.",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const expectedToken = await sha256(password);

  // Explicit logout endpoint: clear cookie, send back to gate.
  if (url.pathname === "/preview/__logout") {
    const headers = new Headers({ Location: "/preview/" });
    headers.append(
      "Set-Cookie",
      `${COOKIE_NAME}=; Path=/preview; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
    );
    return new Response(null, { status: 303, headers });
  }

  // Login attempt: any POST under /preview/* with a `password` form field.
  if (request.method === "POST") {
    const ct = request.headers.get("Content-Type") || "";
    const isForm =
      ct.includes("application/x-www-form-urlencoded") ||
      ct.includes("multipart/form-data");
    if (isForm) {
      const fd = await request.formData();
      const submitted = String(fd.get("password") || "");
      const submittedToken = await sha256(submitted);
      if (submittedToken === expectedToken && submitted.length > 0) {
        const headers = new Headers({ Location: url.pathname });
        headers.append(
          "Set-Cookie",
          `${COOKIE_NAME}=${expectedToken}; Path=/preview; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`
        );
        return new Response(null, { status: 303, headers });
      }
      return htmlResponse(loginPage({ error: true }), 401);
    }
  }

  // Cookie check.
  const token = parseCookies(request.headers.get("Cookie") || "")[COOKIE_NAME];
  if (token && token === expectedToken) {
    return next();
  }

  return htmlResponse(loginPage({ error: false }), 401);
};

const sha256 = async (text) => {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const parseCookies = (header) =>
  Object.fromEntries(
    header
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const idx = p.indexOf("=");
        return idx === -1
          ? [p, ""]
          : [p.slice(0, idx), p.slice(idx + 1)];
      })
  );

const htmlResponse = (html, status = 200) =>
  new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });

// Inline Vatico wordmark — keeps the lock screen self-contained so it can render
// before any /preview/* asset request would be served.
const VATICO_LOGO_SVG = `<svg viewBox="0 0 1310.58 350.5" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vatico"><g fill="currentColor"><path d="M633.53,287.91c11.69,23.65,41.58,18.89,62.22,8.6l11.7,41.46c-39.68,22.13-104,16.14-122.46-30.04-5.37-13.43-7.24-27.42-7.23-42.04l.02-113.8-38.21-.45.27-41.53,37.89-.17.06-74.65,51.18-9.21.13,83.95h163.13s.17,235.02.17,235.02l-51.19.15-.04-193.23-112.09-.12-.12,112.29c.88,8.41,2.31,16.03,4.58,23.77Z"/><path d="M509.19,345.04l-50.31.16-.84-33.62c-13.84,18.33-30.78,30.55-52.82,35.67-50.11,11.63-102.61-10.74-128.27-55.15-31.67-54.79-18.71-126.18,32.2-163.84,44.44-32.87,115.92-31.4,148.79,14.68l.99-32.94,50.23.15.05,234.89ZM396.23,304.23c24.92-3.64,44.17-17.48,54.36-39.59,13.03-28.25,9.37-61.15-8.92-86.19-13.04-17.86-32.07-27.04-54.11-27.93-27.53-1.12-52.5,12.11-65.66,36.81-11.56,21.69-13.24,47.78-4.82,70.98,11.91,32.85,43.99,51.06,79.15,45.92Z"/><path d="M1310.57,227.75c-.3,78.3-66.94,132.55-144.53,121.2-40.34-5.9-75-29.9-92.58-66.92-23.19-48.83-12.62-107.39,26.82-144.12,27.14-25.28,62.85-34.65,99.22-31.52,64.2,5.53,111.31,57.16,111.07,121.36ZM1248.6,269.52c15-28.9,13.65-63.44-4.08-89.73-13.46-19.97-34.08-29.13-57.63-29.31-25.78-.2-49.11,10.96-62.33,34-15.06,26.24-14.82,59.71-.11,86.04,13.13,23.51,36.16,35.23,62.47,34.91,26.02-.32,49.18-11.82,61.68-35.91Z"/><path d="M194.06,135.88c6.74-15.82,21.31-25.69,36.87-25.88,9.9-.12,18.63.1,28.25.68l-102.08,234.57-54.93-.24L0,110.33l34.16-.23c15.03,3.28,26.23,12.76,32.42,27.25l63.52,148.69,63.95-150.16Z"/><path d="M888.17,262.09c12.02,27.86,37.81,43.79,67.4,43.15,23.36.49,44.32-8.38,60.02-27.15l32.34,32.72c-28.5,30.89-69.05,43.97-110.12,38.46-42.74-5.74-79.48-30.16-97.71-69.72-22.07-47.9-11.11-105.51,27.44-141.37,48-44.66,135.99-44.32,180.27,6.05l-32.44,35.3c-14.71-19.26-35.67-29.05-59.78-29.11-28.61-.07-53.59,13.99-66.09,40.24-10.57,22.18-11.41,48.07-1.34,71.43Z"/><path d="M760.81.48c20.51-3.3,36.73,10.96,39.6,28.92,3.02,18.9-10.44,36.16-28.3,39.37-19.02,3.42-36.38-9.49-39.77-27.42-3.53-18.68,8.74-37.7,28.47-40.88Z"/></g></svg>`;

const loginPage = ({ error }) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Vatico — private preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #08090d;
    --text: #e4e8f4;
    --muted: #5a6180;
    --muted-2: #8892b0;
    --border: #1c2032;
    --border-2: #252b3b;
    --blue: #3B82F6;
    --green: #10B981;
    --purple: #A855F7;
    --grad-hero: linear-gradient(100deg, #10B981 0%, #3B82F6 50%, #A855F7 100%);
    --font-sans: "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif;
    --font-mono: ui-monospace, "Cascadia Code", Consolas, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  html { background: var(--bg); }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-sans);
    min-height: 100svh;
    display: grid;
    grid-template-rows: auto 1fr auto;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .glow {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background:
      radial-gradient(ellipse 60% 45% at 18% 30%, rgba(59,130,246,0.07) 0%, rgba(59,130,246,0) 60%),
      radial-gradient(ellipse 50% 45% at 88% 75%, rgba(168,85,247,0.04) 0%, rgba(168,85,247,0) 65%);
  }
  header {
    position: relative; z-index: 2;
    padding: 28px 40px;
    display: flex; align-items: center;
  }
  .wordmark { color: var(--text); display: block; height: 22px; }
  .wordmark svg { height: 100%; width: auto; display: block; }
  main {
    position: relative; z-index: 2;
    padding: 40px 40px 80px;
    max-width: 980px;
    width: 100%;
    margin: 0 auto;
    align-self: center;
  }
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 32px;
  }
  .eyebrow .num { color: var(--muted-2); margin-right: 12px; }
  .heading {
    font-family: var(--font-sans);
    font-weight: 900;
    font-size: clamp(2.4rem, 6.5vw, 5.6rem);
    line-height: 1;
    letter-spacing: -0.045em;
    margin: 0;
    max-width: 18ch;
  }
  .heading .line { display: block; text-box: trim-both cap alphabetic; -webkit-text-box-trim: both; -webkit-text-box-edge: cap alphabetic; }
  .heading .line:nth-child(2) { margin-top: 0.20em; }
  .ink-grad {
    background: var(--grad-hero);
    background-size: 200% 100%;
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
    animation: gradShift 16s ease-in-out infinite;
  }
  @keyframes gradShift {
    0%, 100% { background-position: 0% 50%; }
    50%      { background-position: 100% 50%; }
  }
  .sub {
    margin-top: 36px;
    font-size: 1.05rem;
    line-height: 1.55;
    color: var(--muted-2);
    max-width: 52ch;
    font-weight: 500;
  }
  form {
    margin-top: 44px;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    max-width: 520px;
  }
  input[type="password"] {
    background: rgba(18,21,28,0.6);
    border: 1px solid var(--border-2);
    border-radius: 6px;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 1rem;
    padding: 14px 16px;
    outline: none;
    transition: border-color 120ms ease, background 120ms ease;
    width: 100%;
  }
  input[type="password"]::placeholder { color: var(--muted); }
  input[type="password"]:focus {
    border-color: var(--blue);
    background: rgba(18,21,28,0.85);
  }
  button {
    background: var(--text);
    color: var(--bg);
    border: 0;
    border-radius: 6px;
    font-family: var(--font-sans);
    font-weight: 700;
    font-size: 0.95rem;
    letter-spacing: 0.01em;
    padding: 14px 22px;
    cursor: pointer;
    transition: opacity 120ms ease, transform 120ms ease;
  }
  button:hover { opacity: 0.92; }
  button:active { transform: translateY(1px); }
  .err {
    margin-top: 14px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #f87171;
    min-height: 14px;
  }
  footer {
    position: relative; z-index: 2;
    padding: 24px 40px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    display: flex; justify-content: space-between; align-items: center;
  }
  @media (max-width: 640px) {
    header, main, footer { padding-left: 22px; padding-right: 22px; }
    form { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
  <div class="glow" aria-hidden="true"></div>
  <header>
    <div class="wordmark" aria-label="Vatico">${VATICO_LOGO_SVG}</div>
  </header>
  <main>
    <div class="eyebrow"><span class="num">00</span>private preview</div>
    <h1 class="heading">
      <span class="line"><span class="ink-grad">Private</span></span>
      <span class="line">preview.</span>
    </h1>
    <p class="sub">
      Enter the access phrase you were given to continue.
    </p>
    <form method="POST" action="" autocomplete="off" novalidate>
      <input type="password" name="password" placeholder="access phrase" required autofocus aria-label="Access phrase">
      <button type="submit">Enter &rarr;</button>
    </form>
    <div class="err" role="alert" aria-live="polite">${error ? "incorrect" : ""}</div>
  </main>
  <footer>
    <span>medical aesthetics, on the record</span>
    <span>&copy; 2026</span>
  </footer>
</body>
</html>`;
