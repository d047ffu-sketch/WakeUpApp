import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView, SafeAreaViewProps } from 'react-native-safe-area-context';
import { useBgColor } from '../lib/bg-color-context';

type Props = SafeAreaViewProps & { style?: StyleProp<ViewStyle> };

export const AppSafeArea: React.FC<Props> = ({ children, style, ...rest }) => {
  const { bgColor } = useBgColor();
  return (
    <SafeAreaView style={[style, { flex: 1, backgroundColor: bgColor ?? '#f2f4f5' }]} {...rest}>
      {children}
    </SafeAreaView>
  );
};

export default AppSafeArea;
