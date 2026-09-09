# OHOS PC Telemetry Ingress Integration

This document records the OHOS-specific host adapter for the portable BitFun
observability runtime. The signal schema and business-owner rules remain in
`observability-telemetry-design.md`; the public ingress contract is frozen in
`docs/telemetry-api/telemetry-api.md`.

## Data flow

```text
Agent owner -> bitfun-observability -> bitfun-observability-otel
            -> AnonymousAuthService (otel:write)
            -> /otlp/v1/{traces,metrics,logs}
```

- `AnonymousAuthService` is shared with Feedback. It owns enroll, refresh,
  scope validation, in-memory access tokens, and refresh serialization.
- HarmonyOS Asset Store persists the existing credential payload under the
  existing alias. Feedback capability tokens remain separate and cannot be
  used as telemetry credentials.
- `OhosTelemetryController` takes its enablement only from the privacy
  collection policy. Before consent it applies `off`; after consent it applies
  `diagnostic`, with Trace and successful Log sampling both set to `1.0` by the
  product default. The product exposes no separate telemetry setting and never
  selects `basic` or `debug`. Revocation closes admission and discards pending
  data immediately.
- Every OTLP batch has a UUID `X-Request-ID` and `Idempotency-Key`. Retries of
  the same body reuse both values; 401 performs one forced token refresh; 413
  recursively splits standard OTLP protobuf batches.
- The OHOS host selects the same fixed ingress environment as Feedback: Debug
  uses `http://api-test.infra-bitfun.com`, while Release uses
  `https://api.infra-bitfun.com`. Release does not require
  `BITFUN_TELEMETRY_OTLP_ENDPOINT`; other hosts retain their existing Collector
  configuration paths.
- The current test ingress rejects payloads after gateway gzip processing, so
  the OHOS ingress profile sends uncompressed protobuf. Gzip remains available
  for standard Collector deployments and can be re-enabled after the cloud
  path passes the same smoke test.

## Verification evidence

On 2026-08-25, a synthetic content-free Turn was sent through the test ingress.
Trace, Log, and Metric requests all returned HTTP 200; client diagnostics
reported `acknowledged=4`, `rejected=0`, and `dropped=0`.
