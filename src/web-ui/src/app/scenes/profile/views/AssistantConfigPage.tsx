import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, RefreshCw, Zap, Star, Wrench, Puzzle, ListChecks, Smile, Radar,
} from 'lucide-react';
import {
  ConfirmDialog, Input, Select, Switch, type SelectOption,
} from '@/component-library';
import { Tabs, TabPane } from '@/component-library';
import { AIRulesAPI, RuleLevel, type AIRule } from '@/infrastructure/api/service-api/AIRulesAPI';
import { getAllMemories, type AIMemory } from '@/infrastructure/api/aiMemoryApi';
import { configAPI } from '@/infrastructure/api/service-api/ConfigAPI';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import type { AIModelConfig, ModeConfigItem, SkillInfo } from '@/infrastructure/config/types';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { useAgentIdentityDocument } from '@/app/scenes/my-agent/useAgentIdentityDocument';
import { MEditor } from '@/tools/editor/meditor';
import { PersonaRadar } from './PersonaRadar';
import { useNurseryStore } from '../nurseryStore';
import { useTokenEstimate, formatTokenCount } from './useTokenEstimate';

const log = createLogger('AssistantConfigPage');

interface ToolInfo { name: string; description: string; is_readonly: boolean; }

const MODEL_SLOTS = ['primary', 'fast'] as const;
type ModelSlot = typeof MODEL_SLOTS[number];

const DEFAULT_AGENT_NAME = 'BitFun Agent';

// ── Radar dim computation (same formula as original PersonaView L894-902) ──────
function computeRadarDims(
  rules: AIRule[],
  memories: AIMemory[],
  agenticConfig: ModeConfigItem | null,
  skills: SkillInfo[],
  t: (k: string) => string,
) {
  const skillEn  = skills.filter((s) => s.enabled);
  const memEn    = memories.filter((m) => m.enabled).length;
  const rulesEn  = rules.filter((r) => r.enabled);
  const avgImp   = memEn > 0
    ? memories.filter((m) => m.enabled).reduce((s, m) => s + m.importance, 0) / memEn
    : 0;
  const enabledTools = agenticConfig?.available_tools?.length ?? 0;

  return [
    { label: t('radar.dims.creativity'),   value: Math.min(10, skillEn.length * 0.9) },
    { label: t('radar.dims.rigor'),        value: Math.min(10, rulesEn.length * 1.5) },
    { label: t('radar.dims.autonomy'),     value: agenticConfig?.enabled
      ? Math.min(10, 4 + enabledTools * 0.25)
      : Math.min(10, enabledTools * 0.3) },
    { label: t('radar.dims.memory'),       value: Math.min(10, memEn * 0.7 + avgImp * 0.3) },
    { label: t('radar.dims.expression'),   value: Math.min(10, skillEn.length * 0.8 + skillEn.length * 0.4) },
    { label: t('radar.dims.adaptability'), value: Math.min(10, skillEn.length * 1.2) },
  ];
}

const AssistantConfigPage: React.FC = () => {
  const { t } = useTranslation('scenes/profile');
  const { openGallery, activeWorkspaceId } = useNurseryStore();
  const { assistantWorkspacesList } = useWorkspaceContext();

  const workspace = useMemo(
    () => assistantWorkspacesList.find((w) => w.id === activeWorkspaceId) ?? null,
    [assistantWorkspacesList, activeWorkspaceId],
  );
  const workspacePath = workspace?.rootPath ?? '';

  const {
    document: identityDocument,
    updateField: updateIdentityField,
    resetPersonaFiles,
    loading: identityLoading,
  } = useAgentIdentityDocument(workspacePath);

  // ── Identity edit state ────────────────────────────────────────────────────
  const [editingField, setEditingField] = useState<'name' | 'emoji' | 'creature' | 'vibe' | null>(null);
  const [editValue, setEditValue] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const metaInputRef = useRef<HTMLInputElement>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);

  // ── Capability state ───────────────────────────────────────────────────────
  const [models, setModels] = useState<AIModelConfig[]>([]);
  const [, setFuncAgentModels] = useState<Record<string, string>>({});
  const [agenticConfig, setAgenticConfig] = useState<ModeConfigItem | null>(null);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [toolsLoading, setToolsLoading] = useState<Record<string, boolean>>({});

  // ── Memory state ───────────────────────────────────────────────────────────
  const [rules, setRules] = useState<AIRule[]>([]);
  const [memories, setMemories] = useState<AIMemory[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [capsLoaded, setCapsLoaded] = useState(false);
  const [memLoaded, setMemLoaded] = useState(false);

  // ── Active tab ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('identity');

  // ── Body edit debounce ─────────────────────────────────────────────────────
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBodyChange = useCallback((newBody: string) => {
    if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
    bodyTimerRef.current = setTimeout(() => updateIdentityField('body', newBody), 600);
  }, [updateIdentityField]);

  // Load models/tools/skills on first visit to personality or ability tab
  useEffect(() => {
    if ((activeTab === 'personality' || activeTab === 'ability') && !capsLoaded) {
      (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const [allModels, funcModels, modeConf, tools, sks] = await Promise.all([
            (configManager.getConfig<AIModelConfig[]>('ai.models')).catch(() => [] as AIModelConfig[]),
            (configManager.getConfig<Record<string, string>>('ai.func_agent_models')).catch(() => ({} as Record<string, string>)),
            configAPI.getModeConfig('agentic').catch(() => null as ModeConfigItem | null),
            invoke<ToolInfo[]>('get_all_tools_info').catch(() => [] as ToolInfo[]),
            configAPI.getSkillConfigs({ workspacePath: workspacePath || undefined }).catch(() => [] as SkillInfo[]),
          ]);
          setModels(allModels ?? []);
          setFuncAgentModels(funcModels ?? {});
          setAgenticConfig(modeConf);
          setAvailableTools(tools);
          setSkills(sks);
          setCapsLoaded(true);
        } catch (e) { log.error('caps load', e); }
      })();
    }
  }, [activeTab, capsLoaded, workspacePath]);

  // Load rules and memories on first visit to personality or memory tab
  useEffect(() => {
    if ((activeTab === 'personality' || activeTab === 'memory') && !memLoaded) {
      (async () => {
        try {
          const [u, p, m] = await Promise.all([
            AIRulesAPI.getRules(RuleLevel.User),
            AIRulesAPI.getRules(RuleLevel.Project, workspacePath || undefined),
            getAllMemories(),
          ]);
          setRules([...u, ...p]);
          setMemories(m);
          setMemLoaded(true);
        } catch (e) { log.error('memory/rules load', e); }
      })();
    }
  }, [activeTab, memLoaded, workspacePath]);

  // ── Identity edit helpers ──────────────────────────────────────────────────
  const startEdit = useCallback((field: 'name' | 'emoji' | 'creature' | 'vibe') => {
    setEditingField(field);
    setEditValue(field === 'name' ? identityDocument.name : identityDocument[field as keyof typeof identityDocument] as string);
    setTimeout(() => {
      (field === 'name' ? nameInputRef : metaInputRef).current?.focus();
    }, 10);
  }, [identityDocument]);

  const commitEdit = useCallback(() => {
    if (!editingField) return;
    updateIdentityField(editingField, editValue.trim());
    setEditingField(null);
  }, [editingField, editValue, updateIdentityField]);

  const onEditKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditingField(null);
  }, [commitEdit]);

  // ── Model helpers ──────────────────────────────────────────────────────────
  const INHERIT_VALUE = '__inherit__';

  const buildModelOptions = useCallback((slot: ModelSlot): SelectOption[] => {
    const inheritLabel = slot === 'primary' ? t('nursery.assistant.inheritPrimary') : t('nursery.assistant.inheritFast');
    const modelOptions: SelectOption[] = models
      .filter((m) => m.enabled && !!m.id)
      .map((m) => ({ value: m.id!, label: m.name, group: t('modelGroups.models') }));
    return [
      { value: INHERIT_VALUE, label: inheritLabel, group: t('nursery.assistant.inheritGroup') },
      ...modelOptions,
    ];
  }, [models, t]);

  const getModelValue = useCallback((slot: ModelSlot): string => {
    const override = slot === 'primary' ? identityDocument.modelPrimary : identityDocument.modelFast;
    return override || INHERIT_VALUE;
  }, [identityDocument]);

  const handleModelChange = useCallback(async (slot: ModelSlot, raw: string | number | (string | number)[]) => {
    if (Array.isArray(raw)) return;
    const val = String(raw) === INHERIT_VALUE ? '' : String(raw);
    updateIdentityField(slot === 'primary' ? 'modelPrimary' : 'modelFast', val);
  }, [updateIdentityField]);

  // ── Tool helpers ───────────────────────────────────────────────────────────
  const handleToolToggle = useCallback(async (toolName: string) => {
    if (!agenticConfig) return;
    setToolsLoading((p) => ({ ...p, [toolName]: true }));
    const current = agenticConfig.available_tools ?? [];
    const isOn = current.includes(toolName);
    const newTools = isOn ? current.filter((n) => n !== toolName) : [...current, toolName];
    const newConf = { ...agenticConfig, available_tools: newTools };
    setAgenticConfig(newConf);
    try {
      await configAPI.setModeConfig('agentic', newConf);
      const { globalEventBus } = await import('@/infrastructure/event-bus');
      globalEventBus.emit('mode:config:updated');
    } catch (e) {
      log.error('tool toggle', e);
      notificationService.error(t('notifications.toggleFailed'));
      setAgenticConfig(agenticConfig);
    } finally {
      setToolsLoading((p) => ({ ...p, [toolName]: false }));
    }
  }, [agenticConfig, t]);

  // ── Radar ──────────────────────────────────────────────────────────────────
  const radarDims = useMemo(
    () => computeRadarDims(rules, memories, agenticConfig, skills, t),
    [rules, memories, agenticConfig, skills, t],
  );

  // ── Token estimate ─────────────────────────────────────────────────────────
  const enabledToolCount = agenticConfig?.available_tools?.length ?? 0;
  const enabledRulesCount = rules.filter((r) => r.enabled).length;
  const enabledMemCount   = memories.filter((m) => m.enabled).length;
  const tokenBreakdown = useTokenEstimate(
    identityDocument.body,
    enabledToolCount,
    enabledRulesCount,
    enabledMemCount,
  );

  const identityName = identityDocument.name || DEFAULT_AGENT_NAME;

  const metaItems = useMemo(() => [
    { key: 'emoji'    as const, label: t('identity.emoji'),    value: identityDocument.emoji,   placeholder: t('identity.emojiPlaceholder') },
    { key: 'creature' as const, label: t('identity.creature'), value: identityDocument.creature, placeholder: t('identity.creaturePlaceholderShort') },
    { key: 'vibe'     as const, label: t('identity.vibe'),     value: identityDocument.vibe,    placeholder: t('identity.vibePlaceholderShort') },
  ] as const, [identityDocument.emoji, identityDocument.creature, identityDocument.vibe, t]);

  return (
    <div className="nursery-page">
      <div className="nursery-page__bar">
        <button type="button" className="nursery-page__back" onClick={openGallery}>
          <ArrowLeft size={14} />
          <span>{t('nursery.backToGallery')}</span>
        </button>
        <h2 className="nursery-page__title">
          {identityDocument.emoji && <span>{identityDocument.emoji} </span>}
          {identityName}
        </h2>
        {identityDocument.creature && (
          <span className="nursery-page__subtitle">{identityDocument.creature}</span>
        )}
        <button
          type="button"
          className="nursery-page__reset"
          title={t('identity.resetTooltip')}
          onClick={() => setIsResetDialogOpen(true)}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="nursery-page__body">
      <Tabs
        type="line"
        size="small"
        activeKey={activeTab}
        onChange={setActiveTab}
        className="nursery-tabs"
      >
        {/* Identity tab */}
        <TabPane tabKey="identity" label={t('nursery.tabs.identity')} icon={<Smile size={13} />}>
          <div className="nursery-tab-content">
            {identityLoading ? (
              <div className="nursery-page__loading"><RefreshCw size={16} className="nursery-spinning" /></div>
            ) : (
              <>
                {/* Name row */}
                <div className="nursery-identity__name-row">
                  {editingField === 'name' ? (
                    <Input
                      ref={nameInputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={onEditKey}
                      className="nursery-identity__name-input"
                    />
                  ) : (
                    <h3
                      className="nursery-identity__name"
                      onClick={() => startEdit('name')}
                      title={t('hero.editNameTitle')}
                    >
                      {identityName}
                    </h3>
                  )}
                </div>

                {/* Meta pills */}
                <div className="nursery-identity__meta-row">
                  {metaItems.map((item) => (
                    <div key={item.key} className="nursery-identity__meta-pill">
                      <span className="nursery-identity__meta-label">{item.label}</span>
                      {editingField === item.key ? (
                        <Input
                          ref={metaInputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={onEditKey}
                          size="small"
                        />
                      ) : (
                        <span
                          className={`nursery-identity__meta-value${!item.value ? ' is-empty' : ''}`}
                          onClick={() => startEdit(item.key)}
                        >
                          {item.value || item.placeholder}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Body editor */}
                <div className="nursery-identity__body">
                  <MEditor
                    value={identityDocument.body}
                    onChange={handleBodyChange}
                    mode="ir"
                  />
                </div>
              </>
            )}
          </div>
        </TabPane>

        {/* Personality tab */}
        <TabPane tabKey="personality" label={t('nursery.tabs.personality')} icon={<Radar size={13} />}>
          <div className="nursery-tab-content nursery-tab-content--centered">
            <PersonaRadar dims={radarDims} size={240} />
            <div className="nursery-radar__dims">
              {radarDims.map((d) => (
                <div key={d.label} className="nursery-radar__dim-row">
                  <span className="nursery-radar__dim-label">{d.label}</span>
                  <div className="nursery-radar__dim-bar">
                    <div
                      className="nursery-radar__dim-fill"
                      style={{ width: `${(d.value / 10) * 100}%` }}
                    />
                  </div>
                  <span className="nursery-radar__dim-val">{d.value.toFixed(1)}</span>
                </div>
              ))}
            </div>
            <p className="nursery-radar__hint">{t('radar.subtitle')}</p>
          </div>
        </TabPane>

        {/* Ability tab */}
        <TabPane tabKey="ability" label={t('nursery.tabs.ability')} icon={<Wrench size={13} />}>
          <div className="nursery-tab-content">
            {/* Model overrides */}
            <section className="nursery-section">
              <div className="nursery-section__head">
                <Star size={13} />
                <span className="nursery-section__title">{t('cards.model')}</span>
              </div>
              <div className="nursery-model-grid">
                {MODEL_SLOTS.map((slot) => {
                  const Icon = slot === 'primary' ? Star : Zap;
                  return (
                    <div key={slot} className="nursery-model-cell">
                      <div className="nursery-model-cell__meta">
                        <Icon size={13} />
                        <span className="nursery-model-cell__label">
                          {t(`modelSlots.${slot}.label`)}
                        </span>
                      </div>
                      <Select
                        size="small"
                        options={buildModelOptions(slot)}
                        value={getModelValue(slot)}
                        onChange={(v) => handleModelChange(slot, v)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Token breakdown */}
            <section className="nursery-section">
              <div className="nursery-section__head">
                <span className="nursery-section__title">{t('nursery.template.tokenTitle')}</span>
              </div>
              <div className="nursery-token-breakdown">
                <div className="nursery-token-row">
                  <span>{t('nursery.template.tokenSystemPrompt')}</span>
                  <span>~{formatTokenCount(tokenBreakdown.systemPrompt)} tok</span>
                </div>
                <div className="nursery-token-row">
                  <span>{t('nursery.template.tokenToolInjection')}</span>
                  <span>~{formatTokenCount(tokenBreakdown.toolInjection)} tok</span>
                </div>
                <div className="nursery-token-row">
                  <span>{t('nursery.template.tokenRules')} ({enabledRulesCount})</span>
                  <span>~{formatTokenCount(tokenBreakdown.rules)} tok</span>
                </div>
                <div className="nursery-token-row">
                  <span>{t('nursery.template.tokenMemories')} ({enabledMemCount})</span>
                  <span>~{formatTokenCount(tokenBreakdown.memories)} tok</span>
                </div>
                <div className="nursery-token-row nursery-token-row--total">
                  <span>{t('nursery.template.tokenTotal')}</span>
                  <span>~{formatTokenCount(tokenBreakdown.total)} tok ({tokenBreakdown.percentage})</span>
                </div>
                <div className="nursery-token-bar">
                  <div
                    className="nursery-token-bar__fill"
                    style={{ width: `${Math.min(100, (tokenBreakdown.total / tokenBreakdown.contextWindowSize) * 100)}%` }}
                  />
                </div>
              </div>
            </section>

            {/* Tools */}
            <section className="nursery-section">
              <div className="nursery-section__head">
                <Wrench size={13} />
                <span className="nursery-section__title">{t('cards.toolsMcp')}</span>
                <span className="nursery-section__count">
                  {enabledToolCount}/{availableTools.length}
                </span>
              </div>
              <div className="nursery-tool-list">
                {availableTools.map((tool) => {
                  const enabled = agenticConfig?.available_tools?.includes(tool.name) ?? false;
                  return (
                    <div key={tool.name} className="nursery-tool-row">
                      <div className="nursery-tool-row__meta">
                        <span className="nursery-tool-row__name">{tool.name}</span>
                        <span className="nursery-tool-row__desc">{tool.description}</span>
                      </div>
                      <Switch
                        size="small"
                        checked={enabled}
                        loading={toolsLoading[tool.name]}
                        onChange={() => handleToolToggle(tool.name)}
                        aria-label={tool.name}
                      />
                    </div>
                  );
                })}
                {availableTools.length === 0 && (
                  <span className="nursery-empty">{t('empty.tools')}</span>
                )}
              </div>
            </section>
          </div>
        </TabPane>

        {/* Memory tab */}
        <TabPane tabKey="memory" label={t('nursery.tabs.memory')} icon={<ListChecks size={13} />}>
          <div className="nursery-tab-content">
            {/* Rules */}
            <section className="nursery-section">
              <div className="nursery-section__head">
                <ListChecks size={13} />
                <span className="nursery-section__title">{t('cards.rules')}</span>
                <span className="nursery-section__count">
                  {rules.filter((r) => r.enabled).length}/{rules.length}
                </span>
              </div>
              <div className="nursery-rule-list">
                {rules.length === 0 ? (
                  <span className="nursery-empty">{t('empty.rules')}</span>
                ) : (
                  rules.map((rule) => (
                    <div key={`${rule.level}-${rule.name}`} className="nursery-rule-row">
                      <span className="nursery-rule-row__name">{rule.name}</span>
                      <span className="nursery-rule-row__level">
                        {rule.level === RuleLevel.User ? 'user' : 'project'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Skills */}
            <section className="nursery-section">
              <div className="nursery-section__head">
                <Puzzle size={13} />
                <span className="nursery-section__title">{t('cards.skills')}</span>
                <span className="nursery-section__count">
                  {skills.filter((s) => s.enabled).length}/{skills.length}
                </span>
              </div>
              <div className="nursery-skill-grid">
                {skills.length === 0 ? (
                  <span className="nursery-empty">{t('empty.skills')}</span>
                ) : (
                  skills.map((skill) => (
                    <div
                      key={skill.name}
                      className={`nursery-skill-chip${skill.enabled ? ' is-on' : ''}`}
                      title={skill.description}
                    >
                      {skill.name}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </TabPane>
      </Tabs>
      </div>

      <ConfirmDialog
        isOpen={isResetDialogOpen}
        title={t('identity.resetConfirmTitle')}
        message={t('identity.resetConfirmMessage')}
        confirmText={t('identity.resetConfirmAction')}
        cancelText={t('identity.resetCancel')}
        confirmDanger
        onClose={() => setIsResetDialogOpen(false)}
        onConfirm={() => {
          setIsResetDialogOpen(false);
          resetPersonaFiles()
            .then(() => notificationService.success(t('identity.resetSuccess')))
            .catch(() => notificationService.error(t('identity.resetFailed')));
        }}
        onCancel={() => setIsResetDialogOpen(false)}
      />
    </div>
  );
};

export default AssistantConfigPage;
