import { NextRequest, NextResponse } from "next/server";
import { fetchXMedia, MediaKind, XApiError } from "@/lib/x";

interface FetchRequestBody {
  input?: string;
  mediaTypes?: MediaKind[];
  includeReplies?: boolean;
  mediaCount?: number;
  maxFileMB?: number;
  filenamePattern?: "Timeline-Date-Index" | "TweetID-Index" | "Date-Username-Index";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as FetchRequestBody;

    if (!body || typeof body.input !== "string" || !body.input.trim()) {
      return NextResponse.json(
        { error: "Please provide an X username, profile URL, or tweet URL." },
        { status: 400 }
      );
    }

    const validTypes = new Set<MediaKind>(["photo", "video", "animated_gif"]);
    const mediaTypes: MediaKind[] = Array.isArray(body.mediaTypes)
      ? body.mediaTypes.filter((t): t is MediaKind => validTypes.has(t))
      : ["photo", "video", "animated_gif"];

    const includeReplies = Boolean(body.includeReplies);
    const mediaCount =
      typeof body.mediaCount === "number" && Number.isFinite(body.mediaCount)
        ? Math.max(0, Math.floor(body.mediaCount))
        : 0;
    const maxFileMB =
      typeof body.maxFileMB === "number" && Number.isFinite(body.maxFileMB)
        ? Math.max(1, body.maxFileMB)
        : 100;

    const result = await fetchXMedia({
      input: body.input.trim(),
      mediaTypes,
      includeReplies,
      mediaCount,
      maxFileMB,
      filenamePattern: body.filenamePattern || "Timeline-Date-Index",
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof XApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Failed to fetch media from X.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
