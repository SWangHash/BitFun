use async_trait::async_trait;
use bitfun_observability::domains::{
    start_turn, AgentModeClass, CompletionFacts, FinishReasonClass, TurnFinishFacts,
    TurnStartFacts, TurnTrigger,
};
use bitfun_observability::{TelemetryEntrypoint, TelemetryLevel, TelemetryUserConfig};
use bitfun_observability_otel::{
    NoTelemetrySecrets, OtlpCompression, TelemetryAuthorization, TelemetryDeploymentConfig,
    TelemetryEndpointLayout, TelemetryRequestAuthorizer, TelemetryRuntimeError,
    TelemetryRuntimeHandle, TelemetryRuntimeMetadata,
};
use std::sync::Arc;

struct StaticAuthorizer {
    token: String,
}

#[async_trait]
impl TelemetryRequestAuthorizer for StaticAuthorizer {
    async fn authorization(
        &self,
        _force_refresh: bool,
    ) -> Result<Option<TelemetryAuthorization>, TelemetryRuntimeError> {
        TelemetryAuthorization::bearer(self.token.clone()).map(Some)
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let endpoint = std::env::var("BITFUN_TELEMETRY_SMOKE_ENDPOINT")?;
    let token = std::env::var("BITFUN_TELEMETRY_SMOKE_TOKEN")?;
    let data_dir =
        std::env::temp_dir().join(format!("bitfun-telemetry-smoke-{}", uuid::Uuid::new_v4()));
    let runtime = TelemetryRuntimeHandle::new_with_authorizer(
        TelemetryRuntimeMetadata::new(TelemetryEntrypoint::Desktop, &data_dir),
        Arc::new(NoTelemetrySecrets),
        Arc::new(StaticAuthorizer { token }),
    );
    let deployment = TelemetryDeploymentConfig {
        endpoint: Some(endpoint),
        endpoint_layout: TelemetryEndpointLayout::BitFunIngressV1,
        compression: OtlpCompression::None,
        credential_namespace: "ingress-smoke".to_string(),
        allow_insecure_loopback: true,
        ..TelemetryDeploymentConfig::default()
    };
    runtime.apply_config(
        &TelemetryUserConfig::with_sensitive_content_consent(TelemetryLevel::Debug, true),
        &deployment,
    )?;

    start_turn(
        &runtime.telemetry(),
        TurnStartFacts {
            mode_class: AgentModeClass::Agentic,
            trigger: TurnTrigger::User,
            remote: false,
            subagent: false,
        },
        None,
    )
    .finish(TurnFinishFacts {
        completion: CompletionFacts::completed(),
        finish_reason: Some(FinishReasonClass::Completed),
        round_count: Some(1),
        tool_count: Some(0),
        first_result_ms: Some(1),
        modified_file_count: Some(0),
        added_lines: Some(0),
        deleted_lines: Some(0),
    });

    let _ = runtime.force_flush();
    let health = runtime.health();
    println!(
        "acknowledged={} rejected={} dropped={}",
        health.acknowledged, health.server_rejected, health.locally_dropped
    );
    let _ = runtime.shutdown();
    let _ = std::fs::remove_dir_all(data_dir);
    Ok(())
}
