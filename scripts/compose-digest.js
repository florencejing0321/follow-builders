#!/usr/bin/env node

import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SCRIPT_DIR, "..");
const PROMPTS_DIR = join(ROOT_DIR, "prompts");

const SECTION_FALLBACKS = {
  "X / TWITTER": "No qualifying X posts in the past 24 hours.",
  "OFFICIAL BLOGS": "No qualifying official blog posts in the past 24 hours.",
  PODCASTS: "No qualifying podcast episodes in the past 24 hours.",
};

function parseCliArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function formatDateForTimezone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function trimText(text, maxChars) {
  if (!text) return "";
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function readJsonFile(path, label, issues) {
  if (!existsSync(path)) {
    issues.push(`${label} is missing.`);
    return null;
  }

  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch (error) {
    issues.push(`${label} could not be parsed: ${error.message}`);
    return null;
  }
}

async function readPrompt(filename) {
  return readFile(join(PROMPTS_DIR, filename), "utf-8");
}

function collectRecentX(feed, cutoff) {
  const builders = Array.isArray(feed?.x) ? feed.x : [];
  return builders
    .map((builder) => {
      const tweets = (builder.tweets || []).filter((tweet) => {
        const createdAt = parseTimestamp(tweet.createdAt);
        return createdAt && createdAt >= cutoff;
      });

      if (tweets.length === 0) return null;

      return {
        name: builder.name || "",
        handle: builder.handle || "",
        bio: trimText(builder.bio || "", 280),
        tweets: tweets.map((tweet) => ({
          createdAt: tweet.createdAt,
          url: tweet.url,
          text: trimText(tweet.text || "", 600),
          likes: tweet.likes ?? null,
          retweets: tweet.retweets ?? null,
          replies: tweet.replies ?? null,
          isQuote: Boolean(tweet.isQuote),
        })),
      };
    })
    .filter(Boolean);
}

function collectRecentArticles(feed, cutoff) {
  const articles = Array.isArray(feed?.blogs) ? feed.blogs : [];
  return articles
    .filter((article) => {
      const publishedAt = parseTimestamp(article.publishedAt);
      return publishedAt && publishedAt >= cutoff;
    })
    .map((article) => ({
      name: article.name || "",
      title: article.title || "",
      url: article.url || "",
      publishedAt: article.publishedAt,
      author: article.author || "",
      description: trimText(article.description || "", 600),
      content: trimText(article.content || "", 8000),
    }));
}

function collectRecentPodcasts(feed, cutoff) {
  const podcasts = Array.isArray(feed?.podcasts) ? feed.podcasts : [];
  return podcasts
    .filter((episode) => {
      const publishedAt = parseTimestamp(episode.publishedAt);
      return publishedAt && publishedAt >= cutoff;
    })
    .map((episode) => ({
      name: episode.name || "",
      title: episode.title || "",
      url: episode.url || "",
      publishedAt: episode.publishedAt,
      transcript: trimText(episode.transcript || "", 12000),
    }));
}

function noteFeedIssues(label, feed, cutoff, issues) {
  if (!feed) return;

  const generatedAt = parseTimestamp(feed.generatedAt);
  if (!generatedAt) {
    issues.push(`${label} is missing a reliable generatedAt timestamp.`);
  } else if (generatedAt < cutoff) {
    issues.push(
      `${label} looks stale (generatedAt ${generatedAt.toISOString()}).`
    );
  }

  if (Array.isArray(feed.errors) && feed.errors.length > 0) {
    issues.push(`${label} reported errors: ${feed.errors.join("; ")}`);
  }
}

function renderFallbackDigest(dateString) {
  return [
    `AI Builders Digest - ${dateString}`,
    "",
    "--------",
    "",
    "**X / TWITTER**",
    "",
    "--------",
    "",
    SECTION_FALLBACKS["X / TWITTER"],
    "",
    "--------",
    "",
    "**OFFICIAL BLOGS**",
    "",
    "--------",
    "",
    SECTION_FALLBACKS["OFFICIAL BLOGS"],
    "",
    "--------",
    "",
    "**PODCASTS**",
    "",
    "--------",
    "",
    SECTION_FALLBACKS.PODCASTS,
    "",
  ].join("\n");
}

function buildPromptPayload({
  dateString,
  timeZone,
  issues,
  xItems,
  blogItems,
  podcastItems,
  prompts,
}) {
  return JSON.stringify(
    {
      date: dateString,
      timezone: timeZone,
      formatting: {
        title: `AI Builders Digest - ${dateString}`,
        divider: "--------",
        sections: ["X / TWITTER", "OFFICIAL BLOGS", "PODCASTS"],
        fallbackSentences: SECTION_FALLBACKS,
      },
      repositoryPrompts: prompts,
      issues,
      selectedContent: {
        x: xItems,
        blogs: blogItems,
        podcasts: podcastItems,
      },
    },
    null,
    2
  );
}

async function createDigestWithOpenAI(promptPayload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to compose the digest.");
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.2";
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const systemPrompt = [
    "You create a daily AI builders digest from structured feed data.",
    "Return plain text only. Do not wrap the answer in code fences.",
    "Use this exact overall shape:",
    "AI Builders Digest - YYYY-MM-DD",
    "",
    "--------",
    "",
    "**X / TWITTER**",
    "",
    "--------",
    "",
    "**Author Name — Role / Company**",
    "",
    "English paragraph, 2-4 sentences.",
    "",
    "Chinese paragraph, 2-4 sentences.",
    "",
    "Source URL or URLs once only after the Chinese paragraph.",
    "",
    "--------",
    "",
    "Repeat the same pattern for **OFFICIAL BLOGS** and **PODCASTS**.",
    "If a major section has no qualifying items, output only the exact fallback sentence supplied in the JSON payload for that section.",
    "Do not leave any major section blank.",
    "Do not invent facts, quotes, roles, or links. Use only the supplied content.",
    "Keep the digest concise. Prefer one representative source URL when a single URL is sufficient.",
    "Do not repeat URLs after both languages.",
    "For X items, keep the URL as the original tweet URL.",
  ].join("\n");

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 4000,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: promptPayload }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const outputText = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        outputText.push(content.text);
      }
    }
  }

  const combined = outputText.join("\n").trim();
  if (!combined) {
    throw new Error("OpenAI API returned no digest text.");
  }
  return combined;
}

function validateDigest(text, dateString) {
  const requiredSections = ["**X / TWITTER**", "**OFFICIAL BLOGS**", "**PODCASTS**"];
  if (!text.startsWith(`AI Builders Digest - ${dateString}`)) {
    throw new Error("Digest output did not start with the expected title.");
  }
  for (const section of requiredSections) {
    if (!text.includes(section)) {
      throw new Error(`Digest output is missing section ${section}.`);
    }
  }
}

async function main() {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const timeZone = cliArgs.timezone || process.env.DIGEST_TIMEZONE || "Asia/Singapore";
  const now = cliArgs.now ? new Date(cliArgs.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid --now value: ${cliArgs.now}`);
  }

  const dateString = formatDateForTimezone(now, timeZone);
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const issues = [];

  const [feedX, feedBlogs, feedPodcasts] = await Promise.all([
    readJsonFile(join(ROOT_DIR, "feed-x.json"), "feed-x.json", issues),
    readJsonFile(join(ROOT_DIR, "feed-blogs.json"), "feed-blogs.json", issues),
    readJsonFile(
      join(ROOT_DIR, "feed-podcasts.json"),
      "feed-podcasts.json",
      issues
    ),
  ]);

  noteFeedIssues("feed-x.json", feedX, cutoff, issues);
  noteFeedIssues("feed-blogs.json", feedBlogs, cutoff, issues);
  noteFeedIssues("feed-podcasts.json", feedPodcasts, cutoff, issues);

  const [digestIntro, summarizeTweets, summarizeBlogs, summarizePodcast, translate] =
    await Promise.all([
      readPrompt("digest-intro.md"),
      readPrompt("summarize-tweets.md"),
      readPrompt("summarize-blogs.md"),
      readPrompt("summarize-podcast.md"),
      readPrompt("translate.md"),
    ]);

  const xItems = collectRecentX(feedX, cutoff);
  const blogItems = collectRecentArticles(feedBlogs, cutoff);
  const podcastItems = collectRecentPodcasts(feedPodcasts, cutoff);

  let digestText;
  if (xItems.length === 0 && blogItems.length === 0 && podcastItems.length === 0) {
    digestText = renderFallbackDigest(dateString);
  } else {
    const promptPayload = buildPromptPayload({
      dateString,
      timeZone,
      issues,
      xItems,
      blogItems,
      podcastItems,
      prompts: {
        digest_intro: digestIntro,
        summarize_tweets: summarizeTweets,
        summarize_blogs: summarizeBlogs,
        summarize_podcast: summarizePodcast,
        translate,
      },
    });

    digestText = await createDigestWithOpenAI(promptPayload);
    validateDigest(digestText, dateString);
  }

  if (cliArgs.output) {
    await writeFile(cliArgs.output, `${digestText.trim()}\n`, "utf-8");
  } else {
    process.stdout.write(`${digestText.trim()}\n`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
