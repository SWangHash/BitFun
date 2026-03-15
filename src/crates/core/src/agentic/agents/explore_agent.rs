use super::Agent;
use async_trait::async_trait;
pub struct ExploreAgent {
    default_tools: Vec<String>,
}

impl ExploreAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "LS".to_string(),
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for ExploreAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "Explore"
    }

    fn name(&self) -> &str {
        "Explore"
    }

    fn description(&self) -> &str {
        r#"Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. \"src/components/**/*.tsx\"), search code for keywords (eg. \"API endpoints\"), or answer questions about the codebase (eg. \"how do API endpoints work?\"). When calling this agent, specify the desired thoroughness level: \"quick\" for basic searches, \"medium\" for moderate exploration, or \"very thorough\" for comprehensive analysis across multiple locations and naming conventions."#
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "explore_agent"
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn is_readonly(&self) -> bool {
        true
    }
}
