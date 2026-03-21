import type { PanelType } from '@/app/types';

export type MyAgentView = 'profile' | 'agents' | 'skills' | 'insights';

export interface MyAgentNavItem {
  id: MyAgentView;
  panelTab: PanelType;
  labelKey: string;
}

export interface MyAgentNavCategory {
  id: string;
  nameKey: string;
  items: MyAgentNavItem[];
}

export const MY_AGENT_NAV_CATEGORIES: MyAgentNavCategory[] = [
  {
    id: 'agents',
    nameKey: 'nav.myAgent.categories.agents',
    items: [
      { id: 'profile', panelTab: 'profile', labelKey: 'nav.items.persona' },
      { id: 'agents', panelTab: 'agents', labelKey: 'nav.items.agents' },
    ],
  },
  {
    id: 'extensions',
    nameKey: 'nav.myAgent.categories.extensions',
    items: [
      { id: 'skills', panelTab: 'skills', labelKey: 'nav.items.skills' },
    ],
  },
  {
    id: 'analytics',
    nameKey: 'nav.myAgent.categories.analytics',
    items: [
      { id: 'insights', panelTab: 'sessions', labelKey: 'nav.items.insights' },
    ],
  },
];

export const DEFAULT_MY_AGENT_VIEW: MyAgentView = 'profile';
