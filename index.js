// import axios from "axios";
// import { HttpsProxyAgent } from "https-proxy-agent";
// import { parseStringPromise } from "xml2js";
// import * as dotenv from "dotenv";

// dotenv.config();

// const DOMAINS_MAP = {
//   en: "https://www.addingvalue.nu",
// };

// const PROXIES = {
//   en: process.env.BRD_PROXY_NU,
// };

// const USER_AGENTS = {
//   en: "AddingValue-NU-CacheWarmer/1.0",
// };

// const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// async function fetchWithProxy(url, country) {
//   const proxy = PROXIES[country];
//   const agent = new HttpsProxyAgent(proxy);
//   const res = await axios.get(url, {
//     httpsAgent: agent,
//     headers: { "User-Agent": USER_AGENTS[country] },
//     timeout: 15000,
//   });
//   return res.data;
// }

// async function fetchIndexSitemaps(domain, country) {
//   try {
//     const xml = await fetchWithProxy(`${domain}/sitemap.xml`, country);
//     const result = await parseStringPromise(xml);
//     return result?.sitemapindex?.sitemap?.map((entry) => entry.loc[0]) ?? [];
//   } catch {
//     return [];
//   }
// }

// async function fetchUrlsFromSitemap(sitemapUrl, country) {
//   try {
//     const xml = await fetchWithProxy(sitemapUrl, country);
//     const result = await parseStringPromise(xml);
//     return result?.urlset?.url?.map((entry) => entry.loc[0]) ?? [];
//   } catch {
//     return [];
//   }
// }

// async function retryableGet(url, config, retries = 3) {
//   let lastError = null;
//   for (let i = 0; i < retries; i++) {
//     try {
//       return await axios.get(url, config);
//     } catch (err) {
//       lastError = err;
//       const code = err.code || "";
//       const isRetryable =
//         axios.isAxiosError(err) &&
//         ["ECONNABORTED", "ECONNRESET", "ETIMEDOUT"].includes(code);
//       if (!isRetryable) break;
//       await sleep(2000);
//     }
//   }
//   throw lastError;
// }

// async function warmUrls(urls, country, batchSize = 3, delay = 7000) {
//   const proxy = PROXIES[country];
//   const agent = new HttpsProxyAgent(proxy);

//   const batches = Array.from(
//     { length: Math.ceil(urls.length / batchSize) },
//     (_, i) => urls.slice(i * batchSize, i * batchSize + batchSize)
//   );

//   await batches.reduce(async (previous, batch) => {
//     await previous;

//     await Promise.all(
//       batch.map(async (url) => {
//         try {
//           const res = await retryableGet(url, {
//             httpsAgent: agent,
//             headers: { "User-Agent": USER_AGENTS[country] },
//             timeout: 30000,
//           });

//           console.log(
//             `[${country}] [${res.status}] ${
//               res.headers["cf-cache-status"] || "N/A"
//             } - ${url}`
//           );
//           console.log(
//             `[${country}] ➤ Edge: ${res.headers["cf-ray"] || "unknown"}`
//           );
//         } catch {
//           console.warn(`[${country}] ❌ Failed to warm ${url}`);
//         }
//       })
//     );

//     await sleep(delay);
//   }, Promise.resolve());
// }

// // 🚀 Main function
// (async () => {
//   console.log(`[CacheWarmer] Started at ${new Date().toISOString()}`);

//   await Promise.all(
//     Object.entries(DOMAINS_MAP).map(async ([country, domain]) => {
//       const sitemapList = await fetchIndexSitemaps(domain, country);

//       const urlArrays = await Promise.all(
//         sitemapList.map((sitemapUrl) =>
//           fetchUrlsFromSitemap(sitemapUrl, country)
//         )
//       );

//       const urls = urlArrays.flat();
//       console.log(`[${country}] 🔗 Found ${urls.length} URLs`);

//       await warmUrls(urls, country);
//     })
//   );

//   console.log(`[CacheWarmer] Finished at ${new Date().toISOString()}`);
// })();
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { parseStringPromise } from "xml2js";
import * as dotenv from "dotenv";

dotenv.config();

// === Apps Script endpoint (tanpa secret) ===
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL; // Wajib di-set

// === Konfigurasi domain/proxy/UA ===
const DOMAINS_MAP = {
  en: "https://www.addingvalue.nu",
  fl: "https://www.addingvalue.nu",
};

const PROXIES = {
  en: process.env.BRD_PROXY_NU,
  fl: process.env.BRD_PROXY_FL,
};

const USER_AGENTS = {
  en: "AddingValue-NU-CacheWarmer/1.0",
  fl: "AddingValue-FL-CacheWarmer/1.0",
};

// === Cloudflare ===
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

// === Util umum ===
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cryptoRandomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Buat nama tab berdasarkan waktu WITA (Asia/Makassar)
 * Contoh: 2025-08-21_14-00-00_WITA
 */
function makeSheetNameForRun(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  // Runner (GitHub) umumnya UTC. WITA = UTC+8.
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const stamp =
    `${local.getUTCFullYear()}-` +
    `${pad(local.getUTCMonth() + 1)}-` +
    `${pad(local.getUTCDate())}_` +
    `${pad(local.getUTCHours())}-` +
    `${pad(local.getUTCMinutes())}-` +
    `${pad(local.getUTCSeconds())}_WITA`;
  return stamp;
}

// Jika ingin per-hari saja, gunakan ini:
// function makeSheetNameForRun(date = new Date()) {
//   const pad = (n) => String(n).padStart(2, "0");
//   const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
//   return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
// }

// === Logger ke Apps Script (buffer lalu POST sekali di akhir run) ===
class AppsScriptLogger {
  constructor() {
    this.rows = [];
    this.runId = cryptoRandomId();
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
    this.sheetName = makeSheetNameForRun(); // nama tab per-run
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
      this.finishedAt, // akan diisi saat finalize()
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
    // backfill finishedAt untuk semua baris sebelum kirim
    this.rows = this.rows.map((r) => {
      r[2] = this.finishedAt;
      return r;
    });
  }

  async flush() {
    // CHANGED: tidak lagi memerlukan SECRET
    if (!APPS_SCRIPT_URL) {
      console.warn("Apps Script logging disabled (missing APPS_SCRIPT_URL).");
      return;
    }
    if (this.rows.length === 0) return;

    try {
      const res = await axios.post(
        APPS_SCRIPT_URL,
        {
          // CHANGED: hanya kirim sheetName & rows
          sheetName: this.sheetName, // hapus field ini jika ingin nama tab auto dari Apps Script
          rows: this.rows,
        },
        { timeout: 20000, headers: { "Content-Type": "application/json" } }
      );

      console.log("Apps Script response:", res.status, res.data);
      if (!res.data?.ok) {
        console.warn("Apps Script replied error:", res.data);
      } else {
        console.log(
          `📝 Logged ${res.data.inserted} rows to sheet: ${res.data.sheet}`
        );
      }
      this.rows = [];
    } catch (e) {
      console.warn("Apps Script logging error:", e?.message || e);
    }
  }
}

// === Logika cache warmer (punyamu) + instrumentation logger ===
async function fetchWithProxy(url, country) {
  const proxy = PROXIES[country];
  const agent = new HttpsProxyAgent(proxy);
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
    const result = await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: true,
    });
    const sitemapList = result?.sitemapindex?.sitemap;
    if (!sitemapList) return [];
    const sitemaps = Array.isArray(sitemapList) ? sitemapList : [sitemapList];
    return sitemaps.map((entry) => entry.loc);
  } catch (err) {
    console.warn(
      `[${country}] ❌ Failed to fetch sitemap index`,
      err?.message || err
    );
    return [];
  }
}

async function fetchUrlsFromSitemap(sitemapUrl, country) {
  try {
    const xml = await fetchWithProxy(sitemapUrl, country);
    const result = await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: true,
    });
    const urlList = result?.urlset?.url;
    if (!urlList) return [];
    const urls = Array.isArray(urlList) ? urlList : [urlList];
    return urls.map((entry) => entry.loc);
  } catch (err) {
    console.warn(
      `[${country}] ❌ Failed to fetch URLs from ${sitemapUrl}`,
      err?.message || err
    );
    return [];
  }
}

async function retryableGet(url, config, retries = 3) {
  let lastError = null;
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, config);
    } catch (err) {
      lastError = err;
      const code = err.code || "";
      const isRetryable =
        axios.isAxiosError(err) &&
        ["ECONNABORTED", "ECONNRESET", "ETIMEDOUT"].includes(code);
      if (!isRetryable) break;
      await sleep(2000);
    }
  }
  throw lastError;
}

async function purgeCloudflareCache(url) {
  try {
    const purgeRes = await axios.post(
      `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache`,
      { files: [url] },
      {
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (purgeRes.data.success) {
      console.log(`✅ Cloudflare cache purged for: ${url}`);
    } else {
      console.warn(`⚠️ Cloudflare purge failed for: ${url}`);
    }
  } catch {
    console.warn(`❌ Error purging Cloudflare for: ${url}`);
  }
}

async function warmUrls(urls, country, logger, batchSize = 3, delay = 7000) {
  const proxy = PROXIES[country];
  const agent = new HttpsProxyAgent(proxy);

  const batches = Array.from(
    { length: Math.ceil(urls.length / batchSize) },
    (_, i) => urls.slice(i * batchSize, i * batchSize + batchSize)
  );

  await batches.reduce(async (previous, batch) => {
    await previous;

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

          const vercelCache = res.headers["x-vercel-cache"];
          const cfCache = res.headers["cf-cache-status"];
          const cfRay = res.headers["cf-ray"] || "unknown";

          console.log(
            `[${country}] [${res.status}] cf=${cfCache || "N/A"} vercel=${
              vercelCache || "N/A"
            } - ${url}`
          );
          console.log(`[${country}] ➤ Edge: ${cfRay}`);

          // log sukses
          logger.log({
            country,
            url,
            status: res.status,
            cfCache: cfCache || "N/A",
            vercelCache: vercelCache || "N/A",
            cfRay,
            responseMs: dt,
            error: 0,
            message: "",
          });

          if (["REVALIDATED", "MISS", "PRERENDER"].includes(vercelCache)) {
            await purgeCloudflareCache(url);
          }
        } catch (err) {
          const dt = Date.now() - t0;
          console.warn(`[${country}] ❌ Failed to warm ${url}`);

          // log error
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

    // Jika ingin melihat log masuk bertahap, aktifkan ini:
    // await logger.flush();

    await sleep(delay);
  }, Promise.resolve());
}

// 🚀 Main function
(async () => {
  console.log(`[CacheWarmer] Started at ${new Date().toISOString()}`);

  const logger = new AppsScriptLogger();

  try {
    await Promise.all(
      Object.entries(DOMAINS_MAP).map(async ([country, domain]) => {
        const sitemapList = await fetchIndexSitemaps(domain, country);
        const urlArrays = await Promise.all(
          sitemapList.map((sitemapUrl) =>
            fetchUrlsFromSitemap(sitemapUrl, country)
          )
        );
        const urls = urlArrays.flat();

        console.log(`[${country}] 🔗 Found ${urls.length} URLs`);

        // optional: catat summary per-country
        logger.log({
          country,
          message: `Found ${urls.length} URLs for ${country}`,
        });

        await warmUrls(urls, country, logger);
      })
    );
  } finally {
    // finalize & kirim sekali di akhir agar semua row punya finished_at
    logger.setFinished();
    await logger.flush();
  }

  console.log(`[CacheWarmer] Finished at ${new Date().toISOString()}`);
})();


