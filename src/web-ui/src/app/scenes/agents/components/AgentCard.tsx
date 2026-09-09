import React from 'react';
import { Bot, Wrench, Cpu, UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { OverflowText, Icon, StatusPill } from '@openbitfun/ui';
import type { AgentWithCapabilities } from '../agentsStore';
import { AGENT_ICON_MAP } from '../agentsIcons';
import { getAgentBadge, getAgentDescription, getCapabilityLabel } from '../utils';
import './AgentCard.scss';

interface AgentCardProps {
  agent: AgentWithCapabilities;
  index?: number;
  toolCount?: number;
  skillCount?: number;
  subagentCount?: number;
  onOpenDetails: (agent: AgentWithCapabilities) => void;
}

const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  index = 0,
  toolCount,
  skillCount = 0,
  subagentCount = 0,
  onOpenDetails,
}) => {
  const { t } = useTranslation('scenes/agents');
  const badge = getAgentBadge(t, agent.agentKind, agent.source ?? agent.subagentSource);
  const agentIcon = AGENT_ICON_MAP[(agent.iconKey ?? 'bot') as keyof typeof AGENT_ICON_MAP] ?? { glyph: Bot };
  const totalTools = toolCount ?? agent.toolCount ?? agent.defaultTools?.length ?? 0;
  const capabilityCount = agent.capabilities.length;
  const openDetails = () => onOpenDetails(agent);

  return (
    <div data-overflow-trigger data-openbitfun-component="agent-card" data-openbitfun-part="root"
      className="agent-card"
      style={{
        '--surface-stagger-index': index,
      } as React.CSSProperties}
      onClick={openDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDetails();
        }
      }}
      aria-label={agent.name}
      data-testid="agent-list-item"
      data-agent-id={agent.id}
      data-agent-name={agent.name}
      data-agent-kind={agent.agentKind}
      data-subagent-source={agent.subagentSource ?? ''}
    >
      <div className="agent-card__icon-area" data-openbitfun-component="agent-card" data-openbitfun-part="iconArea">
        <div className="agent-card__icon-tile">
          <div className="agent-card__icon" data-openbitfun-component="agent-card" data-openbitfun-part="icon">
            <Icon {...agentIcon} size="lg" />
          </div>
        </div>
        <span className="agent-card__dot-field" aria-hidden="true" />
      </div>

      <div className="agent-card__content">
        <div className="agent-card__header" data-openbitfun-component="agent-card" data-openbitfun-part="header">
          <div className="agent-card__header-info" data-openbitfun-component="agent-card" data-openbitfun-part="headerInfo">
            <div className="agent-card__title-row" data-openbitfun-component="agent-card" data-openbitfun-part="titleRow">
              <OverflowText className="agent-card__name" data-openbitfun-component="agent-card" data-openbitfun-part="name" data-testid="agent-list-item-title">{agent.name}</OverflowText>
            </div>
            <div className="agent-card__cap-chips" data-openbitfun-component="agent-card" data-openbitfun-part="capabilities">
              {agent.capabilities.slice(0, 2).map((cap) => (
                <span
                  key={cap.category}
                  className="agent-card__cap-chip"
                >
                  {getCapabilityLabel(t, cap.category)}
                </span>
              ))}
            </div>
          </div>
          <div className="agent-card__badges" data-openbitfun-component="agent-card" data-openbitfun-part="badges">
            <StatusPill tone={badge.variant} className="agent-card__kind-badge">
              {badge.label}
            </StatusPill>
          </div>
        </div>

        <div className="agent-card__body" data-openbitfun-component="agent-card" data-openbitfun-part="body">
          <OverflowText as="p" lines={2} className="agent-card__desc" data-openbitfun-component="agent-card" data-openbitfun-part="description" data-testid="agent-list-item-description">
            {getAgentDescription(t, agent)}
          </OverflowText>
        </div>

        <div className="agent-card__footer" data-openbitfun-component="agent-card" data-openbitfun-part="footer">
          <div className="agent-card__meta" data-openbitfun-component="agent-card" data-openbitfun-part="meta">
            <span className="agent-card__meta-item">
              <span className="agent-card__meta-icon"><Icon glyph={Wrench} size="xs" /></span>
              <OverflowText className="agent-card__meta-label">{t('agentCard.metrics.tools')}</OverflowText>
              <strong><OverflowText>{totalTools}</OverflowText></strong>
            </span>
            {agent.agentKind === 'mode' ? (
              <>
                <span className="agent-card__meta-item">
                  <span className="agent-card__meta-icon"><Icon name="extension" size="xs" /></span>
                  <OverflowText className="agent-card__meta-label">{t('agentCard.metrics.skills')}</OverflowText>
                  <strong><OverflowText>{skillCount}</OverflowText></strong>
                </span>
                <span className="agent-card__meta-item">
                  <span className="agent-card__meta-icon"><Icon glyph={UsersRound} size="xs" /></span>
                  <OverflowText className="agent-card__meta-label">{t('agentCard.metrics.collaboration')}</OverflowText>
                  <strong><OverflowText>{subagentCount}</OverflowText></strong>
                </span>
              </>
            ) : (
              <span className="agent-card__meta-item">
                <span className="agent-card__meta-icon"><Icon name="spark" size="2xs" /></span>
                <OverflowText className="agent-card__meta-label">{t('agentCard.metrics.capabilities')}</OverflowText>
                <strong><OverflowText>{capabilityCount}</OverflowText></strong>
              </span>
            )}
            {agent.agentKind === 'subagent' && agent.subagentModelDisplayName ? (
              <span className="agent-card__meta-item">
                <span className="agent-card__meta-icon"><Icon glyph={Cpu} size="xs" /></span>
                <OverflowText className="agent-card__meta-label">{t('agentCard.metrics.model')}</OverflowText>
                <strong className="agent-card__meta-value--text" title={agent.subagentModelDisplayName}><OverflowText>
                  {agent.subagentModelDisplayName}
                </OverflowText></strong>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentCard;
