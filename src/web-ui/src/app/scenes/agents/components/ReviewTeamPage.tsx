import React, { Component, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  Gauge,
  GitBranch,
  Lock,
  Plus,
  Shield,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  ConfigPageLoading,
  NumberInput,
  Select,
} from '@/component-library';
import {
  ConfigPageContent,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageRow,
  ConfigPageSection,
} from '@/infrastructure/config/components/common';
import { ModelSelectionRadio } from '@/infrastructure/config/components/ModelSelectionRadio';
import type { AIModelConfig } from '@/infrastructure/config/types';
import { getModelDisplayName } from '@/infrastructure/config/services/modelConfigs';
import { configAPI } from '@/infrastructure/api/service-api/ConfigAPI';
import {
  SubagentAPI,
  type SubagentInfo,
  type SubagentSource,
} from '@/infrastructure/api/service-api/SubagentAPI';
import { useNotification } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { useCurrentWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useAgentsStore } from '../agentsStore';
import {
  addDefaultReviewTeamMember,
  canUseSubagentAsReviewTeamMember,
  DEFAULT_REVIEW_MEMBER_STRATEGY_LEVEL,
  DEFAULT_REVIEW_TEAM_EXECUTION_POLICY,
  DEFAULT_REVIEW_TEAM_MODEL,
  loadDefaultReviewTeam,
  REVIEW_STRATEGY_DEFINITIONS,
  REVIEW_STRATEGY_LEVELS,
  removeDefaultReviewTeamMember,
  saveDefaultReviewTeamExecutionPolicy,
  saveDefaultReviewTeamMemberStrategyOverride,
  saveDefaultReviewTeamStrategyLevel,
  type ReviewMemberStrategyLevel,
  type ReviewStrategyLevel,
  type ReviewTeam,
  type ReviewTeamExecutionPolicy,
  type ReviewTeamMember,
} from '@/shared/services/reviewTeamService';
import '../AgentsView.scss';
import './ReviewTeamPage.scss';

function getMemberIcon(member: ReviewTeamMember) {
  switch (member.definitionKey) {
    case 'businessLogic':
      return GitBranch;
    case 'performance':
      return Gauge;
    case 'security':
      return Shield;
    case 'judge':
      return BadgeCheck;
    default:
      return Bot;
  }
}

function getSourceVariant(source?: SubagentSource): 'neutral' | 'info' | 'purple' {
  if (source === 'user') {
    return 'info';
  }
  if (source === 'project') {
    return 'purple';
  }
  return 'neutral';
}

const MEMBER_STRATEGY_OPTIONS: ReviewMemberStrategyLevel[] = [
  DEFAULT_REVIEW_MEMBER_STRATEGY_LEVEL,
  ...REVIEW_STRATEGY_LEVELS,
];
const DEFAULT_MEMBER_ACCENT = '#64748b';

function getMemberResponsibilities(member: ReviewTeamMember): string[] {
  return Array.isArray(member.responsibilities) ? member.responsibilities : [];
}

function resolveStrategySource(strategyOverride: ReviewMemberStrategyLevel): 'team' | 'member' {
  return strategyOverride === DEFAULT_REVIEW_MEMBER_STRATEGY_LEVEL ? 'team' : 'member';
}

function updateMemberStrategy(
  member: ReviewTeamMember,
  strategyOverride: ReviewMemberStrategyLevel,
  teamStrategyLevel: ReviewStrategyLevel,
): ReviewTeamMember {
  const inheritsTeamStrategy = strategyOverride === DEFAULT_REVIEW_MEMBER_STRATEGY_LEVEL;
  return {
    ...member,
    strategyOverride,
    strategyLevel: inheritsTeamStrategy ? teamStrategyLevel : strategyOverride,
    strategySource: resolveStrategySource(strategyOverride),
  };
}

function updateTeamStrategy(
  team: ReviewTeam,
  strategyLevel: ReviewStrategyLevel,
): ReviewTeam {
  const applyTeamStrategy = (member: ReviewTeamMember) =>
    member.strategyOverride === DEFAULT_REVIEW_MEMBER_STRATEGY_LEVEL
      ? updateMemberStrategy(member, DEFAULT_REVIEW_MEMBER_STRATEGY_LEVEL, strategyLevel)
      : member;

  return {
    ...team,
    strategyLevel,
    members: team.members.map(applyTeamStrategy),
    coreMembers: team.coreMembers.map(applyTeamStrategy),
    extraMembers: team.extraMembers.map(applyTeamStrategy),
  };
}

function updateTeamMemberStrategy(
  team: ReviewTeam,
  memberId: string,
  strategyOverride: ReviewMemberStrategyLevel,
): ReviewTeam {
  const applyMemberStrategy = (member: ReviewTeamMember) =>
    member.id === memberId
      ? updateMemberStrategy(member, strategyOverride, team.strategyLevel)
      : member;

  return {
    ...team,
    members: team.members.map(applyMemberStrategy),
    coreMembers: team.coreMembers.map(applyMemberStrategy),
    extraMembers: team.extraMembers.map(applyMemberStrategy),
  };
}

const rtLog = createLogger('ReviewTeamPage');

interface ReviewTeamErrorBoundaryProps {
  children: React.ReactNode;
}

interface ReviewTeamErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ReviewTeamErrorBoundary extends Component<ReviewTeamErrorBoundaryProps, ReviewTeamErrorBoundaryState> {
  constructor(props: ReviewTeamErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ReviewTeamErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    rtLog.error('ReviewTeamPage render error', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bitfun-agents-scene bitfun-agents-scene--page" style={{ padding: 24 }}>
          <div style={{ color: 'var(--color-text-primary, #e5e7eb)', maxWidth: 600 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Review Team Page Error</h3>
            <p style={{ margin: '0 0 8px', color: 'var(--color-text-muted, #858585)', fontSize: 13 }}>
              {this.state.error?.message ?? 'Unknown error'}
            </p>
            {import.meta.env.DEV && this.state.error?.stack && (
              <pre style={{
                margin: '8px 0 0',
                padding: 12,
                background: 'var(--color-bg-secondary, #1c1c1f)',
                color: 'var(--color-text-secondary, #cbd5e1)',
                borderRadius: 8,
                overflow: 'auto',
                maxHeight: 200,
                fontSize: 11,
              }}>
                {this.state.error.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const ReviewTeamPage: React.FC = () => {
  const { t } = useTranslation('scenes/agents');
  const { t: tModel } = useTranslation('settings/default-model');
  const { openHome } = useAgentsStore();
  const { workspacePath } = useCurrentWorkspace();
  const { error: notifyError, success: notifySuccess } = useNotification();

  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<ReviewTeam | null>(null);
  const [models, setModels] = useState<AIModelConfig[]>([]);
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState('');
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [savingPolicyKey, setSavingPolicyKey] = useState<keyof ReviewTeamExecutionPolicy | null>(null);
  const [savingStrategyTarget, setSavingStrategyTarget] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    rtLog.info('loadData started', { workspacePath });
    try {
      const [loadedTeam, loadedModels, loadedSubagents] = await Promise.all([
        loadDefaultReviewTeam(workspacePath || undefined),
        configAPI.getConfig('ai.models'),
        SubagentAPI.listSubagents({ workspacePath: workspacePath || undefined }),
      ]);

      rtLog.info('loadData succeeded', {
        teamId: loadedTeam?.id,
        memberCount: loadedTeam?.members?.length,
        coreMemberCount: loadedTeam?.coreMembers?.length,
        strategyLevel: loadedTeam?.strategyLevel,
        modelCount: Array.isArray(loadedModels) ? loadedModels.length : 0,
        subagentCount: loadedSubagents?.length,
      });

      setTeam(loadedTeam);
      setModels(Array.isArray(loadedModels) ? loadedModels as AIModelConfig[] : []);
      setSubagents(loadedSubagents);
      setSelectedMemberId((currentId) => {
        if (currentId && loadedTeam.members.some((member) => member.id === currentId)) {
          return currentId;
        }
        return loadedTeam.members[0]?.id ?? null;
      });
    } catch (error) {
      rtLog.error('loadData failed', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      setTeam({
        id: 'default-review-team',
        name: 'Code Review Team',
        description: '',
        warning: t('reviewTeams.detail.warning', {
          defaultValue:
            'Deep review may take longer and usually consumes more tokens than a standard review.',
        }),
        strategyLevel: 'normal',
        memberStrategyOverrides: {},
        executionPolicy: { ...DEFAULT_REVIEW_TEAM_EXECUTION_POLICY },
        members: [],
        coreMembers: [],
        extraMembers: [],
      });
      setModels([]);
      setSubagents([]);
      notifyError(
        error instanceof Error
          ? error.message
          : t('reviewTeams.detail.messages.saveFailed', {
            defaultValue: 'Failed to save the code review team configuration.',
          }),
      );
    } finally {
      setLoading(false);
    }
  }, [notifyError, t, workspacePath]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedMember = useMemo(() => {
    if (!team) {
      return null;
    }
    return team.members.find((member) => member.id === selectedMemberId) ?? team.members[0] ?? null;
  }, [selectedMemberId, team]);

  const getLocalizedMemberName = useCallback((member: ReviewTeamMember): string => {
    if (!member.definitionKey) {
      return member.displayName;
    }
    return t(`reviewTeams.members.${member.definitionKey}.funName`, {
      defaultValue: member.displayName,
    });
  }, [t]);

  const getLocalizedMemberRole = useCallback((member: ReviewTeamMember): string => {
    if (!member.definitionKey) {
      return t('reviewTeams.extraReviewer.role', {
        defaultValue: member.roleName,
      });
    }
    return t(`reviewTeams.members.${member.definitionKey}.role`, {
      defaultValue: member.roleName,
    });
  }, [t]);

  const getLocalizedMemberDescription = useCallback((member: ReviewTeamMember): string => {
    if (!member.definitionKey) {
      return t('reviewTeams.extraReviewer.description', {
        defaultValue: member.description,
      });
    }
    return t(`reviewTeams.members.${member.definitionKey}.description`, {
      defaultValue: member.description,
    });
  }, [t]);

  const getLocalizedResponsibilities = useCallback((member: ReviewTeamMember): string[] => {
    if (!member.definitionKey) {
      return getMemberResponsibilities(member).map((item, index) => t(
        `reviewTeams.extraReviewer.responsibilities.${index}`,
        { defaultValue: item },
      ));
    }

    return getMemberResponsibilities(member).map((item, index) => t(
      `reviewTeams.members.${member.definitionKey}.responsibilities.${index}`,
      { defaultValue: item },
    ));
  }, [t]);

  const getStrategyLabel = useCallback((level: ReviewStrategyLevel): string => {
    return t(`reviewTeams.strategy.${level}.label`, {
      defaultValue: REVIEW_STRATEGY_DEFINITIONS[level].label,
    });
  }, [t]);

  const getStrategySummary = useCallback((level: ReviewStrategyLevel): string => {
    return t(`reviewTeams.strategy.${level}.summary`, {
      defaultValue: REVIEW_STRATEGY_DEFINITIONS[level].summary,
    });
  }, [t]);

  const getStrategyImpact = useCallback((level: ReviewStrategyLevel): string => {
    const definition = REVIEW_STRATEGY_DEFINITIONS[level];
    return t('reviewTeams.strategy.impact', {
      token: definition.tokenImpact,
      runtime: definition.runtimeImpact,
      defaultValue: `About ${definition.tokenImpact} token usage and ${definition.runtimeImpact} runtime.`,
    });
  }, [t]);

  const getMemberStrategyOptionLabel = useCallback((
    level: ReviewMemberStrategyLevel,
  ): string => {
    if (level === DEFAULT_REVIEW_MEMBER_STRATEGY_LEVEL) {
      return t('reviewTeams.strategy.inheritLabel', {
        level: team ? getStrategyLabel(team.strategyLevel) : '',
        defaultValue: team
          ? `Inherit team (${getStrategyLabel(team.strategyLevel)})`
          : 'Inherit team',
      });
    }

    return getStrategyLabel(level);
  }, [getStrategyLabel, t, team]);

  const getMemberStrategyOptionSummary = useCallback((
    level: ReviewMemberStrategyLevel,
    member: ReviewTeamMember,
  ): string => {
    if (level === DEFAULT_REVIEW_MEMBER_STRATEGY_LEVEL) {
      return t('reviewTeams.strategy.inheritSummary', {
        level: getStrategyLabel(team?.strategyLevel ?? member.strategyLevel),
        defaultValue: 'Use the team-wide review strategy for this reviewer.',
      });
    }

    return getStrategySummary(level);
  }, [getStrategyLabel, getStrategySummary, t, team?.strategyLevel]);

  const formatModelLabel = useCallback((modelId: string): string => {
    if (!modelId || modelId === DEFAULT_REVIEW_TEAM_MODEL) {
      return tModel('selection.fast', { defaultValue: 'Fast' });
    }
    if (modelId === 'primary') {
      return tModel('selection.primary', { defaultValue: 'Primary' });
    }

    const match = models.find((model) => model.id === modelId);
    return match ? getModelDisplayName(match) : modelId;
  }, [models, tModel]);

  const extraCandidates = useMemo(() => {
    if (!team) {
      return [];
    }
    const existingIds = new Set(team.members.map((member) => member.subagentId));

    return subagents
      .filter((subagent) => !existingIds.has(subagent.id))
      .filter(canUseSubagentAsReviewTeamMember)
      .sort((left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      );
  }, [subagents, team]);

  useEffect(() => {
    if (extraCandidates.length === 0) {
      setCandidateId('');
      return;
    }

    setCandidateId((currentId) => {
      if (currentId && extraCandidates.some((candidate) => candidate.id === currentId)) {
        return currentId;
      }
      return extraCandidates[0]?.id ?? '';
    });
  }, [extraCandidates]);

  const handleModelChange = useCallback(async (member: ReviewTeamMember, modelId: string) => {
    setSavingMemberId(member.id);
    try {
      await SubagentAPI.updateSubagentConfig({
        subagentId: member.subagentId,
        enabled: true,
        model: modelId,
        workspacePath: workspacePath || undefined,
      });
      notifySuccess(
        t('reviewTeams.detail.messages.modelUpdated', {
          name: getLocalizedMemberName(member),
          defaultValue: `Updated ${getLocalizedMemberName(member)} model.`,
        }),
      );
      await loadData();
    } catch (error) {
      notifyError(
        error instanceof Error
          ? error.message
          : t('reviewTeams.detail.messages.saveFailed', {
            defaultValue: 'Failed to save the code review team configuration.',
          }),
      );
    } finally {
      setSavingMemberId(null);
    }
  }, [getLocalizedMemberName, loadData, notifyError, notifySuccess, t, workspacePath]);

  const handleAddMember = useCallback(async () => {
    if (!candidateId) {
      return;
    }

    setAddingMember(true);
    try {
      await addDefaultReviewTeamMember(candidateId);
      await SubagentAPI.updateSubagentConfig({
        subagentId: candidateId,
        enabled: true,
        workspacePath: workspacePath || undefined,
      });
      await loadData();
      setSelectedMemberId(`extra:${candidateId}`);
      notifySuccess(
        t('reviewTeams.detail.messages.memberAdded', {
          defaultValue: 'Added the extra reviewer to the team.',
        }),
      );
    } catch (error) {
      notifyError(
        error instanceof Error
          ? error.message
          : t('reviewTeams.detail.messages.saveFailed', {
            defaultValue: 'Failed to save the code review team configuration.',
          }),
      );
    } finally {
      setAddingMember(false);
    }
  }, [candidateId, loadData, notifyError, notifySuccess, t, workspacePath]);

  const handleRemoveMember = useCallback(async (member: ReviewTeamMember) => {
    if (member.locked) {
      return;
    }

    setRemovingMemberId(member.id);
    try {
      await removeDefaultReviewTeamMember(member.subagentId);
      await loadData();
      setSelectedMemberId((currentId) => (currentId === member.id ? null : currentId));
      notifySuccess(
        t('reviewTeams.detail.messages.memberRemoved', {
          defaultValue: 'Removed the extra reviewer from the team.',
        }),
      );
    } catch (error) {
      notifyError(
        error instanceof Error
          ? error.message
          : t('reviewTeams.detail.messages.saveFailed', {
            defaultValue: 'Failed to save the code review team configuration.',
          }),
      );
    } finally {
      setRemovingMemberId(null);
    }
  }, [loadData, notifyError, notifySuccess, t]);

  const handleExecutionPolicyChange = useCallback(async (
    key: keyof ReviewTeamExecutionPolicy,
    value: ReviewTeamExecutionPolicy[keyof ReviewTeamExecutionPolicy],
  ) => {
    if (!team) {
      return;
    }

    const nextPolicy: ReviewTeamExecutionPolicy = {
      ...team.executionPolicy,
      [key]: value,
    };

    setSavingPolicyKey(key);
    setTeam((current) => (current ? { ...current, executionPolicy: nextPolicy } : current));

    try {
      await saveDefaultReviewTeamExecutionPolicy(nextPolicy);
    } catch (error) {
      await loadData();
      notifyError(
        error instanceof Error
          ? error.message
          : t('reviewTeams.detail.messages.saveFailed', {
            defaultValue: 'Failed to save the code review team configuration.',
          }),
      );
    } finally {
      setSavingPolicyKey(null);
    }
  }, [loadData, notifyError, t, team]);

  const handleTeamStrategyChange = useCallback(async (strategyLevel: ReviewStrategyLevel) => {
    if (!team || team.strategyLevel === strategyLevel) {
      return;
    }

    setSavingStrategyTarget('team');
    setTeam((current) => (current ? updateTeamStrategy(current, strategyLevel) : current));
    try {
      await saveDefaultReviewTeamStrategyLevel(strategyLevel);
    } catch (error) {
      await loadData();
      notifyError(
        error instanceof Error
          ? error.message
          : t('reviewTeams.detail.messages.saveFailed', {
            defaultValue: 'Failed to save the code review team configuration.',
          }),
      );
    } finally {
      setSavingStrategyTarget(null);
    }
  }, [loadData, notifyError, t, team]);

  const handleMemberStrategyChange = useCallback(async (
    member: ReviewTeamMember,
    strategyLevel: ReviewMemberStrategyLevel,
  ) => {
    if (member.strategyOverride === strategyLevel) {
      return;
    }

    const target = `member:${member.id}`;
    setSavingStrategyTarget(target);
    setTeam((current) =>
      current ? updateTeamMemberStrategy(current, member.id, strategyLevel) : current,
    );
    try {
      await saveDefaultReviewTeamMemberStrategyOverride(
        member.subagentId,
        strategyLevel,
      );
    } catch (error) {
      await loadData();
      notifyError(
        error instanceof Error
          ? error.message
          : t('reviewTeams.detail.messages.saveFailed', {
            defaultValue: 'Failed to save the code review team configuration.',
          }),
      );
    } finally {
      setSavingStrategyTarget(null);
    }
  }, [loadData, notifyError, t]);

  if (loading || !team) {
    return (
      <ConfigPageLayout className="review-team-page">
        <ConfigPageLoading
          text={t('reviewTeams.detail.loading', {
            defaultValue: 'Loading code review team...',
          })}
        />
      </ConfigPageLayout>
    );
  }

  const selectedResponsibilities = selectedMember
    ? getLocalizedResponsibilities(selectedMember)
    : [];
  const selectedIcon = selectedMember ? getMemberIcon(selectedMember) : Bot;
  const SelectedIcon = selectedIcon;

  return (
    <ConfigPageLayout className="review-team-page">
      <ConfigPageHeader
        title={t('reviewTeams.detail.title', {
          defaultValue: 'Code Review Team',
        })}
        subtitle={t('reviewTeams.detail.subtitle', {
          defaultValue:
            'Configure the code review team used by Deep Review and /DeepReview. Every reviewer starts on the Fast model unless you change it.',
        })}
        extra={(
          <Button variant="secondary" size="small" onClick={openHome}>
            <ArrowLeft size={14} style={{ marginRight: 6 }} />
            {t('reviewTeams.detail.back', {
              defaultValue: 'Back to Agents',
            })}
          </Button>
        )}
      />

      <ConfigPageContent>
        <ConfigPageSection
          title={t('reviewTeams.detail.summaryTitle', {
            defaultValue: 'Team Overview',
          })}
          description={t('reviewTeams.detail.summaryDescription', {
            defaultValue:
              'The code review team launches reviewers in parallel and always finishes with a quality-gate pass.',
          })}
          titleSuffix={(
            <Badge variant="neutral">
              {t('reviewTeams.detail.membersCount', {
                count: team.members.length,
                defaultValue: `${team.members.length} members`,
              })}
            </Badge>
          )}
        >
          <div className="review-team-page__summary-grid">
            <div className="review-team-page__summary-card">
              <span className="review-team-page__summary-kicker">
                {t('reviewTeams.detail.localOnly', {
                  defaultValue: 'Code review',
                })}
              </span>
              <p className="review-team-page__summary-value">
                {t('reviewTeams.detail.localOnlyDescription', {
                  defaultValue:
                    'Reviewers run as BitFun subagents and report through the same review workflow.',
                })}
              </p>
            </div>

            <div className="review-team-page__summary-card">
              <span className="review-team-page__summary-kicker">
                {t('reviewTeams.detail.parallelLabel', {
                  defaultValue: 'Parallel reviewers',
                })}
              </span>
              <p className="review-team-page__summary-value">
                {t('reviewTeams.detail.parallelDescription', {
                  defaultValue:
                    'Business logic, performance, security, and any extra reviewers run concurrently before the judge verifies them.',
                })}
              </p>
            </div>

            <div className="review-team-page__summary-card review-team-page__summary-card--warning">
              <span className="review-team-page__summary-kicker">
                {t('reviewTeams.detail.warningLabel', {
                  defaultValue: 'Longer and heavier',
                })}
              </span>
              <p className="review-team-page__summary-value">
                {t('reviewTeams.detail.warning', {
                  defaultValue: team.warning,
                })}
              </p>
            </div>
          </div>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('reviewTeams.detail.executionPolicyTitle', {
            defaultValue: 'Execution Policy',
          })}
          description={t('reviewTeams.detail.executionPolicyDescription', {
            defaultValue:
              'Control reviewer timeouts and how large review scopes are split across parallel read-only reviewer instances.',
          })}
        >
          <div className="review-team-page__strategy-panel">
            <div className="review-team-page__strategy-panel-copy">
              <span className="review-team-page__block-label">
                {t('reviewTeams.strategy.teamTitle', {
                  defaultValue: 'Review strategy',
                })}
              </span>
              <p>
                {t('reviewTeams.strategy.teamDescription', {
                  defaultValue:
                    'Choose the default depth for the whole code review team. Individual reviewers can override it in their member details.',
                })}
              </p>
            </div>

            <div className="review-team-page__strategy-options">
              {REVIEW_STRATEGY_LEVELS.map((level) => {
                const isSelected = team.strategyLevel === level;
                return (
                  <button
                    key={level}
                    type="button"
                    className={`review-team-page__strategy-option${isSelected ? ' is-selected' : ''}`}
                    aria-pressed={isSelected}
                    disabled={savingStrategyTarget === 'team'}
                    onClick={() => void handleTeamStrategyChange(level)}
                  >
                    <span className="review-team-page__strategy-option-title">
                      {getStrategyLabel(level)}
                    </span>
                    <span className="review-team-page__strategy-option-summary">
                      {getStrategySummary(level)}
                    </span>
                    <span className="review-team-page__strategy-option-impact">
                      {getStrategyImpact(level)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <ConfigPageRow
            label={t('reviewTeams.detail.reviewerTimeout', {
              defaultValue: 'Reviewer timeout',
            })}
            description={t('reviewTeams.detail.reviewerTimeoutDescription', {
              defaultValue:
                'Per-reviewer timeout in seconds. Set 0 to disable and let reviewers run without a hard deadline.',
            })}
            align="center"
            balanced
          >
            <NumberInput
              value={team.executionPolicy.reviewerTimeoutSeconds}
              onChange={(value) => void handleExecutionPolicyChange('reviewerTimeoutSeconds', value)}
              min={0}
              max={3600}
              step={30}
              unit={t('reviewTeams.detail.seconds', {
                defaultValue: 's',
              })}
              size="small"
              disabled={savingPolicyKey === 'reviewerTimeoutSeconds'}
            />
          </ConfigPageRow>

          <ConfigPageRow
            label={t('reviewTeams.detail.judgeTimeout', {
              defaultValue: 'Judge timeout',
            })}
            description={t('reviewTeams.detail.judgeTimeoutDescription', {
              defaultValue:
                'Quality-gate timeout in seconds. Set 0 to disable and wait as long as needed for the judge.',
            })}
            align="center"
            balanced
          >
            <NumberInput
              value={team.executionPolicy.judgeTimeoutSeconds}
              onChange={(value) => void handleExecutionPolicyChange('judgeTimeoutSeconds', value)}
              min={0}
              max={3600}
              step={30}
              unit={t('reviewTeams.detail.seconds', {
                defaultValue: 's',
              })}
              size="small"
              disabled={savingPolicyKey === 'judgeTimeoutSeconds'}
            />
          </ConfigPageRow>

          <ConfigPageRow
            label={t('reviewTeams.detail.fileSplitThreshold', {
              defaultValue: 'File split threshold',
            })}
            description={t('reviewTeams.detail.fileSplitThresholdDescription', {
              defaultValue:
                'When the number of target files exceeds this value, each reviewer role splits into multiple instances. Set 0 to disable file splitting.',
            })}
            align="center"
            balanced
          >
            <NumberInput
              value={team.executionPolicy.reviewerFileSplitThreshold}
              onChange={(value) => void handleExecutionPolicyChange('reviewerFileSplitThreshold', value)}
              min={0}
              max={9999}
              step={5}
              size="small"
              disabled={savingPolicyKey === 'reviewerFileSplitThreshold'}
            />
          </ConfigPageRow>

          <ConfigPageRow
            label={t('reviewTeams.detail.maxSameRoleInstances', {
              defaultValue: 'Max same-role instances',
            })}
            description={t('reviewTeams.detail.maxSameRoleInstancesDescription', {
              defaultValue:
                'Maximum number of same-role reviewer instances per role when file splitting is active. Higher values use more parallel subagents.',
            })}
            align="center"
            balanced
          >
            <NumberInput
              value={team.executionPolicy.maxSameRoleInstances}
              onChange={(value) => void handleExecutionPolicyChange('maxSameRoleInstances', value)}
              min={1}
              max={8}
              step={1}
              size="small"
              disabled={savingPolicyKey === 'maxSameRoleInstances'}
            />
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('reviewTeams.detail.membersTitle', {
            defaultValue: 'Team Members',
          })}
          description={t('reviewTeams.detail.membersDescription', {
            defaultValue:
              'Click a member to inspect its role, responsibilities, and model. Locked roles always stay in the team.',
          })}
          extra={(
            <div className="review-team-page__section-badges">
              <Badge variant="info">
                {t('reviewTeams.detail.lockedCount', {
                  count: team.coreMembers.length,
                  defaultValue: `${team.coreMembers.length} locked roles`,
                })}
              </Badge>
              <Badge variant="neutral">
                {t('reviewTeams.detail.extraCount', {
                  count: team.extraMembers.length,
                  defaultValue: `${team.extraMembers.length} extra Sub-Agents`,
                })}
              </Badge>
            </div>
          )}
        >
          <div className="review-team-page__member-grid">
            {team.members.map((member) => {
              const MemberIcon = getMemberIcon(member);
              const isSelected = selectedMember?.id === member.id;

              return (
                <button
                  key={member.id}
                  type="button"
                  className={`review-team-page__member-card${isSelected ? ' is-selected' : ''}`}
                  style={{ '--member-accent': member.accentColor || DEFAULT_MEMBER_ACCENT } as React.CSSProperties}
                  onClick={() => setSelectedMemberId(member.id)}
                >
                  <div className="review-team-page__member-card-icon">
                    <MemberIcon size={16} strokeWidth={1.9} />
                  </div>

                  <div className="review-team-page__member-card-body">
                    <div className="review-team-page__member-card-top">
                      <span className="review-team-page__member-card-name">
                        {getLocalizedMemberName(member)}
                      </span>
                      <div className="review-team-page__member-card-badges">
                        {member.locked ? (
                          <Badge variant="neutral">
                            <Lock size={10} />
                            {t('reviewTeams.detail.memberTypes.locked', {
                              defaultValue: 'Locked',
                            })}
                          </Badge>
                        ) : (
                          <Badge variant="info">
                            {t('reviewTeams.detail.memberTypes.extra', {
                              defaultValue: 'Extra Sub-Agent',
                            })}
                          </Badge>
                        )}
                        <Badge variant={getSourceVariant(member.subagentSource)}>
                          {t(`reviewTeams.detail.memberTypes.${member.subagentSource ?? 'builtin'}`, {
                            defaultValue: member.subagentSource ?? 'builtin',
                          })}
                        </Badge>
                        <Badge variant={member.strategySource === 'member' ? 'info' : 'neutral'}>
                          {getStrategyLabel(member.strategyLevel)}
                        </Badge>
                      </div>
                    </div>

                    <span className="review-team-page__member-card-role">
                      {getLocalizedMemberRole(member)}
                    </span>
                    <p className="review-team-page__member-card-description">
                      {getLocalizedMemberDescription(member)}
                    </p>
                    <span className="review-team-page__member-card-model">
                      {formatModelLabel(member.model)}
                      {member.modelFallbackReason ? (
                        <span className="review-team-page__member-card-model-note">
                          {t('reviewTeams.strategy.modelFallbackShort', {
                            defaultValue: 'fallback',
                          })}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </ConfigPageSection>

        {selectedMember ? (
          <ConfigPageSection
            title={t('reviewTeams.detail.memberDetailTitle', {
              defaultValue: 'Member Detail',
            })}
            description={t('reviewTeams.detail.memberDetailDescription', {
              defaultValue:
                'The selected reviewer keeps an isolated context when the code review team runs.',
            })}
          >
            <div className="review-team-page__detail-hero">
              <div
                className="review-team-page__detail-icon"
                style={{ '--member-accent': selectedMember.accentColor || DEFAULT_MEMBER_ACCENT } as React.CSSProperties}
              >
                <SelectedIcon size={18} strokeWidth={1.9} />
              </div>

              <div className="review-team-page__detail-copy">
                <div className="review-team-page__detail-title-row">
                  <div>
                    <h3 className="review-team-page__detail-name">
                      {getLocalizedMemberName(selectedMember)}
                    </h3>
                    <p className="review-team-page__detail-role">
                      {getLocalizedMemberRole(selectedMember)}
                    </p>
                  </div>

                  <div className="review-team-page__detail-badges">
                    <Badge variant="accent">{formatModelLabel(selectedMember.model)}</Badge>
                    <Badge variant={selectedMember.strategySource === 'member' ? 'info' : 'neutral'}>
                      {getStrategyLabel(selectedMember.strategyLevel)}
                    </Badge>
                    {selectedMember.modelFallbackReason ? (
                      <Badge variant="neutral">
                        {t('reviewTeams.strategy.modelFallbackShort', {
                          defaultValue: 'fallback',
                        })}
                      </Badge>
                    ) : null}
                    {selectedMember.locked ? (
                      <Badge variant="neutral">
                        {t('reviewTeams.detail.memberTypes.core', {
                          defaultValue: 'Core role',
                        })}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <p className="review-team-page__detail-description">
                  {getLocalizedMemberDescription(selectedMember)}
                </p>
              </div>
            </div>

            <div className="review-team-page__responsibilities">
              <span className="review-team-page__block-label">
                {t('reviewTeams.detail.responsibilities', {
                  defaultValue: 'Responsibilities',
                })}
              </span>
              <ul className="review-team-page__responsibility-list">
                {selectedResponsibilities.map((item) => (
                  <li key={item} className="review-team-page__responsibility-item">
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <ConfigPageRow
              label={t('reviewTeams.strategy.memberTitle', {
                defaultValue: 'Reviewer strategy',
              })}
              description={t('reviewTeams.strategy.memberDescription', {
                defaultValue:
                  'Override this reviewer only when a role needs a different depth from the team default.',
              })}
              multiline
            >
              <div className="review-team-page__strategy-options review-team-page__strategy-options--compact">
                {MEMBER_STRATEGY_OPTIONS.map((level) => {
                  const isSelected = selectedMember.strategyOverride === level;
                  const effectiveLevel = level === DEFAULT_REVIEW_MEMBER_STRATEGY_LEVEL
                    ? team.strategyLevel
                    : level;

                  return (
                    <button
                      key={level}
                      type="button"
                      className={`review-team-page__strategy-option${isSelected ? ' is-selected' : ''}`}
                      aria-pressed={isSelected}
                      disabled={savingStrategyTarget === `member:${selectedMember.id}`}
                      onClick={() => void handleMemberStrategyChange(selectedMember, level)}
                    >
                      <span className="review-team-page__strategy-option-title">
                        {getMemberStrategyOptionLabel(level)}
                      </span>
                      <span className="review-team-page__strategy-option-summary">
                        {getMemberStrategyOptionSummary(level, selectedMember)}
                      </span>
                      <span className="review-team-page__strategy-option-impact">
                        {getStrategyImpact(effectiveLevel)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ConfigPageRow>

            <ConfigPageRow
              label={t('reviewTeams.detail.model', {
                defaultValue: 'Assigned model',
              })}
              description={t('reviewTeams.detail.modelDescription', {
                defaultValue:
                  'Change the model for this reviewer only. Primary/Fast aliases follow the active strategy, while a concrete custom model is kept when available.',
              })}
              multiline
            >
              <div className="review-team-page__model-picker">
                {selectedMember.modelFallbackReason ? (
                  <p className="review-team-page__model-fallback-note">
                    {t('reviewTeams.strategy.modelFallbackDescription', {
                      configuredModel: selectedMember.configuredModel,
                      model: formatModelLabel(selectedMember.model),
                      defaultValue:
                        `The configured model ${selectedMember.configuredModel} is no longer available, so this reviewer will use ${formatModelLabel(selectedMember.model)}.`,
                    })}
                  </p>
                ) : null}
                <ModelSelectionRadio
                  value={selectedMember.model || DEFAULT_REVIEW_TEAM_MODEL}
                  models={models}
                  layout="vertical"
                  size="small"
                  disabled={savingMemberId === selectedMember.id}
                  onChange={(modelId) => void handleModelChange(selectedMember, modelId)}
                />
              </div>
            </ConfigPageRow>

            {!selectedMember.locked ? (
              <ConfigPageRow
                label={t('reviewTeams.detail.remove', {
                  defaultValue: 'Remove member',
                })}
                description={t('reviewTeams.detail.removeDescription', {
                  defaultValue:
                    'Remove this extra Sub-Agent from the code review team. Core roles cannot be removed.',
                })}
                align="center"
                balanced
              >
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => void handleRemoveMember(selectedMember)}
                  disabled={removingMemberId === selectedMember.id}
                >
                  <Trash2 size={12} style={{ marginRight: 6 }} />
                  {t('reviewTeams.detail.remove', {
                    defaultValue: 'Remove member',
                  })}
                </Button>
              </ConfigPageRow>
            ) : null}
          </ConfigPageSection>
        ) : null}

        <ConfigPageSection
          title={t('reviewTeams.detail.addTitle', {
            defaultValue: 'Add Extra Sub-Agent',
          })}
          description={t('reviewTeams.detail.addDescription', {
            defaultValue:
              'Bring another read-only Sub-Agent into the deep code review team. The four core roles always remain locked in place.',
          })}
        >
          <ConfigPageRow
            label={t('reviewTeams.detail.addLabel', {
              defaultValue: 'Candidate',
            })}
            description={t('reviewTeams.detail.addHint', {
              defaultValue:
                'Only read-only Sub-Agents can join the initial review pass; the quality inspector checks every extra reviewer before final reporting.',
            })}
            multiline
          >
            <div className="review-team-page__add-controls">
              <Select
                value={candidateId}
                onChange={(value) => {
                  if (Array.isArray(value)) {
                    setCandidateId(String(value[0] || ''));
                    return;
                  }
                  setCandidateId(String(value));
                }}
                size="small"
                disabled={extraCandidates.length === 0 || addingMember}
                placeholder={t('reviewTeams.detail.addPlaceholder', {
                  defaultValue: 'Select a Sub-Agent',
                })}
                options={extraCandidates.map((candidate) => ({
                  value: candidate.id,
                  label: `${candidate.name} · ${t(`reviewTeams.detail.memberTypes.${candidate.subagentSource ?? 'builtin'}`, {
                    defaultValue: candidate.subagentSource ?? 'builtin',
                  })}`,
                }))}
              />

              <Button
                variant="primary"
                size="small"
                onClick={() => void handleAddMember()}
                disabled={!candidateId || extraCandidates.length === 0 || addingMember}
              >
                <Plus size={12} style={{ marginRight: 6 }} />
                {t('reviewTeams.detail.addButton', {
                  defaultValue: 'Add to team',
                })}
              </Button>
            </div>

            {extraCandidates.length === 0 ? (
              <p className="review-team-page__empty-candidate">
                <Sparkles size={14} />
                <span>
                  {t('reviewTeams.detail.emptyCandidates', {
                    defaultValue: 'No additional read-only Sub-Agents are available to add right now.',
                  })}
                </span>
              </p>
            ) : null}
          </ConfigPageRow>
        </ConfigPageSection>
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export { ReviewTeamErrorBoundary };
export default ReviewTeamPage;
