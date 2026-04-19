/**
 * search.ts
 *
 * Brave Search API integration for the Solicited Advice agent.
 * Returns a concise plain-text summary of top results for Claude to reason over.
 */

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESULTS = 5;

interface BraveResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveResponse {
  web?: {
    results?: BraveResult[];
  };
}

/**
 * Search the web via Brave Search and return a formatted string of results.
 * Returns an error string (not thrown) so the agent can handle it gracefully.
 */
export async function searchWeb(query: string): Promise<string> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return "Web search is unavailable: BRAVE_SEARCH_API_KEY is not set.";
  }

  const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}&search_lang=en`;

  let data: BraveResponse;
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });
    if (!res.ok) {
      return `Web search failed: HTTP ${res.status} from Brave API.`;
    }
    data = (await res.json()) as BraveResponse;
  } catch (err) {
    return `Web search failed: ${String(err)}`;
  }

  const results = data.web?.results ?? [];
  if (results.length === 0) {
    return `No results found for: "${query}"`;
  }

  const lines = results.map((r, i) => {
    const desc = r.description ? `\n   ${r.description}` : "";
    return `${i + 1}. ${r.title} — ${r.url}${desc}`;
  });

  return `Search results for "${query}":\n\n${lines.join("\n\n")}`;
}
