import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/component-library';
import type { WorkspaceInfo } from '@/shared/types';
import { getCardGradient } from '@/shared/utils/cardGradients';

interface AssistantCardProps {
  workspace: WorkspaceInfo;
  onClick: () => void;
  style?: React.CSSProperties;
}

const AssistantCard: React.FC<AssistantCardProps> = ({ workspace, onClick, style }) => {
  const { t } = useTranslation('scenes/profile');
  const identity = workspace.identity;

  const name = identity?.name?.trim() || workspace.name || t('nursery.card.unnamed');
  const emoji = identity?.emoji?.trim() || '🤖';
  const creature = identity?.creature?.trim() || '';
  const vibe = identity?.vibe?.trim() || '';
  const modelPrimary = identity?.modelPrimary?.trim() || '';
  const modelFast = identity?.modelFast?.trim() || '';

  const gradient = getCardGradient(workspace.id || name);

  return (
    <button
      type="button"
      className="assistant-card"
      onClick={onClick}
      aria-label={name}
      style={{
        ...style,
        '--assistant-card-gradient': gradient,
      } as React.CSSProperties}
    >
      {/* Header: avatar + name + badges */}
      <div className="assistant-card__header">
        <div className="assistant-card__avatar">
          <span className="assistant-card__emoji">{emoji}</span>
        </div>
        <div className="assistant-card__header-info">
          <div className="assistant-card__title-row">
            <span className="assistant-card__name">{name}</span>
          </div>
          <div className="assistant-card__badges">
            {creature && <Badge variant="neutral">{creature}</Badge>}
            {modelPrimary && <Badge variant="accent">{modelPrimary}</Badge>}
            {modelFast && <Badge variant="neutral">{modelFast}</Badge>}
          </div>
        </div>
      </div>

      {/* Body: vibe / description */}
      <div className="assistant-card__body">
        {vibe ? (
          <p className="assistant-card__vibe">{vibe}</p>
        ) : (
          <p className="assistant-card__vibe assistant-card__vibe--empty">
            {t('nursery.card.noVibe')}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="assistant-card__footer">
        <div className="assistant-card__footer-inner">
          <span className="assistant-card__footer-hint">
            {t('nursery.card.configure')}
          </span>
        </div>
      </div>
    </button>
  );
};

export default AssistantCard;
