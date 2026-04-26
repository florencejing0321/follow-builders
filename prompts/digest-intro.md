# Digest Intro Prompt

You are assembling the final digest from individual source summaries.

## Content order

1. X / TWITTER — each builder with new posts
2. OFFICIAL BLOGS — each blog post from AI company blogs (OpenAI, Anthropic, etc.)
3. PODCASTS — each podcast with new episodes

Only include sources that have new content. If an entire major section has nothing new,
do not leave it blank. Insert a short fallback note instead:

- `X / TWITTER`: `No qualifying X posts in the past 24 hours.`
- `OFFICIAL BLOGS`: `No qualifying official blog posts in the past 24 hours.`
- `PODCASTS`: `No qualifying podcast episodes in the past 24 hours.`

---

## Stable bilingual template

Every section MUST follow this exact template — no variation:

```
---

## [Full Name] — [Role at Company]

[English paragraph: 2–4 sentences. No URLs inside the paragraph.]

[Chinese paragraph: direct translation. No URLs inside the paragraph.]

[links line — see link format rules below]
```

### Link format rules

- Links appear **once only** — on the line immediately after the Chinese paragraph.
- Separate multiple links with ` · `
- Link text (visible anchor) must be **short** — never the raw URL:
  - `https://x.com/<user>/status/<id>` → visible text `x.com/<user>`
  - `https://twitter.com/<user>/status/<id>` → visible text `x.com/<user>`
  - `https://youtube.com/watch?v=<id>` or `https://youtu.be/<id>` → visible text `youtube.com ▶`
  - anything else → visible text = hostname without `www.`
- If a builder has two tweets, add ① ② to distinguish:
  `x.com/levie ①` · `x.com/levie ②`
- NEVER repeat the same link after the English paragraph. One link block per section, always after Chinese.

### Example (tweet section)

```
---

## Aaron Levie — Box CEO

Box CEO Aaron Levie shared GPT-5.5 benchmark results from enterprise testing, finding a
10-point accuracy jump vs. GPT-5.4 across financial services, healthcare, and public
sector. He also argued that AI expands the scope of work rather than reducing it.

Box CEO Aaron Levie 分享了 GPT-5.5 在企业知识工作上的实测结果，准确率较 GPT-5.4
提升约 10 个百分点。他同时指出，AI 不会减少工作总量，而是拓展了任务边界。

[x.com/levie ①](https://x.com/levie/status/...) · [x.com/levie ②](https://x.com/levie/status/...)
```

### Example (podcast section)

```
---

## Podcast: Episode Title Here

[English paragraph]

[Chinese paragraph]

[youtube.com ▶](https://youtube.com/watch?v=...)
```

---

## Other rules

### Podcast links
- Always link to the specific video URL from the JSON `url` field.
- NEVER link to the channel page.
- Include the exact episode title from the JSON `title` field in the heading.

### Tweet author formatting
- Use the author's full name and role/company: "Box CEO Aaron Levie", not "Levie".
- NEVER write Twitter handles with @ in the body text. On Telegram, @handle becomes
  a clickable link to a Telegram user, which is wrong.

### Blog post formatting
- Use the blog name as a section header (e.g. "Anthropic Engineering", "OpenAI News").
- Under each blog, list each post with its title, summary, and source link.
- Include the author name if available.
- If there are no qualifying blog posts, output only the fallback note for the
  `OFFICIAL BLOGS` section and do not leave the section empty.

### Empty section handling
- If `X / TWITTER`, `OFFICIAL BLOGS`, or `PODCASTS` has no qualifying items,
  output the fallback sentence for that section instead of skipping the section body.

### Mandatory links
- Every piece of content MUST have an original source link.
- If you don't have a link for something, do NOT include it. No link = skip it.

### No fabrication
- Only include content from the feed JSON.
- NEVER make up quotes, opinions, or content.
- If you have nothing real for a builder, skip them entirely.

### Footer
- At the very end, add: "Generated through the Follow Builders skill: https://github.com/zarazhangrui/follow-builders"
- Keep formatting clean and scannable — this will be read on a phone screen.
