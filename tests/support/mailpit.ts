const MAILPIT_API = `http://localhost:${process.env.MAILPIT_UI_PORT ?? "8025"}/api/v1`;

type MailpitSummary = { ID: string; Subject: string; To: { Address: string }[] };

export async function findMessages(to: string): Promise<MailpitSummary[]> {
  const query = encodeURIComponent(`to:"${to}"`);
  const response = await fetch(`${MAILPIT_API}/search?query=${query}`);
  if (!response.ok) throw new Error(`Mailpit search failed: ${response.status}`);
  return ((await response.json()) as { messages: MailpitSummary[] }).messages;
}

export async function waitForMessages(to: string, count = 1, timeoutMs = 5000): Promise<MailpitSummary[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await findMessages(to);
    if (messages.length >= count || Date.now() > deadline) return messages;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function readMessageText(id: string): Promise<string> {
  const response = await fetch(`${MAILPIT_API}/message/${id}`);
  if (!response.ok) throw new Error(`Mailpit read failed: ${response.status}`);
  return ((await response.json()) as { Text: string }).Text;
}

export async function deleteMessages(to: string): Promise<void> {
  const messages = await findMessages(to);
  if (messages.length === 0) return;
  await fetch(`${MAILPIT_API}/messages`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ IDs: messages.map(({ ID }) => ID) }),
  });
}
