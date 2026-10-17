// Public read-only example. Grant SELECT only on the intended public records.
const json = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store", ...headers },
});

export async function handleNotes({ request, supabase }) {
  // Query parameters avoid depending on the physical Function pathname.
  const params = new URL(request.url).searchParams;
  if (params.get("action") !== "list") return json({ error: "not_found" }, 404);
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
  const rawOffset = params.get("offset") ?? "0";
  if (!/^(0|[1-9][0-9]{0,5})$/.test(rawOffset)) return json({ error: "invalid_offset" }, 400);
  const offset = Number(rawOffset);
  const pageSize = 20;
  try {
    // Fetch one extra row; range endpoints are inclusive.
    const { data, error } = await supabase.from("notes")
      .select("id,title,created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + pageSize);
    if (error || !Array.isArray(data)) return json({ error: "database_request_failed" }, 503);
    const hasMore = data.length > pageSize;
    return json({ items: data.slice(0, pageSize), hasMore, nextOffset: hasMore ? offset + pageSize : null });
  } catch {
    return json({ error: "database_request_failed" }, 503);
  }
}
