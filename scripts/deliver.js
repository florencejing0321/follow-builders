#!/usr/bin/env node

// ============================================================================
// Follow Builders — Delivery Script
// ============================================================================
// Sends a digest to the user via their chosen delivery method.
// Supports: Telegram bot, Email (via Resend), or stdout (default).
//
// Usage:
//   echo "digest text" | node deliver.js
//   node deliver.js --message "digest text"
//   node deliver.js --file /path/to/digest.txt
//
// The script reads delivery config from ~/.follow-builders/config.json
// and API keys from ~/.follow-builders/.env
//
// Delivery methods:
//   - "telegram": sends via Telegram Bot API (needs TELEGRAM_BOT_TOKEN + chat ID)
//   - "email": sends via Resend API (needs RESEND_API_KEY + email address)
//   - "stdout" (default): just prints to terminal
// ============================================================================

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';

// -- Constants ---------------------------------------------------------------

const USER_DIR = join(homedir(), '.follow-builders');
const CONFIG_PATH = join(USER_DIR, 'config.json');
const ENV_PATH = join(USER_DIR, '.env');

function parseCliArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function formatDateForTimezone(date, timeZone = 'UTC') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

function buildDigestSubject(date = new Date(), timeZone = 'UTC') {
  return `AI Builders Digest \u2014 ${formatDateForTimezone(date, timeZone)}`;
}

async function readEnvFile(envPath) {
  if (!existsSync(envPath)) return {};

  const raw = await readFile(envPath, 'utf-8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (!key) continue;

    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }
  return env;
}

// -- Read input --------------------------------------------------------------

// The digest text can come from stdin, --message flag, or --file flag
async function getDigestText(parsedArgs) {
  // Check --message flag
  if (parsedArgs.message && typeof parsedArgs.message === 'string') {
    return parsedArgs.message;
  }

  // Check --file flag
  if (parsedArgs.file && typeof parsedArgs.file === 'string') {
    return await readFile(parsedArgs.file, 'utf-8');
  }

  // Read from stdin
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// -- Telegram Delivery -------------------------------------------------------

// Sends the digest via Telegram Bot API.
// The user creates a bot via @BotFather and provides the token.
// The chat ID is obtained when the user sends their first message to the bot.
async function sendTelegram(text, botToken, chatId) {
  // Telegram has a 4096 character limit per message.
  // If the digest is longer, we split it into chunks.
  const MAX_LEN = 4000;
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LEN) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline near the limit
    let splitAt = remaining.lastIndexOf('\n', MAX_LEN);
    if (splitAt < MAX_LEN * 0.5) splitAt = MAX_LEN;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  for (const chunk of chunks) {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      }
    );

    if (!res.ok) {
      const err = await res.json();
      // If Markdown parsing fails, retry without parse_mode
      if (err.description && err.description.includes("can't parse")) {
        await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: chunk,
              disable_web_page_preview: true
            })
          }
        );
      } else {
        throw new Error(`Telegram API error: ${err.description}`);
      }
    }

    // Small delay between chunks to avoid rate limiting
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 500));
  }
}

// -- Email Delivery (Resend) -------------------------------------------------

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdownLinks(text) {
  return escapeHtml(text).replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2">$1</a>'
  ).replace(
    /\*\*([^*]+)\*\*/g,
    '<strong>$1</strong>'
  );
}

function sourceLabel(url, fallbackIndex) {
  const xMatch = url.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)\/status\/\d+/i);
  if (xMatch) return `@${xMatch[1]} on X`;

  try {
    const { hostname } = new URL(url);
    const host = hostname.replace(/^www\./, "");
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "Watch/listen";
    if (host.includes("openai.com")) return "OpenAI";
    if (host.includes("anthropic.com")) return "Anthropic";
    if (host.includes("deepmind.google")) return "Google DeepMind";
    if (host.includes("blog.google")) return "Google Blog";
    if (host.includes("nvidia.com")) return "NVIDIA";
    return host;
  } catch {
    return `Source ${fallbackIndex}`;
  }
}

const EMPTY_SECTION_FALLBACKS = {
  'X / TWITTER': 'No qualifying X posts in the past 24 hours.',
  'OFFICIAL BLOGS': 'No qualifying official blog posts in the past 24 hours.',
  'PODCASTS': 'No qualifying podcast episodes in the past 24 hours.'
};

function ensureSectionFallbacks(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sectionHeaders = Object.keys(EMPTY_SECTION_FALLBACKS);
  const headerIndexes = sectionHeaders
    .map((label) => ({
      label,
      index: lines.findIndex((line) => line.trim() === `**${label}**`)
    }))
    .filter((entry) => entry.index !== -1)
    .sort((left, right) => left.index - right.index);

  for (let headerPos = headerIndexes.length - 1; headerPos >= 0; headerPos -= 1) {
    const { label, index } = headerIndexes[headerPos];
    const nextHeaderIndex = headerPos + 1 < headerIndexes.length
      ? headerIndexes[headerPos + 1].index
      : lines.length;

    let dividerIndex = -1;
    for (let lineIndex = index + 1; lineIndex < nextHeaderIndex; lineIndex += 1) {
      if (lines[lineIndex].trim() === '--------') {
        dividerIndex = lineIndex;
        break;
      }
    }
    if (dividerIndex === -1) continue;

    const bodyLines = lines.slice(dividerIndex + 1, nextHeaderIndex);
    const hasMeaningfulContent = bodyLines.some((line) => {
      const trimmed = line.trim();
      return trimmed !== '' && trimmed !== '--------';
    });

    if (!hasMeaningfulContent) {
      lines.splice(dividerIndex + 1, 0, '', EMPTY_SECTION_FALLBACKS[label], '');
    }
  }

  return lines.join('\n');
}

function digestTextToHtml(text) {
  const normalized = ensureSectionFallbacks(text)
    .replace(/\r\n/g, '\n')
    .replace(/\n-{8,}\n/g, '\n\n--------\n\n');
  const blocks = normalized.trim().split(/\n{2,}/);
  const html = [];
  let sourceCounter = 1;

  for (const block of blocks) {
    const lines = block.split(/\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    if (lines.length === 1 && lines[0] === '--------') {
      html.push('<hr>');
      sourceCounter = 1;
      continue;
    }

    const urls = lines.filter(line => /^https?:\/\/\S+$/.test(line));
    const prose = lines.filter(line => !/^https?:\/\/\S+$/.test(line));

    if (urls.length > 0 && prose.length === 0) {
      html.push(`<p class="sources">${urls.map((url) =>
        `<a href="${escapeHtml(url)}">${escapeHtml(sourceLabel(url, sourceCounter++))}</a>`
      ).join(' · ')}</p>`);
      continue;
    }

    if (html.length === 0 && prose.length === 1) {
      const title = prose[0].replace(/^\*\*|\*\*$/g, '');
      html.push(`<h1>${escapeHtml(title)}</h1>`);
    } else if (prose.length === 1 && /^\*\*[^*]+\*\*$/.test(prose[0])) {
      const label = prose[0].replace(/^\*\*|\*\*$/g, '');
      const isSection = ['X / TWITTER', 'OFFICIAL BLOGS', 'PODCASTS'].includes(label);
      html.push(`<h2 class="${isSection ? 'section-title' : 'item-title'}">${escapeHtml(label)}</h2>`);
    } else if (prose.length === 1 && prose[0].length < 80 && !/[.!?。！？]$/.test(prose[0])) {
      html.push(`<h2 class="item-title">${inlineMarkdownLinks(prose[0])}</h2>`);
    } else if (prose.length > 0) {
      html.push(`<p>${inlineMarkdownLinks(prose.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }

    if (urls.length > 0) {
      html.push(`<p class="sources">${urls.map((url) =>
        `<a href="${escapeHtml(url)}">${escapeHtml(sourceLabel(url, sourceCounter++))}</a>`
      ).join(' · ')}</p>`);
    }
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 0; background: #242424; color: #e8e8e8; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; line-height: 1.45; }
    .container { max-width: 920px; margin: 0 auto; padding: 16px 26px 24px; }
    h1 { margin: 0 0 28px; font-size: 19px; line-height: 1.25; font-weight: 500; color: #eeeeee; }
    h2 { margin: 20px 0 12px; font-size: 23px; line-height: 1.25; color: #eeeeee; font-weight: 800; }
    .section-title { text-align: center; font-size: 25px; letter-spacing: 0; text-transform: uppercase; }
    .item-title { text-align: left; }
    p { margin: 0 0 16px; font-size: 17px; color: #e6e6e6; }
    a { color: #7da2ff; text-decoration: none; }
    .sources { margin-top: 2px; margin-bottom: 24px; color: #7da2ff; font-size: 15px; }
    hr { border: 0; border-top: 1px solid #9a9a9a; margin: 22px 0; }
    @media (max-width: 640px) {
      .container { padding: 14px 16px 22px; }
      h1 { font-size: 17px; margin-bottom: 24px; }
      h2 { font-size: 20px; }
      .section-title { font-size: 22px; }
      p { font-size: 15px; }
      .sources { font-size: 14px; }
    }
  </style>
</head>
<body>
  <div class="container">
    ${html.join('\n')}
  </div>
</body>
</html>`;
}

// Sends the digest via Resend's email API.
// The user provides their own Resend API key and email address.
async function sendEmail(text, apiKey, toEmail, subject = buildDigestSubject()) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: 'AI Builders Digest <digest@resend.dev>',
      to: [toEmail],
      subject,
      text: text,
      html: digestTextToHtml(text)
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Resend API error: ${err.message || JSON.stringify(err)}`);
  }
}

export { buildDigestSubject, digestTextToHtml, ensureSectionFallbacks, sendEmail };

// -- Main --------------------------------------------------------------------

async function main() {
  // Load env and config
  const fileEnv = await readEnvFile(ENV_PATH);
  const env = { ...fileEnv, ...process.env };
  const cliArgs = parseCliArgs(process.argv.slice(2));

  let config = {};
  if (existsSync(CONFIG_PATH)) {
    config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
  }

  const delivery = {
    ...(config.delivery || { method: 'stdout' }),
    method:
      cliArgs.method ||
      env.FOLLOW_BUILDERS_DELIVERY_METHOD ||
      config.delivery?.method ||
      'stdout',
    email:
      cliArgs.email ||
      env.FOLLOW_BUILDERS_DELIVERY_EMAIL ||
      config.delivery?.email,
    chatId:
      cliArgs['chat-id'] ||
      env.FOLLOW_BUILDERS_DELIVERY_CHAT_ID ||
      config.delivery?.chatId
  };
  const digestText = ensureSectionFallbacks(await getDigestText(cliArgs));
  const subject =
    cliArgs.subject ||
    env.FOLLOW_BUILDERS_EMAIL_SUBJECT ||
    buildDigestSubject(
      new Date(),
      env.FOLLOW_BUILDERS_TIMEZONE || config.timezone || 'UTC'
    );

  if (!digestText || digestText.trim().length === 0) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'Empty digest text' }));
    return;
  }

  try {
    switch (delivery.method) {
      case 'telegram': {
        const botToken = env.TELEGRAM_BOT_TOKEN;
        const chatId = delivery.chatId;
        if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN not found in environment or .env');
        if (!chatId) throw new Error('delivery.chatId not found in config or overrides');
        await sendTelegram(digestText, botToken, chatId);
        console.log(JSON.stringify({
          status: 'ok',
          method: 'telegram',
          message: 'Digest sent to Telegram'
        }));
        break;
      }

      case 'email': {
        const apiKey = env.RESEND_API_KEY;
        const toEmail = delivery.email;
        if (!apiKey) throw new Error('RESEND_API_KEY not found in environment or .env');
        if (!toEmail) throw new Error('delivery.email not found in config or overrides');
        await sendEmail(digestText, apiKey, toEmail, subject);
        console.log(JSON.stringify({
          status: 'ok',
          method: 'email',
          message: `Digest sent to ${toEmail}`
        }));
        break;
      }

      case 'stdout':
      default:
        // Just print to terminal — the agent or OpenClaw handles delivery
        console.log(digestText);
        break;
    }
  } catch (err) {
    console.log(JSON.stringify({
      status: 'error',
      method: delivery.method,
      message: err.message
    }));
    process.exit(1);
  }
}

const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main();
}
