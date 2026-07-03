// 設定画面
// 今はログイン中ユーザーの情報表示とログアウトのみ。
// 通報・ブロックなどの安全機能は Phase 6 で追加する。

import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../../firebase';
import { useAuth } from '../../lib/auth-context';

export default function SettingsScreen() {
  const { user } = useAuth();
  const [nickname, setNickname] = useState('');

  // 自分のニックネームを読み込む。
  useEffect(() => {
    if (!user) return;
    (async () => {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        setNickname(snap.data().nickname ?? '');
      }
    })();
  }, [user]);

  // ログアウト確認 → 実行。成功すると _layout.tsx が自動でログイン画面へ戻す。
  const handleLogout = () => {
    Alert.alert('ログアウト', 'ログアウトしますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: 'ログアウト',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut(auth);
          } catch {
            Alert.alert('エラー', 'ログアウトに失敗しました。');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>設定</Text>

        {/* アカウント情報 */}
        <View style={styles.card}>
          <Text style={styles.label}>ニックネーム</Text>
          <Text style={styles.value}>{nickname || '—'}</Text>
          <View style={styles.divider} />
          <Text style={styles.label}>メールアドレス</Text>
          <Text style={styles.value}>{user?.email}</Text>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>ログアウト</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f4f5',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1D3D47',
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  label: {
    fontSize: 12,
    color: '#888',
  },
  value: {
    fontSize: 16,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 12,
  },
  logoutButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#B00020',
  },
  logoutText: {
    color: '#B00020',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
