/**
 * McpToolsConfig — MCP servers only.
 * Tool execution behavior lives on Session Config.
 * Uses settings/mcp-tools for page title/subtitle, settings/mcp for the MCP section.
 */

import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileJson,
  RefreshCw,
  X,
  Play,
  Square,
  CheckCircle,
  Clock,
  AlertTriangle,
  MinusCircle,
} from 'lucide-react';
import { Button, Textarea, IconButton } from '@/component-library';
import {
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageContent,
  ConfigPageSection,
  ConfigCollectionItem,
} from './common';
import { useNotification } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { MCPAPI, MCPServerInfo } from '../../api/service-api/MCPAPI';
import './McpToolsConfig.scss';

const log = createLogger('McpToolsConfig');

// ─── MCP error classifier (from MCPConfig) ────────────────────────────────────
interface ErrorInfo {
  title: string;
  message: string;
  duration: number;
  suggestions?: string[];
}

function createErrorClassifier(t: (key: string, options?: any) => any) {
  const getSuggestions = (key: string): string[] | undefined => {
    const suggestions = t(key, { returnObjects: true });
    if (!Array.isArray(suggestions)) return undefined;
    return suggestions.map((s) => String(s));
  };

  return function classifyError(error: unknown, context: string = 'operation'): ErrorInfo {
    let errorMessage = t('errors.unknownError');
    if (error instanceof Error) errorMessage = error.message;
    else if (typeof error === 'string') errorMessage = error;

    const normalizedMessage = errorMessage.toLowerCase();
    const matches = (patterns: string[]) => patterns.some((p) => normalizedMessage.includes(p));

    if (matches(['json parsing failed', 'json parse failed', 'invalid json', 'json format']))
      return {
        title: t('errors.jsonFormatError'),
        message: errorMessage,
        duration: 10000,
        suggestions: getSuggestions('errors.suggestions.jsonFormat'),
      };
    if (matches(["config missing 'mcpservers' field", "'mcpservers' field must be an object"]))
      return {
        title: t('errors.configStructureError'),
        message: errorMessage,
        duration: 10000,
        suggestions: getSuggestions('errors.suggestions.configStructure'),
      };
    if (
      matches([
        "must not set both 'command' and 'url'",
        "must provide either 'command' (stdio) or 'url' (sse)",
        "unsupported 'type' value",
        "'type' conflicts with provided fields",
        "(stdio) must provide 'command' field",
        "(sse) must provide 'url' field",
        "'args' field must be an array",
        "'env' field must be an object",
        'config must be an object',
      ])
    )
      return {
        title: t('errors.serverConfigError'),
        message: errorMessage,
        duration: 10000,
        suggestions: getSuggestions('errors.suggestions.serverConfig'),
      };
    if (matches(['permission denied', 'access is denied']))
      return {
        title: t('errors.permissionError'),
        message: errorMessage,
        duration: 15000,
        suggestions: getSuggestions('errors.suggestions.permission'),
      };
    if (
      matches([
        'failed to write config file',
        'failed to serialize config',
        'failed to save config',
        'io error',
        'write failed',
      ])
    )
      return {
        title: t('errors.fileOperationError'),
        message: errorMessage,
        duration: 10000,
        suggestions: getSuggestions('errors.suggestions.fileOperation'),
      };
    if (matches(['not found']))
      return { title: t('errors.resourceNotFound'), message: errorMessage, duration: 8000 };
    if (
      matches([
        'failed to start mcp server',
        'failed to capture stdin',
        'failed to capture stdout',
        'max restart attempts',
        'process error',
      ])
    )
      return {
        title: t('errors.serverStartError'),
        message: errorMessage,
        duration: 10000,
        suggestions: getSuggestions('errors.suggestions.serverStart'),
      };
    return {
      title: t('errors.operationFailed', { context }),
      message: errorMessage,
      duration: 8000,
      suggestions: getSuggestions('errors.suggestions.default'),
    };
  };
}

const McpToolsConfig: React.FC = () => {
  const { t: tPage } = useTranslation('settings/mcp-tools');
  const { t: tMcp } = useTranslation('settings/mcp');

  const notification = useNotification();
  const classifyError = createErrorClassifier(tMcp);

  // ─── MCP state ─────────────────────────────────────────────────────────────
  const jsonEditorRef = useRef<HTMLTextAreaElement>(null);
  const jsonLintSeqRef = useRef(0);
  const [servers, setServers] = useState<MCPServerInfo[]>([]);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [jsonConfig, setJsonConfig] = useState('');
  const [jsonLintError, setJsonLintError] = useState<{
    message: string;
    line?: number;
    column?: number;
    position?: number;
  } | null>(null);

  const tryFormatJson = (input: string): string | null => {
    try {
      return JSON.stringify(JSON.parse(input), null, 2);
    } catch {
      return null;
    }
  };

  // ─── MCP effects & handlers ─────────────────────────────────────────────────
  const loadServers = async () => {
    try {
      setMcpLoading(true);
      const serverList = await MCPAPI.getServers();
      setServers(serverList);
    } catch (error) {
      log.error('Failed to load MCP servers', error);
    } finally {
      setMcpLoading(false);
    }
  };

  const loadJsonConfig = async () => {
    try {
      const config = await MCPAPI.loadMCPJsonConfig();
      setJsonConfig(config);
    } catch {
      setJsonConfig(
        JSON.stringify(
          { mcpServers: { 'example-server': { command: 'npx', args: ['-y', '@example/mcp-server'], env: {} } } },
          null,
          2
        )
      );
    }
  };

  useEffect(() => {
    loadServers();
    loadJsonConfig();
  }, []);

  useEffect(() => {
    if (!showJsonEditor) {
      setJsonLintError(null);
      return;
    }
    const seq = ++jsonLintSeqRef.current;
    const handle = window.setTimeout(() => {
      if (seq !== jsonLintSeqRef.current) return;
      if (!jsonConfig.trim()) {
        setJsonLintError(null);
        return;
      }
      try {
        JSON.parse(jsonConfig);
        setJsonLintError(null);
      } catch (error) {
        if (seq !== jsonLintSeqRef.current) return;
        const rawMessage = error instanceof Error ? error.message : String(error);
        const message = rawMessage.replace(/\s+at position \d+$/, '');
        const posMatch =
          rawMessage.match(/position\s+(\d+)/i) ??
          rawMessage.match(/at position\s+(\d+)/i) ??
          rawMessage.match(/char(?:acter)?\s+(\d+)/i);
        const position = posMatch ? Number(posMatch[1]) : undefined;
        if (typeof position === 'number' && Number.isFinite(position)) {
          const prefix = jsonConfig.slice(0, Math.max(0, position));
          const lines = prefix.split('\n');
          setJsonLintError({
            message,
            line: lines.length,
            column: (lines[lines.length - 1]?.length ?? 0) + 1,
            position,
          });
        } else {
          setJsonLintError({ message });
        }
      }
    }, 150);
    return () => window.clearTimeout(handle);
  }, [jsonConfig, showJsonEditor]);

  const handleSaveJsonConfig = async () => {
    try {
      let parsedConfig;
      try {
        parsedConfig = JSON.parse(jsonConfig);
      } catch (parseError) {
        throw new Error(
          tMcp('errors.jsonParseError', {
            message: parseError instanceof Error ? parseError.message : 'Invalid JSON',
          })
        );
      }
      if (!parsedConfig.mcpServers) throw new Error(tMcp('errors.mcpServersRequired'));
      if (typeof parsedConfig.mcpServers !== 'object' || Array.isArray(parsedConfig.mcpServers))
        throw new Error(tMcp('errors.mcpServersMustBeObject'));

      await MCPAPI.saveMCPJsonConfig(jsonConfig);
      notification.success(tMcp('messages.saveSuccess'), {
        title: tMcp('notifications.saveSuccess'),
        duration: 3000,
      });
      setShowJsonEditor(false);

      void (async () => {
        try {
          await loadServers();
          await MCPAPI.initializeServers();
        } catch {
          notification.warning(tMcp('messages.partialStartFailed'), {
            title: tMcp('notifications.partialStartFailed'),
            duration: 5000,
          });
        } finally {
          await loadServers();
          await loadJsonConfig();
        }
      })();
    } catch (error) {
      const errorInfo = classifyError(error, tMcp('actions.saveConfig'));
      let fullMessage = errorInfo.message;
      if (errorInfo.suggestions?.length) {
        fullMessage +=
          '\n\n' +
          tMcp('notifications.suggestionPrefix') +
          '\n' +
          errorInfo.suggestions.map((s) => `• ${s}`).join('\n');
      }
      notification.error(fullMessage, {
        title: errorInfo.title,
        duration: errorInfo.duration,
      });
    }
  };

  const handleJsonEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const value = jsonConfig;
    const indent = '  ';
    const selectionStart = e.currentTarget.selectionStart ?? 0;
    const selectionEnd = e.currentTarget.selectionEnd ?? 0;
    const setSelection = (start: number, end: number) => {
      requestAnimationFrame(() => {
        const el = jsonEditorRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(start, end);
      });
    };

    if (selectionStart === selectionEnd) {
      if (!e.shiftKey) {
        setJsonConfig(value.slice(0, selectionStart) + indent + value.slice(selectionEnd));
        setSelection(selectionStart + indent.length, selectionStart + indent.length);
        return;
      }
      const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
      const lineEndIdx = value.indexOf('\n', selectionStart);
      const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
      const line = value.slice(lineStart, lineEnd);
      const removeFromLineStart = (() => {
        if (line.startsWith(indent)) return indent.length;
        if (line.startsWith('\t')) return 1;
        let spaces = 0;
        while (spaces < indent.length && line[spaces] === ' ') spaces++;
        return spaces;
      })();
      if (removeFromLineStart === 0) return;
      setJsonConfig(value.slice(0, lineStart) + line.slice(removeFromLineStart) + value.slice(lineEnd));
      setSelection(
        Math.max(lineStart, selectionStart - removeFromLineStart),
        Math.max(lineStart, selectionStart - removeFromLineStart)
      );
      return;
    }

    let endForLineCalc = selectionEnd;
    if (selectionEnd > 0 && value[selectionEnd - 1] === '\n') endForLineCalc = selectionEnd - 1;
    const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
    const nextNewline = value.indexOf('\n', endForLineCalc);
    const lineEnd = nextNewline === -1 ? value.length : nextNewline;
    const selectedBlock = value.slice(lineStart, lineEnd);
    const lines = selectedBlock.split('\n');

    if (!e.shiftKey) {
      const nextBlock = lines.map((l) => indent + l).join('\n');
      setJsonConfig(value.slice(0, lineStart) + nextBlock + value.slice(lineEnd));
      setSelection(selectionStart + indent.length, selectionEnd + indent.length * lines.length);
      return;
    }

    let removedTotal = 0;
    const removedPerLine: number[] = [];
    const nextBlock = lines
      .map((line) => {
        let removed = 0;
        if (line.startsWith(indent)) removed = indent.length;
        else if (line.startsWith('\t')) removed = 1;
        else {
          while (removed < indent.length && line[removed] === ' ') removed++;
        }
        removedPerLine.push(removed);
        removedTotal += removed;
        return line.slice(removed);
      })
      .join('\n');
    const nextStart = Math.max(lineStart, selectionStart - (removedPerLine[0] ?? 0));
    setJsonConfig(value.slice(0, lineStart) + nextBlock + value.slice(lineEnd));
    setSelection(nextStart, Math.max(nextStart, selectionEnd - removedTotal));
  };

  const handleJsonEditorPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (!pasted) return;
    const current = jsonConfig;
    const selectionStart = e.currentTarget.selectionStart ?? 0;
    const selectionEnd = e.currentTarget.selectionEnd ?? 0;
    const isWholeReplace =
      current.trim().length === 0 || (selectionStart === 0 && selectionEnd === current.length);
    if (!isWholeReplace) return;
    const formatted = tryFormatJson(pasted);
    if (!formatted) return;
    e.preventDefault();
    setJsonConfig(formatted);
    requestAnimationFrame(() => {
      jsonEditorRef.current?.focus();
      jsonEditorRef.current?.setSelectionRange(formatted.length, formatted.length);
    });
  };

  const isCommandDrivenServer = (server: MCPServerInfo) => {
    const normalizedType = server.serverType.toLowerCase();
    return normalizedType.includes('local') || normalizedType.includes('container');
  };

  const canStartServer = (server: MCPServerInfo) => {
    if (!isCommandDrivenServer(server)) return true;
    return server.commandAvailable !== false;
  };

  const notifyCommandUnavailable = (server: MCPServerInfo) => {
    notification.warning(
      tMcp('messages.commandUnavailable', {
        serverId: server.id,
        defaultValue: `Server "${server.id}" command is unavailable. Check runtime installation or command configuration.`,
      }),
      {
        title: tMcp('notifications.startFailed'),
        duration: 5000,
      }
    );
  };

  const handleStartServer = async (server: MCPServerInfo) => {
    if (!canStartServer(server)) {
      notifyCommandUnavailable(server);
      return;
    }

    const serverId = server.id;
    try {
      await MCPAPI.startServer(serverId);
      notification.success(tMcp('messages.startSuccess', { serverId }), {
        title: tMcp('notifications.startSuccess'),
        duration: 3000,
      });
      await loadServers();
    } catch (error) {
      notification.error(
        tMcp('messages.startFailed', { serverId }) +
          ': ' +
          (error instanceof Error ? error.message : String(error)),
        { title: tMcp('notifications.startFailed'), duration: 5000 }
      );
    }
  };

  const handleStopServer = async (serverId: string) => {
    try {
      await MCPAPI.stopServer(serverId);
      notification.success(tMcp('messages.stopSuccess', { serverId }), {
        title: tMcp('notifications.stopSuccess'),
        duration: 3000,
      });
      await loadServers();
    } catch (error) {
      notification.error(
        tMcp('messages.stopFailed', { serverId }) +
          ': ' +
          (error instanceof Error ? error.message : String(error)),
        { title: tMcp('notifications.stopFailed'), duration: 5000 }
      );
    }
  };

  const handleRestartServer = async (server: MCPServerInfo) => {
    if (!canStartServer(server)) {
      notifyCommandUnavailable(server);
      return;
    }

    const serverId = server.id;
    try {
      await MCPAPI.restartServer(serverId);
      notification.success(tMcp('messages.restartSuccess', { serverId }), {
        title: tMcp('notifications.restartSuccess'),
        duration: 3000,
      });
      await loadServers();
    } catch (error) {
      notification.error(
        tMcp('messages.restartFailed', { serverId }) +
          ': ' +
          (error instanceof Error ? error.message : String(error)),
        { title: tMcp('notifications.restartFailed'), duration: 5000 }
      );
    }
  };

  const getStatusClass = (status: string): string => {
    const s = status.toLowerCase();
    if (s.includes('healthy') || s.includes('connected')) return 'is-healthy';
    if (s.includes('starting') || s.includes('reconnecting')) return 'is-pending';
    if (s.includes('failed') || s.includes('stopped')) return 'is-error';
    return '';
  };

  const getStatusIcon = (status: string): React.ReactNode => {
    const s = status.toLowerCase();
    if (s.includes('healthy') || s.includes('connected')) return <CheckCircle size={10} />;
    if (s.includes('starting') || s.includes('reconnecting')) return <Clock size={10} />;
    if (s.includes('failed') || s.includes('stopped')) return <AlertTriangle size={10} />;
    return <MinusCircle size={10} />;
  };

  const isStopped = (status: string) => {
    const s = status.toLowerCase();
    return s.includes('stopped') || s.includes('failed');
  };

  const getRuntimeSourceLabel = (server: MCPServerInfo) => {
    if (!server.commandSource) {
      return tMcp('server.runtime.unknown', { defaultValue: 'unknown' });
    }
    return server.commandSource === 'managed'
      ? tMcp('server.runtime.managed', { defaultValue: 'managed' })
      : tMcp('server.runtime.system', { defaultValue: 'system' });
  };

  const mcpSectionExtra = (
    <>
      <IconButton
        variant={showJsonEditor ? 'ghost' : 'primary'}
        size="small"
        onClick={() => setShowJsonEditor(!showJsonEditor)}
        tooltip={showJsonEditor ? tMcp('actions.backToList') : tMcp('actions.jsonConfig')}
      >
        {showJsonEditor ? <X size={16} /> : <FileJson size={16} />}
      </IconButton>
      <IconButton variant="ghost" size="small" onClick={loadServers} tooltip={tMcp('actions.refresh')}>
        <RefreshCw size={16} />
      </IconButton>
    </>
  );

  const renderServerBadge = (server: MCPServerInfo) => (
    <>
      <span className={`bitfun-mcp-tools__status-badge ${getStatusClass(server.status)}`}>
        {getStatusIcon(server.status)}
        {server.status}
      </span>
      <span className="bitfun-collection-item__badge">{server.serverType}</span>
      {isCommandDrivenServer(server) && (
        <span
          className={`bitfun-collection-item__badge ${
            server.commandAvailable === false
              ? 'bitfun-mcp-tools__runtime-badge bitfun-mcp-tools__runtime-badge--error'
              : 'bitfun-mcp-tools__runtime-badge bitfun-mcp-tools__runtime-badge--ok'
          }`}
        >
          {server.commandAvailable === false
            ? tMcp('server.runtime.unavailable', { defaultValue: 'command unavailable' })
            : tMcp('server.runtime.available', { defaultValue: 'command available' })}
        </span>
      )}
    </>
  );

  const renderServerControl = (server: MCPServerInfo) => (
    <>
      {isStopped(server.status) ? (
        <IconButton
          size="small"
          variant="success"
          onClick={() => handleStartServer(server)}
          tooltip={
            canStartServer(server)
              ? tMcp('actions.start')
              : tMcp('messages.commandUnavailable', {
                  serverId: server.id,
                  defaultValue: `Server "${server.id}" command is unavailable.`,
                })
          }
        >
          <Play size={14} />
        </IconButton>
      ) : (
        <IconButton
          size="small"
          variant="warning"
          onClick={() => handleStopServer(server.id)}
          tooltip={tMcp('actions.stop')}
        >
          <Square size={14} />
        </IconButton>
      )}
      <IconButton
        size="small"
        variant="ghost"
        onClick={() => handleRestartServer(server)}
        tooltip={
          canStartServer(server)
            ? tMcp('actions.restart')
            : tMcp('messages.commandUnavailable', {
                serverId: server.id,
                defaultValue: `Server "${server.id}" command is unavailable.`,
              })
        }
      >
        <RefreshCw size={14} />
      </IconButton>
    </>
  );

  const renderServerDetails = (server: MCPServerInfo) => {
    if (!isCommandDrivenServer(server)) return null;

    return (
      <div className="bitfun-mcp-tools__server-details">
        <div className="bitfun-mcp-tools__server-detail-item">
          <span className="bitfun-mcp-tools__server-detail-label">
            {tMcp('server.command', { defaultValue: 'Command' })}:
          </span>
          <code className="bitfun-mcp-tools__server-detail-value">
            {server.command || '-'}
          </code>
        </div>
        <div className="bitfun-mcp-tools__server-detail-item">
          <span className="bitfun-mcp-tools__server-detail-label">
            {tMcp('server.runtime.source', { defaultValue: 'Source' })}:
          </span>
          <span className="bitfun-mcp-tools__server-detail-value">
            {getRuntimeSourceLabel(server)}
          </span>
        </div>
        {server.commandResolvedPath && (
          <div className="bitfun-mcp-tools__server-detail-item">
            <span className="bitfun-mcp-tools__server-detail-label">
              {tMcp('server.runtime.path', { defaultValue: 'Resolved Path' })}:
            </span>
            <code className="bitfun-mcp-tools__server-detail-value">
              {server.commandResolvedPath}
            </code>
          </div>
        )}
      </div>
    );
  };

  return (
    <ConfigPageLayout className="bitfun-mcp-tools">
      <ConfigPageHeader title={tPage('title')} subtitle={tPage('subtitle')} />

      <ConfigPageContent>
        {/* MCP section */}
        <ConfigPageSection
          title={tMcp('section.serverList.title')}
          description={tMcp('section.serverList.description')}
          extra={mcpSectionExtra}
        >
          {showJsonEditor && (
            <div className="bitfun-mcp-tools__json-editor">
              <div className="bitfun-mcp-tools__json-editor-header">
                <h3>{tMcp('jsonEditor.title')}</h3>
                <p className="bitfun-mcp-tools__json-hint">{tMcp('jsonEditor.hint1')}</p>
                <p className="bitfun-mcp-tools__json-hint">{tMcp('jsonEditor.hint2')}</p>
              </div>
              <Textarea
                ref={jsonEditorRef}
                value={jsonConfig}
                onChange={(e) => setJsonConfig(e.target.value)}
                onKeyDown={handleJsonEditorKeyDown}
                onPaste={handleJsonEditorPaste}
                rows={18}
                placeholder={`{\n  "mcpServers": {\n    "server-name": {\n      "command": "npx",\n      "args": ["-y", "@package/name"],\n      "env": {}\n    }\n  }\n}`}
                variant="outlined"
                className="bitfun-mcp-tools__json-textarea"
                spellCheck={false}
                error={!!jsonLintError}
                errorMessage={
                  jsonLintError
                    ? tMcp('jsonEditor.lintError', {
                        location:
                          typeof jsonLintError.line === 'number' && typeof jsonLintError.column === 'number'
                            ? tMcp('jsonEditor.lintLocation', {
                                line: jsonLintError.line,
                                column: jsonLintError.column,
                              })
                            : '',
                        message: jsonLintError.message,
                      })
                    : undefined
                }
              />
              <div className="bitfun-mcp-tools__json-actions">
                <Button variant="secondary" onClick={() => setShowJsonEditor(false)}>
                  {tMcp('actions.cancel')}
                </Button>
                <Button variant="primary" onClick={handleSaveJsonConfig}>
                  {tMcp('actions.saveConfig')}
                </Button>
              </div>
              <div className="bitfun-mcp-tools__json-examples">
                <h4>{tMcp('jsonEditor.exampleTitle')}</h4>
                <div className="bitfun-mcp-tools__example">
                  <h5>{tMcp('jsonEditor.localProcess')}</h5>
                  <pre>{`{\n  "mcpServers": {\n    "zai-mcp-server": {\n      "command": "npx",\n      "args": ["-y", "@z_ai/mcp-server"],\n      "env": { "Z_AI_API_KEY": "your_api_key" }\n    }\n  }\n}`}</pre>
                </div>
                <div className="bitfun-mcp-tools__example">
                  <h5>{tMcp('jsonEditor.remoteService')}</h5>
                  <pre>{`{\n  "mcpServers": {\n    "remote-mcp": {\n      "url": "http://localhost:3000/sse"\n    }\n  }\n}`}</pre>
                </div>
              </div>
            </div>
          )}

          {!showJsonEditor && mcpLoading && (
            <div className="bitfun-collection-empty">
              <p>{tMcp('loading')}</p>
            </div>
          )}

          {!showJsonEditor && !mcpLoading && servers.length === 0 && (
            <div className="bitfun-collection-empty">
              <Button variant="dashed" size="small" onClick={() => setShowJsonEditor(true)}>
                <FileJson size={14} />
                {tMcp('actions.jsonConfig')}
              </Button>
            </div>
          )}

          {!showJsonEditor &&
            servers.map((server) => (
              <ConfigCollectionItem
                key={server.id}
                label={server.name}
                badge={renderServerBadge(server)}
                control={renderServerControl(server)}
                details={renderServerDetails(server)}
              />
            ))}
        </ConfigPageSection>
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default McpToolsConfig;
