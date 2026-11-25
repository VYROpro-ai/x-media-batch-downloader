"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import type { MediaKind, XMediaItem, XUserProfile } from "@/lib/x";

type ActiveOverlay =
  | null
  | "preferences"
  | "history"
  | "gif"
  | "privacy"
  | "terms"
  | "faq"
  | "tips";

type FilenamePattern =
  | "Timeline-Date-Index"
  | "TweetID-Index"
  | "Date-Username-Index";

type ThemeOption = "Dark" | "Light" | "System";
type BannerSizeOption = "Compact" | "Standard" | "Wide";

interface AppPreferences {
  includeReplies: boolean;
  mediaCount: number; // 0 = Unlimited
  mediaTypes: MediaKind[];
  filenamePattern: FilenamePattern;
  bannerSize: BannerSizeOption;
  maxFileMB: number;
  theme: ThemeOption;
  showDemo: boolean;
  language: string;
}

interface SavedHistoryEntry {
  id: string;
  query: string;
  fetchedAt: string;
  user: XUserProfile;
  media: XMediaItem[];
  total: number;
  truncated: boolean;
}

const PREFS_STORAGE_KEY = "twitterdl_preferences_v1";
const HISTORY_STORAGE_KEY = "twitterdl_history_v1";

const DEFAULT_PREFERENCES: AppPreferences = {
  includeReplies: false,
  mediaCount: 0,
  mediaTypes: ["photo", "video", "animated_gif"],
  filenamePattern: "Timeline-Date-Index",
  bannerSize: "Standard",
  maxFileMB: 100,
  theme: "Dark",
  showDemo: false,
  language: "English",
};

const DEMO_RESULT: {
  user: XUserProfile;
  media: XMediaItem[];
  total: number;
  truncated: boolean;
} = {
  user: {
    restId: "14459280",
    name: "Nintendo of America",
    screenName: "NintendoAmerica",
    avatarUrl: "https://pbs.twimg.com/profile_images/1823037067847180288/7g8r4O1p_400x400.jpg",
    bio: "Official tweets from Nintendo of America. Smiles to go!",
    followersCount: 16420000,
    followingCount: 142,
  },
  media: [
    {
      id: "demo-1",
      tweetId: "1993000000000000001",
      type: "photo",
      url: "https://pbs.twimg.com/media/Gc1DemoPhoto1.jpg",
      origUrl: "https://pbs.twimg.com/media/Gc1DemoPhoto1.jpg?format=jpg&name=orig",
      thumb: "https://pbs.twimg.com/media/Gc1DemoPhoto1.jpg?format=jpg&name=small",
      filename: "NintendoAmerica-2026-11-25-001.jpg",
      width: 1920,
      height: 1080,
      createdAt: "2026-11-25T12:00:00.000Z",
      text: "Sample preview item — enter any username or tweet link above to fetch live media.",
    },
    {
      id: "demo-2",
      tweetId: "1993000000000000002",
      type: "video",
      url: "https://video.twimg.com/ext_tw_video/demo/pu/vid/1280x720/sample.mp4",
      origUrl: "https://video.twimg.com/ext_tw_video/demo/pu/vid/1280x720/sample.mp4",
      thumb: "https://pbs.twimg.com/media/Gc1DemoVideo2.jpg",
      filename: "NintendoAmerica-2026-11-25-002.mp4",
      width: 1280,
      height: 720,
      durationMs: 24500,
      createdAt: "2026-11-24T18:30:00.000Z",
      text: "Sample video clip preview.",
    },
    {
      id: "demo-3",
      tweetId: "1993000000000000003",
      type: "animated_gif",
      url: "https://video.twimg.com/tweet_video/demoGif3.mp4",
      origUrl: "https://video.twimg.com/tweet_video/demoGif3.mp4",
      thumb: "https://pbs.twimg.com/tweet_video_thumb/demoGif3.jpg",
      filename: "NintendoAmerica-2026-11-23-003.mp4",
      width: 640,
      height: 360,
      durationMs: 3200,
      createdAt: "2026-11-23T09:15:00.000Z",
      text: "Sample looping GIF preview.",
    },
  ],
  total: 3,
  truncated: false,
};

function formatCompactCount(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return "";
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatBytesEstimate(item: XMediaItem): number {
  if (item.type === "photo") {
    const pixels = (item.width || 1280) * (item.height || 720);
    return Math.max(85_000, Math.round(pixels * 0.22));
  }
  const sec = item.durationMs ? item.durationMs / 1000 : 8;
  return Math.max(400_000, Math.round(sec * 350_000));
}

function formatHumanBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function HomePage() {
  const [prefs, setPrefs] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const [userProfile, setUserProfile] = useState<XUserProfile | null>(null);
  const [mediaItems, setMediaItems] = useState<XMediaItem[]>([]);
  const [isDemoResult, setIsDemoResult] = useState(false);

  const [typeFilters, setTypeFilters] = useState<Record<MediaKind, boolean>>({
    photo: true,
    video: true,
    animated_gif: true,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [zipProgress, setZipProgress] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>(null);

  // History state
  const [history, setHistory] = useState<SavedHistoryEntry[]>([]);
  const [historyTab, setHistoryTab] = useState<"refetch" | "saved">("saved");
  const [historySearch, setHistorySearch] = useState("");
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // GIF Converter state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [gifFps, setGifFps] = useState<number>(12);
  const [gifWidth, setGifWidth] = useState<number>(480);
  const [gifConverting, setGifConverting] = useState(false);
  const [gifProgressMsg, setGifProgressMsg] = useState<string | null>(null);
  const [gifOutputUrl, setGifOutputUrl] = useState<string | null>(null);
  const [gifError, setGifError] = useState<string | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const gifInputRef = useRef<HTMLInputElement | null>(null);

  // Load preferences & history from localStorage
  useEffect(() => {
    try {
      const rawPrefs = localStorage.getItem(PREFS_STORAGE_KEY);
      if (rawPrefs) {
        const parsed = JSON.parse(rawPrefs) as Partial<AppPreferences>;
        const merged: AppPreferences = {
          ...DEFAULT_PREFERENCES,
          ...parsed,
          mediaTypes:
            Array.isArray(parsed.mediaTypes) && parsed.mediaTypes.length > 0
              ? parsed.mediaTypes
              : DEFAULT_PREFERENCES.mediaTypes,
        };
        setPrefs(merged);
        setTypeFilters({
          photo: merged.mediaTypes.includes("photo"),
          video: merged.mediaTypes.includes("video"),
          animated_gif: merged.mediaTypes.includes("animated_gif"),
        });
      }
    } catch {
      // ignore storage errors
    }

    try {
      const rawHist = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (rawHist) {
        const parsedHist = JSON.parse(rawHist) as SavedHistoryEntry[];
        if (Array.isArray(parsedHist)) {
          setHistory(parsedHist);
        }
      }
    } catch {
      // ignore storage errors
    }

    setPrefsLoaded(true);
  }, []);

  // Save preferences to localStorage
  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs, prefsLoaded]);

  // Save history to localStorage
  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [history, prefsLoaded]);

  // Initialize demo card when showDemo is enabled and no fetch has happened yet
  useEffect(() => {
    if (!prefsLoaded) return;
    if (prefs.showDemo && !userProfile && !loading && !errorMsg) {
      setUserProfile(DEMO_RESULT.user);
      setMediaItems(DEMO_RESULT.media);
      setSelectedIds(new Set(DEMO_RESULT.media.map((m) => m.id)));
      setIsDemoResult(true);
    } else if (!prefs.showDemo && isDemoResult) {
      setUserProfile(null);
      setMediaItems([]);
      setSelectedIds(new Set());
      setIsDemoResult(false);
    }
  }, [prefs.showDemo, prefsLoaded, userProfile, loading, errorMsg, isDemoResult]);

  const filteredMedia = useMemo(() => {
    return mediaItems.filter((item) => Boolean(typeFilters[item.type]));
  }, [mediaItems, typeFilters]);

  const selectedFilteredItems = useMemo(() => {
    return filteredMedia.filter((item) => selectedIds.has(item.id));
  }, [filteredMedia, selectedIds]);

  const totalEstimatedBytes = useMemo(() => {
    return selectedFilteredItems.reduce(
      (acc, item) => acc + formatBytesEstimate(item),
      0
    );
  }, [selectedFilteredItems]);

  const runFetch = useCallback(
    async (rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (!trimmed) {
        setErrorMsg("Please enter an X username, profile URL, or tweet URL.");
        return;
      }

      setLoading(true);
      setErrorMsg(null);
      setStatusNote(null);
      setIsDemoResult(false);

      const activeTypes: MediaKind[] = [];
      if (typeFilters.photo) activeTypes.push("photo");
      if (typeFilters.video) activeTypes.push("video");
      if (typeFilters.animated_gif) activeTypes.push("animated_gif");

      try {
        const res = await fetch("/api/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: trimmed,
            mediaTypes:
              activeTypes.length > 0
                ? activeTypes
                : ["photo", "video", "animated_gif"],
            includeReplies: prefs.includeReplies,
            mediaCount: prefs.mediaCount,
            maxFileMB: prefs.maxFileMB,
            filenamePattern: prefs.filenamePattern,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || `Request failed (${res.status})`);
        }

        const fetchedUser: XUserProfile = data.user;
        const fetchedMedia: XMediaItem[] = Array.isArray(data.media)
          ? data.media
          : [];

        setUserProfile(fetchedUser);
        setMediaItems(fetchedMedia);
        setSelectedIds(new Set(fetchedMedia.map((m) => m.id)));

        if (data.truncated) {
          setStatusNote("Showing up to the 200-media safety cap for this batch.");
        }

        // Save to history
        const entry: SavedHistoryEntry = {
          id: `${fetchedUser.screenName.toLowerCase()}-${Date.now()}`,
          query: trimmed,
          fetchedAt: new Date().toISOString(),
          user: fetchedUser,
          media: fetchedMedia,
          total: Number(data.total ?? fetchedMedia.length),
          truncated: Boolean(data.truncated),
        };

        setHistory((prev) => {
          const withoutDup = prev.filter(
            (h) =>
              h.user.screenName.toLowerCase() !==
              fetchedUser.screenName.toLowerCase()
          );
          return [entry, ...withoutDup].slice(0, 50);
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to fetch media.";
        setErrorMsg(msg);
        setUserProfile(null);
        setMediaItems([]);
        setSelectedIds(new Set());
      } finally {
        setLoading(false);
      }
    },
    [prefs.filenamePattern, prefs.includeReplies, prefs.maxFileMB, prefs.mediaCount, typeFilters]
  );

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runFetch(inputValue);
  };

  const handlePasteFromClipboard = async () => {
    setErrorMsg(null);
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setInputValue(text.trim());
          return;
        }
      }
      setErrorMsg("Clipboard access is empty or blocked — paste manually with Ctrl/Cmd+V.");
    } catch {
      setErrorMsg("Unable to read clipboard automatically — paste manually with Ctrl/Cmd+V.");
    }
  };

  const handleShareClick = async () => {
    const shareUrl =
      typeof window !== "undefined" ? window.location.href : "https://twitterdl.app";
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setStatusNote("Link copied to clipboard.");
        setTimeout(() => setStatusNote(null), 2500);
      }
    } catch {
      setStatusNote(shareUrl);
    }
  };

  const toggleFilter = (kind: MediaKind) => {
    setTypeFilters((prev) => {
      const next = { ...prev, [kind]: !prev[kind] };
      const enabledList = (["photo", "video", "animated_gif"] as MediaKind[]).filter(
        (k) => next[k]
      );
      setPrefs((p) => ({
        ...p,
        mediaTypes: enabledList.length > 0 ? enabledList : ["photo", "video", "animated_gif"],
      }));
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(filteredMedia.map((m) => m.id)));
  };

  const handleSelectNone = () => {
    setSelectedIds(new Set());
  };

  const toggleItemSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const buildProxyDownloadUrl = (item: XMediaItem): string => {
    const target = item.origUrl || item.url;
    return `/api/download?url=${encodeURIComponent(target)}&filename=${encodeURIComponent(
      item.filename
    )}`;
  };

  const handleSingleDownload = async (item: XMediaItem) => {
    setErrorMsg(null);
    setDownloadingId(item.id);
    try {
      const proxyUrl = buildProxyDownloadUrl(item);
      const res = await fetch(proxyUrl);
      if (!res.ok) {
        throw new Error(`Download failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const maxBytes = prefs.maxFileMB * 1024 * 1024;
      if (prefs.maxFileMB > 0 && blob.size > maxBytes) {
        throw new Error(
          `Skipped ${item.filename}: file exceeds ${prefs.maxFileMB} MB limit.`
        );
      }
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = item.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : `Could not download ${item.filename}.`
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadAllZip = async () => {
    if (selectedFilteredItems.length === 0) return;
    setErrorMsg(null);
    setZipProgress(`Preparing ZIP (0/${selectedFilteredItems.length})...`);

    try {
      const zip = new JSZip();
      const maxBytes = prefs.maxFileMB * 1024 * 1024;
      let addedCount = 0;

      for (let i = 0; i < selectedFilteredItems.length; i++) {
        const item = selectedFilteredItems[i];
        setZipProgress(
          `Fetching ${i + 1}/${selectedFilteredItems.length}: ${item.filename}`
        );

        try {
          const proxyUrl = buildProxyDownloadUrl(item);
          const res = await fetch(proxyUrl);
          if (!res.ok) continue;
          const blob = await res.blob();
          if (prefs.maxFileMB > 0 && blob.size > maxBytes) {
            continue;
          }
          const arrayBuf = await blob.arrayBuffer();
          zip.file(item.filename, arrayBuf);
          addedCount += 1;
        } catch {
          // continue with remaining files
        }
      }

      if (addedCount === 0) {
        throw new Error(
          "No files could be packed into the ZIP (check file size limits or network access)."
        );
      }

      setZipProgress("Compressing ZIP archive...");
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const handleBase =
        userProfile?.screenName?.replace(/[^A-Za-z0-9_]/g, "") || "twitterdl";
      const zipFilename = `${handleBase}-media.zip`;

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      setStatusNote(
        `Downloaded ${zipFilename} (${addedCount} ${
          addedCount === 1 ? "file" : "files"
        }).`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to generate ZIP archive."
      );
    } finally {
      setZipProgress(null);
    }
  };

  // History helpers
  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (h) =>
        h.user.screenName.toLowerCase().includes(q) ||
        h.user.name.toLowerCase().includes(q) ||
        h.query.toLowerCase().includes(q)
    );
  }, [history, historySearch]);

  const handleLoadSavedEntry = (entry: SavedHistoryEntry) => {
    setInputValue(entry.query);
    setUserProfile(entry.user);
    setMediaItems(entry.media);
    setSelectedIds(new Set(entry.media.map((m) => m.id)));
    setIsDemoResult(false);
    setErrorMsg(null);
    setActiveOverlay(null);
  };

  const handleRefetchHistoryEntry = (entry: SavedHistoryEntry) => {
    const target = entry.user.screenName || entry.query;
    setInputValue(target);
    setActiveOverlay(null);
    void runFetch(target);
  };

  const handleExportOrImportJson = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.accounts)
        ? parsed.accounts
        : [];

      const importedEntries: SavedHistoryEntry[] = [];
      for (const raw of list) {
        if (typeof raw === "string" && raw.trim()) {
          const clean = raw.trim().replace(/^@/, "");
          importedEntries.push({
            id: `imp-${clean}-${Date.now()}-${importedEntries.length}`,
            query: clean,
            fetchedAt: new Date().toISOString(),
            user: {
              restId: "",
              name: clean,
              screenName: clean,
              avatarUrl: "",
              bio: "Imported account",
              followersCount: 0,
              followingCount: 0,
            },
            media: [],
            total: 0,
            truncated: false,
          });
        } else if (raw && typeof raw === "object") {
          const obj = raw as Record<string, unknown>;
          const sn = String(
            obj.screenName || obj.screen_name || obj.username || ""
          ).replace(/^@/, "");
          if (sn) {
            importedEntries.push({
              id: `imp-${sn}-${Date.now()}-${importedEntries.length}`,
              query: String(obj.query || sn),
              fetchedAt: String(obj.fetchedAt || new Date().toISOString()),
              user: {
                restId: String(obj.restId || ""),
                name: String(obj.name || sn),
                screenName: sn,
                avatarUrl: String(obj.avatarUrl || ""),
                bio: String(obj.bio || ""),
                followersCount: Number(obj.followersCount || 0),
                followingCount: Number(obj.followingCount || 0),
              },
              media: Array.isArray(obj.media) ? (obj.media as XMediaItem[]) : [],
              total: Number(obj.total || 0),
              truncated: Boolean(obj.truncated),
            });
          }
        }
      }

      if (importedEntries.length > 0) {
        setHistory((prev) => [...importedEntries, ...prev].slice(0, 100));
        setStatusNote(
          `Imported ${importedEntries.length} account${
            importedEntries.length === 1 ? "" : "s"
          } from JSON.`
        );
      }
    } catch {
      setErrorMsg("Could not parse JSON file. Provide an array of accounts or usernames.");
    } finally {
      e.target.value = "";
    }
  };

  // GIF Converter handlers
  const handleSelectVideoFile = (file: File | null) => {
    setGifError(null);
    setGifOutputUrl(null);
    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl);
      setVideoPreviewUrl(null);
    }
    setVideoFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoPreviewUrl(url);
    }
  };

  const handleConvertToGif = async () => {
    if (!videoFile) {
      setGifError("Please choose or drop a video file first.");
      return;
    }

    setGifConverting(true);
    setGifError(null);
    setGifOutputUrl(null);
    setGifProgressMsg("Loading browser FFmpeg engine (~30 MB initial load)...");

    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { fetchFile, toBlobURL } = await import("@ffmpeg/util");

      if (!ffmpegRef.current) {
        const ff = new FFmpeg();
        ff.on("log", ({ message }) => {
          if (message.includes("frame=")) {
            setGifProgressMsg(`Encoding GIF: ${message.slice(0, 72)}`);
          }
        });

        const baseCoreUrl =
          "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
        await ff.load({
          coreURL: await toBlobURL(
            `${baseCoreUrl}/ffmpeg-core.js`,
            "text/javascript"
          ),
          wasmURL: await toBlobURL(
            `${baseCoreUrl}/ffmpeg-core.wasm`,
            "application/wasm"
          ),
        });
        ffmpegRef.current = ff;
      }

      const ff = ffmpegRef.current;
      const ext = videoFile.name.split(".").pop()?.toLowerCase() || "mp4";
      const inputName = `input_clip.${ext}`;
      const outputName = "output_clip.gif";

      setGifProgressMsg("Writing video into browser memory...");
      await ff.writeFile(inputName, await fetchFile(videoFile));

      setGifProgressMsg("Rendering animated GIF...");
      const vfFilter = `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos`;
      await ff.exec(["-i", inputName, "-vf", vfFilter, "-loop", "0", outputName]);

      const data = await ff.readFile(outputName);
      const bytes =
        data instanceof Uint8Array
          ? new Uint8Array(data)
          : new TextEncoder().encode(String(data));
      const gifBlob = new Blob([bytes], { type: "image/gif" });
      const outUrl = URL.createObjectURL(gifBlob);
      setGifOutputUrl(outUrl);
      setGifProgressMsg("GIF ready!");
    } catch (err) {
      setGifError(
        err instanceof Error
          ? err.message
          : "GIF conversion failed in browser. Try a shorter clip or check browser memory."
      );
      setGifProgressMsg(null);
    } finally {
      setGifConverting(false);
    }
  };

  const resetPreferences = () => {
    setPrefs(DEFAULT_PREFERENCES);
    setTypeFilters({
      photo: true,
      video: true,
      animated_gif: true,
    });
    setStatusNote("Preferences reset to defaults.");
  };

  return (
    <div className="starfield-bg min-h-screen w-full text-slate-100 flex flex-col justify-between">
      {/* Main Centered Container */}
      <main className="w-full max-w-[520px] mx-auto px-4 pt-8 pb-10 flex-1 flex flex-col">
        {/* Top Header Bar */}
        <header className="flex items-center justify-between mb-5">
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setActiveOverlay(null);
            }}
            className="flex items-center gap-2 text-left group cursor-pointer"
          >
            <span className="text-2xl font-extrabold tracking-tight">
              <span className="text-white">Twitter</span>
              <span className="text-[#38bdf8]">DL</span>
            </span>
            <span
              aria-hidden="true"
              className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#38bdf8]/15 text-[#38bdf8] border border-[#38bdf8]/30"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </span>
          </button>

          <div className="flex items-center gap-1.5">
            {/* Share button */}
            <button
              type="button"
              onClick={handleShareClick}
              title="Share TwitterDL"
              aria-label="Share TwitterDL"
              className="w-9 h-9 rounded-full bg-[#141821] hover:bg-[#1d2332] border border-slate-700/60 flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>

            {/* History / Clock button */}
            <button
              type="button"
              onClick={() => setActiveOverlay("history")}
              title="History & Saved Accounts"
              aria-label="History"
              className="w-9 h-9 rounded-full bg-[#141821] hover:bg-[#1d2332] border border-slate-700/60 flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>

            {/* Settings / Preferences gear button */}
            <button
              type="button"
              onClick={() => setActiveOverlay("preferences")}
              title="Preferences"
              aria-label="Preferences"
              className="w-9 h-9 rounded-full bg-[#141821] hover:bg-[#1d2332] border border-slate-700/60 flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </header>

        {/* Centered Dark-Grey Card */}
        <section className="w-full rounded-2xl bg-[#141821]/95 border border-slate-800/90 shadow-2xl p-5 sm:p-6">
          <p className="text-center text-sm sm:text-[15px] text-slate-300 mb-5 leading-relaxed">
            Drop any X (Twitter) username or link — grab all the media.
          </p>

          {/* Main Input Form (Always Enabled) */}
          <form onSubmit={handleFormSubmit} className="w-full">
            <div className="flex items-center gap-2 rounded-xl bg-[#0d111a] border border-slate-700/80 focus-within:border-amber-500/80 px-3 py-2 transition">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="x.com/nintendo"
                aria-label="X username, profile URL, or tweet URL"
                disabled={loading}
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none min-w-0"
              />

              {/* Paste from clipboard icon button */}
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                title="Paste from clipboard"
                aria-label="Paste from clipboard"
                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800/70 transition cursor-pointer shrink-0"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>

              {/* Amber/Orange Arrow Submit Button */}
              <button
                type="submit"
                disabled={loading}
                aria-label="Fetch media"
                className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-60 text-slate-950 font-semibold flex items-center justify-center transition cursor-pointer shrink-0"
              >
                {loading ? (
                  <span className="inline-block w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                )}
              </button>
            </div>
          </form>

          {/* GIF Converter Pill Button Below */}
          <div className="mt-3.5 flex justify-center">
            <button
              type="button"
              onClick={() => setActiveOverlay("gif")}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#1c2230] hover:bg-[#252d3f] border border-slate-700/70 text-xs font-medium text-slate-200 transition cursor-pointer"
            >
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              GIF Converter
            </button>
          </div>

          {/* Status / Error Feedback */}
          {errorMsg && (
            <div className="mt-4 rounded-xl bg-red-950/50 border border-red-500/40 px-3.5 py-2.5 text-xs text-red-200">
              {errorMsg}
            </div>
          )}

          {statusNote && !errorMsg && (
            <div className="mt-4 rounded-xl bg-sky-950/40 border border-sky-500/30 px-3.5 py-2.5 text-xs text-sky-200">
              {statusNote}
            </div>
          )}

          {/* Profile Header + Controls + Media Grid */}
          {userProfile && (
            <div className="mt-6 pt-5 border-t border-slate-800/90 space-y-4">
              {isDemoResult && (
                <div className="flex items-center justify-between text-[11px] text-amber-400/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-1.5">
                  <span>Sample preview (Show Demo ON)</span>
                  <button
                    type="button"
                    onClick={() => {
                      setUserProfile(null);
                      setMediaItems([]);
                      setSelectedIds(new Set());
                      setIsDemoResult(false);
                    }}
                    className="underline hover:text-amber-300 cursor-pointer"
                  >
                    Hide
                  </button>
                </div>
              )}

              {/* Profile Header */}
              <div className="flex items-start gap-3">
                {userProfile.avatarUrl ? (
                  <img
                    src={userProfile.avatarUrl}
                    alt={`${userProfile.name} avatar`}
                    className="w-12 h-12 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-sm font-bold text-amber-400 shrink-0">
                    {userProfile.screenName.slice(0, 2).toUpperCase()}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h2 className="text-sm font-bold text-white truncate">
                      {userProfile.name}
                    </h2>
                    <span className="text-xs text-slate-400 truncate">
                      @{userProfile.screenName}
                    </span>
                  </div>
                  {userProfile.bio && (
                    <p className="text-xs text-slate-300 mt-1 line-clamp-2 leading-relaxed">
                      {userProfile.bio}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-1.5 text-[11px] text-slate-400">
                    <span>
                      <strong className="text-slate-200 font-semibold">
                        {formatCompactCount(userProfile.followersCount)}
                      </strong>{" "}
                      Followers
                    </span>
                    <span>
                      <strong className="text-slate-200 font-semibold">
                        {formatCompactCount(userProfile.followingCount)}
                      </strong>{" "}
                      Following
                    </span>
                  </div>
                </div>
              </div>

              {/* Media-Type Filter Checkboxes */}
              <div className="flex items-center justify-between gap-2 flex-wrap bg-[#0d111a] border border-slate-800 rounded-xl px-3 py-2 text-xs">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-200">
                    <input
                      type="checkbox"
                      checked={typeFilters.photo}
                      onChange={() => toggleFilter("photo")}
                      className="accent-amber-500 rounded cursor-pointer"
                    />
                    <span>Photos</span>
                  </label>

                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-200">
                    <input
                      type="checkbox"
                      checked={typeFilters.video}
                      onChange={() => toggleFilter("video")}
                      className="accent-amber-500 rounded cursor-pointer"
                    />
                    <span>Videos</span>
                  </label>

                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-200">
                    <input
                      type="checkbox"
                      checked={typeFilters.animated_gif}
                      onChange={() => toggleFilter("animated_gif")}
                      className="accent-amber-500 rounded cursor-pointer"
                    />
                    <span>GIFs</span>
                  </label>
                </div>

                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                  >
                    Select all
                  </button>
                  <span className="text-slate-600">/</span>
                  <button
                    type="button"
                    onClick={handleSelectNone}
                    className="text-slate-400 hover:text-slate-200 font-medium cursor-pointer"
                  >
                    Select none
                  </button>
                </div>
              </div>

              {/* Count + Total Size + Download All (.zip) */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs text-slate-300">
                  <span className="font-semibold text-white">
                    {selectedFilteredItems.length}
                  </span>{" "}
                  of {filteredMedia.length} selected{" "}
                  <span className="text-slate-400">
                    (~{formatHumanBytes(totalEstimatedBytes)})
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadAllZip}
                  disabled={
                    selectedFilteredItems.length === 0 || Boolean(zipProgress)
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold transition cursor-pointer"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {zipProgress ? zipProgress : "Download all (.zip)"}
                </button>
              </div>

              {/* Media Grid */}
              {filteredMedia.length === 0 ? (
                <div className="rounded-xl bg-[#0d111a] border border-slate-800 p-6 text-center text-xs text-slate-400">
                  No media items match the active filters.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {filteredMedia.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    const badgeLabel =
                      item.type === "animated_gif"
                        ? "GIF"
                        : item.type === "video"
                        ? "VIDEO"
                        : "PHOTO";
                    const durationText = formatDuration(item.durationMs);
                    const dimsText =
                      item.width && item.height
                        ? `${item.width}×${item.height}`
                        : "";

                    return (
                      <div
                        key={item.id}
                        className={`group relative rounded-xl overflow-hidden bg-[#0d111a] border transition ${
                          isSelected
                            ? "border-amber-500/70"
                            : "border-slate-800 opacity-75"
                        }`}
                      >
                        <div className="relative aspect-square w-full bg-slate-900 overflow-hidden">
                          {item.thumb ? (
                            <img
                              src={item.thumb}
                              alt={item.filename}
                              loading="lazy"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">
                              {badgeLabel}
                            </div>
                          )}

                          {/* Top-left selection checkbox */}
                          <label className="absolute top-1.5 left-1.5 z-10 inline-flex items-center justify-center w-5 h-5 rounded bg-slate-950/75 border border-slate-600/80 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleItemSelection(item.id)}
                              aria-label={`Select ${item.filename}`}
                              className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
                            />
                          </label>

                          {/* Top-right type badge */}
                          <span className="absolute top-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded bg-slate-950/80 border border-slate-700/70 text-[10px] font-bold tracking-wide text-amber-300">
                            {badgeLabel}
                          </span>

                          {/* Bottom-left duration / dimensions */}
                          {(durationText || dimsText) && (
                            <span className="absolute bottom-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded bg-slate-950/80 text-[10px] text-slate-200">
                              {durationText || dimsText}
                            </span>
                          )}

                          {/* Per-item download button */}
                          <button
                            type="button"
                            onClick={() => handleSingleDownload(item)}
                            disabled={downloadingId === item.id}
                            title={`Download ${item.filename}`}
                            aria-label={`Download ${item.filename}`}
                            className="absolute bottom-1.5 right-1.5 z-10 w-7 h-7 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center shadow transition cursor-pointer"
                          >
                            {downloadingId === item.id ? (
                              <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg
                                className="w-3.5 h-3.5"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                            )}
                          </button>
                        </div>

                        <div className="px-2 py-1.5 text-[10px] text-slate-300 truncate border-t border-slate-800/80">
                          {item.filename}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Footer Links & Disclaimer */}
      <footer className="w-full max-w-[520px] mx-auto px-4 pb-8 pt-2 text-center space-y-2.5">
        <div className="flex items-center justify-center gap-4 flex-wrap text-xs text-slate-400">
          <button
            type="button"
            onClick={() => setActiveOverlay("privacy")}
            className="hover:text-slate-200 transition cursor-pointer"
          >
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => setActiveOverlay("terms")}
            className="hover:text-slate-200 transition cursor-pointer"
          >
            Terms of Service
          </button>
          <button
            type="button"
            onClick={() => setActiveOverlay("faq")}
            className="hover:text-slate-200 transition cursor-pointer"
          >
            FAQ
          </button>
          <button
            type="button"
            onClick={() => setActiveOverlay("tips")}
            className="hover:text-slate-200 transition cursor-pointer"
          >
            Tips
          </button>
        </div>

        <p className="text-[11px] text-slate-500 leading-relaxed">
          TwitterDL is an independent platform and is not affiliated with or
          endorsed by X Corp. We do not host any copyrighted material. Users
          are responsible for their actions.
        </p>

        <p className="text-[11px] text-slate-500">© 2026</p>
      </footer>

      {/* Full-Screen Dark Overlays */}
      {activeOverlay && (
        <div className="fixed inset-0 z-50 bg-[#070b14]/95 backdrop-blur-md overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 py-6">
            {/* Top-left Back button */}
            <div className="flex items-center justify-between mb-6">
              <button
                type="button"
                onClick={() => setActiveOverlay(null)}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#141821] hover:bg-[#1d2433] border border-slate-700/70 text-sm font-medium text-slate-100 transition cursor-pointer"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                Back
              </button>

              <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                {activeOverlay === "preferences" && "Preferences"}
                {activeOverlay === "history" && "History & Saved Accounts"}
                {activeOverlay === "gif" && "GIF Converter"}
                {activeOverlay === "privacy" && "Privacy Policy"}
                {activeOverlay === "terms" && "Terms of Service"}
                {activeOverlay === "faq" && "Frequently Asked Questions"}
                {activeOverlay === "tips" && "Usage Tips"}
              </span>
            </div>

            {/* PREFERENCES OVERLAY */}
            {activeOverlay === "preferences" && (
              <PreferencesPanel
                prefs={prefs}
                setPrefs={setPrefs}
                typeFilters={typeFilters}
                toggleFilter={toggleFilter}
                onReset={resetPreferences}
              />
            )}

            {/* HISTORY OVERLAY */}
            {activeOverlay === "history" && (
              <div className="rounded-2xl bg-[#141821] border border-slate-800 p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="inline-flex rounded-lg bg-[#0d111a] p-1 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setHistoryTab("refetch")}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                        historyTab === "refetch"
                          ? "bg-amber-500 text-slate-950"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Refetch
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryTab("saved")}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                        historyTab === "saved"
                          ? "bg-amber-500 text-slate-950"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Saved Results ({filteredHistory.length})
                    </button>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      ref={importFileRef}
                      type="file"
                      accept="application/json,.json"
                      onChange={handleExportOrImportJson}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => importFileRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-[#1d2433] hover:bg-[#263044] border border-slate-700 text-xs font-medium text-slate-200 transition cursor-pointer"
                    >
                      Import accounts from JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistory([])}
                      className="px-3 py-1.5 rounded-lg bg-red-950/50 hover:bg-red-900/60 border border-red-500/30 text-xs font-medium text-red-200 transition cursor-pointer"
                    >
                      Clear all saved accounts
                    </button>
                  </div>
                </div>

                {/* Search box */}
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search saved accounts or handles..."
                  className="w-full rounded-xl bg-[#0d111a] border border-slate-700/80 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />

                {filteredHistory.length === 0 ? (
                  <p className="text-sm text-slate-400 py-8 text-center">
                    No saved accounts yet. Fetch a profile or tweet link to record it here.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {filteredHistory.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between gap-3 rounded-xl bg-[#0d111a] border border-slate-800 p-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {entry.user.avatarUrl ? (
                            <img
                              src={entry.user.avatarUrl}
                              alt={entry.user.screenName}
                              className="w-10 h-10 rounded-full object-cover border border-slate-700 shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-amber-400 shrink-0">
                              {entry.user.screenName.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white truncate">
                              {entry.user.name}{" "}
                              <span className="text-xs font-normal text-slate-400">
                                @{entry.user.screenName}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {entry.media.length} cached items •{" "}
                              {new Date(entry.fetchedAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {historyTab === "saved" && entry.media.length > 0 && (
                            <button
                              type="button"
                              onClick={() => handleLoadSavedEntry(entry)}
                              className="px-3 py-1.5 rounded-lg bg-[#1d2433] hover:bg-[#263044] text-xs font-medium text-slate-200 transition cursor-pointer"
                            >
                              Load
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRefetchHistoryEntry(entry)}
                            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 transition cursor-pointer"
                          >
                            Refetch
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* GIF CONVERTER OVERLAY */}
            {activeOverlay === "gif" && (
              <div className="rounded-2xl bg-[#141821] border border-slate-800 p-5 space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-white">GIF Converter</h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Runs 100% locally in your browser with ffmpeg.wasm (~30 MB initial load on first conversion). No files are uploaded to any server.
                  </p>
                </div>

                <input
                  ref={gifInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm"
                  onChange={(e) =>
                    handleSelectVideoFile(e.target.files?.[0] || null)
                  }
                  className="hidden"
                />

                <div
                  onClick={() => gifInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const dropped = e.dataTransfer.files?.[0] || null;
                    handleSelectVideoFile(dropped);
                  }}
                  className="rounded-xl border-2 border-dashed border-slate-700 hover:border-amber-500/70 bg-[#0d111a] p-7 text-center cursor-pointer transition"
                >
                  <p className="text-sm font-medium text-slate-200">
                    Drop your video here or click to browse MP4, MOV, M4V, WebM → animated GIF
                  </p>
                  {videoFile && (
                    <p className="text-xs text-amber-400 mt-2">
                      Selected: {videoFile.name} (
                      {formatHumanBytes(videoFile.size)})
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <label className="space-y-1">
                    <span className="text-slate-300 font-medium">Frame Rate (FPS)</span>
                    <select
                      value={gifFps}
                      onChange={(e) => setGifFps(Number(e.target.value))}
                      className="w-full rounded-lg bg-[#0d111a] border border-slate-700 px-3 py-2 text-white"
                    >
                      <option value={8}>8 FPS (smaller file)</option>
                      <option value={12}>12 FPS (balanced)</option>
                      <option value={15}>15 FPS (smoother)</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-slate-300 font-medium">Max Width (px)</span>
                    <select
                      value={gifWidth}
                      onChange={(e) => setGifWidth(Number(e.target.value))}
                      className="w-full rounded-lg bg-[#0d111a] border border-slate-700 px-3 py-2 text-white"
                    >
                      <option value={320}>320px</option>
                      <option value={480}>480px</option>
                      <option value={640}>640px</option>
                    </select>
                  </label>
                </div>

                {videoPreviewUrl && (
                  <video
                    src={videoPreviewUrl}
                    controls
                    className="w-full max-h-56 rounded-xl bg-black border border-slate-800"
                  />
                )}

                <button
                  type="button"
                  onClick={handleConvertToGif}
                  disabled={!videoFile || gifConverting}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-sm font-bold transition cursor-pointer"
                >
                  {gifConverting ? "Converting..." : "Convert to Animated GIF"}
                </button>

                {gifProgressMsg && (
                  <p className="text-xs text-sky-300">{gifProgressMsg}</p>
                )}

                {gifError && (
                  <p className="text-xs text-red-300 bg-red-950/40 border border-red-500/30 rounded-lg p-3">
                    {gifError}
                  </p>
                )}

                {gifOutputUrl && (
                  <div className="space-y-3 pt-2 border-t border-slate-800">
                    <img
                      src={gifOutputUrl}
                      alt="Converted animated GIF"
                      className="w-full max-h-72 object-contain rounded-xl bg-[#0d111a] border border-slate-800"
                    />
                    <a
                      href={gifOutputUrl}
                      download={`${
                        videoFile?.name.replace(/\.[^.]+$/, "") || "converted"
                      }.gif`}
                      className="inline-flex items-center justify-center w-full py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition"
                    >
                      Download Animated GIF
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* INFO / LEGAL OVERLAYS (FAQ, Privacy, Terms, Tips) */}
            {(activeOverlay === "faq" ||
              activeOverlay === "privacy" ||
              activeOverlay === "terms" ||
              activeOverlay === "tips") && (
              <InfoOverlayContent section={activeOverlay} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PreferencesPanel({
  prefs,
  setPrefs,
  typeFilters,
  toggleFilter,
  onReset,
}: {
  prefs: AppPreferences;
  setPrefs: React.Dispatch<React.SetStateAction<AppPreferences>>;
  typeFilters: Record<MediaKind, boolean>;
  toggleFilter: (kind: MediaKind) => void;
  onReset: () => void;
}) {
  const [tab, setTab] = useState<"fetch" | "general">("fetch");

  return (
    <div className="rounded-2xl bg-[#141821] border border-slate-800 p-5 space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex rounded-lg bg-[#0d111a] p-1 border border-slate-800">
          <button
            type="button"
            onClick={() => setTab("fetch")}
            className={`px-3.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
              tab === "fetch"
                ? "bg-amber-500 text-slate-950"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Fetch
          </button>
          <button
            type="button"
            onClick={() => setTab("general")}
            className={`px-3.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
              tab === "general"
                ? "bg-amber-500 text-slate-950"
                : "text-slate-400 hover:text-white"
            }`}
          >
            General
          </button>
        </div>

        <button
          type="button"
          onClick={onReset}
          className="px-3 py-1.5 rounded-lg bg-[#1d2433] hover:bg-[#263044] border border-slate-700 text-xs font-medium text-slate-200 transition cursor-pointer"
        >
          Reset Settings
        </button>
      </div>

      {tab === "fetch" ? (
        <div className="space-y-4 text-sm">
          {/* Include replies and retweets */}
          <div className="flex items-center justify-between py-2 border-b border-slate-800/80">
            <div>
              <div className="font-medium text-white">
                Include replies and retweets
              </div>
              <div className="text-xs text-slate-400">
                Default OFF — fetches original media posts from the timeline.
              </div>
            </div>
            <input
              type="checkbox"
              checked={prefs.includeReplies}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, includeReplies: e.target.checked }))
              }
              className="accent-amber-500 w-4 h-4 cursor-pointer"
            />
          </div>

          {/* Media Count */}
          <div className="flex items-center justify-between py-2 border-b border-slate-800/80 gap-4">
            <div>
              <div className="font-medium text-white">Media Count</div>
              <div className="text-xs text-slate-400">
                0 = Unlimited (up to 200 items per batch).
              </div>
            </div>
            <select
              value={prefs.mediaCount}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, mediaCount: Number(e.target.value) }))
              }
              className="rounded-lg bg-[#0d111a] border border-slate-700 px-3 py-1.5 text-xs text-white"
            >
              <option value={0}>Unlimited</option>
              <option value={20}>20 items</option>
              <option value={50}>50 items</option>
              <option value={100}>100 items</option>
              <option value={200}>200 items</option>
            </select>
          </div>

          {/* Media Type checkboxes */}
          <div className="py-2 border-b border-slate-800/80 space-y-2">
            <div className="font-medium text-white">Media Type</div>
            <div className="flex items-center gap-4 text-xs">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={typeFilters.photo}
                  onChange={() => toggleFilter("photo")}
                  className="accent-amber-500 cursor-pointer"
                />
                <span>Photos</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={typeFilters.video}
                  onChange={() => toggleFilter("video")}
                  className="accent-amber-500 cursor-pointer"
                />
                <span>Videos</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={typeFilters.animated_gif}
                  onChange={() => toggleFilter("animated_gif")}
                  className="accent-amber-500 cursor-pointer"
                />
                <span>GIFs</span>
              </label>
            </div>
          </div>

          {/* File name pattern */}
          <div className="flex items-center justify-between py-2 border-b border-slate-800/80 gap-4">
            <div>
              <div className="font-medium text-white">File name pattern</div>
              <div className="text-xs text-slate-400">
                Example: nintendo-2026-11-25-001.jpg
              </div>
            </div>
            <select
              value={prefs.filenamePattern}
              onChange={(e) =>
                setPrefs((p) => ({
                  ...p,
                  filenamePattern: e.target.value as FilenamePattern,
                }))
              }
              className="rounded-lg bg-[#0d111a] border border-slate-700 px-3 py-1.5 text-xs text-white"
            >
              <option value="Timeline-Date-Index">Timeline-Date-Index</option>
              <option value="TweetID-Index">TweetID-Index</option>
              <option value="Date-Username-Index">Date-Username-Index</option>
            </select>
          </div>

          {/* Banner Size */}
          <div className="flex items-center justify-between py-2 gap-4">
            <div>
              <div className="font-medium text-white">Banner Size</div>
              <div className="text-xs text-slate-400">
                Profile header density preference.
              </div>
            </div>
            <select
              value={prefs.bannerSize}
              onChange={(e) =>
                setPrefs((p) => ({
                  ...p,
                  bannerSize: e.target.value as BannerSizeOption,
                }))
              }
              className="rounded-lg bg-[#0d111a] border border-slate-700 px-3 py-1.5 text-xs text-white"
            >
              <option value="Compact">Compact</option>
              <option value="Standard">Standard</option>
              <option value="Wide">Wide</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {/* File size limit */}
          <div className="flex items-center justify-between py-2 border-b border-slate-800/80 gap-4">
            <div>
              <div className="font-medium text-white">File size limit</div>
              <div className="text-xs text-slate-400">
                Default 100 MB — skip larger files during download.
              </div>
            </div>
            <select
              value={prefs.maxFileMB}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, maxFileMB: Number(e.target.value) }))
              }
              className="rounded-lg bg-[#0d111a] border border-slate-700 px-3 py-1.5 text-xs text-white"
            >
              <option value={25}>25 MB</option>
              <option value={50}>50 MB</option>
              <option value={100}>100 MB</option>
              <option value={250}>250 MB</option>
              <option value={500}>500 MB</option>
            </select>
          </div>

          {/* Theme */}
          <div className="flex items-center justify-between py-2 border-b border-slate-800/80 gap-4">
            <div>
              <div className="font-medium text-white">Theme</div>
              <div className="text-xs text-slate-400">
                Visual appearance mode.
              </div>
            </div>
            <select
              value={prefs.theme}
              onChange={(e) =>
                setPrefs((p) => ({
                  ...p,
                  theme: e.target.value as ThemeOption,
                }))
              }
              className="rounded-lg bg-[#0d111a] border border-slate-700 px-3 py-1.5 text-xs text-white"
            >
              <option value="Dark">Dark</option>
              <option value="Light">Light</option>
              <option value="System">System</option>
            </select>
          </div>

          {/* Show Demo */}
          <div className="flex items-center justify-between py-2 border-b border-slate-800/80">
            <div>
              <div className="font-medium text-white">Show Demo</div>
              <div className="text-xs text-slate-400">
                Display a sample media preview before your first search.
              </div>
            </div>
            <input
              type="checkbox"
              checked={prefs.showDemo}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, showDemo: e.target.checked }))
              }
              className="accent-amber-500 w-4 h-4 cursor-pointer"
            />
          </div>

          {/* Language */}
          <div className="flex items-center justify-between py-2 gap-4">
            <div>
              <div className="font-medium text-white">Language</div>
              <div className="text-xs text-slate-400">Interface language.</div>
            </div>
            <select
              value={prefs.language}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, language: e.target.value }))
              }
              className="rounded-lg bg-[#0d111a] border border-slate-700 px-3 py-1.5 text-xs text-white"
            >
              <option value="English">English</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoOverlayContent({
  section,
}: {
  section: "faq" | "privacy" | "terms" | "tips";
}) {
  return (
    <div className="rounded-2xl bg-[#141821] border border-slate-800 p-6 space-y-4 text-sm text-slate-300 leading-relaxed">
      {section === "faq" && (
        <>
          <h2 className="text-lg font-bold text-white">
            Frequently Asked Questions
          </h2>
          <div className="space-y-3 text-xs sm:text-sm">
            <div>
              <h3 className="font-semibold text-white">
                What does TwitterDL do?
              </h3>
              <p className="text-slate-400 mt-0.5">
                TwitterDL lets you paste an X (Twitter) username, profile URL, or
                tweet URL to inspect available photos, videos, and GIFs, filter
                by media type, and download individual files or a batch ZIP
                archive.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-white">
                Do I need a license key, auth token, or login?
              </h3>
              <p className="text-slate-400 mt-0.5">
                No. This version handles X guest-token access automatically on
                the server—no license key, auth token, or account sign-in is
                required.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-white">
                Is downloading from X legal?
              </h3>
              <p className="text-slate-400 mt-0.5">
                Availability and lawful use depend on applicable copyright laws
                and X&apos;s Terms of Service. Only download media you have the
                right or permission to access and use.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-white">
                What media can be downloaded?
              </h3>
              <p className="text-slate-400 mt-0.5">
                Publicly accessible photos (including high-resolution original
                variants), MP4 videos, and animated GIFs from public posts or
                timelines. Protected or private accounts cannot be accessed.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-white">
                Is my data safe, and is anything stored on servers?
              </h3>
              <p className="text-slate-400 mt-0.5">
                Nothing is stored on our servers. Preferences and history are
                saved locally in your browser&apos;s localStorage, and GIF
                conversions run locally in your browser with ffmpeg.wasm.
              </p>
            </div>
          </div>
        </>
      )}

      {section === "privacy" && (
        <>
          <h2 className="text-lg font-bold text-white">Privacy Policy</h2>
          <p className="text-xs sm:text-sm text-slate-400">
            TwitterDL does not store user accounts, search logs, or downloaded
            media files on its servers. Media proxy requests stream directly
            from X&apos;s media CDN to your browser. Your preferences and saved
            history remain in your browser&apos;s localStorage until cleared.
          </p>
        </>
      )}

      {section === "terms" && (
        <>
          <h2 className="text-lg font-bold text-white">Terms of Service</h2>
          <p className="text-xs sm:text-sm text-slate-400">
            TwitterDL is an independent tool and is not affiliated with,
            sponsored by, or endorsed by X Corp. You agree to use this service
            in compliance with applicable laws, copyright holders&apos; rights,
            and X&apos;s Terms of Service.
          </p>
        </>
      )}

      {section === "tips" && (
        <>
          <h2 className="text-lg font-bold text-white">Tips</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-sm text-slate-400">
            <li>
              Paste a full tweet URL (such as{" "}
              <code className="text-slate-200">x.com/user/status/123...</code>)
              to grab media from a single post quickly.
            </li>
            <li>
              Use the Photos, Videos, and GIFs checkboxes to narrow down large
              timelines before packing a ZIP archive.
            </li>
            <li>
              Use the GIF Converter overlay to turn short MP4, MOV, M4V, or
              WebM clips into GIFs right inside your browser.
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
