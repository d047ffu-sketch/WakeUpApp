import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

type BgColorContextValue = {
  bgColor: string | null;
  setBgColor: (c: string | null) => Promise<void>;
};

const BgColorContext = createContext<BgColorContextValue | undefined>(undefined);

export const BgColorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [bgColor, setBgColorState] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem('@settings:bgColor');
        if (v) setBgColorState(v);
      } catch {
        // ignore
      }
    })();
  }, []);

  const setBgColor = async (c: string | null) => {
    try {
      if (c) await AsyncStorage.setItem('@settings:bgColor', c);
      else await AsyncStorage.removeItem('@settings:bgColor');
    } catch {
      // ignore
    }
    setBgColorState(c);
  };

  return <BgColorContext.Provider value={{ bgColor, setBgColor }}>{children}</BgColorContext.Provider>;
};

export const useBgColor = () => {
  const ctx = useContext(BgColorContext);
  if (!ctx) throw new Error('useBgColor must be used within BgColorProvider');
  return ctx;
};

export default BgColorContext;
