import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { BackgroundColorProvider } from '@/lib/background-color-context';

export const unstable_settings = {
  anchor: '(tabs)',
};

// 認証状態を見て、表示すべき画面グループへ自動で振り分けるコンポーネント。
function RootLayoutNav() {
  const { user, initializing } = useAuth();
  const segments = useSegments(); // 今いる画面のパス（例: ['(auth)', 'login']）
  const router = useRouter();

  useEffect(() => {
    // 起動直後のログイン確認中は何もしない。
    if (initializing) return;

    // 今 (auth) グループ（ログイン・登録画面）にいるかどうか。
    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      // 未ログインなのにアプリ本体にいる → ログイン画面へ追い出す。
      router.replace('/login');
    } else if (user && inAuthGroup) {
      // ログイン済みなのにログイン画面にいる → ホームへ送る。
      router.replace('/');
    }
  }, [user, initializing, segments, router]);

  // ログイン状態の確認中はくるくる（ローディング）を表示。
  if (initializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="match/[roomId]" options={{ headerShown: false }} />
      <Stack.Screen name="talk-waiting/[roomId]" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[roomId]" options={{ title: 'チャット' }} />
      <Stack.Screen name="history/[roomId]" options={{ title: 'トーク履歴' }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    // AuthProvider で全体を包み、どの画面からでもログイン状態を参照できるようにする。
    <AuthProvider>
      <BackgroundColorProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <RootLayoutNav />
          <StatusBar style="auto" />
        </ThemeProvider>
      </BackgroundColorProvider>
    </AuthProvider>
  );
}
