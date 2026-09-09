# OpenTelemetry Observability Service

Scope: this guide applies to `src/crates/services/observability-otel`.

`bitfun-observability-otel` is the concrete native service behind the portable
[`bitfun-observability`](../../execution/observability/AGENTS.md) contract. It
owns deployment configuration validation, pseudonymous installation identity,
secret resolution, OTel SDK mapping, bounded signal pipelines, OTLP HTTP,
retry, health, runtime reconfiguration, flush, and shutdown. Detailed behavior
and current data flow are documented in the
[`telemetry design`](../../../../docs/architecture/observability-telemetry-design.md)
and [`implementation guide`](../../../../docs/architecture/observability-implementation-guide.md).

## Ownership And Boundaries

- Only native application bootstrap and deployment-configuration owners use
  this crate directly. Product and business modules receive an injected
  `bitfun_observability::Telemetry`; they must not depend on this crate, OTel
  SDK types, endpoints, headers, credentials, exporters, or runtime health.
- Keep business domains, event names, attributes, privacy rules, sampling
  semantics, and trace relationships in `bitfun-observability`. This crate maps
  already validated records and must never loosen or duplicate the safe schema.
- Do not install a bridge for ordinary `log`/`tracing` output or product events.
  Debug records use their dedicated instrumentation scope and bounded in-memory
  queue; do not merge that path with safe Logs or add a disk retry cache.
- Preserve generation fencing during reconfiguration. A downgrade or disable
  must revoke admission before replacing pipelines; retired generations must
  not accept new data or leak records into the new configuration.
- Export, retry, flush, health, and shutdown failures must remain bounded and
  must not panic, block, or change the business result.

## Business Point Integration

Route changes by intent:

| Change | Owner |
|---|---|
| Add or use a business point | Business owner plus `bitfun-observability::domains`; follow its [instrumentation guide](../../execution/observability/AGENTS.md#business-instrumentation-guide) |
| Add a safe domain, field, outcome, or trace relation | `bitfun-observability`; this crate normally needs no change |
| Change validated-record to OTel mapping, batching, OTLP transport, retry, identity, secrets, or runtime lifecycle | This crate |
| Wire telemetry into a native product | App host creates the runtime and injects only the portable `Telemetry` facade |

For native host wiring, create one `TelemetryRuntimeHandle` per process with
`TelemetryRuntimeMetadata` and a `TelemetrySecretProvider`, resolve user and
deployment settings at the host boundary, call `apply_config`, and inject
`handle.telemetry()` into product assembly. Use the startup and shutdown guards,
route runtime setting changes back through `apply_config`, and expose only typed
health/capability facts where the host needs them. Business code must never
construct a runtime or read deployment secrets.

Adding a business point alone is therefore not a reason to edit this crate.
Exporter changes must be tested with already validated safe and Debug records,
including disable/downgrade, generation rotation, queue saturation, retryable
and terminal responses, partial acceptance, flush, and shutdown behavior.

## Verification

```bash
cargo test -p bitfun-observability-otel
pnpm run check:core-boundaries
```

Also run `cargo test -p bitfun-observability` when the portable record contract
or schema changes. For documentation-only changes, follow the documentation row
in [`verification.md`](../../../../docs/development/verification.md).
