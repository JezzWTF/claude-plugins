import type { EngineInterface, Register } from 'claude-code'

const MINUTE = 60_000
const PING_AFTER_MS = 55 * MINUTE // the cache lasts 60 min
const MAX_IDLE_PINGS = 5
const PING_TEXT = 'Keep-warm ping. Reply with just "ok"; do not use tools.'

const CACHE_TTL_MS = 60 * MINUTE
const MIN_TOKENS = 50_000 // below this a cold rewrite costs too little to be worth a ping

// The real time of the last reply, read from the session transcript's tail, so a
// resumed or reloaded session does not think the cache is fresher than it is.
async function lastReplyAt($: EngineInterface): Promise<number | null> {
  try {
    const home = await $.env.get('USERPROFILE')
    const id = await $.session.id()
    const cwd = await $.session.cwd()
    if (!home) return null
    const project = cwd.replace(/[^A-Za-z0-9]/g, '-')
    const file = [home, '.claude', 'projects', project, `${id}.jsonl`].join('\\')
    const run = await $.process.run([
      'powershell', '-NoProfile', '-Command', `Get-Content -Tail 300 -LiteralPath '${file}'`,
    ])
    for (const line of run.stdout.split(/\r?\n/).reverse()) {
      if (!line.includes('"type":"assistant"')) continue
      const at = Date.parse((JSON.parse(line) as { timestamp?: string }).timestamp ?? '')
      if (!Number.isNaN(at)) return at
    }
  } catch {
    return null
  }

  return null
}

async function contextTokens($: EngineInterface): Promise<number | undefined> {
  try {
    return (await $.session.usage()).context.tokens
  } catch {
    return undefined
  }
}

const isSmall = (tokens: number | undefined) => tokens !== undefined && tokens < MIN_TOKENS

// What the status line says: time left on the cache, or why nothing will be pinged.
const label = (enabled: boolean, idleMs: number, pings: number, tokens: number | undefined) => {
  if (!enabled) return undefined
  if (isSmall(tokens)) return 'keep-warm · small chat'
  if (idleMs >= CACHE_TTL_MS) return 'keep-warm · cold'
  const left = Math.ceil((CACHE_TTL_MS - idleMs) / MINUTE)
  const used = pings > 0 ? ` · ${pings}/${MAX_IDLE_PINGS}` : ''

  return `keep-warm · warm ${left}m${used}`
}

export const register: Register = on => {
  let enabled = false
  let lastActivity = Date.now()
  let pings = 0
  let pingInFlight = false
  let tokens: number | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'keep-warm',
      description: 'Toggle keeping the 1-hour prompt cache warm while idle',
    })
    lastActivity = (await lastReplyAt($)) ?? lastActivity
    enabled = (await $.store.get('enabled')) === true
    tokens = await contextTokens($)
    void $.ui.status(label(enabled, Date.now() - lastActivity, pings, tokens))

    // One steady timer: it keeps the countdown fresh and sends a ping once the session has idled long enough.
    $.clock.every(MINUTE, async () => {
      const idle = Date.now() - lastActivity
      tokens = await contextTokens($)
      void $.ui.status(label(enabled, idle, pings, tokens))
      if (!enabled || pingInFlight || isSmall(tokens)) return
      if (idle < PING_AFTER_MS || idle >= CACHE_TTL_MS) return
      if (pings >= MAX_IDLE_PINGS) {
        enabled = false
        void $.ui.status(undefined)
        void $.ui.toast(`keep-warm off: ${MAX_IDLE_PINGS} idle pings sent`)
        return
      }
      pingInFlight = true
      void $.prompt.submit({ text: PING_TEXT })
    })

    return next(e)
  })

  // A sent prompt starts a request, which refreshes the cache.
  on('prompt.submit', async ($, e, next) => {
    lastActivity = Date.now()
    void $.ui.status(label(enabled, 0, pings, tokens))

    return next(e)
  })

  // Any finished main-loop turn refreshes the cache; a ping's turn counts as idle.
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId) return ran

    lastActivity = Date.now()
    const wasPing = pingInFlight
    pings = wasPing ? pings + 1 : 0
    pingInFlight = false
    tokens = await contextTokens($)
    void $.ui.status(label(enabled, 0, pings, tokens))
    if (wasPing) void $.ui.toast(`keep-warm: cache refreshed (${pings}/${MAX_IDLE_PINGS})`)

    return ran
  })

  on('command.run', { command: 'keep-warm' }, async $ => {
    enabled = !enabled
    lastActivity = (await lastReplyAt($)) ?? Date.now()
    pings = 0
    tokens = await contextTokens($)
    await $.store.set('enabled', enabled)
    const text = label(enabled, Date.now() - lastActivity, pings, tokens)
    void $.ui.status(text)

    return { text: text ?? 'keep-warm off' }
  })
}
