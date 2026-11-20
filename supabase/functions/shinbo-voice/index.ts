// Shinbo's voice (optional). Turns Shinbo's replies into very natural speech with Microsoft Azure neural voices.
// Free tier: 500,000 characters a month. The key lives only in Supabase secrets, never in the website.
// Setup:   supabase secrets set AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=eastus   (set these yourself)
// Deploy:  supabase functions deploy shinbo-voice --no-verify-jwt
// Then put the function URL in SHINBO_TTS in index.html. If this ever fails, the site falls back to the browser's voice.

const ALLOWED_ORIGINS = [
  "https://rijvearefin-360.github.io",
  "https://rijvearefin.com",
  "https://www.rijvearefin.com",
];

// Soft, warm female voices. Ava is one of Azure's most natural English voices; Nabanita is a Bangladeshi Bangla voice.
const VOICES: Record<string, { name: string; lang: string; rate: string; pitch: string }> = {
  en: { name: "en-US-AvaMultilingualNeural", lang: "en-US", rate: "-4%", pitch: "+2%" },
  bn: { name: "bn-BD-NabanitaNeural", lang: "bn-BD", rate: "-6%", pitch: "+0%" },
};

const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 40;
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const ok = origin && ALLOWED_ORIGINS.includes(origin);
  const cors = {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST" || !ok) return new Response("forbidden", { status: 403, headers: cors });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (limited(ip)) return new Response("slow down", { status: 429, headers: cors });

  let body: { text?: string; lang?: string };
  try { body = await req.json(); } catch { return new Response("bad request", { status: 400, headers: cors }); }
  const text = String(body.text ?? "").trim().slice(0, 1200);
  if (!text) return new Response("bad request", { status: 400, headers: cors });
  const v = VOICES[body.lang === "bn" ? "bn" : "en"];

  const key = Deno.env.get("AZURE_SPEECH_KEY");
  const region = Deno.env.get("AZURE_SPEECH_REGION") ?? "eastus";
  if (!key) return new Response("not configured", { status: 503, headers: cors });

  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${v.lang}">` +
    `<voice name="${v.name}"><prosody rate="${v.rate}" pitch="${v.pitch}">${xmlEscape(text)}</prosody></voice></speak>`;

  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "shinbo-voice",
    },
    body: ssml,
  });
  if (!r.ok) {
    console.error("tts", r.status, await r.text().catch(() => ""));
    return new Response("unavailable", { status: 502, headers: cors });
  }
  return new Response(r.body, { headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
});
