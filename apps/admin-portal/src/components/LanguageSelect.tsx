import { isLanguage, LANGUAGE_OPTIONS, useI18n } from '../i18n';

export function LanguageSelect() {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className="language-select">
      <span>{t('common.language')}</span>
      <select
        value={language}
        onChange={(event) => {
          if (isLanguage(event.target.value)) setLanguage(event.target.value);
        }}
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value} lang={option.value}>
            {option.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}
