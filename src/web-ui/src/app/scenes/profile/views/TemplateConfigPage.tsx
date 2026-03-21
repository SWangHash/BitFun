import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ChevronDown,
  Cpu,
  Plug2,
  Puzzle,
  RefreshCw,
  Star,
  Wrench,
  Zap,
} from 'lucide-react';
import { Select, Switch, type SelectOption } from '@/component-library';
import { configAPI } from '@/infrastructure/api/service-api/ConfigAPI';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import type { AIModelConfig, ModeConfigItem, SkillInfo } from '@/infrastructure/config/types';
import { MCPAPI, type MCPServerInfo } from '@/infrastructure/api/service-api/MCPAPI';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { useNurseryStore } from '../nurseryStore';
import { formatTokenCount } from './useTokenEstimate';

const log = createLogger('TemplateConfigPage');

interface ToolInfo { name: string; description: string; is_readonly: boolean; }

const MODEL_SLOTS = ['primary', 'fast'] as const;
type ModelSlot = typeof MODEL_SLOTS[number];

// MCP tools are registered as "mcp_{server_id}_{tool_name}" (single underscores)
function isMcpTool(name: string): boolean {
  return name.startsWith('mcp_');
}

// Extract server id: "mcp_github_create_issue" → "github"
function getMcpServerName(toolName: string): string {
  return toolName.split('_')[1] ?? toolName;
}

// Short display name: "mcp_github_create_issue" → "create_issue"
function getMcpShortName(toolName: string): string {
  const parts = toolName.split('_');
  return parts.slice(2).join('_') || toolName;
}

type CtxSegKey = 'systemPrompt' | 'toolInjection' | 'rules' | 'memories';

const CTX_SEGMENT_ORDER: readonly CtxSegKey[] = ['systemPrompt', 'toolInjection', 'rules', 'memories'];

const CTX_SEGMENT_COLORS: Record<CtxSegKey, string> = {
  systemPrompt: '#34d399',
  toolInjection: '#60a5fa',
  rules: '#a78bfa',
  memories: '#f472b6',
};

const CTX_LABEL_I18N_KEY: Record<CtxSegKey, string> = {
  systemPrompt: 'nursery.template.tokenSystemPrompt',
  toolInjection: 'nursery.template.tokenToolInjection',
  rules: 'nursery.template.tokenRules',
  memories: 'nursery.template.tokenMemories',
};

function fmtPct(val: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((val / total) * 100)}%`;
}

// ── Claw agent token estimates (based on actual prompt files) ─────────────
// claw_mode.md ≈ 838 tok + persona files (BOOTSTRAP/SOUL/USER/IDENTITY) ≈ 600 tok
const CLAW_SYS_TOKENS = 1438;
const TOKENS_PER_TOOL = 45;   // matches backend estimation
const TOKENS_PER_RULE = 80;
const TOKENS_PER_MEMORY = 60;
const CTX_WINDOW = 128_000;

interface MockBreakdown {
  systemPrompt: number;
  toolInjection: number;
  rules: number;
  memories: number;
  total: number;
}

function buildMockBreakdown(
  toolCount: number,
  rulesCount: number,
  memoriesCount: number,
): MockBreakdown {
  const systemPrompt = CLAW_SYS_TOKENS;
  const toolInjection = toolCount * TOKENS_PER_TOOL;
  const rules = rulesCount * TOKENS_PER_RULE;
  const memories = memoriesCount * TOKENS_PER_MEMORY;
  return { systemPrompt, toolInjection, rules, memories, total: systemPrompt + toolInjection + rules + memories };
}

const TemplateConfigPage: React.FC = () => {
  const { t } = useTranslation('scenes/profile');
  const { openGallery } = useNurseryStore();

  const [models, setModels] = useState<AIModelConfig[]>([]);
  const [funcAgentModels, setFuncAgentModels] = useState<Record<string, string>>({});
  const [agenticConfig, setAgenticConfig] = useState<ModeConfigItem | null>(null);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [toolsLoading, setToolsLoading] = useState<Record<string, boolean>>({});
  const [skillsLoading, setSkillsLoading] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const enabledToolCount = useMemo(
    () => agenticConfig?.available_tools?.length ?? 0,
    [agenticConfig],
  );

  // Whether a skill is enabled in this template:
  // - If available_skills is undefined, fall back to the skill's global enabled state
  // - Otherwise check if the skill name appears in the list
  const isSkillEnabled = useCallback(
    (skillName: string): boolean => {
      if (agenticConfig?.available_skills == null) {
        return skills.find((s) => s.name === skillName)?.enabled ?? true;
      }
      return agenticConfig.available_skills.includes(skillName);
    },
    [agenticConfig, skills],
  );

  const enabledSkillCount = useMemo(
    () => skills.filter((s) => isSkillEnabled(s.name)).length,
    [skills, isSkillEnabled],
  );

  const tokenBreakdown = useMemo(
    () => buildMockBreakdown(enabledToolCount, 0, 0),
    [enabledToolCount],
  );

  const ctxSegments = useMemo(
    () => CTX_SEGMENT_ORDER.map((key) => ({
      key,
      color: CTX_SEGMENT_COLORS[key],
      label: t(CTX_LABEL_I18N_KEY[key]),
    })),
    [t],
  );

  // Split tools into built-in vs MCP
  const builtinTools = useMemo(
    () => availableTools.filter((t) => !isMcpTool(t.name)),
    [availableTools],
  );

  // MCP tools grouped by server id
  const mcpToolsByServer = useMemo(() => {
    const map = new Map<string, ToolInfo[]>();
    for (const tool of availableTools) {
      if (!isMcpTool(tool.name)) continue;
      const server = getMcpServerName(tool.name);
      if (!map.has(server)) map.set(server, []);
      map.get(server)!.push(tool);
    }
    return map;
  }, [availableTools]);

  // All known MCP server ids — union of detected tool servers + registered servers
  const mcpServerIds = useMemo(() => {
    const fromTools = new Set(mcpToolsByServer.keys());
    const fromRegistry = new Set(mcpServers.map((s) => s.id));
    return new Set([...fromTools, ...fromRegistry]);
  }, [mcpToolsByServer, mcpServers]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const [allModels, funcModels, modeConf, tools, skillList, servers] = await Promise.all([
          configManager.getConfig<AIModelConfig[]>('ai.models').catch(() => [] as AIModelConfig[]),
          configManager.getConfig<Record<string, string>>('ai.func_agent_models').catch(() => ({} as Record<string, string>)),
          configAPI.getModeConfig('agentic').catch(() => null as ModeConfigItem | null),
          invoke<ToolInfo[]>('get_all_tools_info').catch(() => [] as ToolInfo[]),
          configAPI.getSkillConfigs({}).catch(() => [] as SkillInfo[]),
          MCPAPI.getServers().catch(() => [] as MCPServerInfo[]),
        ]);
        setModels(allModels ?? []);
        setFuncAgentModels(funcModels ?? {});
        setAgenticConfig(modeConf);
        setAvailableTools(tools);
        setSkills(skillList ?? []);
        setMcpServers(servers ?? []);
      } catch (e) {
        log.error('Failed to load template config', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const buildModelOptions = useCallback((slot: ModelSlot): SelectOption[] => {
    const presets: SelectOption[] = [
      { value: 'preset:primary', label: t('slotDefault.primary'), group: t('modelGroups.presets') },
      { value: 'preset:fast',    label: t('slotDefault.fast'),    group: t('modelGroups.presets') },
    ];
    const modelOptions: SelectOption[] = models
      .filter((m) => m.enabled && !!m.id)
      .map((m) => ({ value: `model:${m.id}`, label: m.name, group: t('modelGroups.models') }));
    if (slot === 'fast') return [...presets, ...modelOptions];
    return [presets[0], ...modelOptions];
  }, [models, t]);

  const getSelectedValue = useCallback((slot: ModelSlot): string => {
    const id = funcAgentModels[slot] ?? '';
    if (!id) return '';
    return ['primary', 'fast'].includes(id) ? `preset:${id}` : `model:${id}`;
  }, [funcAgentModels]);

  const getSelectedLabel = useCallback((slot: ModelSlot): string => {
    const val = getSelectedValue(slot);
    if (!val) return slot === 'primary' ? t('slotDefault.primary') : t('slotDefault.fast');
    const opts = buildModelOptions(slot);
    return opts.find((o) => o.value === val)?.label
      ?? (slot === 'primary' ? t('slotDefault.primary') : t('slotDefault.fast'));
  }, [getSelectedValue, buildModelOptions, t]);

  const handleModelChange = useCallback(async (
    slot: ModelSlot,
    raw: string | number | (string | number)[],
  ) => {
    if (Array.isArray(raw)) return;
    const rawStr = String(raw);
    const newId = rawStr.startsWith('preset:') ? rawStr.replace('preset:', '') : rawStr.replace('model:', '');
    const updated = { ...funcAgentModels, [slot]: newId };
    setFuncAgentModels(updated);
    try {
      await configManager.setConfig('ai.func_agent_models', updated);
      notificationService.success(t('notifications.modelUpdated'));
    } catch (e) {
      log.error('Failed to update model', e);
      notificationService.error(t('notifications.updateFailed'));
    }
  }, [funcAgentModels, t]);

  const handleToolToggle = useCallback(async (toolName: string) => {
    if (!agenticConfig) return;
    setToolsLoading((prev) => ({ ...prev, [toolName]: true }));
    const current = agenticConfig.available_tools ?? [];
    const isEnabled = current.includes(toolName);
    const newTools = isEnabled ? current.filter((n) => n !== toolName) : [...current, toolName];
    const newConfig = { ...agenticConfig, available_tools: newTools };
    setAgenticConfig(newConfig);
    try {
      await configAPI.setModeConfig('agentic', newConfig);
      const { globalEventBus } = await import('@/infrastructure/event-bus');
      globalEventBus.emit('mode:config:updated');
    } catch (e) {
      log.error('Failed to toggle tool', e);
      notificationService.error(t('notifications.toggleFailed'));
      setAgenticConfig(agenticConfig);
    } finally {
      setToolsLoading((prev) => ({ ...prev, [toolName]: false }));
    }
  }, [agenticConfig, t]);

  const handleResetTools = useCallback(async () => {
    try {
      await configAPI.resetModeConfig('agentic');
      const modeConf = await configAPI.getModeConfig('agentic');
      setAgenticConfig(modeConf);
      const { globalEventBus } = await import('@/infrastructure/event-bus');
      globalEventBus.emit('mode:config:updated');
      notificationService.success(t('notifications.resetSuccess'));
    } catch (e) {
      log.error('Failed to reset tools', e);
      notificationService.error(t('notifications.resetFailed'));
    }
  }, [t]);

  const handleGroupToggleAll = useCallback(async (toolNames: string[]) => {
    if (!agenticConfig) return;
    const current = agenticConfig.available_tools ?? [];
    const allEnabled = toolNames.every((n) => current.includes(n));
    const newTools = allEnabled
      ? current.filter((n) => !toolNames.includes(n))
      : [...new Set([...current, ...toolNames])];
    const newConfig = { ...agenticConfig, available_tools: newTools };
    setAgenticConfig(newConfig);
    try {
      await configAPI.setModeConfig('agentic', newConfig);
      const { globalEventBus } = await import('@/infrastructure/event-bus');
      globalEventBus.emit('mode:config:updated');
    } catch (e) {
      log.error('Failed to toggle group', e);
      notificationService.error(t('notifications.toggleFailed'));
      setAgenticConfig(agenticConfig);
    }
  }, [agenticConfig, t]);

  const handleSkillToggle = useCallback(async (skillName: string) => {
    if (!agenticConfig) return;
    setSkillsLoading((prev) => ({ ...prev, [skillName]: true }));
    // Initialise from global state when available_skills is not yet set
    const current =
      agenticConfig.available_skills ??
      skills.filter((s) => s.enabled).map((s) => s.name);
    const isEnabled = current.includes(skillName);
    const next = isEnabled
      ? current.filter((n) => n !== skillName)
      : [...current, skillName];
    const newConfig = { ...agenticConfig, available_skills: next };
    setAgenticConfig(newConfig);
    try {
      await configAPI.setModeConfig('agentic', newConfig);
      const { globalEventBus } = await import('@/infrastructure/event-bus');
      globalEventBus.emit('mode:config:updated');
    } catch (e) {
      log.error('Failed to toggle skill', e);
      notificationService.error(t('notifications.toggleFailed'));
      setAgenticConfig(agenticConfig);
    } finally {
      setSkillsLoading((prev) => ({ ...prev, [skillName]: false }));
    }
  }, [agenticConfig, skills, t]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Context breakdown: each segment = part / total  (composition of consumed tokens)
  const ctxTotal = tokenBreakdown.total;

  const segmentWidths = useMemo(() => {
    if (ctxTotal === 0) return CTX_SEGMENT_ORDER.map(() => 0);
    return CTX_SEGMENT_ORDER.map((key) => {
      const val = tokenBreakdown[key];
      return typeof val === 'number' ? (val / ctxTotal) * 100 : 0;
    });
  }, [tokenBreakdown, ctxTotal]);

  const primaryLabel = getSelectedLabel('primary');
  const fastLabel = getSelectedLabel('fast');

  // ── Render helpers ───────────────────────────────────────────────────────

  const renderToolGrid = (tools: ToolInfo[], isMcp: boolean) => (
    <div className="tc-tool-grid">
      {tools.map((tool) => {
        const enabled = agenticConfig?.available_tools?.includes(tool.name) ?? false;
        const displayName = isMcp ? getMcpShortName(tool.name) : tool.name;
        return (
          <div
            key={tool.name}
            className={`tc-tool-card ${!enabled ? 'tc-tool-card--off' : ''}`}
          >
            <div className={`tc-tool-card__icon-wrap ${isMcp ? 'tc-tool-card__icon-wrap--mcp' : ''}`}>
              {isMcp ? <Plug2 size={12} /> : <Wrench size={12} />}
            </div>
            <div className="tc-tool-card__meta">
              <span className="tc-tool-card__name" title={displayName}>{displayName}</span>
              <span className="tc-tool-card__desc" title={tool.description}>{tool.description}</span>
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
    </div>
  );

  const renderGroupHeader = (
    id: string,
    label: string,
    toolNames: string[],
    isMcp: boolean,
    serverStatus?: string,
  ) => {
    const groupEnabled = toolNames.filter(
      (n) => agenticConfig?.available_tools?.includes(n),
    ).length;
    const isCollapsed = collapsedGroups.has(id);
    const allOn = toolNames.length > 0 && groupEnabled === toolNames.length;

    return (
      <div className="tc-group-header">
        {toolNames.length > 0 && (
          <button
            type="button"
            className="tc-group-header__toggle"
            onClick={() => toggleCollapse(id)}
          >
            <ChevronDown
              size={13}
              className={`tc-group-header__chevron ${isCollapsed ? 'tc-group-header__chevron--collapsed' : ''}`}
            />
          </button>
        )}
        {isMcp
          ? <Plug2 size={13} className="tc-group-header__icon tc-group-header__icon--mcp" />
          : <Cpu size={13} className="tc-group-header__icon" />
        }
        <span className="tc-group-header__name">{label}</span>
        {serverStatus && (
          <span className={`tc-group-header__status tc-group-header__status--${serverStatus.toLowerCase()}`}>
            {serverStatus}
          </span>
        )}
        <span className="tc-group-header__count">
          {toolNames.length > 0 ? `${groupEnabled}/${toolNames.length}` : t('nursery.template.groupCountEmpty')}
        </span>
        {toolNames.length > 0 && (
          <Switch
            size="small"
            checked={allOn}
            onChange={() => handleGroupToggleAll(toolNames)}
            aria-label={`Toggle all in ${label}`}
          />
        )}
      </div>
    );
  };

  return (
    <div className="nursery-page">
      <div className="nursery-page__bar">
        <button type="button" className="nursery-page__back" onClick={openGallery}>
          <ArrowLeft size={14} />
          <span>{t('nursery.backToGallery')}</span>
        </button>
        <h2 className="nursery-page__title">{t('nursery.template.title')}</h2>
      </div>

      <div className="nursery-page__content">
        {loading ? (
          <div className="nursery-page__loading">
            <RefreshCw size={16} className="nursery-spinning" />
          </div>
        ) : (
          <>
            {/* ── Hero panel ──────────────────────────────────────── */}
            <div className="tc-hero">
              {/* Left: identity + stat chips */}
              <div className="tc-hero__left">
                <div className="tc-hero__identity">
                  <span className="tc-hero__tag">{t('nursery.template.tag')}</span>
                  <h3 className="tc-hero__name">{t('nursery.template.title')}</h3>
                  <p className="tc-hero__desc">{t('nursery.template.subtitle')}</p>
                </div>
                <div className="tc-hero__chips">
                  <span className="tc-hero__chip">
                    <Star size={10} />
                    {primaryLabel}
                  </span>
                  <span className="tc-hero__chip tc-hero__chip--fast">
                    <Zap size={10} />
                    {fastLabel}
                  </span>
                  <span className="tc-hero__chip tc-hero__chip--tools">
                    <Wrench size={10} />
                    {t('nursery.template.stats.tools', { count: enabledToolCount })}
                  </span>
                  {enabledSkillCount > 0 && (
                    <span className="tc-hero__chip tc-hero__chip--skills">
                      <Puzzle size={10} />
                      {t('nursery.template.stats.skills', { count: enabledSkillCount })}
                    </span>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="tc-hero__divider" />

              {/* Right: model config (one row) + context visualization */}
              <div className="tc-hero__right">
                {/* Model row: primary + fast selectors (horizontal) */}
                <div className="tc-hero__models">
                  <div className="tc-model-slot">
                    <Star size={11} className="tc-model-slot__icon tc-model-slot__icon--primary" />
                    <span className="tc-model-slot__label">{t('modelSlots.primary.label')}</span>
                    <div className="tc-model-slot__select">
                      <Select
                        size="small"
                        options={buildModelOptions('primary')}
                        value={getSelectedValue('primary')}
                        onChange={(v) => handleModelChange('primary', v)}
                        placeholder={t('slotDefault.primary')}
                      />
                    </div>
                  </div>
                  <div className="tc-model-slot">
                    <Zap size={11} className="tc-model-slot__icon tc-model-slot__icon--fast" />
                    <span className="tc-model-slot__label">{t('modelSlots.fast.label')}</span>
                    <div className="tc-model-slot__select">
                      <Select
                        size="small"
                        options={buildModelOptions('fast')}
                        value={getSelectedValue('fast')}
                        onChange={(v) => handleModelChange('fast', v)}
                        placeholder={t('slotDefault.fast')}
                      />
                    </div>
                  </div>
                </div>

                {/* Context visualization — total + each part's share of total */}
                <div className="tc-ctx__header">
                  <span className="tc-ctx__title">{t('nursery.template.tokenTitle')}</span>
                  <span className="tc-ctx__summary">
                    <strong>{formatTokenCount(ctxTotal)}</strong>
                    &nbsp;tok&ensp;
                    <span className="tc-ctx__pct">
                      {fmtPct(ctxTotal, CTX_WINDOW)}&nbsp;of&nbsp;{formatTokenCount(CTX_WINDOW)}
                    </span>
                  </span>
                </div>

                <div className="tc-ctx__bar">
                  {ctxTotal === 0 ? (
                    <div className="tc-ctx__segment tc-ctx__segment--empty" />
                  ) : ctxSegments.map(({ key, color, label }, i) => (
                    segmentWidths[i] > 0 && (
                      <div
                        key={key}
                        className="tc-ctx__segment"
                        style={{ width: `${segmentWidths[i]}%`, background: color }}
                        title={`${label}: ${formatTokenCount(tokenBreakdown[key as keyof typeof tokenBreakdown] as number)} (${fmtPct(tokenBreakdown[key as keyof typeof tokenBreakdown] as number, ctxTotal)})`}
                      />
                    )
                  ))}
                </div>

                <div className="tc-ctx__legend">
                  {ctxSegments.map(({ key, color, label }) => {
                    const val = tokenBreakdown[key as keyof typeof tokenBreakdown];
                    const num = typeof val === 'number' ? val : 0;
                    return (
                      <div key={key} className="tc-ctx__legend-item">
                        <span className="tc-ctx__legend-dot" style={{ background: color }} />
                        <span className="tc-ctx__legend-name">{label}</span>
                        <span className="tc-ctx__legend-val">{formatTokenCount(num)}</span>
                        <span className="tc-ctx__legend-pct">{fmtPct(num, ctxTotal)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── Built-in tools ───────────────────────────────────── */}
            <section className="nursery-section">
              <div className="nursery-section__head">
                <Cpu size={14} />
                <span className="nursery-section__title">{t('nursery.template.builtinToolsSection')}</span>
                <span className="nursery-section__count">
                  {builtinTools.filter((t) => agenticConfig?.available_tools?.includes(t.name)).length}
                  /{builtinTools.length}
                </span>
                <button
                  type="button"
                  className="nursery-section__action"
                  onClick={handleResetTools}
                  title={t('actions.reset')}
                >
                  <RefreshCw size={12} />
                </button>
              </div>

              {builtinTools.length === 0 ? (
                <p className="nursery-empty">{t('empty.tools')}</p>
              ) : (
                <div className="tc-tool-block">
                  {renderGroupHeader('__builtin__', t('nursery.template.builtinToolsSection'), builtinTools.map((tool) => tool.name), false)}
                  {!collapsedGroups.has('__builtin__') && renderToolGrid(builtinTools, false)}
                </div>
              )}
            </section>

            {/* ── MCP tools ────────────────────────────────────────── */}
            <section className="nursery-section">
              <div className="nursery-section__head">
                <Plug2 size={14} />
                <span className="nursery-section__title">{t('nursery.template.mcpToolsSection')}</span>
                <span className="nursery-section__count">
                  {[...mcpToolsByServer.values()].flat()
                    .filter((t) => agenticConfig?.available_tools?.includes(t.name)).length}
                  /{[...mcpToolsByServer.values()].flat().length}
                </span>
              </div>

              {mcpServerIds.size === 0 ? (
                <div className="tc-mcp-empty">
                  <Plug2 size={20} className="tc-mcp-empty__icon" />
                  <span className="tc-mcp-empty__text">{t('nursery.template.mcpEmptyTitle')}</span>
                  <span className="tc-mcp-empty__hint">{t('nursery.template.mcpEmptyHint')}</span>
                </div>
              ) : (
                <div className="tc-tool-groups">
                  {[...mcpServerIds].map((serverId) => {
                    const serverTools = mcpToolsByServer.get(serverId) ?? [];
                    const serverInfo = mcpServers.find((s) => s.id === serverId);
                    const status = serverInfo?.status ?? (serverTools.length > 0 ? 'Connected' : 'Unknown');
                    const groupId = `mcp_${serverId}`;

                    return (
                      <div key={serverId} className="tc-tool-block">
                        {renderGroupHeader(
                          groupId,
                          serverInfo?.name ?? serverId,
                          serverTools.map((t) => t.name),
                          true,
                          status,
                        )}
                        {!collapsedGroups.has(groupId) && serverTools.length > 0
                          && renderToolGrid(serverTools, true)}
                        {!collapsedGroups.has(groupId) && serverTools.length === 0 && (
                          <p className="tc-tool-block__empty">{t('nursery.template.mcpServerNoTools')}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ── Skills ───────────────────────────────────────────── */}
            <section className="nursery-section">
              <div className="nursery-section__head">
                <Puzzle size={14} />
                <span className="nursery-section__title">{t('cards.skills')}</span>
                <span className="nursery-section__count">
                  {enabledSkillCount}/{skills.length}
                </span>
              </div>

              {skills.length === 0 ? (
                <p className="nursery-empty">{t('empty.skills')}</p>
              ) : (
                <div className="tc-skill-grid">
                  {skills.map((skill) => {
                    const on = isSkillEnabled(skill.name);
                    return (
                      <div
                        key={skill.name}
                        className={`tc-skill-card ${!on ? 'tc-skill-card--off' : ''}`}
                      >
                        <div className="tc-skill-card__meta">
                          <div className="tc-skill-card__title-row">
                            <span className="tc-skill-card__name">{skill.name}</span>
                            <span className="tc-skill-card__level">{skill.level}</span>
                          </div>
                          <span className="tc-skill-card__desc">{skill.description}</span>
                        </div>
                        <Switch
                          checked={on}
                          onChange={() => handleSkillToggle(skill.name)}
                          disabled={skillsLoading[skill.name]}
                          size="small"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default TemplateConfigPage;
