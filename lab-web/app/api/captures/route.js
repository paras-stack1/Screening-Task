const backend = process.env.LAB_BACKEND_URL || "http://127.0.0.1:8000";
const limit = 128 * 1024 * 1024;

export async function POST(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.startsWith("multipart/form-data")) {
    return Response.json({ detail: "Capture upload must use multipart form data." }, { status: 415 });
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) {
    return Response.json({ detail: "Recording exceeds the 128 MB limit." }, { status: 413 });
  }
  try {
    const response = await fetch(`${backend}/api/captures`, {
      method: "POST",
      headers: { "content-type": type },
      body: request.body,
      duplex: "half",
      signal: AbortSignal.timeout(120000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch {
    return Response.json({ detail: "The storage backend did not respond." }, { status: 502 });
  }
}
