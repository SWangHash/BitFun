# bitfun-observability-otel

Concrete native OpenTelemetry runtime for BitFun. It owns receiver-scoped
installation identity, deployment-only endpoint and secret resolution, bounded
in-memory Trace/Log batching, Metric aggregation, generation fencing, retry,
health, flush, and shutdown.

Product and business code must depend on the portable `Telemetry` facade. Only
native application bootstrap and deployment configuration owners use this crate
directly. The crate never bridges ordinary `log`/`tracing` or product events.

When explicitly authorized Debug is active, content-bearing records use the
same `/v1/logs` endpoint and credential but a separate
`bitfun.observability.debug` instrumentation scope, fixed
`data_class=debug_sensitive`, and an independent bounded in-memory queue. The
channel has no disk retry cache and is revoked and discarded on downgrade. Its
business event names are the same fixed Turn, Inference, Tool, and Permission
names used by the safe channel; `record_type` and the separate scope identify
the sensitive schema.

Debug fixes Trace and successful safe-Log sampling at `1.0` so evaluation runs
have complete correlation. Deployment sampling settings continue to apply to
Basic and Diagnostic, but cannot reduce Debug sampling.
