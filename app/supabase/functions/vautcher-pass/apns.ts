// APNs push for Wallet pass updates.
//
// A pass update push carries an empty payload — it just tells the device
// "this pass changed, come fetch it". We authenticate to APNs with the
// SAME Pass Type ID certificate (mutual-TLS), so no separate APNs key is
// needed. Topic = the pass type identifier.

// Push an empty notification to every registered device token.
// Returns the set of tokens APNs reported as invalid (410 / BadDeviceToken)
// so the caller can prune them.
export async function pushPassUpdate(
  pushTokens: string[],
  certPem: string,
  keyPem: string,
  topic: string,
): Promise<string[]> {
  if (pushTokens.length === 0) return []

  // One mutual-TLS client, reused for every token.
  const client = Deno.createHttpClient({ cert: certPem, key: keyPem })
  const stale: string[] = []

  try {
    for (const token of pushTokens) {
      try {
        const res = await fetch(`https://api.push.apple.com/3/device/${token}`, {
          method: 'POST',
          client,
          headers: { 'apns-topic': topic },
          body: '{}',
        })
        // 200 = delivered. 410 = device no longer valid; 400 BadDeviceToken too.
        if (res.status === 410) {
          stale.push(token)
        } else if (res.status === 400) {
          const reason = (await res.json().catch(() => ({}))).reason
          if (reason === 'BadDeviceToken') stale.push(token)
        }
        await res.body?.cancel()
      } catch (e) {
        console.error('[apns] push failed for token', token, e)
      }
    }
  } finally {
    client.close()
  }

  return stale
}
