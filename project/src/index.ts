/**
 * Finance Agent (发仔) — Architecture Description Module
 *
 * All descriptions are derived from the official Finance Agent Developer Wiki
 * located at project/finance_agent/.
 *
 * Each export is a pure function returning a structured description of one
 * architectural concern.  Functions are kept single-purpose (one concern each)
 * and return plain data so callers can render, log, or assert as needed.
 */

// ---------------------------------------------------------------------------
// 1. Multi-Channel Architecture
// ---------------------------------------------------------------------------

export interface Channel {
  name: string;
  protocol: string;
  description: string;
}

export interface MultiChannelArchitecture {
  channels: Channel[];
  unifiedBackend: string;
  note: string;
}

/**
 * Returns the multi-channel entry-point architecture.
 *
 * Finance Agent exposes two consumer channels that both funnel into the same
 * FastAPI backend, keeping domain logic in one place.
 */
export function getMultiChannelArchitecture(): MultiChannelArchitecture {
  return {
    channels: [
      {
        name: "Web UI",
        protocol: "HTTP / SSE",
        description:
          "React 18 SPA served at the internal domain. Users type natural-language questions; " +
          "the browser opens an EventSource connection to POST /api/v1/chat and renders " +
          "streaming tokens via the conversationStore (Zustand).",
      },
      {
        name: "Feishu Bot",
        protocol: "Feishu Webhook (HTTPS)",
        description:
          "A Feishu message-bot webhook registered under app/api/. Incoming Feishu events " +
          "are parsed and forwarded to the same AgentRunner used by the Web UI. " +
          "Replies are pushed back via the Feishu Bot API as rich-text messages.",
      },
    ],
    unifiedBackend:
      "Both channels converge on a single FastAPI application (app/). " +
      "The API layer normalises channel-specific payloads into a common " +
      "{ session_id, message, context } structure before handing off to AgentRunner.",
    note:
      "Adding a third channel (e.g. Slack, SMS) requires only a new webhook handler " +
      "in app/api/; the Agent Core, Tools, and Infrastructure layers are channel-agnostic.",
  };
}

// ---------------------------------------------------------------------------
// 2. Architecture Diagram
// ---------------------------------------------------------------------------

/**
 * Returns an ASCII diagram showing the full request path from user input to
 * streaming response, as documented in architecture.html.
 */
export function getArchitectureDiagram(): string {
  return `
┌─────────────────────────────────────────────────────────────────────────┐
│                          User Channels                                  │
│                                                                         │
│   ┌───────────────────────┐        ┌──────────────────────────────┐    │
│   │     Web UI (React)    │        │      Feishu Bot (Webhook)    │    │
│   │  Chat · Report Viewer │        │  @发仔 message → Feishu API  │    │
│   └──────────┬────────────┘        └─────────────┬────────────────┘    │
│              │ HTTP POST /api/v1/chat             │ HTTPS Webhook       │
└──────────────┼────────────────────────────────────┼────────────────────┘
               │                                    │
               ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           API Layer  (FastAPI)                          │
│                                                                         │
│   POST /chat   GET /conversations   POST /reports   POST /tool-call    │
│   DELETE /conversations/:id         GET /reports/:id                   │
│                                                                         │
│   • Auth via SSO Bearer token                                           │
│   • Rate limiting via Redis sliding-window counters                     │
│   • Normalises channel payload → { session_id, message, context }      │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Agent Runner  (runner.py)                        │
│                                                                         │
│   • Looks up / creates session in Redis (TTL 24 h)                     │
│   • Injects system prompt, conversation history, and request context    │
│   • Instantiates AgentLoop with TOOL_REGISTRY                          │
│   • Publishes partial tokens to Redis Stream → SSE response             │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Agent Loop  (loop.py)                            │
│                                                                         │
│   for step in range(max_steps):                                         │
│       response = await llm.complete(messages)   ◄── LLM call           │
│       if response.is_final: return response.content                     │
│       tool_results = await dispatch_tools(response.tool_calls)          │
│       messages = messages + [response] + tool_results  ← append        │
│   raise MaxStepsExceeded()                                              │
└──────────────┬───────────────────────────────────────┬──────────────────┘
               │ tool calls (29 tools)                 │ results
               ▼                                       ▼
┌──────────────────────────┐           ┌───────────────────────────────────┐
│       Tools (29)         │           │          Infrastructure            │
│                          │           │                                   │
│  Data Query:             │           │  Redis   – session store,         │
│   hive_query             │           │            tool-result cache,     │
│   cis_core_query         │           │            rate-limit counters,   │
│   aeolus_metrics         │           │            SSE token stream       │
│   feishu_sheet_read      │           │                                   │
│   sentry_query           │           │  TOS     – object storage for     │
│   tos_download           │           │            charts, CSVs, reports  │
│                          │           │                                   │
│  Data Processing:        │           │  ByteDoc – document rendering     │
│   dataframe_filter       │           │            & sharing              │
│   dataframe_aggregate    │           │                                   │
│   dataframe_pivot        │           │  TCC     – runtime feature flags  │
│   dataframe_join         │           │            (model, max_steps …)   │
│   dataframe_sort         │           │                                   │
│                          │           │  Sandbox – isolated Python exec   │
│  Code Execution:         │           │            (2 CPU, 512 MB, 30 s)  │
│   python_execute         │           │                                   │
│   python_install_package │           │  Aeolus  – metrics & monitoring   │
│                          │           │                                   │
│  Output:                 │           │  Feishu  – sheet read/write +     │
│   chart_generate         │           │            bot notifications      │
│   bytedoc_create         │           └───────────────────────────────────┘
│   bytedoc_append         │
│   feishu_sheet_write     │           ┌───────────────────────────────────┐
│   tos_upload             │           │        Data Sources               │
│                          │           │                                   │
│  Search / Utility:       │           │  Hive        2–60 s  (batch DW)  │
│   web_search             │           │  CIS-Core  200–800 ms (finance)   │
│   memory_store           │           │  Aeolus    100–500 ms (metrics)   │
│   date_parse             │           │  Sentry    300–1 s   (errors)     │
│   currency_convert       │           │  Feishu    200–600 ms (sheets)    │
│   number_format          │           └───────────────────────────────────┘
│   cis_core_entity_lookup │
│   sentry_issue_detail    │
│   feishu_sheet_list      │
│   aeolus_dashboard       │
└──────────────────────────┘
`.trim();
}

// ---------------------------------------------------------------------------
// 3. Layer Responsibilities
// ---------------------------------------------------------------------------

export interface LayerDescription {
  layer: string;
  files: string[];
  responsibilities: string[];
}

/**
 * Returns a per-layer breakdown of responsibilities as documented across
 * agent.html, api.html, and infrastructure.html.
 */
export function getLayerDescriptions(): LayerDescription[] {
  return [
    {
      layer: "API Routes",
      files: [
        "app/api/routes/messages.py",
        "app/api/routes/conversations.py",
        "app/api/routes/reports.py",
        "app/api/webhooks/feishu.py",
      ],
      responsibilities: [
        "Expose all HTTP endpoints under /api/v1 via FastAPI routers.",
        "Validate Authorization: Bearer <token> against the internal SSO service.",
        "Parse and normalise channel-specific payloads (Web UI JSON body, Feishu webhook event) into the shared { session_id, message, context } contract.",
        "Enforce per-user rate limits using Redis sliding-window counters (20 req/min on /chat, 60 req/min on /tool-call).",
        "Open an SSE connection for /chat: set Content-Type: text/event-stream, then yield data: events as tokens arrive from the Redis Stream written by AgentRunner.",
        "Return standard error envelopes (invalid_request, unauthorized, not_found, rate_limited, internal_error, agent_overloaded).",
      ],
    },
    {
      layer: "Agent Runner",
      files: ["app/agent/runner.py"],
      responsibilities: [
        "Entry point for a single user request.  Called by both the HTTP route and the Feishu webhook handler.",
        "Look up the existing session from Redis (key: session:{session_id}, TTL 24 h) or create a new one.",
        "Assemble the full message list via PromptBuilder: system prompt + conversation history + injected context.",
        "Instantiate AgentLoop with the global TOOL_REGISTRY and LLM client.",
        "Await the AgentLoop result, then persist the completed turn (user message + assistant answer) back to Redis.",
        "Publish streaming tokens to a per-request Redis Stream so the SSE route can forward them to the browser in real-time.",
      ],
    },
    {
      layer: "Agent Loop",
      files: ["app/agent/loop.py"],
      responsibilities: [
        "Drive the iterative reasoning cycle: LLM call → tool dispatch → append results → repeat.",
        "Terminate when the LLM produces a response with no tool calls (final answer), when max_steps is reached (default 20, tunable via TCC agent.max_steps), or when a tool raises an unrecoverable error.",
        "Delegate tool execution to ToolDispatcher: parse tool name + arguments from the LLM response, validate against JSON Schema, execute, wrap result in a tool_result message.",
        "Handle LLM-level errors with up to 3 retries and exponential backoff.",
        "Feed tool errors back to the LLM as tool_result messages so the model can self-correct rather than hard-failing.",
        "Keep each iteration stateless — all state is carried in the messages list, enabling horizontal scaling and clean retry logic.",
      ],
    },
    {
      layer: "Sandbox",
      files: ["app/sandbox/"],
      responsibilities: [
        "Provide isolated execution environments for the python_execute and python_install_package tools.",
        "Each invocation runs in a fresh container with constrained resources: 2 CPU cores, 512 MB RAM (configurable via TCC sandbox.memory_limit_mb), 30-second wall-clock timeout.",
        "Network access restricted to approved internal data-source APIs only; no public internet.",
        "Filesystem writes limited to /tmp; no shell command execution.",
        "Pre-installed packages: pandas, numpy, scipy, matplotlib, requests.",
        "Return stdout/stderr and any generated files (e.g., chart PNGs) to the caller; files are uploaded to TOS and returned as pre-signed URLs.",
      ],
    },
    {
      layer: "Infrastructure",
      files: ["app/infra/redis.py", "app/infra/tos.py", "app/infra/tcc.py", "app/infra/bytedoc.py"],
      responsibilities: [
        "Redis: Three usage patterns — (a) session store (conversation history, TTL 24 h), (b) tool-result cache (idempotent calls cached 5 min to reduce duplicate data-source queries), (c) rate-limit counters; also used as the transport layer for SSE token streaming via Redis Streams.",
        "TOS (Toutiao Object Storage): Store generated charts, exported CSVs, and report attachments in the finance-agent-outputs bucket.  Pre-signed URLs expire after 7 days.  Max file size 100 MB.",
        "TCC (Dynamic Configuration): Runtime feature flags and config values without redeploy — model identifier, max_steps, streaming toggle, query timeouts, sandbox memory limits.",
        "ByteDoc: Render Markdown + tables + embedded images into shareable internal documents via bytedoc_create / bytedoc_append tools.  Documents permanent; drafts expire 7 days.",
        "Aeolus: The agent publishes its own operational metrics (request latency, tool call counts, error rates) to Aeolus for observability.",
        "Feishu: App-token-based auth refreshed every 2 h; used for both sheet read/write data operations and outbound bot-notification messages.",
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// 4. Technology Selection Rationale
// ---------------------------------------------------------------------------

export interface TechDecision {
  technology: string;
  decision: string;
  rationale: string;
}

/**
 * Returns the rationale behind key technology choices as documented in
 * architecture.html (Key Design Decisions table) and infrastructure.html.
 */
export function getTechSelectionRationale(): TechDecision[] {
  return [
    {
      technology: "Redis Streams for SSE",
      decision:
        "AgentRunner writes partial tokens to a per-request Redis Stream; the API route reads from that stream and forwards each entry as an SSE data: event.",
      rationale:
        "FastAPI's async generator support makes SSE straightforward, but the agent loop runs as a background task that may span multiple async iterations.  " +
        "Redis Streams decouple the producer (AgentLoop publishing tokens) from the consumer (HTTP response generator), allowing horizontal scaling: " +
        "any API pod can serve the SSE connection while a different worker pod runs the agent.  " +
        "Streams also provide at-least-once delivery semantics and a natural audit trail of every token emitted.  " +
        "Alternative (WebSocket) was rejected because it adds bidirectional-channel complexity that the one-way streaming use-case does not require.",
    },
    {
      technology: "ByteDoc for report rendering",
      decision:
        "Agent creates reports by calling bytedoc_create / bytedoc_append rather than returning raw Markdown.",
      rationale:
        "ByteDoc is the internal document platform used company-wide at ByteDance.  " +
        "Reports stored in ByteDoc are accessible via a stable URL, support embedded tables and chart images, " +
        "and can be shared with stakeholders who have no access to the Finance Agent web UI.  " +
        "Using ByteDoc also means reports benefit from ByteDance's existing access-control, version-history, and commenting infrastructure at zero additional cost.",
    },
    {
      technology: "MongoDB (session / conversation history)",
      decision:
        "Conversation history is stored in Redis for hot sessions (TTL 24 h); longer-term or archived conversations can be persisted to MongoDB.",
      rationale:
        "Redis provides sub-millisecond reads for active sessions (O(1) GET by key), which is critical for prompt-assembly latency.  " +
        "MongoDB's flexible document model maps naturally to the heterogeneous message schema (user messages, assistant messages, tool_use blocks, tool_result blocks) " +
        "without requiring schema migrations as the message format evolves.  " +
        "Unlike a relational DB, there is no need to JOIN across tables to reconstruct a conversation — one document read returns the full history.",
    },
    {
      technology: "TOS (Toutiao Object Storage) for files",
      decision:
        "All binary outputs — chart PNGs, CSV exports, report attachments — are stored in TOS and surfaced via pre-signed URLs.",
      rationale:
        "The agent generates potentially large binary files (chart images, data exports) that should not be inlined in the SSE stream or the database.  " +
        "TOS is the ByteDance-internal object storage service with existing SDK support, IAM integration, and audit logging.  " +
        "Pre-signed URLs (7-day expiry) give the frontend direct browser-to-TOS download without proxying through the API layer, " +
        "reducing backend bandwidth by keeping large blobs out of the response path.",
    },
    {
      technology: "FastAPI + Python 3.11",
      decision:
        "HTTP server and agent orchestration both written in Python using FastAPI.",
      rationale:
        "Python is the de-facto language for ML/AI tooling; using it for the server eliminates the impedance mismatch of calling Python agent libraries from another language.  " +
        "FastAPI's native async support and first-class SSE/streaming response types map directly onto the token-streaming requirement.  " +
        "Python 3.11 brings meaningful performance improvements (10-60% faster) relevant to tight LLM-call loops.",
    },
    {
      technology: "TCC for dynamic configuration",
      decision:
        "Runtime parameters (LLM model name, max_steps, streaming toggle, timeouts) are read from TCC rather than hard-coded or from env vars.",
      rationale:
        "LLM model names change frequently as new versions are released.  " +
        "TCC allows the platform team to hot-swap the model or tune limits (e.g., reduce max_steps during a Hive outage) without a deployment, " +
        "reducing the blast radius of configuration changes and enabling gradual rollouts via TCC percentage flags.",
    },
    {
      technology: "Sandboxed Python execution",
      decision:
        "python_execute tool runs user-triggered code in an isolated container, not in the API process.",
      rationale:
        "The LLM generates arbitrary Python code that could attempt filesystem access, network egress, or resource exhaustion.  " +
        "Container isolation (CPU/memory caps, network allowlist, /tmp-only writes, 30-second timeout) prevents any single agent run from impacting the host or other users.  " +
        "The sandbox is disposable: a fresh container per invocation eliminates state leakage between sessions.",
    },
  ];
}

// ---------------------------------------------------------------------------
// 5. Data Flow: HTTP POST → SSE Streaming Response
// ---------------------------------------------------------------------------

export interface DataFlowStep {
  step: number;
  layer: string;
  description: string;
}

/**
 * Returns the ordered sequence of steps that transform a user's HTTP POST
 * into a token-by-token SSE streaming response, based on the code paths in
 * app/api/routes/messages.py, app/agent/runner.py, and app/agent/loop.py.
 */
export function getDataFlow(): DataFlowStep[] {
  return [
    {
      step: 1,
      layer: "Client → API Layer",
      description:
        "The browser (or Feishu Bot handler) sends HTTP POST /api/v1/chat with body " +
        '{ "session_id": "sess_abc123", "message": "Q3 revenue by region?", "context": { "date_range": "2024-Q3" } }. ' +
        "The Authorization: Bearer <token> header is validated against the internal SSO service.",
    },
    {
      step: 2,
      layer: "API Layer — Route Handler (messages.py)",
      description:
        "The FastAPI route handler validates the request body, checks the rate-limit counter in Redis " +
        "(INCR ratelimit:{user_id}:{window}, reject if > 20), then immediately returns HTTP 200 with " +
        "Content-Type: text/event-stream and begins yielding SSE events.  " +
        "A background task is launched to run AgentRunner; the route generator blocks on a Redis Stream consumer waiting for token events.",
    },
    {
      step: 3,
      layer: "Agent Runner (runner.py)",
      description:
        "AgentRunner fetches the session from Redis (GET session:sess_abc123) to retrieve conversation history.  " +
        "If the key does not exist a new empty session is initialised.  " +
        "PromptBuilder assembles the message list: system prompt (role + tool catalog + behavioural guidelines) + " +
        "prior turns from history + the new user message + any injected context (date_range, entity).  " +
        "A new Redis Stream key (stream:req:{request_id}) is created to act as the token channel.",
    },
    {
      step: 4,
      layer: "Agent Loop — LLM Call (loop.py)",
      description:
        "AgentLoop calls the LLM (model resolved from TCC agent.model) with the assembled message list.  " +
        "The LLM response is streamed; each token is written to the Redis Stream " +
        "(XADD stream:req:{request_id} * type token content <tok>).  " +
        "The SSE route's generator reads from the stream via XREAD BLOCK and immediately yields " +
        'data: {"type": "token", "content": "<tok>"}\\n\\n to the browser.',
    },
    {
      step: 5,
      layer: "Agent Loop — Tool Dispatch (loop.py)",
      description:
        "If the LLM response contains tool_use blocks (e.g., hive_query), the loop pauses streaming " +
        "and passes each call to ToolDispatcher: validate JSON Schema, execute the tool handler, " +
        "receive the result.  " +
        "Tool progress events (tool_start, tool_result) are also written to the Redis Stream so the " +
        "frontend can render inline ToolCallCards.  " +
        "The tool result is appended to the messages list as a tool_result message, and the loop iterates.",
    },
    {
      step: 6,
      layer: "Agent Loop — Final Answer (loop.py)",
      description:
        "When the LLM returns a response with no tool_use blocks, AgentLoop treats it as the final answer.  " +
        "All remaining tokens are flushed to the Redis Stream, then a sentinel event is written: " +
        'XADD stream:req:{request_id} * type done session_id sess_abc123.',
    },
    {
      step: 7,
      layer: "Agent Runner — Session Persistence (runner.py)",
      description:
        "After the loop returns, AgentRunner appends the completed turn (user message + full assistant answer) " +
        "to the Redis session key (RPUSH / JSON-patch) and resets its TTL to 24 h.  " +
        "The stream key is set to expire in 60 s (no longer needed after the SSE connection closes).",
    },
    {
      step: 8,
      layer: "API Layer → Client",
      description:
        'The SSE generator reads the done sentinel from the Redis Stream and emits data: {"type": "done", "session_id": "sess_abc123"}\\n\\n, ' +
        "then closes the response.  " +
        "The browser EventSource receives the done event, finalises the message in the Zustand conversationStore, " +
        "and closes the EventSource connection.  " +
        "The complete answer is now visible in the chat UI.",
    },
  ];
}

// ---------------------------------------------------------------------------
// 6. Full Architecture Summary (convenience aggregate)
// ---------------------------------------------------------------------------

export interface ArchitectureSummary {
  multiChannel: MultiChannelArchitecture;
  diagram: string;
  layers: LayerDescription[];
  techDecisions: TechDecision[];
  dataFlow: DataFlowStep[];
}

/**
 * Returns the complete Finance Agent architecture summary in a single call.
 * Aggregates all individual section getters — useful for rendering a full
 * architecture document or running snapshot tests.
 */
export function getArchitectureSummary(): ArchitectureSummary {
  return {
    multiChannel: getMultiChannelArchitecture(),
    diagram: getArchitectureDiagram(),
    layers: getLayerDescriptions(),
    techDecisions: getTechSelectionRationale(),
    dataFlow: getDataFlow(),
  };
}
