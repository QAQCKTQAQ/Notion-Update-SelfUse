#!/usr/bin/env node
/**
 * 从 Notion 读取页面「时间戳元数据」，聚合成热力图数据 activity.json。
 *
 * 隐私约定（建议部署前通读这 100 行）：
 *   - 只使用每个页面的 id（仅用于去重）、created_time、last_edited_time、parent、archived；
 *   - 从不读取、打印或输出 properties / url / 标题 / 正文 / 块内容 / 附件；
 *   - 输出文件只含 { updatedAt, days: [{ date, count }] }，没有任何可识别信息；
 *   - 日志只输出汇总数字，不输出任何页面 ID 或标题。
 *
 * 零第三方依赖，只需要 Node.js 18+ 自带的 fetch。
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TOKEN = process.env.NOTION_TOKEN;
const API = "https://api.notion.com/v1/search";
const NOTION_VERSION = "2022-06-28";
const GMT8 = 8 * 60 * 60 * 1000;

/**
 * 自建统计库：它们的行由统计流程自己产生，若不排除会让活动数自我膨胀。
 * 同时列出 database ID 与 data source ID，兼容 Notion API 新旧两种 parent 形态。
 * 可用环境变量 EXCLUDE_IDS 追加，英文逗号分隔。
 */
const BUILTIN_EXCLUDES = [
  "f321d6991faf422c9a9e71f9207d7ae2", // 写作活跃度（database）
  "fceaf212c0d845ce934d334067543e42", // 写作活跃度（data source）
  "308f813c0d704fc0b32e0a4fe605eb58", // 写作热力看板（database）
  "0bbadffea26a4b3f9ef19ee0aaf188e3"  // 写作热力看板（data source）
];
const EXCLUDES = new Set([
  ...BUILTIN_EXCLUDES,
  ...(process.env.EXCLUDE_IDS || "")
    .split(",")
    .map((s) => normId(s))
    .filter(Boolean)
]);

function normId(id) {
  return String(id || "").replace(/-/g, "").toLowerCase();
}

function gmt8Date(iso) {
  return new Date(new Date(iso).getTime() + GMT8).toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchPage(cursor) {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;

  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    // 刻意不打印响应体，避免任何页面内容进入 Actions 日志
    throw new Error(`Notion search 失败：HTTP ${res.status}（检查 token 是否有效、集成是否已授权页面）`);
  }
  return res.json();
}

async function main() {
  if (!TOKEN) throw new Error("缺少环境变量 NOTION_TOKEN");

  const latestById = new Map(); // page id -> 最新时间戳
  let scanned = 0;
  let cursor = null;

  do {
    const data = await searchPage(cursor);
    for (const item of data.results || []) {
      if (item.object !== "page") continue;        // 跳过 database / data_source 对象
      if (item.archived || item.in_trash) continue; // 跳过回收站

      const p = item.parent || {};
      const parentIds = [p.database_id, p.data_source_id, p.page_id, p.block_id].filter(Boolean);
      if (parentIds.some((x) => EXCLUDES.has(normId(x)))) continue;

      const a = item.created_time;
      const b = item.last_edited_time;
      const latest = a && b ? (a > b ? a : b) : a || b;
      if (!latest) continue;

      // id 只在这个 Map 里做去重，绝不写入输出
      const prev = latestById.get(item.id);
      if (!prev || latest > prev) latestById.set(item.id, latest);
      scanned++;
    }
    cursor = data.has_more ? data.next_cursor : null;
    if (cursor) await sleep(400); // 免费计划速率较低，留足余量
  } while (cursor);

  // 授权丢失时绝不覆盖成空数据，否则历史热力会被清空
  if (latestById.size === 0) {
    throw new Error("未读到任何页面：通常是集成未授权根页面或 token 失效。已中止，activity.json 保持不变");
  }

  const counts = new Map();
  for (const latest of latestById.values()) {
    const day = gmt8Date(latest);
    counts.set(day, (counts.get(day) || 0) + 1);
  }

  const days = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  const updatedAt = new Date(Date.now() + GMT8).toISOString().slice(0, 19) + "+08:00";
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "activity.json");
  await writeFile(out, JSON.stringify({ updatedAt, days }, null, 2) + "\n", "utf8");

  const total = days.reduce((sum, d) => sum + d.count, 0);
  console.log(`已扫描 ${scanned} 条页面记录，去重后 ${latestById.size} 个页面`);
  console.log(`活跃日期 ${days.length} 天，贡献总数 ${total}`);
  console.log(`已写入 ${out}`);
  console.log("若「去重后页面数」明显少于你的笔记总数，说明集成授权范围不足，请检查根页面是否已 Add connections");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
