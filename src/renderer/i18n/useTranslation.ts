// PhotoCatalog i18n Hook
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { translations, Language, TranslationKey } from './translations';

interface LanguageStore {
  language: Language;
  setLanguage: (lang: Language) => void;
}

export const useLanguageStore = create<LanguageStore>()(
  persist(
    (set) => ({
      language: 'en',
      setLanguage: (lang: Language) => set({ language: lang }),
    }),
    {
      name: 'photocatalog-language',
    }
  )
);

export function useTranslation() {
  const { language, setLanguage } = useLanguageStore();

  const t = (key: TranslationKey): string => {
    return translations[language][key] as string || translations.en[key] as string || key;
  };

  const tArray = (key: 'months'): string[] => {
    return translations[language][key] || translations.en[key];
  };

  return {
    t,
    tArray,
    language,
    setLanguage,
  };
}

export { Language };
