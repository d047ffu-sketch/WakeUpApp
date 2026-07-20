import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY_BACKGROUND_COLOR = '@wakeupapp:backgroundColor';
export const BACKGROUND_COLOR_OPTIONS = [
  { id: 'default', label: 'デフォルト', color: '#f2f4f5' },
  { id: 'sky', label: 'スカイ', color: '#dceefc' },
  { id: 'mint', label: 'ミント', color: '#e0f2f1' },
  { id: 'peach', label: 'ピーチ', color: '#ffe5d4' },
  { id: 'lavender', label: 'ラベンダー', color: '#f3e8ff' },
];

const DEFAULT_BACKGROUND_COLOR = BACKGROUND_COLOR_OPTIONS[0].color;

type BackgroundColorContextType = {
  backgroundColor: string;
  setBackgroundColor: (color: string) => Promise<void>;
};

const BackgroundColorContext = createContext<BackgroundColorContextType>({
  backgroundColor: DEFAULT_BACKGROUND_COLOR,
  setBackgroundColor: async () => { },
});

export function BackgroundColorProvider({ children }: { children: React.ReactNode }) {
  const [backgroundColor, setBackgroundColorState] = useState(DEFAULT_BACKGROUND_COLOR);

  useEffect(() => {
    (async () => {
      const savedColor = await AsyncStorage.getItem(STORAGE_KEY_BACKGROUND_COLOR);
      if (savedColor) {
        setBackgroundColorState(savedColor);
      }
    })();
  }, []);

  const setBackgroundColor = async (color: string) => {
    setBackgroundColorState(color);
    await AsyncStorage.setItem(STORAGE_KEY_BACKGROUND_COLOR, color);
  };

  return (
    <BackgroundColorContext.Provider value={{ backgroundColor, setBackgroundColor }}>
      {children}
    </BackgroundColorContext.Provider>
  );
}

export function useBackgroundColor() {
  return useContext(BackgroundColorContext);
}
