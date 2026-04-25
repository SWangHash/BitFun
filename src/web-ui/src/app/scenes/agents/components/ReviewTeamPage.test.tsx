import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

const loadDefaultReviewTeam = vi.fn();
const saveDefaultReviewTeamStrategyLevel = vi.fn();
const saveDefaultReviewTeamMemberStrategyOverride = vi.fn();
const saveDefaultReviewTeamExecutionPolicy = vi.fn();
const notificationFns = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
const tMock = vi.hoisted(() =>
  vi.fn((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key),
);

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: tMock,
  }),
}));

vi.mock('@/component-library', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  ConfigPageLoading: ({ text }: { text: string }) => <div>{text}</div>,
  NumberInput: () => <input type="number" readOnly />,
  Select: () => <select />,
  Switch: () => <input type="checkbox" readOnly />,
}));

vi.mock('@/infrastructure/config/components/common', () => ({
  ConfigPageContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConfigPageHeader: ({ title, subtitle, extra }: { title: string; subtitle?: string; extra?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
      {extra}
    </header>
  ),
  ConfigPageLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  ConfigPageRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConfigPageSection: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <section>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  ),
}));

vi.mock('@/infrastructure/config/components/ModelSelectionRadio', () => ({
  ModelSelectionRadio: () => <div data-testid="model-selection" />,
}));

vi.mock('@/infrastructure/api/service-api/ConfigAPI', () => ({
  configAPI: {
    getConfig: vi.fn(async () => []),
  },
}));

vi.mock('@/infrastructure/api/service-api/SubagentAPI', () => ({
  SubagentAPI: {
    listSubagents: vi.fn(async () => []),
    updateSubagentConfig: vi.fn(async () => undefined),
  },
}));

vi.mock('@/shared/notification-system', () => ({
  useNotification: () => ({
    success: notificationFns.success,
    error: notificationFns.error,
    warning: notificationFns.warning,
    info: notificationFns.info,
  }),
}));

vi.mock('@/infrastructure/contexts/WorkspaceContext', () => ({
  useCurrentWorkspace: () => ({ workspacePath: 'D:/workspace/project' }),
}));

vi.mock('@/shared/services/reviewTeamService', async () => {
  const actual = await vi.importActual<typeof import('@/shared/services/reviewTeamService')>(
    '@/shared/services/reviewTeamService',
  );
  return {
    ...actual,
    loadDefaultReviewTeam,
    saveDefaultReviewTeamStrategyLevel,
    saveDefaultReviewTeamMemberStrategyOverride,
    saveDefaultReviewTeamExecutionPolicy,
  };
});

let JSDOMCtor: (new (
  html?: string,
  options?: { pretendToBeVisual?: boolean }
) => { window: Window & typeof globalThis }) | null = null;

try {
  const jsdom = await import('jsdom');
  JSDOMCtor = jsdom.JSDOM as typeof JSDOMCtor;
} catch {
  JSDOMCtor = null;
}

const describeWithJsdom = JSDOMCtor ? describe : describe.skip;

describeWithJsdom('ReviewTeamPage', () => {
  let dom: { window: Window & typeof globalThis };
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOMCtor!('<!doctype html><html><body></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost',
    });

    const { window } = dom;
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('navigator', window.navigator);
    vi.stubGlobal('HTMLElement', window.HTMLElement);
    vi.stubGlobal('localStorage', window.localStorage);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    loadDefaultReviewTeam.mockResolvedValue({
      id: 'default-review-team',
      name: 'Code Review Team',
      description: '',
      warning: 'Review may take longer.',
      strategyLevel: 'normal',
      memberStrategyOverrides: {},
      executionPolicy: {
        reviewerTimeoutSeconds: 300,
        judgeTimeoutSeconds: 240,
        reviewerFileSplitThreshold: 20,
        maxSameRoleInstances: 3,
      },
      members: [],
      coreMembers: [],
      extraMembers: [],
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    dom.window.close();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('loads review team data only once on initial render', async () => {
    const { default: ReviewTeamPage } = await import('./ReviewTeamPage');

    await act(async () => {
      root.render(<ReviewTeamPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadDefaultReviewTeam).toHaveBeenCalledTimes(1);
  });

  it('renders review strategy controls with token and runtime impact copy', async () => {
    const { default: ReviewTeamPage } = await import('./ReviewTeamPage');

    await act(async () => {
      root.render(<ReviewTeamPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Review strategy');
    expect(container.textContent).toContain('Quick');
    expect(container.textContent).toContain('Normal');
    expect(container.textContent).toContain('Deep');
    expect(container.textContent).toContain('About 1.8-2.5x token usage and 1.5-2.5x runtime.');
  });

  it('updates the team review strategy without reloading the whole page', async () => {
    saveDefaultReviewTeamStrategyLevel.mockResolvedValue(undefined);
    const { default: ReviewTeamPage } = await import('./ReviewTeamPage');

    await act(async () => {
      root.render(<ReviewTeamPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadDefaultReviewTeam).toHaveBeenCalledTimes(1);
    const deepStrategyButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Thorough multi-pass review'));
    expect(deepStrategyButton).toBeTruthy();

    await act(async () => {
      deepStrategyButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(saveDefaultReviewTeamStrategyLevel).toHaveBeenCalledWith('deep');
    expect(loadDefaultReviewTeam).toHaveBeenCalledTimes(1);
    expect(deepStrategyButton!.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).not.toContain('Loading code review team...');
  });

  it('keeps rendering after selecting a review team member with missing optional fields', async () => {
    loadDefaultReviewTeam.mockResolvedValue({
      id: 'default-review-team',
      name: 'Code Review Team',
      description: '',
      warning: 'Review may take longer.',
      strategyLevel: 'normal',
      memberStrategyOverrides: {},
      executionPolicy: {
        reviewerTimeoutSeconds: 300,
        judgeTimeoutSeconds: 240,
        reviewerFileSplitThreshold: 20,
        maxSameRoleInstances: 3,
      },
      members: [
        {
          id: 'core:review-business-logic',
          subagentId: 'review-business-logic',
          definitionKey: 'businessLogic',
          displayName: 'Logic reviewer',
          roleName: 'Logic',
          description: 'Checks behavior.',
          responsibilities: undefined,
          model: 'fast',
          configuredModel: 'fast',
          strategyOverride: 'inherit',
          strategyLevel: 'normal',
          strategySource: 'team',
          enabled: true,
          available: true,
          locked: true,
          source: 'core',
          subagentSource: undefined,
          accentColor: undefined,
        },
      ],
      coreMembers: [],
      extraMembers: [],
    });
    const { default: ReviewTeamPage } = await import('./ReviewTeamPage');

    await act(async () => {
      root.render(<ReviewTeamPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const memberButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Logic reviewer'));
    expect(memberButton).toBeTruthy();

    await act(async () => {
      memberButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Member Detail');
    expect(container.textContent).toContain('Logic reviewer');
  });
});
