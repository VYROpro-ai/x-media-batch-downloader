import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOSTS = new Set([
  "pbs.twimg.com",
  "video.twimg.com",
  "abs.twimg.com",
]);

function sanitizeFilename(rawName: string | null): string {
  if (!rawName) return "media-download";
  const cleaned = rawName.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 120) || "media-download";
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");
  const filenameParam = req.nextUrl.searchParams.get("filename");

  if (!rawUrl) {
    return NextResponse.json(
      { error: "Missing required 'url' query parameter." },
      { status: 400 }
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json(
      { error: "Invalid target URL." },
      { status: 400 }
    );
  }

  if (parsedUrl.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only HTTPS media URLs are allowed." },
      { status: 403 }
    );
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(hostname)) {
    return NextResponse.json(
      { error: `Host '${hostname}' is not in the allowed media allowlist.` },
      { status: 403 }
    );
  }

  try {
    const upstream = await fetch(parsedUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://x.com/",
        Accept: "*/*",
      },
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `Upstream media fetch failed (HTTP ${upstream.status}).` },
        { status: upstream.status >= 400 ? upstream.status : 502 }
      );
    }

    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");
    const safeFilename = sanitizeFilename(filenameParam);

    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", contentType);
    responseHeaders.set(
      "Content-Disposition",
      `attachment; filename="${safeFilename}"`
    );
    responseHeaders.set("Cache-Control", "no-store");
    if (contentLength) {
      responseHeaders.set("Content-Length", contentLength);
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to stream remote media file." },
      { status: 502 }
    );
  }
}
