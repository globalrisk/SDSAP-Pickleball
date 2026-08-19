import { useTranslation } from 'react-i18next'

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const current = i18n.language.startsWith('vi') ? 'vi' : 'en'

  function setLanguage(lang: 'vi' | 'en') {
    void i18n.changeLanguage(lang)
  }

  return (
    <div
      className="flex items-center gap-1 rounded-lg border border-green-200 bg-green-50 p-0.5"
      role="group"
      aria-label={t('language.label')}
    >
      <button
        type="button"
        aria-pressed={current === 'vi'}
        onClick={() => setLanguage('vi')}
        className={`min-h-8 rounded-md px-2.5 text-xs font-semibold transition-colors ${
          current === 'vi'
            ? 'bg-green-600 text-white'
            : 'text-green-800 hover:bg-green-100'
        }`}
      >
        {t('language.vi')}
      </button>
      <button
        type="button"
        aria-pressed={current === 'en'}
        onClick={() => setLanguage('en')}
        className={`min-h-8 rounded-md px-2.5 text-xs font-semibold transition-colors ${
          current === 'en'
            ? 'bg-green-600 text-white'
            : 'text-green-800 hover:bg-green-100'
        }`}
      >
        {t('language.en')}
      </button>
    </div>
  )
}
