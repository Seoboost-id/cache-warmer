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

const DOMAINS_MAP = {
  en: "https://www.addingvalue.nu",
};

const PROXIES = {
  en: process.env.BRD_PROXY_NU,
};

const USER_AGENTS = {
  en: "AddingValue-NU-CacheWarmer/1.0",
};

const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    console.warn(`[${country}] ❌ Failed to fetch sitemap index`, err?.message || err);
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
    console.warn(`[${country}] ❌ Failed to fetch URLs from ${sitemapUrl}`, err?.message || err);
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
      const isRetryable = axios.isAxiosError(err) && ["ECONNABORTED", "ECONNRESET", "ETIMEDOUT"].includes(code);
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
      {
        files: [url],
      },
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
  } catch (err) {
    console.warn(`❌ Error purging Cloudflare for: ${url}`);
  }
}

async function warmUrls(urls, country, batchSize = 3, delay = 7000) {
  const proxy = PROXIES[country];
  const agent = new HttpsProxyAgent(proxy);

  const batches = Array.from({ length: Math.ceil(urls.length / batchSize) }, (_, i) => urls.slice(i * batchSize, i * batchSize + batchSize));

  await batches.reduce(async (previous, batch) => {
    await previous;

    await Promise.all(
      batch.map(async (url) => {
        try {
          const res = await retryableGet(url, {
            httpsAgent: agent,
            headers: { "User-Agent": USER_AGENTS[country] },
            timeout: 30000,
          });

          const vercelCache = res.headers["x-vercel-cache"];
          const cfCache = res.headers["cf-cache-status"];

          console.log(`[${country}] [${res.status}] cf=${cfCache || "N/A"} vercel=${vercelCache || "N/A"} - ${url}`);
          console.log(`[${country}] ➤ Edge: ${res.headers["cf-ray"] || "unknown"}`);

          if (["REVALIDATED", "MISS", "PRERENDERED"].includes(vercelCache)) {
            await purgeCloudflareCache(url);
          }

        } catch (err) {
          console.warn(`[${country}] ❌ Failed to warm ${url}`);
        }
      })
    );

    await sleep(delay);
  }, Promise.resolve());
}

// 🚀 Main function
(async () => {
  console.log(`[CacheWarmer] Started at ${new Date().toISOString()}`);

  await Promise.all(
    Object.entries(DOMAINS_MAP).map(async ([country, domain]) => {
      const sitemapList = await fetchIndexSitemaps(domain, country);

      const urlArrays = await Promise.all(sitemapList.map((sitemapUrl) => fetchUrlsFromSitemap(sitemapUrl, country)));

      const urls = urlArrays.flat();
      console.log(`[${country}] 🔗 Found ${urls.length} URLs`);

      await warmUrls(urls, country);
    })
  );

  console.log(`[CacheWarmer] Finished at ${new Date().toISOString()}`);
})();
