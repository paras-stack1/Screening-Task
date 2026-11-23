import type { AreaNode } from '@balswasthya/shared-contracts';
import { useId, useState } from 'react';
import { Alert, Button, Loading } from '../../components/ui';
import { errorMessageKey, useI18n, type TranslationKey } from '../../i18n';
import { useAreas } from './api';
import { areaLabel } from './format';

/**
 * Chooses one area from the administrator's own part of the tree (GET /areas): browse down from
 * their top areas, or search by name or code. Only areas the API offers can be chosen; the API
 * checks the choice again when the account or assignment is saved.
 */
export function areaPath(language: 'en' | 'hi', area: AreaNode): string {
  return [
    ...area.path.map((p) => areaLabel(language, p.nameEn, p.nameHi)),
    areaLabel(language, area.nameEn, area.nameHi),
  ].join(' › ');
}

export function AreaPicker({
  label,
  value,
  onChange,
  errorKey,
}: {
  label: string;
  value: AreaNode | null;
  onChange: (area: AreaNode | null) => void;
  errorKey?: string;
}) {
  const { t, language } = useI18n();
  const id = useId();
  const [trail, setTrail] = useState<AreaNode[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const search = searchInput.trim().length >= 2 ? searchInput.trim() : undefined;
  const parent = trail.at(-1);
  const areas = useAreas(search ? { search } : { parentId: parent?.id }, value === null);

  if (value) {
    return (
      <div className="field">
        <span className="field-label">{label}</span>
        <p className="selected-area" data-testid="selected-area">
          {t('areaPicker.selected', { path: areaPath(language, value) })}
        </p>
        <Button variant="link" onClick={() => onChange(null)}>
          {t('areaPicker.change')}
        </Button>
      </div>
    );
  }

  return (
    <fieldset className="field area-picker" aria-describedby={errorKey ? `${id}-error` : undefined}>
      <legend>{label}</legend>
      <label className="field-hint" htmlFor={`${id}-search`}>
        {t('areaPicker.searchLabel')}
      </label>
      <input
        id={`${id}-search`}
        type="search"
        value={searchInput}
        placeholder={t('areaPicker.searchPlaceholder')}
        onChange={(event) => setSearchInput(event.target.value)}
      />

      {!search && (
        <nav className="breadcrumbs" aria-label={t('areaPicker.top')}>
          <Button variant="link" onClick={() => setTrail([])} disabled={trail.length === 0}>
            {t('areaPicker.top')}
          </Button>
          {trail.map((node, index) => (
            <span key={node.id}>
              {' › '}
              <Button
                variant="link"
                onClick={() => setTrail(trail.slice(0, index + 1))}
                disabled={index === trail.length - 1}
              >
                {areaLabel(language, node.nameEn, node.nameHi)}
              </Button>
            </span>
          ))}
        </nav>
      )}

      {areas.isPending ? (
        <Loading />
      ) : areas.isError ? (
        <Alert tone="error">{t(errorMessageKey(areas.error))}</Alert>
      ) : areas.data.items.length === 0 ? (
        <p className="muted">{t('areaPicker.empty')}</p>
      ) : (
        <ul className="area-list">
          {areas.data.items.map((area) => (
            <li key={area.id}>
              <div>
                <strong>{areaLabel(language, area.nameEn, area.nameHi)}</strong>{' '}
                <span className="muted small">
                  {language === 'hi' ? area.levelNameHi : area.levelNameEn}
                  {search &&
                    area.path.length > 0 &&
                    ` · ${area.path.map((p) => areaLabel(language, p.nameEn, p.nameHi)).join(' › ')}`}
                </span>
              </div>
              <div className="area-actions">
                {!search && area.childCount > 0 && (
                  <Button
                    variant="secondary"
                    aria-label={t('areaPicker.open', { name: areaLabel(language, area.nameEn, area.nameHi) })}
                    onClick={() => setTrail([...trail, area])}
                  >
                    {t('areaPicker.subAreas', { count: area.childCount })}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  aria-label={`${t('areaPicker.select')}: ${areaLabel(language, area.nameEn, area.nameHi)}`}
                  onClick={() => onChange(area)}
                >
                  {t('areaPicker.select')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {areas.data?.truncated && <p className="muted small">{t('areaPicker.truncated')}</p>}
      {errorKey && (
        <p className="field-error" id={`${id}-error`}>
          {t(errorKey as TranslationKey)}
        </p>
      )}
    </fieldset>
  );
}
