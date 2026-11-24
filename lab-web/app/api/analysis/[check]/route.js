const backend = process.env.LAB_BACKEND_URL || "http://127.0.0.1:8000";
const checks = new Set(["skin", "cleft", "dental", "eye", "gait"]);

export async function POST(request, { params }) {
  const { check } = await params;
  if (!checks.has(check)) return Response.json({ detail: "Unknown assessment." }, { status: 404 });
  const type = request.headers.get("content-type") || "";
  const expected = check === "gait" ? "application/json" : "multipart/form-data";
  if (!type.startsWith(expected)) return Response.json({ detail: "Invalid input format." }, { status: 415 });
  const length = Number(request.headers.get("content-length"));
  const limit = 12 * 1024 * 1024;
  if (length > limit) return Response.json({ detail: "Input exceeds 12 MB." }, { status: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength;
    if (size > limit) return Response.json({ detail: "Input exceeds 12 MB." }, { status: 413 });
    chunks.push(chunk);
  }
  const path = check === "gait" ? "/analyze-video-landmarks" : `/predict/combined/${check}`;
  try {
    const response = await fetch(backend + path, {
      method: "POST", headers: { "content-type": type }, body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(90000),
    });
    return new Response(response.body, {
      status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch {
    return Response.json({ detail: "The analysis backend did not respond. Start FastAPI on port 8000 and try again." }, { status: 502 });
  }
}
