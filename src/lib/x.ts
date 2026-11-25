export interface XUserProfile {
  restId: string;
  name: string;
  screenName: string;
  avatarUrl: string;
  bannerUrl?: string;
  bio: string;
  followersCount: number;
  followingCount: number;
}

export type MediaKind = "photo" | "video" | "animated_gif";

export interface XMediaItem {
  id: string;
  tweetId: string;
  type: MediaKind;
  url: string;
  origUrl: string;
  thumb: string;
  filename: string;
  width: number;
  height: number;
  durationMs?: number;
  createdAt: string;
  text: string;
}

export interface FetchMediaOptions {
  input: string;
  mediaTypes?: MediaKind[];
  includeReplies?: boolean;
  mediaCount?: number; // 0 or undefined means unlimited (up to safety cap 200)
  maxFileMB?: number;
  filenamePattern?: "Timeline-Date-Index" | "TweetID-Index" | "Date-Username-Index";
}

export interface FetchMediaResult {
  user: XUserProfile;
  media: XMediaItem[];
  total: number;
  truncated: boolean;
}

const PUBLIC_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  responsive_web_graphql_exclude_direct_messages: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_home_pinned_timelines_enabled: true,
};

// Full timeline feature set from the X web client (required by UserMedia).
const TIMELINE_FEATURES = {
  payments_enabled: false,
  rweb_xchat_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

const FIELD_TOGGLES = { withArticlePlainText: false };

const USER_BY_SCREEN_NAME_QUERY_ID = "ck5KkZ8t5cOmoLssopN99Q";
const USER_MEDIA_QUERY_ID = "jCRhbOzdgOHp6u9H4g2tEg";
const USER_TWEETS_QUERY_ID = "E8Wq-_jFSaU7hxVcuOPR9g";
const MAX_MEDIA_CAP = 200;

let cachedGuestToken: string | null = null;
let guestTokenFetchedAt = 0;
const GUEST_TOKEN_TTL_MS = 45 * 60 * 1000; // 45 minutes

export class XApiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "XApiError";
    this.status = status;
  }
}

// Random per-process CSRF token, same shape as the X web client uses.
const CSRF_TOKEN = Array.from({ length: 16 }, () =>
  Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
).join("");

function getBaseHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${PUBLIC_BEARER_TOKEN}`,
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.5",
    "Content-Type": "application/json",
    Origin: "https://x.com",
    Referer: "https://x.com/",
    "X-Twitter-Client-Language": "en",
    "X-Twitter-Active-User": "yes",
    "X-Csrf-Token": CSRF_TOKEN,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
}

async function activateGuestToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedGuestToken &&
    now - guestTokenFetchedAt < GUEST_TOKEN_TTL_MS
  ) {
    return cachedGuestToken;
  }

  // X rate-limits guest activation from shared hosting IPs; a 429 here is
  // usually transient, so retry once after a short pause instead of
  // failing the whole fetch immediately.
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    const res = await fetch("https://api.x.com/1.1/guest/activate.json", {
      method: "POST",
      headers: getBaseHeaders(),
      cache: "no-store",
    });

    if (res.ok) {
      const data = (await res.json()) as { guest_token?: string };
      if (!data.guest_token) {
        throw new XApiError("X guest token missing from activation response", 502);
      }
      cachedGuestToken = data.guest_token;
      guestTokenFetchedAt = Date.now();
      return data.guest_token;
    }

    lastStatus = res.status;
    if (res.status !== 429) break;
  }

  if (lastStatus === 429) {
    throw new XApiError("X rate limit — try again in a few minutes", 429);
  }
  throw new XApiError(
    `Failed to obtain X guest session (HTTP ${lastStatus})`,
    lastStatus
  );
}

async function xGraphqlGet<T>(
  url: string,
  allowRetry = true
): Promise<T> {
  const envAuthToken = process.env.X_AUTH_TOKEN?.trim();
  const envCt0 = process.env.X_CT0?.trim();
  const useCookieAuth = Boolean(envAuthToken && envCt0);

  const headers: Record<string, string> = getBaseHeaders();

  if (useCookieAuth) {
    headers["Cookie"] = `auth_token=${envAuthToken}; ct0=${envCt0}`;
    headers["x-csrf-token"] = envCt0!;
    headers["x-twitter-auth-type"] = "OAuth2Session";
  } else {
    const token = await activateGuestToken(false);
    headers["x-guest-token"] = token;
  }

  const res = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  if ((res.status === 401 || res.status === 403 || res.status === 429) && !useCookieAuth && allowRetry) {
    // Refresh guest token once and retry
    cachedGuestToken = null;
    const freshToken = await activateGuestToken(true);
    const retryHeaders = {
      ...getBaseHeaders(),
      "x-guest-token": freshToken,
    };
    const retryRes = await fetch(url, {
      method: "GET",
      headers: retryHeaders,
      cache: "no-store",
    });

    if (!retryRes.ok) {
      if (retryRes.status === 429 || retryRes.status === 401 || retryRes.status === 403) {
        throw new XApiError(
          "X rate limit — try again in a few minutes",
          429
        );
      }
      throw new XApiError(
        `X API request failed (HTTP ${retryRes.status})`,
        retryRes.status
      );
    }

    return (await retryRes.json()) as T;
  }

  if (!res.ok) {
    if (res.status === 429 || res.status === 401 || res.status === 403) {
      throw new XApiError(
        "X rate limit — try again in a few minutes",
        429
      );
    }
    throw new XApiError(`X API request failed (HTTP ${res.status})`, res.status);
  }

  return (await res.json()) as T;
}

export type ParsedXInput =
  | { kind: "profile"; username: string }
  | { kind: "tweet"; username: string; tweetId: string };

export function parseXInput(rawInput: string): ParsedXInput {
  const cleaned = rawInput.trim();
  if (!cleaned) {
    throw new XApiError("Please enter an X username, profile URL, or tweet URL.", 400);
  }

  // Handle @username or bare username
  const bareMatch = cleaned.match(/^@?([A-Za-z0-9_]{1,15})$/);
  if (bareMatch) {
    return { kind: "profile", username: bareMatch[1] };
  }

  let normalizedUrl = cleaned;
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    throw new XApiError("Invalid X username or URL format.", 400);
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const allowedHosts = new Set([
    "x.com",
    "twitter.com",
    "mobile.x.com",
    "mobile.twitter.com",
    "vxtwitter.com",
    "fxtwitter.com",
    "fixupx.com",
  ]);

  if (!allowedHosts.has(host)) {
    throw new XApiError("Please provide a valid x.com or twitter.com link.", 400);
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new XApiError("Missing username or tweet path in URL.", 400);
  }

  // Status link: /<user>/status/<id> or /i/web/status/<id>
  const statusIdx = segments.findIndex(
    (s) => s.toLowerCase() === "status" || s.toLowerCase() === "statuses"
  );
  if (statusIdx !== -1 && segments[statusIdx + 1]) {
    const tweetIdMatch = segments[statusIdx + 1].match(/^(\d+)/);
    if (tweetIdMatch) {
      const userSeg = statusIdx > 0 ? segments[statusIdx - 1] : "i";
      return {
        kind: "tweet",
        username: userSeg.replace(/^@/, ""),
        tweetId: tweetIdMatch[1],
      };
    }
  }

  // Profile link: /<username>(/media|/likes|/with_replies)?
  const candidateUser = segments[0].replace(/^@/, "");
  const reservedPaths = new Set([
    "home",
    "explore",
    "notifications",
    "messages",
    "i",
    "search",
    "settings",
    "compose",
    "login",
    "signup",
  ]);
  if (
    reservedPaths.has(candidateUser.toLowerCase()) ||
    !/^[A-Za-z0-9_]{1,15}$/.test(candidateUser)
  ) {
    throw new XApiError("Could not extract a valid X username from that URL.", 400);
  }

  return { kind: "profile", username: candidateUser };
}

function decodeBase64UserId(encodedId?: string): string | null {
  if (!encodedId) return null;
  try {
    const decoded = Buffer.from(encodedId, "base64").toString("utf8");
    const match = decoded.match(/^User:(\d+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function formatDateYMD(rawDate?: string): string {
  if (!rawDate) {
    return new Date().toISOString().slice(0, 10);
  }
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function getFileExtension(type: MediaKind, url: string): string {
  if (type === "video" || type === "animated_gif") {
    return "mp4";
  }
  try {
    const u = new URL(url);
    const fmt = u.searchParams.get("format");
    if (fmt && /^[a-z0-9]+$/i.test(fmt)) {
      return fmt.toLowerCase() === "jpeg" ? "jpg" : fmt.toLowerCase();
    }
    const pathExt = u.pathname.split(".").pop()?.toLowerCase();
    if (pathExt && ["jpg", "jpeg", "png", "webp", "gif"].includes(pathExt)) {
      return pathExt === "jpeg" ? "jpg" : pathExt;
    }
  } catch {
    // fallback below
  }
  return "jpg";
}

export function buildMediaFilename(
  pattern: "Timeline-Date-Index" | "TweetID-Index" | "Date-Username-Index",
  screenName: string,
  createdAt: string,
  tweetId: string,
  index: number,
  ext: string
): string {
  const safeUser = screenName.replace(/[^A-Za-z0-9_]/g, "") || "user";
  const datePart = formatDateYMD(createdAt);
  const idxPart = String(index).padStart(3, "0");

  switch (pattern) {
    case "TweetID-Index":
      return `${safeUser}-${tweetId}-${idxPart}.${ext}`;
    case "Date-Username-Index":
      return `${datePart}-${safeUser}-${idxPart}.${ext}`;
    case "Timeline-Date-Index":
    default:
      return `${safeUser}-${datePart}-${idxPart}.${ext}`;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchUserByScreenName(
  screenName: string
): Promise<XUserProfile> {
  const variables = JSON.stringify({
    screen_name: screenName,
    withSafetyModeUserFields: true,
  });
  const features = JSON.stringify(FEATURES);
  const url = `https://api.x.com/graphql/${USER_BY_SCREEN_NAME_QUERY_ID}/UserByScreenName?variables=${encodeURIComponent(
    variables
  )}&features=${encodeURIComponent(features)}`;

  const payload = await xGraphqlGet<any>(url);
  const userResult = payload?.data?.user?.result;

  if (!userResult || userResult.__typename === "UserUnavailable") {
    throw new XApiError(`User @${screenName} was not found or is unavailable.`, 404);
  }

  const legacy = userResult.legacy ?? {};
  const restId =
    userResult.rest_id ||
    legacy.id_str ||
    decodeBase64UserId(userResult.id) ||
    "";

  if (!restId) {
    throw new XApiError(`Could not resolve user ID for @${screenName}.`, 502);
  }

  const rawAvatar: string =
    legacy.profile_image_url_https ||
    userResult.avatar?.image_url ||
    "";
  const avatarUrl = rawAvatar
    ? rawAvatar.replace("_normal.", "_400x400.")
    : "";

  return {
    restId: String(restId),
    name: legacy.name || userResult.core?.name || screenName,
    screenName: legacy.screen_name || userResult.core?.screen_name || screenName,
    avatarUrl,
    bannerUrl: legacy.profile_banner_url || undefined,
    bio: legacy.description || "",
    followersCount: Number(legacy.followers_count ?? 0),
    followingCount: Number(legacy.friends_count ?? 0),
  };
}

function extractMediaFromTweetResult(
  tweetResult: any,
  includeReplies: boolean
): Array<{
  id: string;
  tweetId: string;
  type: MediaKind;
  url: string;
  origUrl: string;
  thumb: string;
  width: number;
  height: number;
  durationMs?: number;
  createdAt: string;
  text: string;
}> {
  if (!tweetResult) return [];

  // Unwrap TweetWithVisibilityResults if present
  const actualTweet =
    tweetResult.__typename === "TweetWithVisibilityResults" && tweetResult.tweet
      ? tweetResult.tweet
      : tweetResult;

  const legacy = actualTweet.legacy;
  if (!legacy) return [];

  const isReply = Boolean(legacy.in_reply_to_status_id_str);
  const isRetweet = Boolean(legacy.retweeted_status_result);
  if (!includeReplies && (isReply || isRetweet)) {
    return [];
  }

  const tweetId: string = legacy.id_str || actualTweet.rest_id || "";
  const createdAt: string = legacy.created_at || new Date().toISOString();
  const text: string = legacy.full_text || "";

  const mediaList: any[] =
    legacy.extended_entities?.media || legacy.entities?.media || [];

  const items: Array<{
    id: string;
    tweetId: string;
    type: MediaKind;
    url: string;
    origUrl: string;
    thumb: string;
    width: number;
    height: number;
    durationMs?: number;
    createdAt: string;
    text: string;
  }> = [];

  for (let i = 0; i < mediaList.length; i++) {
    const m = mediaList[i];
    const mediaType = m.type as string;
    const baseMediaUrl: string = m.media_url_https || "";
    const width: number =
      m.original_info?.width || m.sizes?.large?.w || 0;
    const height: number =
      m.original_info?.height || m.sizes?.large?.h || 0;
    const mediaId = String(m.id_str || `${tweetId}-${i}`);

    if (mediaType === "photo") {
      if (!baseMediaUrl) continue;
      // Strip existing query if any before appending format/name.
      // The format must match the file's real extension — a .png with
      // ?format=jpg 404s on the CDN.
      const cleanBase = baseMediaUrl.split("?")[0];
      const urlExt = cleanBase.split(".").pop()?.toLowerCase();
      const format =
        urlExt === "png" ? "png" : urlExt === "webp" ? "webp" : "jpg";
      items.push({
        id: mediaId,
        tweetId,
        type: "photo",
        url: cleanBase,
        origUrl: `${cleanBase}?format=${format}&name=orig`,
        thumb: `${cleanBase}?format=jpg&name=small`,
        width,
        height,
        createdAt,
        text,
      });
    } else if (mediaType === "video" || mediaType === "animated_gif") {
      const variants: any[] = m.video_info?.variants || [];
      const mp4Variants = variants
        .filter(
          (v) =>
            v.content_type === "video/mp4" && typeof v.url === "string"
        )
        .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));

      const bestVariant = mp4Variants[0];
      if (!bestVariant?.url) continue;

      const durationMs =
        typeof m.video_info?.duration_millis === "number"
          ? m.video_info.duration_millis
          : undefined;

      items.push({
        id: mediaId,
        tweetId,
        type: mediaType === "animated_gif" ? "animated_gif" : "video",
        url: bestVariant.url,
        origUrl: bestVariant.url,
        thumb: baseMediaUrl || bestVariant.url,
        width,
        height,
        durationMs,
        createdAt,
        text,
      });
    }
  }

  return items;
}

export async function fetchUserTimelineMedia(
  user: XUserProfile,
  options: FetchMediaOptions
): Promise<FetchMediaResult> {
  const allowedTypes = new Set<MediaKind>(
    options.mediaTypes && options.mediaTypes.length > 0
      ? options.mediaTypes
      : ["photo", "video", "animated_gif"]
  );
  const includeReplies = Boolean(options.includeReplies);
  const requestedLimit =
    options.mediaCount && options.mediaCount > 0
      ? Math.min(options.mediaCount, MAX_MEDIA_CAP)
      : MAX_MEDIA_CAP;
  const pattern = options.filenamePattern || "Timeline-Date-Index";

  const collectedRaw: Array<{
    id: string;
    tweetId: string;
    type: MediaKind;
    url: string;
    origUrl: string;
    thumb: string;
    width: number;
    height: number;
    durationMs?: number;
    createdAt: string;
    text: string;
  }> = [];

  const seenMediaIds = new Set<string>();
  let cursor: string | undefined = undefined;
  let pageCount = 0;
  const maxPages = 15;
  let truncated = false;
  // UserMedia returns the media grid directly but its queryId is
  // intermittently retired by X (404). Fall back to UserTweets on the
  // first page if that happens; UserTweets is reliable, it just needs
  // more pages to collect media from text-heavy accounts.
  let endpoint: "media" | "tweets" = "media";

  while (collectedRaw.length < requestedLimit && pageCount < maxPages) {
    pageCount += 1;
    const variablesObj: Record<string, unknown> = {
      userId: user.restId,
      count: 20,
      includePromotedContent: false,
      withVoice: true,
      withQuickPromoteEligibilityTweetFields: false,
    };
    if (endpoint === "media") {
      variablesObj.withClientEventToken = false;
      variablesObj.withBirdwatchNotes = false;
    }
    if (cursor) {
      variablesObj.cursor = cursor;
    }

    const queryId =
      endpoint === "media" ? USER_MEDIA_QUERY_ID : USER_TWEETS_QUERY_ID;
    const opName = endpoint === "media" ? "UserMedia" : "UserTweets";
    const url = `https://api.x.com/graphql/${queryId}/${opName}?variables=${encodeURIComponent(
      JSON.stringify(variablesObj)
    )}&features=${encodeURIComponent(JSON.stringify(TIMELINE_FEATURES))}&fieldToggles=${encodeURIComponent(JSON.stringify(FIELD_TOGGLES))}`;

    let payload: any;
    try {
      payload = await xGraphqlGet<any>(url);
    } catch (err) {
      if (
        err instanceof XApiError &&
        err.status === 404 &&
        endpoint === "media" &&
        pageCount === 1
      ) {
        endpoint = "tweets";
        pageCount -= 1; // retry this page as UserTweets
        continue;
      }
      throw err;
    }
    const instructions: any[] =
      payload?.data?.user?.result?.timeline_v2?.timeline?.instructions ||
      payload?.data?.user?.result?.timeline?.timeline?.instructions ||
      [];

    let nextCursor: string | undefined = undefined;
    let foundEntriesInPage = 0;

    for (const instruction of instructions) {
      if (
        instruction.type === "TimelineAddEntries" &&
        Array.isArray(instruction.entries)
      ) {
        for (const entry of instruction.entries) {
          const content = entry?.content;
          if (!content) continue;

          if (
            content.entryType === "TimelineTimelineCursor" &&
            content.cursorType === "Bottom" &&
            typeof content.value === "string"
          ) {
            nextCursor = content.value;
            continue;
          }

          if (content.entryType === "TimelineTimelineItem") {
            foundEntriesInPage += 1;
            const tweetResult = content.itemContent?.tweet_results?.result;
            const extracted = extractMediaFromTweetResult(
              tweetResult,
              includeReplies
            );
            for (const item of extracted) {
              if (!allowedTypes.has(item.type)) continue;
              if (seenMediaIds.has(item.id)) continue;
              seenMediaIds.add(item.id);
              collectedRaw.push(item);
              if (collectedRaw.length >= requestedLimit) {
                break;
              }
            }
          }

          // Also inspect TimelineTimelineModule (grid modules in UserMedia)
          if (
            content.entryType === "TimelineTimelineModule" &&
            Array.isArray(content.items)
          ) {
            for (const modItem of content.items) {
              foundEntriesInPage += 1;
              const tweetResult =
                modItem?.item?.itemContent?.tweet_results?.result;
              const extracted = extractMediaFromTweetResult(
                tweetResult,
                includeReplies
              );
              for (const item of extracted) {
                if (!allowedTypes.has(item.type)) continue;
                if (seenMediaIds.has(item.id)) continue;
                seenMediaIds.add(item.id);
                collectedRaw.push(item);
                if (collectedRaw.length >= requestedLimit) {
                  break;
                }
              }
              if (collectedRaw.length >= requestedLimit) break;
            }
          }

          if (collectedRaw.length >= requestedLimit) {
            break;
          }
        }
      }
    }

    if (collectedRaw.length >= requestedLimit) {
      if (nextCursor) truncated = true;
      break;
    }

    if (!nextCursor || nextCursor === cursor || foundEntriesInPage === 0) {
      break;
    }

    cursor = nextCursor;
  }

  const media: XMediaItem[] = collectedRaw.map((item, idx) => {
    const ext = getFileExtension(item.type, item.origUrl);
    return {
      ...item,
      filename: buildMediaFilename(
        pattern,
        user.screenName,
        item.createdAt,
        item.tweetId,
        idx + 1,
        ext
      ),
    };
  });

  return {
    user,
    media,
    total: media.length,
    truncated,
  };
}

export async function fetchSingleTweetMedia(
  username: string,
  tweetId: string,
  options: FetchMediaOptions
): Promise<FetchMediaResult> {
  const allowedTypes = new Set<MediaKind>(
    options.mediaTypes && options.mediaTypes.length > 0
      ? options.mediaTypes
      : ["photo", "video", "animated_gif"]
  );
  const pattern = options.filenamePattern || "Timeline-Date-Index";

  const targetUser = username || "i";
  const apiUrl = `https://api.vxtwitter.com/${encodeURIComponent(
    targetUser
  )}/status/${encodeURIComponent(tweetId)}`;

  const res = await fetch(apiUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; TwitterDL/1.0; +https://twitterdl.app)",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new XApiError("Tweet not found or private.", 404);
    }
    throw new XApiError(
      `Failed to fetch tweet details (HTTP ${res.status}).`,
      res.status
    );
  }

  const data = await res.json();
  const screenName: string = data.user_screen_name || username || "user";
  const user: XUserProfile = {
    restId: String(data.tweetID || tweetId),
    name: data.user_name || screenName,
    screenName,
    avatarUrl: data.user_profile_image_url
      ? String(data.user_profile_image_url).replace("_normal.", "_400x400.")
      : "",
    bio: "",
    followersCount: 0,
    followingCount: 0,
  };

  const createdAt: string = data.date || new Date().toISOString();
  const text: string = data.text || "";
  const extendedMedia: any[] = Array.isArray(data.media_extended)
    ? data.media_extended
    : [];

  const media: XMediaItem[] = [];

  extendedMedia.forEach((m, i) => {
    const rawType = String(m.type || "image").toLowerCase();
    const mappedType: MediaKind =
      rawType === "gif"
        ? "animated_gif"
        : rawType === "video"
        ? "video"
        : "photo";

    if (!allowedTypes.has(mappedType)) return;

    const mediaUrl: string = m.url || "";
    if (!mediaUrl) return;

    const cleanBase = mediaUrl.split("?")[0];
    const urlExt = cleanBase.split(".").pop()?.toLowerCase();
    const format =
      urlExt === "png" ? "png" : urlExt === "webp" ? "webp" : "jpg";
    const origUrl =
      mappedType === "photo" ? `${cleanBase}?format=${format}&name=orig` : mediaUrl;
    const thumb =
      m.thumbnail_url ||
      (mappedType === "photo" ? `${cleanBase}?format=${format}&name=small` : mediaUrl);

    const ext = getFileExtension(mappedType, origUrl);
    const width = Number(m.size?.width ?? 0);
    const height = Number(m.size?.height ?? 0);
    const durationMs =
      typeof m.duration_millis === "number" ? m.duration_millis : undefined;

    media.push({
      id: `${tweetId}-${i}`,
      tweetId: String(data.tweetID || tweetId),
      type: mappedType,
      url: mappedType === "photo" ? cleanBase : mediaUrl,
      origUrl,
      thumb,
      filename: buildMediaFilename(
        pattern,
        screenName,
        createdAt,
        String(data.tweetID || tweetId),
        media.length + 1,
        ext
      ),
      width,
      height,
      durationMs,
      createdAt,
      text,
    });
  });

  return {
    user,
    media,
    total: media.length,
    truncated: false,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function fetchXMedia(
  options: FetchMediaOptions
): Promise<FetchMediaResult> {
  const parsed = parseXInput(options.input);

  if (parsed.kind === "tweet") {
    return fetchSingleTweetMedia(parsed.username, parsed.tweetId, options);
  }

  const user = await fetchUserByScreenName(parsed.username);
  return fetchUserTimelineMedia(user, options);
}
