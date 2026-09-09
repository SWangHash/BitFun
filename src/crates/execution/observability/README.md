# bitfun-observability

Portable, OpenTelemetry-SDK-independent contracts for BitFun telemetry.

The crate exposes typed Startup, Session, Turn, Round, Inference, Tool,
Permission, and Compression facts. The safe Trace/Metric/Log channel cannot
accept arbitrary attribute names, log bodies, JSON, errors, paths, prompts,
tool inputs, or tool outputs. Every safe record passes the static schema and
privacy gate before reaching `TelemetrySink`.

`TelemetryLevel::Debug` adds a separate, explicitly authorized sensitive Log
channel. It accepts only the closed `DebugTelemetryRecord` variants constructed
by authoritative owners. Each content field carries its redacted value,
original byte size, and truncation flag; fields share a deterministic content
budget and the serialized record has a final 256 KiB bound. The channel leaves
`ValidatedRecord`, `AttributeValue`, and the safe schema unchanged. There is no
generic event-name/body constructor.

Debug is intended to produce complete evaluation trajectories: safe Traces,
safe successful Logs, and sensitive Debug records are all sampled at `1.0`.
Basic and Diagnostic retain their configured sampling behavior, and Metrics
remain aggregated.

Trace ownership stays at the real asynchronous operation boundary. Agent event
projection is deliberately limited to Metric and structured Log records from
authoritative terminal events; it must not reconstruct a Trace state machine.
