import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  X,
  MessageSquare,
  RotateCcw,
  Settings,
  Copy,
} from 'lucide-react';
import { Button, Checkbox, Tooltip } from '@/component-library';
import { useDeepReviewActionBarStore, type DeepReviewActionPhase } from '../../store/deepReviewActionBarStore';
import type { ReviewRemediationItem } from '../../utils/codeReviewRemediation';
import { buildSelectedRemediationPrompt } from '../../utils/codeReviewRemediation';
import { continueDeepReviewSession } from '../../services/DeepReviewContinuationService';
import { flowChatManager } from '../../services/FlowChatManager';
import { globalEventBus } from '@/infrastructure/event-bus';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { openModelSettings } from '@/shared/ai-errors/aiErrorActions';
import './DeepReviewActionBar.scss';

const log = createLogger('DeepReviewActionBar');

const PHASE_CONFIG: Record<DeepReviewActionPhase, {
  icon: React.ComponentType<{ size?: number | string; style?: React.CSSProperties; className?: string }>;
  iconClass: string;
  variant: 'success' | 'warning' | 'error' | 'info' | 'loading';
}> = {
  idle: { icon: Clock, iconClass: '', variant: 'info' },
  review_completed: { icon: CheckCircle, iconClass: 'deep-review-action-bar__icon--success', variant: 'success' },
  fix_running: { icon: Loader2, iconClass: 'deep-review-action-bar__icon--loading', variant: 'loading' },
  fix_completed: { icon: CheckCircle, iconClass: 'deep-review-action-bar__icon--success', variant: 'success' },
  fix_failed: { icon: AlertCircle, iconClass: 'deep-review-action-bar__icon--error', variant: 'error' },
  fix_timeout: { icon: Clock, iconClass: 'deep-review-action-bar__icon--warning', variant: 'warning' },
  review_interrupted: { icon: AlertTriangle, iconClass: 'deep-review-action-bar__icon--warning', variant: 'warning' },
  resume_blocked: { icon: AlertTriangle, iconClass: 'deep-review-action-bar__icon--error', variant: 'error' },
  resume_running: { icon: Loader2, iconClass: 'deep-review-action-bar__icon--loading', variant: 'loading' },
  resume_failed: { icon: AlertCircle, iconClass: 'deep-review-action-bar__icon--error', variant: 'error' },
  review_error: { icon: AlertTriangle, iconClass: 'deep-review-action-bar__icon--error', variant: 'error' },
};

export const DeepReviewActionBar: React.FC = () => {
  const { t } = useTranslation('flow-chat');
  const store = useDeepReviewActionBarStore();
  const {
    childSessionId,
    phase,
    reviewData,
    remediationItems,
    selectedRemediationIds,
    dismissed,
    activeAction,
    customInstructions,
    errorMessage,
    interruption,
  } = store;

  const [showCustomInput, setShowCustomInput] = useState(false);
  const [showRemediationList, setShowRemediationList] = useState(false);

  const selectedCount = selectedRemediationIds.size;
  const totalCount = remediationItems.length;
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const isFixDisabled = activeAction !== null || selectedCount === 0;
  const hasInterruption = Boolean(interruption);

  const phaseConfig = PHASE_CONFIG[phase];
  const PhaseIcon = phaseConfig.icon;

  const handleToggleRemediation = useCallback((id: string) => {
    store.toggleRemediation(id);
  }, [store]);

  const handleToggleAll = useCallback(() => {
    store.toggleAllRemediation();
  }, [store]);

  const handleStartFixing = useCallback(async (rerunReview: boolean) => {
    if (!reviewData || !childSessionId) return;

    const action = rerunReview ? 'fix-review' : 'fix';
    let prompt = buildSelectedRemediationPrompt({
      reviewData,
      selectedIds: selectedRemediationIds,
      rerunReview,
    });

    if (!prompt) return;

    if (customInstructions.trim()) {
      prompt = `${prompt}\n\n## User Instructions\n${customInstructions.trim()}`;
    }

    store.setActiveAction(action);
    store.updatePhase('fix_running');

    try {
      await flowChatManager.sendMessage(
        prompt,
        childSessionId,
        rerunReview
          ? t('toolCards.codeReview.remediationActions.fixAndReviewRequestDisplay', {
              defaultValue: 'Fix Deep Review findings and re-review',
            })
          : t('toolCards.codeReview.remediationActions.fixRequestDisplay', {
              defaultValue: 'Start fixing Deep Review findings',
            }),
        'DeepReview',
        'agentic',
      );
    } catch (error) {
      log.error('Failed to start Deep Review remediation', { childSessionId, rerunReview, error });
      const msg = error instanceof Error ? error.message : String(error);
      const isTimeout = /timeout/i.test(msg);
      store.updatePhase(isTimeout ? 'fix_timeout' : 'fix_failed', msg);
      notificationService.error(
        error instanceof Error
          ? error.message
          : t('toolCards.codeReview.reviewFailed', {
              error: t('toolCards.codeReview.unknownError'),
            }),
        { duration: 5000 },
      );
    } finally {
      store.setActiveAction(null);
    }
  }, [reviewData, childSessionId, selectedRemediationIds, customInstructions, store, t]);

  const handleFillBackInput = useCallback(() => {
    if (!reviewData) return;

    let prompt = buildSelectedRemediationPrompt({
      reviewData,
      selectedIds: selectedRemediationIds,
      rerunReview: false,
    });

    if (customInstructions.trim()) {
      prompt = `${prompt}\n\n## User Instructions\n${customInstructions.trim()}`;
    }

    if (!prompt) return;

    globalEventBus.emit('fill-chat-input', {
      content: prompt,
      mode: 'replace',
    });

    store.dismiss();
  }, [reviewData, selectedRemediationIds, customInstructions, store]);

  const handleDismiss = useCallback(() => {
    store.dismiss();
  }, [store]);

  const handleContinueReview = useCallback(async () => {
    if (!interruption) return;
    if (!interruption.canResume) {
      notificationService.warning(t('deepReviewActionBar.resumeBlockedHint', {
        defaultValue: 'Resolve the model configuration or quota issue before continuing.',
      }));
      return;
    }

    store.setActiveAction('resume');
    store.updatePhase('resume_running');
    try {
      await continueDeepReviewSession(interruption, t('deepReviewActionBar.resumeRequestDisplay', {
        defaultValue: 'Continue interrupted Deep Review',
      }));
    } catch (error) {
      log.error('Failed to continue interrupted Deep Review', { childSessionId, error });
      const message = t('deepReviewActionBar.resumeFailedMessage', {
        defaultValue: 'Unable to continue Deep Review. Check the model settings or try again later.',
      });
      store.updatePhase('resume_failed', message);
      notificationService.error(message, { duration: 5000 });
    } finally {
      store.setActiveAction(null);
    }
  }, [childSessionId, interruption, store, t]);

  const handleOpenModelSettings = useCallback(() => {
    openModelSettings();
  }, []);

  const handleCopyDiagnostics = useCallback(() => {
    const detail = interruption?.errorDetail;
    const diagnostics = [
      `category=${detail?.category ?? 'unknown'}`,
      detail?.provider ? `provider=${detail.provider}` : null,
      detail?.providerCode ? `code=${detail.providerCode}` : null,
      detail?.requestId ? `request_id=${detail.requestId}` : null,
    ].filter(Boolean).join(', ');
    void navigator.clipboard?.writeText(diagnostics);
    notificationService.success(t('deepReviewActionBar.diagnosticsCopied', {
      defaultValue: 'Diagnostics copied',
    }), { duration: 2500 });
  }, [interruption, t]);

  const phaseTitle = useMemo(() => {
    switch (phase) {
      case 'review_completed':
        return t('deepReviewActionBar.reviewCompleted', {
          defaultValue: 'Deep review completed',
        });
      case 'fix_running':
        return t('deepReviewActionBar.fixRunning', {
          defaultValue: 'Fixing in progress...',
        });
      case 'fix_completed':
        return t('deepReviewActionBar.fixCompleted', {
          defaultValue: 'Fix completed',
        });
      case 'fix_failed':
        return t('deepReviewActionBar.fixFailed', {
          defaultValue: 'Fix failed',
        });
      case 'fix_timeout':
        return t('deepReviewActionBar.fixTimeout', {
          defaultValue: 'Fix timed out',
        });
      case 'review_interrupted':
        return t('deepReviewActionBar.reviewInterrupted', {
          defaultValue: 'Deep review interrupted',
        });
      case 'resume_blocked':
        return t('deepReviewActionBar.resumeBlocked', {
          defaultValue: 'Action required before continuing',
        });
      case 'resume_running':
        return t('deepReviewActionBar.resumeRunning', {
          defaultValue: 'Continuing review...',
        });
      case 'resume_failed':
        return t('deepReviewActionBar.resumeFailed', {
          defaultValue: 'Continue failed',
        });
      case 'review_error':
        return t('deepReviewActionBar.reviewError', {
          defaultValue: 'Review error',
        });
      default:
        return '';
    }
  }, [phase, t]);

  if (dismissed || phase === 'idle' || !childSessionId) {
    return null;
  }

  return (
    <div className={`deep-review-action-bar deep-review-action-bar--${phaseConfig.variant}`}>
      <button
        type="button"
        className="deep-review-action-bar__close"
        onClick={handleDismiss}
        aria-label={t('deepReviewActionBar.dismiss', { defaultValue: 'Dismiss' })}
      >
        <X size={14} />
      </button>

      {/* Phase status header */}
      <div className="deep-review-action-bar__status">
        <PhaseIcon
          size={16}
          className={`deep-review-action-bar__icon ${phaseConfig.iconClass}`}
        />
        <span className="deep-review-action-bar__status-title">{phaseTitle}</span>
        {errorMessage && (
          <span className="deep-review-action-bar__error-message">{errorMessage}</span>
        )}
      </div>

      {/* Remediation selection (only when review completed) */}
      {phase === 'review_completed' && remediationItems.length > 0 && (
        <div className="deep-review-action-bar__remediation">
          <button
            type="button"
            className="deep-review-action-bar__remediation-toggle"
            onClick={() => setShowRemediationList(!showRemediationList)}
          >
            <Checkbox
              checked={allSelected}
              indeterminate={!allSelected && selectedCount > 0}
              onChange={handleToggleAll}
              size="small"
            />
            <span className="deep-review-action-bar__remediation-label">
              {t('toolCards.codeReview.remediationActions.selectionCount', {
                selected: selectedCount,
                total: totalCount,
                defaultValue: '{{selected}}/{{total}} selected',
              })}
            </span>
            {showRemediationList ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {showRemediationList && (
            <div className="deep-review-action-bar__remediation-list">
              {remediationItems.map((item: ReviewRemediationItem) => (
                <label key={item.id} className="deep-review-action-bar__remediation-item">
                  <Checkbox
                    checked={selectedRemediationIds.has(item.id)}
                    onChange={() => handleToggleRemediation(item.id)}
                    size="small"
                  />
                  <span className="deep-review-action-bar__remediation-text" title={item.plan}>
                    {item.plan}
                  </span>
                </label>
              ))}
            </div>
          )}

          {selectedCount === 0 && (
            <div className="deep-review-action-bar__empty-selection">
              {t('toolCards.codeReview.remediationActions.noSelectionHint', {
                defaultValue: 'Select at least one remediation item to start fixing.',
              })}
            </div>
          )}
        </div>
      )}

      {/* Custom instructions input */}
      {phase === 'review_completed' && (
        <div className="deep-review-action-bar__custom">
          <button
            type="button"
            className="deep-review-action-bar__custom-toggle"
            onClick={() => setShowCustomInput(!showCustomInput)}
          >
            <MessageSquare size={12} />
            <span>
              {showCustomInput
                ? t('deepReviewActionBar.hideCustomInput', { defaultValue: 'Hide instructions' })
                : t('deepReviewActionBar.showCustomInput', { defaultValue: 'Add instructions' })}
            </span>
          </button>
          {showCustomInput && (
            <textarea
              className="deep-review-action-bar__custom-textarea"
              placeholder={t('deepReviewActionBar.customInstructionsPlaceholder', {
                defaultValue: 'Describe additional requirements or context for the fix...',
              })}
              value={customInstructions}
              onChange={(e) => store.setCustomInstructions(e.target.value)}
              rows={2}
            />
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="deep-review-action-bar__actions">
        {phase === 'review_completed' && (
          <>
            <Button
              variant="primary"
              size="small"
              isLoading={activeAction === 'fix'}
              disabled={isFixDisabled}
              onClick={() => void handleStartFixing(false)}
            >
              {t('toolCards.codeReview.remediationActions.startFix', { defaultValue: 'Start fixing' })}
            </Button>
            <Button
              variant="secondary"
              size="small"
              isLoading={activeAction === 'fix-review'}
              disabled={isFixDisabled}
              onClick={() => void handleStartFixing(true)}
            >
              {t('toolCards.codeReview.remediationActions.fixAndReview', { defaultValue: 'Fix and re-review' })}
            </Button>
            <Tooltip content={t('deepReviewActionBar.fillBackInputHint', {
              defaultValue: 'Copy selected fix plan to the input box for manual editing',
            })}>
              <Button
                variant="ghost"
                size="small"
                disabled={isFixDisabled}
                onClick={handleFillBackInput}
              >
                {t('deepReviewActionBar.fillBackInput', { defaultValue: 'Fill to input' })}
              </Button>
            </Tooltip>
          </>
        )}

        {hasInterruption && (
          <>
            {interruption?.recommendedActions.some((action) => action.code === 'open_model_settings') && (
              <Button
                variant={interruption.canResume ? 'secondary' : 'primary'}
                size="small"
                onClick={handleOpenModelSettings}
              >
                <Settings size={13} />
                {t('deepReviewActionBar.openModelSettings', { defaultValue: 'Open model settings' })}
              </Button>
            )}
            <Button
              variant={interruption?.canResume ? 'primary' : 'secondary'}
              size="small"
              isLoading={activeAction === 'resume'}
              disabled={activeAction !== null || !interruption?.canResume}
              onClick={() => void handleContinueReview()}
            >
              <RotateCcw size={13} />
              {t('deepReviewActionBar.resumeReview', { defaultValue: 'Continue review' })}
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={handleCopyDiagnostics}
            >
              <Copy size={13} />
              {t('deepReviewActionBar.copyDiagnostics', { defaultValue: 'Copy diagnostics' })}
            </Button>
          </>
        )}

        {(phase === 'fix_completed' || phase === 'fix_failed' || phase === 'fix_timeout' || phase === 'review_error' || phase === 'resume_failed') && (
          <Button
            variant="ghost"
            size="small"
            onClick={handleDismiss}
          >
            {t('deepReviewActionBar.close', { defaultValue: 'Close' })}
          </Button>
        )}
      </div>
    </div>
  );
};
