//! RFC 8628 polling shared by the OpenCode, xAI and Nous device grants.

use anyhow::{anyhow, Result};
use std::future::Future;
use std::time::Duration;
use tokio::time::{sleep, timeout_at, Instant};

pub(super) enum DevicePoll<T> {
    Authorized(T),
    Pending,
    SlowDown,
}

/// Keep the server's interval for the entire grant, including after pending
/// responses. RFC 8628 section 3.5 increases it by five seconds on slow_down
/// for this AND all subsequent requests. The deadline also bounds an in-flight
/// HTTP request, rather than only the sleeps between requests.
pub(super) async fn poll_device_code<T, F, Fut>(
    interval: Duration,
    expires_in: Duration,
    safety_margin: Duration,
    poll_immediately: bool,
    mut poll: F,
) -> Result<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<DevicePoll<T>>>,
{
    let deadline = Instant::now() + expires_in;
    timeout_at(deadline, async {
        let mut interval = interval.max(Duration::from_secs(1));
        if !poll_immediately {
            sleep(interval.min(expires_in)).await;
        }
        loop {
            // timeout_at polls its inner future first. Check explicitly so an
            // already expired grant cannot make one more network request.
            if Instant::now() >= deadline {
                return Err(anyhow!(
                    "Device authorization code expired; start sign-in again"
                ));
            }
            match poll().await? {
                DevicePoll::Authorized(tokens) => return Ok(tokens),
                DevicePoll::Pending => {}
                DevicePoll::SlowDown => {
                    interval = interval.saturating_add(Duration::from_secs(5));
                }
            }
            // Clamp before sleeping so malformed server intervals cannot
            // overflow Instant arithmetic or outlive the grant.
            let remaining = deadline.saturating_duration_since(Instant::now());
            sleep(interval.saturating_add(safety_margin).min(remaining)).await;
        }
    })
    .await
    .map_err(|_| anyhow!("Device authorization code expired; start sign-in again"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::future::{pending, ready};

    #[tokio::test(start_paused = true)]
    async fn pending_preserves_cumulative_slow_down_and_provider_margin() {
        let start = Instant::now();
        let mut calls = Vec::new();
        let mut replies = VecDeque::from([
            DevicePoll::Pending,
            DevicePoll::SlowDown,
            DevicePoll::Pending,
            DevicePoll::SlowDown,
            DevicePoll::Authorized("token"),
        ]);
        let token = poll_device_code(
            Duration::from_secs(5),
            Duration::from_secs(300),
            Duration::from_secs(3),
            true,
            || {
                calls.push(Instant::now().duration_since(start).as_secs());
                ready(Ok(replies.pop_front().unwrap()))
            },
        )
        .await
        .unwrap();
        assert_eq!(token, "token");
        assert_eq!(calls, [0, 8, 21, 34, 52]);
    }

    #[tokio::test(start_paused = true)]
    async fn waits_for_advertised_interval_before_opencode_first_poll() {
        let start = Instant::now();
        poll_device_code(
            Duration::from_secs(7),
            Duration::from_secs(300),
            Duration::ZERO,
            false,
            || ready(Ok(DevicePoll::Authorized(()))),
        )
        .await
        .unwrap();
        assert_eq!(start.elapsed(), Duration::from_secs(7));
    }

    #[tokio::test(start_paused = true)]
    async fn deadline_cancels_an_in_flight_request() {
        let start = Instant::now();
        let error = poll_device_code(
            Duration::from_secs(5),
            Duration::from_secs(10),
            Duration::ZERO,
            true,
            pending::<Result<DevicePoll<()>>>,
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("expired"));
        assert_eq!(start.elapsed(), Duration::from_secs(10));
    }

    #[tokio::test(start_paused = true)]
    async fn never_polls_after_expiry_or_retries_a_terminal_error() {
        let mut calls = 0;
        let error = poll_device_code(
            Duration::from_secs(5),
            Duration::from_secs(5),
            Duration::ZERO,
            true,
            || {
                calls += 1;
                ready(Ok(DevicePoll::<()>::Pending))
            },
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("expired"));
        assert_eq!(calls, 1);

        let start = Instant::now();
        let error = poll_device_code(
            Duration::from_secs(5),
            Duration::from_secs(300),
            Duration::ZERO,
            true,
            || ready(Err::<DevicePoll<()>, _>(anyhow!("authorization denied"))),
        )
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), "authorization denied");
        assert_eq!(start.elapsed(), Duration::ZERO);
    }
}
