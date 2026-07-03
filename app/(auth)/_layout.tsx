import { Stack } from 'expo-router';

// ログイン・新規登録画面のまとまり（グループ）のレイアウト。
// 上部のヘッダーは消してシンプルにする。
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
