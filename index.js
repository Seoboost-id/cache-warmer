import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { parseStringPromise } from "xml2js";
import * as dotenv from "dotenv";

dotenv.config();

/* ============================================================
   CONFIG
============================================================ */

// === Apps Script endpoint ===
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

// === Domain map (logical country → domain) ===
const DOMAINS_MAP = {
  en: "https://www.addingvalue.nu",
  fl: "https://www.addingvalue.nu",
};

// === Proxy per logical country ===
const PROXIES = {
  en: process.env.BRD_PROXY_NU,
  fl: process.env.BRD_PROXY_FL,
};

// === User Agent per logical country ===
const USER_AGENTS = {
  en: "AddingValue-NU-CacheWarmer/1.0",
  fl: "AddingValue-FL-CacheWarmer/1.0",
};

// === Cloudflare ===
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

/* ============================================================
   UTIL
============================================================ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cryptoRandomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Ambil POP Cloudflare dari cf-ray
function extractCfEdge(cfRay) {
  if (!cfRay || typeof cfRay !== "string") return "N/A";
  const parts = cfRay.split("-");
  return parts.length > 1 ? parts[parts.length - 1] : "N/A";
}

/**
 * Sheet name berdasarkan WITA
 * Contoh: 2025-12-15_13-30-00_WITA
 */
function makeSheetNameForRun(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return (
    `${local.getUTCFullYear()}-` +
    `${pad(local.getUTCMonth() + 1)}-` +
    `${pad(local.getUTCDate())}_` +
    `${pad(local.getUTCHours())}-` +
    `${pad(local.getUTCMinutes())}-` +
    `${pad(local.getUTCSeconds())}_WITA`
  );
}

/* ============================================================
   LOGGER → GOOGLE SHEETS
============================================================ */

class AppsScriptLogger {
  constructor() {
    this.rows = [];
    this.runId = cryptoRandomId();
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
    this.sheetName = makeSheetNameForRun();
  }

  log({
    country = "",
    url = "",
    status = "",
    cfCache = "",
    vercelCache = "",
    cfRay = "",
    responseMs = "",
    error = 0,
    message = "",
  }) {
    this.rows.push([
      this.runId,
      this.startedAt,
      this.finishedAt,
      country,
      url,
      status,
      cfCache,
      vercelCache,
      cfRay,
      typeof responseMs === "number" ? responseMs : "",
      error ? 1 : 0,
      message,
    ]);
  }

  setFinished() {
    this.finishedAt = new Date().toISOString();
    this.rows = this.rows.map((r) => {
      r[2] = this.finishedAt;
      return r;
    });
  }

  async flush() {
    if (!APPS_SCRIPT_URL || this.rows.length === 0) return;

    try {
      const res = await axios.post(
        APPS_SCRIPT_URL,
        {
          sheetName: this.sheetName,
          rows: this.rows,
        },
        {
          timeout: 20000,
          headers: { "Content-Type": "application/json" },
        }
      );

      console.log(
        `📝 Logged ${res.data?.inserted || this.rows.length} rows → ${
          this.sheetName
        }`
      );
      this.rows = [];
    } catch (err) {
      console.warn("❌ Apps Script logging error:", err?.message || err);
    }
  }
}

/* ============================================================
   FETCH & SITEMAP
============================================================ */

async function fetchWithProxy(url, country) {
  const agent = new HttpsProxyAgent(PROXIES[country]);
  const res = await axios.get(url, {
    httpsAgent: agent,
    headers: { "User-Agent": USER_AGENTS[country] },
    timeout: 15000,
  });
  return res.data;
}

async function fetchIndexSitemaps(domain, country) {
  try {
    const xml = await fetchWithProxy(`${domain}/sitemap.xml`, country);
    const parsed = await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: true,
    });
    const list = parsed?.sitemapindex?.sitemap;
    if (!list) return [];
    return (Array.isArray(list) ? list : [list]).map((x) => x.loc);
  } catch (e) {
    console.warn(`[${country}] ❌ sitemap index error`);
    return [];
  }
}

async function fetchUrlsFromSitemap(sitemapUrl, country) {
  try {
    const xml = await fetchWithProxy(sitemapUrl, country);
    const parsed = await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: true,
    });
    const list = parsed?.urlset?.url;
    if (!list) return [];
    return (Array.isArray(list) ? list : [list]).map((x) => x.loc);
  } catch (e) {
    console.warn(`[${country}] ❌ sitemap url error`);
    return [];
  }
}

/* ============================================================
   CACHE WARMER
============================================================ */

async function retryableGet(url, config, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, config);
    } catch (e) {
      lastErr = e;
      if (!["ECONNRESET", "ETIMEDOUT", "ECONNABORTED"].includes(e.code)) break;
      await sleep(2000);
    }
  }
  throw lastErr;
}

async function purgeCloudflareCache(url) {
  try {
    await axios.post(
      `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache`,
      { files: [url] },
      {
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`🧹 CF purged → ${url}`);
  } catch {
    console.warn(`⚠️ CF purge failed → ${url}`);
  }
}

async function warmUrls(urls, country, logger, batchSize = 3, delay = 7000) {
  const agent = new HttpsProxyAgent(PROXIES[country]);

  const batches = Array.from(
    { length: Math.ceil(urls.length / batchSize) },
    (_, i) => urls.slice(i * batchSize, i * batchSize + batchSize)
  );

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (url) => {
        const t0 = Date.now();
        try {
          const res = await retryableGet(url, {
            httpsAgent: agent,
            headers: { "User-Agent": USER_AGENTS[country] },
            timeout: 30000,
          });

          const dt = Date.now() - t0;
          const vercelCache = res.headers["x-vercel-cache"] || "N/A";
          const cfCache = res.headers["cf-cache-status"] || "N/A";
          const cfRay = res.headers["cf-ray"] || "";
          const cfEdge = extractCfEdge(cfRay);

          console.log(
            `[${cfEdge}] ${res.status} cf=${cfCache} vercel=${vercelCache} - ${url}`
          );

          logger.log({
            country: cfEdge,
            url,
            status: res.status,
            cfCache,
            vercelCache,
            cfRay,
            responseMs: dt,
            error: 0,
          });

          if (
            ["MISS", "REVALIDATED", "PRERENDER", "STALE"].includes(vercelCache)
          ) {
            await purgeCloudflareCache(url);
          }
        } catch (err) {
          const dt = Date.now() - t0;
          console.warn(`[${country}] ❌ Failed ${url}`);

          logger.log({
            country,
            url,
            responseMs: dt,
            error: 1,
            message: err?.message || "request failed",
          });
        }
      })
    );

    await sleep(delay);
  }
}

/* ============================================================
   MAIN
============================================================ */

(async () => {
  console.log(`[CacheWarmer] Started at ${new Date().toISOString()}`);
  const logger = new AppsScriptLogger();

  try {
    await Promise.all(
      Object.entries(DOMAINS_MAP).map(async ([country, domain]) => {
        const sitemapIndexes = await fetchIndexSitemaps(domain, country);
        const urls = (
          await Promise.all(
            sitemapIndexes.map((s) => fetchUrlsFromSitemap(s, country))
          )
        ).flat();

        console.log(`[${country}] 🔗 Found ${urls.length} URLs`);
        logger.log({ country, message: `Found ${urls.length} URLs` });

        await warmUrls(urls, country, logger);
      })
    );
  } finally {
    logger.setFinished();
    await logger.flush();
  }

  console.log(`[CacheWarmer] Finished at ${new Date().toISOString()}`);
})();
