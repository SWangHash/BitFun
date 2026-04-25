# Phase 2: Dynamic Subagent Concurrency Plan

## Overview

This document describes the implementation plan for dynamically adjusting subagent concurrency based on local system resources and LLM API health. The design follows an **on-demand + event-driven** approach with **no background polling tasks** to avoid `sysinfo` overhead.

## Design Principles

1. **No background timers**: No `tokio::time::interval`, no spawned infinite loops
2. **sysinfo called only at decision points**: DeepReview startup, queue overload, failure recovery
3. **LLM API health is purely event-driven**: 429/503 responses trigger adjustments directly without sysinfo
4. **Cooldown prevents oscillation**: 30-second cooldown between adjustments
5. **Soft limits without killing tasks**: `target_concurrency` waits for natural permit release

## Architecture

```
Trigger Points (on-demand calls)
================================

1. Before DeepReview Phase 2 launch:
   -> Call sysinfo once to decide if local load allows multi-instance splitting

2. When subagent queue depth >= 3:
   -> Call sysinfo once to decide if temporary scale-down is needed

3. After subagent timeout/cancel/failure:
   -> Call sysinfo once to decide if resource exhaustion caused the failure

4. On LLM API 429/503 response:
   -> Scale down immediately, no sysinfo needed

         |
         v
+-----------------------------+
|  ResourceProbe (stateless)  |
|                             |
|  - No timers, no background |
|  - Single-shot sampling     |
|  - Cache result for 5s max  |
+-----------------------------+
         |
         v
+-----------------------------+
| ConcurrencyAdjustment       |
| Decision                    |
|                             |
|  - One-shot decision based  |
|    on snapshot + history    |
|  - Writes to limiter        |
|    target_permits           |
+-----------------------------+
```

## Trigger Point Details

### Trigger 1: DeepReview Startup (File Split Decision)

**Location**: DeepReview orchestrator before Phase 2 reviewer dispatch

**Logic**:
- Call `ResourceProbe::snapshot()` once
- Pass result to `DeepReviewExecutionPolicy::effective_instance_count()`
- This method caps `same_role_instance_count` based on current CPU/memory

**Code** (in `deep_review_policy.rs`):

```rust
impl DeepReviewExecutionPolicy {
    /// Decide actual instance count considering local resources.
    /// Called once per DeepReview turn.
    pub fn effective_instance_count(
        &self,
        file_count: usize,
        resource_snapshot: Option<&ResourceSnapshot>,
    ) -> usize {
        let base_count = self.same_role_instance_count(file_count);
        if base_count <= 1 {
            return 1;
        }

        let Some(snapshot) = resource_snapshot else {
            return base_count;
        };

        // CPU > 80% or memory < 1GB -> cap at 2 instances
        if snapshot.cpu_utilization_percent > 80.0
            || snapshot.available_memory_mb < 1024
        {
            return base_count.min(2);
        }

        // CPU > 60% or memory < 2GB -> reduce by 1
        if snapshot.cpu_utilization_percent > 60.0
            || snapshot.available_memory_mb < 2048
        {
            return base_count.saturating_sub(1).max(1);
        }

        base_count
    }
}
```

**Frequency**: Once per DeepReview turn (typically 1-5 times per user session)

---

### Trigger 2: Subagent Queue Overload

**Location**: `coordinator.rs` — `acquire_subagent_concurrency_permit()`

**Logic**:
- Fast path: if semaphore has available permits, acquire directly (zero overhead)
- Slow path: if queue depth >= 3, sample resources once and possibly request scale-down

**Code**:

```rust
async fn acquire_subagent_concurrency_permit(...) {
    let limiter = self.get_subagent_concurrency_limiter().await;
    
    // Fast path: permit available, no sampling
    if limiter.semaphore.available_permits() > 0 {
        return acquire_directly(...).await;
    }
    
    // Slow path: need to wait
    let queue_depth = limiter.waiting_count.load(Ordering::Relaxed);
    if queue_depth >= 3 {
        let snapshot = ResourceProbe::snapshot();
        if snapshot.cpu_utilization_percent > 75.0 {
            limiter.request_scale_down(1);
        }
    }
    
    // Continue normal wait...
}
```

**Frequency**: Only when concurrency is saturated and queue builds up (rare in normal operation)

---

### Trigger 3: Subagent Failure Recovery

**Location**: `coordinator.rs` — after `execute_subagent()` completes

**Logic**:
- On timeout or cancellation, sample resources to detect resource exhaustion
- Record stress events; after 3 consecutive stress events, auto scale-down

**Code**:

```rust
match &result {
    Err(BitFunError::Timeout(_)) | Err(BitFunError::Cancelled(_)) => {
        let snapshot = ResourceProbe::snapshot();
        if snapshot.cpu_utilization_percent > 70.0
            || snapshot.available_memory_mb < 512
        {
            limiter.record_stress_event();
        }
    }
    _ => {}
}

if limiter.stress_event_count() >= 3 {
    limiter.request_scale_down(1);
    limiter.clear_stress_events();
}
```

**Frequency**: Only on failure (typically rare)

---

### Trigger 4: LLM API Rate Limit (Event-Driven, No sysinfo)

**Location**: HTTP response handling in AI adapter layer

**Logic**:
- On 429 (rate limit) or 503/504 (service unavailable), immediately notify concurrency limiter
- No sysinfo call; this is purely an API-side signal

**Code**:

```rust
match response.status().as_u16() {
    429 => {
        get_global_coordinator()
            .get_subagent_concurrency_limiter()
            .request_scale_down(2);
    }
    503 | 504 => {
        get_global_coordinator()
            .get_subagent_concurrency_limiter()
            .request_scale_down(1);
    }
    _ => {}
}
```

**Frequency**: Only when API actually returns error status

---

## ResourceProbe Implementation

**File**: `src/crates/core/src/agentic/coordination/resource_probe.rs`

```rust
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Cached snapshot with TTL to avoid repeated sysinfo calls within short windows.
static LAST_SNAPSHOT: std::sync::Mutex<Option<(ResourceSnapshot, u64)>> =
    std::sync::Mutex::new(None);

const CACHE_TTL_MS: u64 = 5000; // 5 seconds

/// Stateless resource probe. No background tasks, no timers.
pub struct ResourceProbe;

impl ResourceProbe {
    /// Single-shot system resource snapshot.
    /// Returns cached result if called again within 5 seconds.
    pub fn snapshot() -> ResourceSnapshot {
        let now = current_epoch_millis();
        
        // Check cache first
        if let Ok(guard) = LAST_SNAPSHOT.lock() {
            if let Some((snapshot, cached_at)) = guard.as_ref() {
                if now.saturating_sub(*cached_at) < CACHE_TTL_MS {
                    return snapshot.clone();
                }
            }
        }
        
        // Perform fresh sample
        let snapshot = Self::sample();
        
        // Update cache
        if let Ok(mut guard) = LAST_SNAPSHOT.lock() {
            *guard = Some((snapshot.clone(), now));
        }
        
        snapshot
    }
    
    fn sample() -> ResourceSnapshot {
        use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
        
        let mut system = System::new_with_specifics(
            RefreshKind::new()
                .with_cpu(CpuRefreshKind::new().with_cpu_usage())
                .with_memory(MemoryRefreshKind::new()),
        );
        system.refresh_cpu_specifics(CpuRefreshKind::new().with_cpu_usage());
        
        ResourceSnapshot {
            cpu_utilization_percent: system.global_cpu_usage(),
            available_memory_mb: system.available_memory() / 1024 / 1024,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResourceSnapshot {
    pub cpu_utilization_percent: f32,
    pub available_memory_mb: u64,
}

fn current_epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
```

**Key constraints**:
- `System::new_with_specifics` initializes only necessary data structures
- No background refresh threads
- No process list traversal
- Single call typically < 5ms
- 5-second cache prevents burst calls from repeated sampling

---

## SubagentConcurrencyLimiter Extensions

**File**: `src/crates/core/src/agentic/coordination/coordinator.rs`

Add to existing `SubagentConcurrencyLimiter`:

```rust
pub struct SubagentConcurrencyLimiter {
    pub semaphore: Arc<Semaphore>,
    pub max_concurrency: usize,
    
    // NEW: Target concurrency (may be lower than max_concurrency)
    target_concurrency: AtomicUsize,
    
    // NEW: Stress event counter for adaptive recovery
    stress_events: AtomicUsize,
    
    // NEW: Last adjustment timestamp (epoch millis)
    last_adjustment: AtomicU64,
    
    // NEW: Waiting task count for queue depth detection
    waiting_count: AtomicUsize,
}

const ADJUSTMENT_COOLDOWN_MS: u64 = 30_000; // 30 seconds

impl SubagentConcurrencyLimiter {
    pub fn new(max_concurrency: usize) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(max_concurrency)),
            max_concurrency,
            target_concurrency: AtomicUsize::new(max_concurrency),
            stress_events: AtomicUsize::new(0),
            last_adjustment: AtomicU64::new(0),
            waiting_count: AtomicUsize::new(0),
        }
    }
    
    /// Request scale-down by `delta` permits. Respects cooldown.
    pub fn request_scale_down(&self, delta: usize) {
        let now = current_epoch_millis();
        let last = self.last_adjustment.load(Ordering::Relaxed);
        
        if now.saturating_sub(last) < ADJUSTMENT_COOLDOWN_MS {
            return;
        }
        
        let current_target = self.target_concurrency.load(Ordering::Relaxed);
        let new_target = current_target.saturating_sub(delta).max(1);
        
        self.target_concurrency.store(new_target, Ordering::Relaxed);
        self.last_adjustment.store(now, Ordering::Relaxed);
        
        info!(
            "Subagent concurrency scaled down: target {} -> {} (max: {})",
            current_target, new_target, self.max_concurrency
        );
    }
    
    /// Request scale-up by `delta` permits, capped at max_concurrency.
    pub fn request_scale_up(&self, delta: usize) {
        let now = current_epoch_millis();
        let last = self.last_adjustment.load(Ordering::Relaxed);
        
        if now.saturating_sub(last) < ADJUSTMENT_COOLDOWN_MS {
            return;
        }
        
        let current_target = self.target_concurrency.load(Ordering::Relaxed);
        let new_target = (current_target + delta).min(self.max_concurrency);
        
        if new_target == current_target {
            return;
        }
        
        // Add permits to semaphore for scale-up
        let permits_to_add = new_target - current_target;
        self.semaphore.add_permits(permits_to_add);
        self.target_concurrency.store(new_target, Ordering::Relaxed);
        self.last_adjustment.store(now, Ordering::Relaxed);
        
        info!(
            "Subagent concurrency scaled up: target {} -> {} (max: {})",
            current_target, new_target, self.max_concurrency
        );
    }
    
    pub fn record_stress_event(&self) {
        self.stress_events.fetch_add(1, Ordering::Relaxed);
    }
    
    pub fn stress_event_count(&self) -> usize {
        self.stress_events.load(Ordering::Relaxed)
    }
    
    pub fn clear_stress_events(&self) {
        self.stress_events.store(0, Ordering::Relaxed);
    }
    
    pub fn current_target(&self) -> usize {
        self.target_concurrency.load(Ordering::Relaxed)
    }
    
    /// Increment waiting count before queueing
    pub fn inc_waiting(&self) {
        self.waiting_count.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Decrement waiting count after acquiring or cancelling
    pub fn dec_waiting(&self) {
        self.waiting_count.fetch_sub(1, Ordering::Relaxed);
    }
}
```

**Soft limit mechanism**:
- Scale-down does NOT forcibly cancel running subagents
- `target_concurrency` is checked when releasing permits:
  - If `available_permits + 1 > target_concurrency`, the permit is NOT returned to semaphore
  - This naturally reduces active concurrency as subagents complete
- Scale-up uses `Semaphore::add_permits()` to immediately increase capacity

---

## Configuration

**File**: `src/crates/core/src/service/config/types.rs`

```rust
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "mode", content = "value")]
pub enum SubagentConcurrencyConfig {
    /// Static fixed concurrency (current behavior)
    Static(usize),
    /// Dynamic mode with optional min/max bounds
    Auto {
        #[serde(default = "default_auto_min")]
        min: usize,
        #[serde(default = "default_auto_max")]
        max: usize,
    },
}

fn default_auto_min() -> usize { 1 }
fn default_auto_max() -> usize { 8 }

impl Default for SubagentConcurrencyConfig {
    fn default() -> Self {
        SubagentConcurrencyConfig::Static(5)
    }
}
```

**Config example**:

```json
{
  "ai": {
    "subagent_max_concurrency": {
      "mode": "auto",
      "value": {
        "min": 2,
        "max": 10
      }
    }
  }
}
```

Or for backward compatibility:

```json
{
  "ai": {
    "subagent_max_concurrency": 5
  }
}
```

---

## File Change List

| File | Change |
|------|--------|
| `src/crates/core/src/agentic/coordination/resource_probe.rs` | **NEW** Stateless ResourceProbe with 5s cache |
| `src/crates/core/src/agentic/coordination/dynamic_concurrency.rs` | **NEW** ConcurrencyAdjustmentDecision types |
| `src/crates/core/src/agentic/coordination/coordinator.rs` | Extend SubagentConcurrencyLimiter with target/stress fields; add trigger points in acquire/execute |
| `src/crates/core/src/agentic/coordination/mod.rs` | Register new modules |
| `src/crates/core/src/agentic/deep_review_policy.rs` | Add `effective_instance_count()` method |
| `src/crates/core/src/service/config/types.rs` | Add `SubagentConcurrencyConfig` enum |
| `src/crates/core/Cargo.toml` | Add `sysinfo` dependency (if not already present) |
| `src/crates/ai-adapters/...` | Add 429/503 event triggers (specific file TBD) |

---

## Call Frequency Comparison

| Approach | Background Tasks | sysinfo Calls/Hour (Typical) |
|----------|-----------------|------------------------------|
| **Polling (rejected)** | `tokio::time::interval` every 30s | ~120 |
| **On-demand (this plan)** | None | **0-10** |

---

## Testing Checklist

- [ ] `ResourceProbe::snapshot()` returns valid CPU/memory data
- [ ] 5-second cache prevents repeated sysinfo calls
- [ ] `effective_instance_count()` correctly caps based on resource snapshot
- [ ] `request_scale_down()` respects 30s cooldown
- [ ] Soft limit: permits not returned when above target_concurrency
- [ ] Scale-up adds permits immediately via `add_permits()`
- [ ] Stress event counter triggers auto scale-down after 3 events
- [ ] 429 response triggers immediate scale-down without sysinfo
- [ ] Static config mode remains backward compatible
- [ ] Auto config mode parses correctly from JSON

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| `sysinfo` crate adds binary size | Use `sysinfo` with minimal features (`default-features = false`, enable only `system`) |
| Single `sysinfo` call still slow on some systems | 5-second cache; call only at decision points |
| Scale-down too aggressive | 30s cooldown; minimum target of 1 |
| Scale-up never happens after scale-down | Consider periodic "probe for scale-up" only when queue is empty and no recent stress events |
| Cache stale data | 5s TTL is short enough for decision accuracy |
