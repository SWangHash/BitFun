/**
 * Manages remote sessions by sending commands to the desktop via the relay.
 * All communication is request-response via RelayHttpClient (HTTP).
 *
 * Includes SessionPoller for incremental state synchronization:
 *   - Active tab: poll every 1 second
 *   - Inactive tab: poll every 5 seconds
 *   - On tab activation: immediate poll to catch up on missed changes
 */

import { RelayHttpClient } from './RelayHttpClient';

export interface WorkspaceInfo {
  has_workspace: boolean;
  path?: string;
  project_name?: string;
  git_branch?: string;
}

export interface RecentWorkspaceEntry {
  path: string;
  name: string;
  last_opened: string;
}

export interface SessionInfo {
  session_id: string;
  name: string;
  agent_type: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  workspace_path?: string;
  workspace_name?: string;
}

export interface ChatMessageItem {
  type: 'text' | 'tool' | 'thinking';
  content?: string;
  tool?: RemoteToolStatus;
  is_subagent?: boolean;
  subItems?: ChatMessageItem[];
}

export interface ChatImageAttachment {
  name: string;
  data_url: string;
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  metadata?: any;
  tools?: RemoteToolStatus[];
  thinking?: string;
  items?: ChatMessageItem[];
  images?: ChatImageAttachment[];
}

export interface ActiveTurnSnapshot {
  turn_id: string;
  status: string;
  text: string;
  thinking: string;
  tools: RemoteToolStatus[];
  round_index: number;
  items?: ChatMessageItem[];
}

export interface RemoteToolStatus {
  id: string;
  name: string;
  status: string;
  duration_ms?: number;
  start_ms?: number;
  input_preview?: string;
  tool_input?: any;
}

export interface PollResponse {
  resp: string;
  version: number;
  changed: boolean;
  session_state?: string;
  title?: string;
  new_messages?: ChatMessage[];
  total_msg_count?: number;
  active_turn?: ActiveTurnSnapshot | null;
}

export interface InitialSyncData {
  has_workspace: boolean;
  path?: string;
  project_name?: string;
  git_branch?: string;
  sessions: SessionInfo[];
  has_more_sessions: boolean;
}

export class RemoteSessionManager {
  private client: RelayHttpClient;

  constructor(client: RelayHttpClient) {
    this.client = client;
  }

  private async request<T>(cmd: object): Promise<T> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const cmdWithId = { ...cmd, _request_id: requestId };
    const resp = await this.client.sendCommand<T>(cmdWithId);
    const respAny = resp as any;
    if (respAny.resp === 'error') {
      throw new Error(respAny.message || 'Unknown error');
    }
    return resp;
  }

  async getWorkspaceInfo(): Promise<WorkspaceInfo> {
    const resp = await this.request<{ resp: string } & WorkspaceInfo>({
      cmd: 'get_workspace_info',
    });
    return {
      has_workspace: resp.has_workspace,
      path: resp.path,
      project_name: resp.project_name,
      git_branch: resp.git_branch,
    };
  }

  async listRecentWorkspaces(): Promise<RecentWorkspaceEntry[]> {
    const resp = await this.request<{
      resp: string;
      workspaces: RecentWorkspaceEntry[];
    }>({ cmd: 'list_recent_workspaces' });
    return resp.workspaces || [];
  }

  async setWorkspace(
    path: string,
  ): Promise<{
    success: boolean;
    path?: string;
    project_name?: string;
    error?: string;
  }> {
    return this.request({ cmd: 'set_workspace', path });
  }

  async listSessions(
    workspacePath?: string,
    limit = 30,
    offset = 0,
  ): Promise<{ sessions: SessionInfo[]; has_more: boolean }> {
    const resp = await this.request<{
      resp: string;
      sessions: SessionInfo[];
      has_more: boolean;
    }>({
      cmd: 'list_sessions',
      workspace_path: workspacePath ?? null,
      limit,
      offset,
    });
    return {
      sessions: resp.sessions || [],
      has_more: resp.has_more ?? false,
    };
  }

  async createSession(
    agentType?: string,
    sessionName?: string,
    workspacePath?: string,
  ): Promise<string> {
    const resp = await this.request<{ resp: string; session_id: string }>({
      cmd: 'create_session',
      agent_type: agentType || undefined,
      session_name: sessionName || undefined,
      workspace_path: workspacePath ?? null,
    });
    return resp.session_id;
  }

  async getSessionMessages(
    sessionId: string,
    limit?: number,
    beforeId?: string,
  ): Promise<{ messages: ChatMessage[]; has_more: boolean }> {
    const resp = await this.request<{
      resp: string;
      messages: ChatMessage[];
      has_more: boolean;
    }>({
      cmd: 'get_session_messages',
      session_id: sessionId,
      limit,
      before_message_id: beforeId,
    });
    return {
      messages: resp.messages || [],
      has_more: resp.has_more || false,
    };
  }

  async sendMessage(
    sessionId: string,
    content: string,
    agentType?: string,
    imageContexts?: Array<{
      id: string;
      image_path?: string;
      data_url?: string;
      mime_type: string;
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<string> {
    const resp = await this.request<{ resp: string; turn_id: string }>({
      cmd: 'send_message',
      session_id: sessionId,
      content,
      agent_type: agentType || undefined,
      image_contexts: imageContexts && imageContexts.length > 0 ? imageContexts : undefined,
    });
    return resp.turn_id;
  }

  async cancelTask(sessionId: string, turnId?: string): Promise<void> {
    await this.request({
      cmd: 'cancel_task',
      session_id: sessionId,
      turn_id: turnId ?? undefined,
    });
  }

  async cancelTool(toolId: string, reason?: string): Promise<void> {
    await this.request({
      cmd: 'cancel_tool',
      tool_id: toolId,
      reason: reason ?? undefined,
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request({ cmd: 'delete_session', session_id: sessionId });
  }

  async answerQuestion(toolId: string, answers: any): Promise<void> {
    await this.request({ cmd: 'answer_question', tool_id: toolId, answers });
  }

  async pollSession(
    sessionId: string,
    sinceVersion: number,
    knownMsgCount: number,
  ): Promise<PollResponse> {
    return this.request<PollResponse>({
      cmd: 'poll_session',
      session_id: sessionId,
      since_version: sinceVersion,
      known_msg_count: knownMsgCount,
    });
  }

  async ping(): Promise<void> {
    await this.request({ cmd: 'ping' });
  }
}

// ── SessionPoller ─────────────────────────────────────────────────

export class SessionPoller {
  private intervalId: ReturnType<typeof setTimeout> | null = null;
  private sinceVersion = 0;
  private knownMsgCount = 0;
  private sessionId: string;
  private sessionMgr: RemoteSessionManager;
  private onUpdate: (state: PollResponse) => void;
  private polling = false;
  private stopped = false;
  private hasActiveTurn = false;

  constructor(
    sessionMgr: RemoteSessionManager,
    sessionId: string,
    onUpdate: (state: PollResponse) => void,
  ) {
    this.sessionMgr = sessionMgr;
    this.sessionId = sessionId;
    this.onUpdate = onUpdate;
  }

  start(initialMsgCount = 0) {
    this.stopped = false;
    this.knownMsgCount = initialMsgCount;
    this.tick();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  stop() {
    this.stopped = true;
    if (this.intervalId !== null) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  resetCursors() {
    this.sinceVersion = 0;
    this.knownMsgCount = 0;
  }

  /** Call after sending a message to immediately switch to fast polling. */
  nudge() {
    this.hasActiveTurn = true;
    if (this.intervalId !== null) clearTimeout(this.intervalId);
    this.tick();
  }

  private getInterval(): number {
    if (document.visibilityState !== 'visible') return 5000;
    return this.hasActiveTurn ? 1000 : 10000;
  }

  private scheduleNext() {
    if (this.stopped) return;
    if (this.intervalId !== null) clearTimeout(this.intervalId);
    this.intervalId = setTimeout(() => this.tick(), this.getInterval());
  }

  private onVisibilityChange = () => {
    if (this.stopped) return;
    if (document.visibilityState === 'visible') {
      if (this.intervalId !== null) clearTimeout(this.intervalId);
      this.tick();
    } else {
      this.scheduleNext();
    }
  };

  private async tick() {
    if (this.stopped || this.polling) {
      this.scheduleNext();
      return;
    }
    this.polling = true;
    try {
      const resp = await this.sessionMgr.pollSession(
        this.sessionId,
        this.sinceVersion,
        this.knownMsgCount,
      );
      // Only update hasActiveTurn from responses that carry actual data.
      // When changed=false the backend omits active_turn, so we must
      // preserve the previous value to keep 1-second fast polling alive.
      if (resp.changed) {
        this.hasActiveTurn = resp.active_turn != null && resp.active_turn.status === 'active';
      }
      if (resp.changed) {
        this.sinceVersion = resp.version;
        if (resp.total_msg_count != null) {
          this.knownMsgCount = resp.total_msg_count;
        }
        this.onUpdate(resp);
      }
    } catch (e) {
      console.error('[Poller] poll error', e);
    } finally {
      this.polling = false;
      this.scheduleNext();
    }
  }
}
