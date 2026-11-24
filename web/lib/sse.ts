// Server-sent events, read from a fetch response body. `parseSse` takes everything that has arrived so far and
// returns the complete events plus the unfinished tail, which the caller puts in front of the next chunk.

export type SseEvent = { event: string; data: unknown };

export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const blocks = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue; // a blank line or a keep-alive comment
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length === 0) continue;
    try {
      events.push({ event, data: JSON.parse(data.join("\n")) });
    } catch {
      // an event whose data is not JSON is not one of ours: skip it
    }
  }
  return { events, rest };
}
