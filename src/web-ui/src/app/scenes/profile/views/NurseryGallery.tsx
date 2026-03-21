import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Egg, Settings, Star, Wrench, BarChart2 } from 'lucide-react';
import {
  GalleryLayout,
  GalleryPageHeader,
  GalleryZone,
  GalleryGrid,
} from '@/app/components';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { configAPI } from '@/infrastructure/api/service-api/ConfigAPI';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import type { AIModelConfig } from '@/infrastructure/config/types';
import { createLogger } from '@/shared/utils/logger';
import AssistantCard from './AssistantCard';
import { useNurseryStore } from '../nurseryStore';
import { estimateTokens, formatTokenCount } from './useTokenEstimate';

const log = createLogger('NurseryGallery');

interface TemplateStats {
  primaryModelName: string;
  fastModelName: string;
  enabledToolCount: number;
}

const NurseryGallery: React.FC = () => {
  const { t } = useTranslation('scenes/profile');
  const { assistantWorkspacesList, createAssistantWorkspace } = useWorkspaceContext();
  const { openTemplate, openAssistant } = useNurseryStore();
  const [creating, setCreating] = useState(false);
  const [templateStats, setTemplateStats] = useState<TemplateStats | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [allModels, funcModels, modeConf] = await Promise.all([
          configManager.getConfig<AIModelConfig[]>('ai.models').catch(() => [] as AIModelConfig[]),
          configManager.getConfig<Record<string, string>>('ai.func_agent_models').catch(() => ({} as Record<string, string>)),
          configAPI.getModeConfig('agentic').catch(() => null),
        ]);
        const models = allModels ?? [];
        const fm = funcModels ?? {};

        const resolveModelName = (slotId: string, fallback: string): string => {
          const id = fm[slotId] ?? '';
          if (!id || id === slotId) return fallback;
          const found = models.find((m) => m.id === id && m.enabled);
          return found?.name ?? fallback;
        };

        setTemplateStats({
          primaryModelName: resolveModelName('primary', t('nursery.template.stats.primaryDefault')),
          fastModelName: resolveModelName('fast', t('nursery.template.stats.fastDefault')),
          enabledToolCount: modeConf?.available_tools?.length ?? 0,
        });
      } catch (e) {
        log.error('Failed to load template stats', e);
      }
    })();
  }, [t]);

  const tokenBreakdown = useMemo(
    () => (templateStats ? estimateTokens('', templateStats.enabledToolCount, 0, 0) : null),
    [templateStats],
  );

  const handleCreateAssistant = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const newWorkspace = await createAssistantWorkspace();
      openAssistant(newWorkspace.id);
    } catch (e) {
      log.error('Failed to create assistant workspace', e);
    } finally {
      setCreating(false);
    }
  }, [creating, createAssistantWorkspace, openAssistant]);

  return (
    <GalleryLayout className="nursery-gallery">
      <GalleryPageHeader
        title={t('nursery.gallery.title')}
        subtitle={t('nursery.gallery.subtitle')}
        actions={(
          <button
            type="button"
            className="gallery-action-btn gallery-action-btn--primary"
            onClick={handleCreateAssistant}
            disabled={creating}
          >
            <Plus size={15} />
            <span>{t('nursery.gallery.newAssistant')}</span>
          </button>
        )}
      />

      {/* Template hero: panda + card side by side, bottom-aligned */}
      <div className="nursery-template-hero">
        {/* Panda — hover independently, no card linkage */}
        <div className="nursery-template-panda">
          <img
            className="nursery-template-panda__img nursery-template-panda__img--default"
            src="/panda_full_1.png"
            alt=""
            onError={(e) => { (e.target as HTMLImageElement).src = '/Logo-ICON.png'; }}
          />
          <img
            className="nursery-template-panda__img nursery-template-panda__img--hover"
            src="/panda_full_2.png"
            alt=""
            onError={(e) => { (e.target as HTMLImageElement).src = '/Logo-ICON.png'; }}
          />
        </div>

        {/* Card */}
        <button
          type="button"
          className="nursery-template-card"
          onClick={openTemplate}
          aria-label={t('nursery.template.title')}
        >
          <div className="nursery-template-card__content">
            <span className="nursery-template-card__tag">{t('nursery.template.tag')}</span>
            <h3 className="nursery-template-card__title">{t('nursery.template.title')}</h3>
            <p className="nursery-template-card__subtitle">{t('nursery.template.subtitle')}</p>

            {/* Key stats */}
            {templateStats && tokenBreakdown && (
              <div className="nursery-template-card__stats">
                <span className="nursery-template-card__stat">
                  <Star size={10} strokeWidth={2} />
                  {templateStats.primaryModelName}
                </span>
                {templateStats.fastModelName !== templateStats.primaryModelName && (
                  <span className="nursery-template-card__stat nursery-template-card__stat--accent">
                    <Star size={10} strokeWidth={1.5} style={{ opacity: 0.7 }} />
                    {templateStats.fastModelName}
                  </span>
                )}
                <span className="nursery-template-card__stat nursery-template-card__stat--muted">
                  <Wrench size={10} strokeWidth={2} />
                  {t('nursery.template.stats.tools', { count: templateStats.enabledToolCount })}
                </span>
                <span className="nursery-template-card__stat nursery-template-card__stat--token">
                  <BarChart2 size={10} strokeWidth={2} />
                  ~{formatTokenCount(tokenBreakdown.total)} tok · {tokenBreakdown.percentage}
                </span>
              </div>
            )}

            <span className="nursery-template-card__action">
              <Settings size={13} strokeWidth={1.8} />
              <span>{t('nursery.template.configure')}</span>
            </span>
          </div>

          {/* Decorative eggs */}
          <div className="nursery-template-card__deco" aria-hidden="true">
            <Egg size={56} strokeWidth={1} className="nursery-template-card__deco-egg nursery-template-card__deco-egg--1" />
            <Egg size={32} strokeWidth={1} className="nursery-template-card__deco-egg nursery-template-card__deco-egg--2" />
          </div>
        </button>
      </div>

      {/* Assistants */}
      <div className="gallery-zones">
        <GalleryZone
          id="nursery-assistants-zone"
          title={t('nursery.gallery.assistantsTitle')}
          subtitle={t('nursery.gallery.assistantsSubtitle')}
          tools={(
            <span className="gallery-zone-count">{assistantWorkspacesList.length}</span>
          )}
        >
          <GalleryGrid minCardWidth={260}>
            {assistantWorkspacesList.map((workspace, i) => (
              <AssistantCard
                key={workspace.id}
                workspace={workspace}
                onClick={() => openAssistant(workspace.id)}
                style={{ '--card-index': i } as React.CSSProperties}
              />
            ))}
          </GalleryGrid>
        </GalleryZone>
      </div>
    </GalleryLayout>
  );
};

export default NurseryGallery;
