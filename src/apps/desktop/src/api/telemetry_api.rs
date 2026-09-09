//! Desktop telemetry lifecycle controlled by the privacy consent state.

use bitfun_observability::{TelemetryLevel, TelemetryUserConfig};
use bitfun_observability_otel::{TelemetryDeploymentConfig, TelemetryRuntimeHandle};

const CONSENTED_TELEMETRY_LEVEL: TelemetryLevel = TelemetryLevel::Diagnostic;

pub struct OhosTelemetryController {
    runtime: TelemetryRuntimeHandle,
    deployment: TelemetryDeploymentConfig,
}

impl OhosTelemetryController {
    pub fn new(runtime: TelemetryRuntimeHandle, deployment: TelemetryDeploymentConfig) -> Self {
        Self {
            runtime,
            deployment,
        }
    }

    pub fn reconcile(&self, collection_allowed: bool) -> Result<(), String> {
        let config = telemetry_config_for_privacy(collection_allowed);
        if config.effective_level() == TelemetryLevel::Off {
            self.disable();
            return Ok(());
        }
        if self.deployment.endpoint.is_none() {
            self.disable();
            return Ok(());
        }
        if let Err(error) = self.runtime.apply_config(&config, &self.deployment) {
            self.disable();
            return Err(error.to_string());
        }
        Ok(())
    }

    pub fn disable(&self) {
        let _ = self.runtime.apply_config(
            &TelemetryUserConfig::new(TelemetryLevel::Off),
            &self.deployment,
        );
        self.runtime.cancel_and_discard();
    }
}

fn telemetry_config_for_privacy(collection_allowed: bool) -> TelemetryUserConfig {
    TelemetryUserConfig::new(if collection_allowed {
        CONSENTED_TELEMETRY_LEVEL
    } else {
        TelemetryLevel::Off
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn telemetry_is_off_without_privacy_consent() {
        let config = telemetry_config_for_privacy(false);

        assert_eq!(config.effective_level(), TelemetryLevel::Off);
        assert!(!config.sensitive_content_consent());
    }

    #[test]
    fn privacy_consent_enables_diagnostic_only() {
        let config = telemetry_config_for_privacy(true);

        assert_eq!(config.effective_level(), TelemetryLevel::Diagnostic);
        assert_ne!(config.effective_level(), TelemetryLevel::Basic);
        assert_ne!(config.effective_level(), TelemetryLevel::Debug);
        assert!(!config.sensitive_content_consent());
    }
}
