import React, { useCallback, useMemo } from 'react';
import { FontPreferencePanel } from '@/infrastructure/font-preference';
import { useMouseGlowPreference } from '@/infrastructure/mouse-glow';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/component-library';
import { Select } from '@openbitfun/ui';
import {
  SYSTEM_APPEARANCE_ID,
  useAppearance,
  type AppearanceCatalogEntry,
} from '@/infrastructure/appearance';
import { useLanguageSelector } from '@/infrastructure/i18n';
import type { LocaleId } from '@/infrastructure/i18n/types';
import { AppearancePackageConfigSection } from './AppearancePackageConfigSection';
import {
  ConfigPageContent,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageSection,
  ConfigPageSectionStack,
  ConfigPageRow,
} from './common';
import './AppearanceConfig.scss';

function AppearanceSelectionSection() {
  const { t } = useTranslation('settings/basics');
  const {
    selectedAppearanceId,
    appearances,
    select,
    initialized,
    status,
  } = useAppearance();
  const { currentLanguage, supportedLocales, selectLanguage, isChanging } = useLanguageSelector();

  const handleAppearanceChange = async (nextAppearanceId: string) => {
    await select(nextAppearanceId);
  };

  const getAppearanceDisplayName = useCallback((appearance: AppearanceCatalogEntry) => {
    const presetId = appearance.id.replace(/^builtin\./, '');
    const i18nKey = `appearance.presets.${presetId}`;
    return appearance.source === 'builtin'
      ? t(`${i18nKey}.name`, { defaultValue: appearance.name })
      : appearance.name;
  }, [t]);

  const appearanceOptions = useMemo(
    () => [
      {
        value: SYSTEM_APPEARANCE_ID,
        label: t('appearance.systemAppearance'),
        testId: 'appearance-palette-option',
        testAttributes: {
          'data-appearance-id': SYSTEM_APPEARANCE_ID,
        },
      },
      ...appearances.map((appearance) => ({
        value: appearance.id,
        label: getAppearanceDisplayName(appearance),
        testId: 'appearance-palette-option',
        testAttributes: {
          'data-appearance-id': appearance.id,
        },
      })),
    ],
    [appearances, t]
  );

  return (
    <div
      className="appearance-settings"
      data-testid="appearance-settings-section"
      data-openbitfun-component="appearance-config"
      data-openbitfun-part="settings"
    >
      <div
        className="appearance-settings__content"
        data-openbitfun-component="appearance-config"
        data-openbitfun-part="settingsContent"
      >
        <ConfigPageSection title={t('appearance.title')} description={t('appearance.hint')}>
          <ConfigPageRow
            label={t('appearance.language')}
            description={t('appearance.languageRowHint')}
            align="center"
          >
            <div
              className="appearance-settings__language-select"
              data-openbitfun-component="appearance-config"
              data-openbitfun-part="language"
            >
              <Select
                size="sm"
                value={currentLanguage}
                onValueChange={(value) =>
                  selectLanguage(String(value) as LocaleId)
                }
                options={supportedLocales.map((locale) => ({
                  value: locale.id,
                  label: locale.nativeName,
                  testId: 'appearance-language-option',
                  testAttributes: {
                    'data-locale-id': locale.id,
                  },
                }))}
                disabled={isChanging}
                placeholder={t('appearance.language')}
                data-testid="appearance-language-select"
              />
            </div>
          </ConfigPageRow>
          <ConfigPageRow
            label={t('appearance.appearances')}
            description={t('appearance.appearanceRowHint')}
            align="center"
          >
            <div
              className="appearance-settings__palette-picker"
              data-openbitfun-component="appearance-config"
              data-openbitfun-part="palettePicker"
            >
              <div
                className="appearance-settings__palette-select"
                data-openbitfun-component="appearance-config"
                data-openbitfun-part="paletteSelect"
              >
                <Select
                  size="sm"
                  value={selectedAppearanceId}
                  onValueChange={(value) => handleAppearanceChange(String(value))}
                  disabled={!initialized || status === 'applying'}
                  options={appearanceOptions}
                  data-testid="appearance-palette-select"
                />
              </div>
            </div>
          </ConfigPageRow>
        </ConfigPageSection>
      </div>
    </div>
  );
}

function AppearanceEffectsSection() {
  const { t } = useTranslation('settings/appearance');
  const { enabled, setEnabled } = useMouseGlowPreference();

  return (
    <ConfigPageSection title={t('effects.title')} description={t('effects.hint')}>
      <ConfigPageRow
        label={t('effects.mouseGlow.label')}
        description={t('effects.mouseGlow.description')}
        align="center"
      >
        <Switch
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          aria-label={t('effects.mouseGlow.label')}
          data-testid="appearance-mouse-glow-switch"
          size="small"
        />
      </ConfigPageRow>
    </ConfigPageSection>
  );
}

const AppearanceConfig: React.FC = () => {
  const { t } = useTranslation('settings/appearance');

  return (
    <ConfigPageLayout
      className="openbitfun-appearance-config"
      data-openbitfun-component="appearance-config"
      data-openbitfun-part="root"
    >
      <ConfigPageHeader title={t('title')} subtitle={t('subtitle')} />
      <ConfigPageContent
        className="openbitfun-appearance-config__content"
        data-openbitfun-component="appearance-config"
        data-openbitfun-part="content"
      >
        <ConfigPageSectionStack data-testid="appearance-config">
          <AppearanceSelectionSection />
          <AppearancePackageConfigSection />
          <AppearanceEffectsSection />
          <FontPreferencePanel />
        </ConfigPageSectionStack>
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default AppearanceConfig;
