/**
 * HouseIT — CV Generation Worker
 * Proxies frontend requests to NVIDIA NIM, keeping the API key server-side.
 * Deploy target: Cloudflare Workers
 *
 * Env var required (set as a Worker Secret, never in code):
 *   NVIDIA_API_KEY
 *
 * Frontend calls: POST https://<your-worker>.workers.dev/generate
 * Body: { "prompt": "..." }
 */

const ALLOWED_ORIGINS = [
  "https://houseit-huespane-stasie.vercel.app",
  "https://houseit-git-main-huespane-stasie.vercel.app",
  "http://localhost:3000" // local testing only — remove before final production lock
];

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    let prompt;
    try {
      const body = await request.json();
      prompt = body.prompt;
      if (!prompt || typeof prompt !== "string") {
        throw new Error("Missing or invalid 'prompt' field");
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    try {
      const nimResponse = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        },
        body: JSON.stringify({
          model: "meta/llama-3.1-70b-instruct",
          messages: [
            {
              role: "system",
              content:
                "You are a professional CV writer for a South African internet café CV service called HouseIT. You produce clean, well-structured, professional CVs in plain text format. No markdown, no asterisks, no hashtags — just clean text with clear section headers in ALL CAPS. Keep it concise, professional, and tailored to the South African job market.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 1024,
          temperature: 0.7,
        }),
      });

      if (!nimResponse.ok) {
        const errText = await nimResponse.text();
        return new Response(JSON.stringify({ error: "NIM upstream error", detail: errText }), {
          status: 502,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      const data = await nimResponse.json();
      const cv = data.choices?.[0]?.message?.content || "";

      return new Response(JSON.stringify({ cv }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Worker error", detail: String(err) }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
  },
};
