/**
 * HouseIT — CV Generation + PDF Render Worker
 * Routes:
 *   POST /generate     -> { prompt } => { cv: CVSchema }        (NIM call, schema-locked JSON)
 *   POST /render-pdf    -> { cv: CVSchema } => application/pdf   (pdf-lib, fixed layout)
 *
 * Env secret required: NVIDIA_API_KEY
 * Dependency: pdf-lib (npm install pdf-lib, bundled via wrangler)
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const ALLOWED_ORIGINS = [
  "https://houseit-huespane-stasie.vercel.app",
  "https://houseit-git-main-huespane-stasie.vercel.app",
  "http://localhost:3000"
];

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

const SCHEMA_INSTRUCTIONS = `You are a CV data extraction engine for HouseIT, a South African internet café CV service.
Return ONLY valid JSON — no markdown, no prose, no code fences, no explanation. Exact shape:
{
  "candidate": {"name": "", "phone": "", "email": "", "city": ""},
  "target": {"role": "", "summary": ""},
  "experience": [{"title": "", "employer": "", "start": "", "end": "", "duties": ""}],
  "education": [{"qualification": "", "institution": "", "year": "", "subjects": ""}],
  "skills": ["", ""]
}
Keep "duties" to one concise sentence per role (max ~120 characters) — it will be rendered in a fixed-height PDF field and must not overflow.
If a field has no data, use an empty string or empty array. Do not invent employers, dates, or qualifications not implied by the input.`;

async function callNim(env, prompt) {
  const nimResponse = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: "meta/llama-3.1-70b-instruct",
      messages: [
        { role: "system", content: SCHEMA_INSTRUCTIONS },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
      temperature: 0.4,
    }),
  });
  if (!nimResponse.ok) {
    throw new Error(`NIM upstream error: ${await nimResponse.text()}`);
  }
  const data = await nimResponse.json();
  return data.choices?.[0]?.message?.content || "";
}

function tryParseSchema(raw) {
  // Strip accidental code fences if the model adds them anyway
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  // Minimal shape guard — fill any missing top-level keys so the renderer never crashes
  return {
    candidate: { name: "", phone: "", email: "", city: "", ...(parsed.candidate || {}) },
    target: { role: "", summary: "", ...(parsed.target || {}) },
    experience: Array.isArray(parsed.experience) ? parsed.experience : [],
    education: Array.isArray(parsed.education) ? parsed.education : [],
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
  };
}

async function handleGenerate(request, env, headers) {
  let prompt;
  try {
    const body = await request.json();
    prompt = body.prompt;
    if (!prompt || typeof prompt !== "string") throw new Error("Missing 'prompt'");
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const raw = await callNim(env, prompt);
    let schema;
    try {
      schema = tryParseSchema(raw);
    } catch {
      // one retry, explicitly telling the model it failed
      const retryRaw = await callNim(env, `${prompt}\n\nYour previous response was not valid JSON. Return ONLY the JSON object, nothing else.`);
      schema = tryParseSchema(retryRaw); // let this throw if it fails twice — surfaces as 502 below
    }
    return new Response(JSON.stringify({ cv: schema }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Generation failed", detail: String(err) }), {
      status: 502,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
}

// Wraps text to a max character width per line, returns array of lines (no reflow beyond maxLines)
function wrapText(text, maxCharsPerLine, maxLines) {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length > maxCharsPerLine) {
      lines.push(current.trim());
      current = w;
      if (lines.length === maxLines) break;
    } else {
      current = (current + " " + w).trim();
    }
  }
  if (current && lines.length < maxLines) lines.push(current.trim());
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxCharsPerLine - 1) + "…";
  }
  return lines;
}

async function renderCVPdf(cv) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]); // A4 points
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const body = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.05, 0.05, 0.05);
  const accent = rgb(0.78, 0.38, 0.1);
  const margin = 50;
  const pageWidth = 595;
  const colWidth = pageWidth - margin * 2;
  let y = 792;

  function ensureSpace(needed) {
    if (y - needed < 50) {
      page = pdfDoc.addPage([595, 842]);
      y = 792;
    }
  }

  function heading(text) {
    ensureSpace(28);
    y -= 4;
    page.drawText(text.toUpperCase(), { x: margin, y, size: 11, font: bold, color: accent });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: margin + colWidth, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 16;
  }

  function paragraph(text, size = 10, lineHeight = 13, maxLines = 6) {
    const lines = wrapText(text, 95, maxLines);
    for (const line of lines) {
      ensureSpace(lineHeight);
      page.drawText(line, { x: margin, y, size, font: body, color: ink });
      y -= lineHeight;
    }
  }

  // Header
  page.drawText(cv.candidate.name || "Candidate Name", { x: margin, y, size: 22, font: bold, color: ink });
  y -= 20;
  const contactLine = [cv.candidate.phone, cv.candidate.email, cv.candidate.city].filter(Boolean).join("  |  ");
  page.drawText(contactLine, { x: margin, y, size: 9, font: body, color: rgb(0.4, 0.4, 0.4) });
  y -= 24;

  if (cv.target.role) {
    heading(`Target Role: ${cv.target.role}`);
  }
  if (cv.target.summary) {
    heading("Professional Summary");
    paragraph(cv.target.summary, 10, 13, 4);
    y -= 6;
  }

  if (cv.experience.length) {
    heading("Work Experience");
    for (const exp of cv.experience) {
      ensureSpace(40);
      page.drawText(`${exp.title || "Role"} — ${exp.employer || "Employer"}`, { x: margin, y, size: 10, font: bold, color: ink });
      const dateStr = [exp.start, exp.end].filter(Boolean).join(" – ");
      if (dateStr) {
        const w = bold.widthOfTextAtSize(`${exp.title || "Role"} — ${exp.employer || "Employer"}`, 10);
        page.drawText(dateStr, { x: margin + colWidth - body.widthOfTextAtSize(dateStr, 9), y, size: 9, font: body, color: rgb(0.4, 0.4, 0.4) });
      }
      y -= 14;
      paragraph(exp.duties || "", 9.5, 12, 3);
      y -= 6;
    }
  }

  if (cv.education.length) {
    heading("Education");
    for (const ed of cv.education) {
      ensureSpace(24);
      const line = `${ed.qualification || "Qualification"} — ${ed.institution || "Institution"}${ed.year ? " (" + ed.year + ")" : ""}`;
      page.drawText(line, { x: margin, y, size: 10, font: body, color: ink });
      y -= 14;
      if (ed.subjects) {
        paragraph(ed.subjects, 9, 11, 2);
      }
      y -= 4;
    }
  }

  if (cv.skills.length) {
    heading("Skills");
    paragraph(cv.skills.join(" • "), 10, 13, 4);
  }

  return pdfDoc.save();
}

async function handleRenderPdf(request, headers) {
  let cv;
  try {
    const body = await request.json();
    cv = body.cv;
    if (!cv || !cv.candidate) throw new Error("Missing 'cv' schema");
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const pdfBytes = await renderCVPdf(cv);
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${(cv.candidate.name || "cv").replace(/\s+/g, "_")}_CV.pdf"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "PDF render failed", detail: String(err) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/generate") return handleGenerate(request, env, headers);
    if (url.pathname === "/render-pdf") return handleRenderPdf(request, headers);

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  },
};
