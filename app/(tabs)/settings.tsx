// 設定画面
// 今はログイン中ユーザーの情報表示とログアウトのみ。
// 通報・ブロックなどの安全機能は Phase 6 で追加する。

import AppSafeArea from '@/components/app-safe-area';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useBgColor } from '../../lib/bg-color-context';
import { auth, db } from '../../firebase';
import { useAuth } from '../../lib/auth-context';

export default function SettingsScreen() {
  const { user } = useAuth();
  const [nickname, setNickname] = useState('');
  const { bgColor, setBgColor } = useBgColor();

  // 自分のニックネームを読み込む。
  useEffect(() => {
    if (!user) return;
    (async () => {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        setNickname(snap.data().nickname ?? '');
      }
    })();
    // 背景色は BgColorProvider が読み込むためここでは不要
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

  // 背景色変更処理（グローバルの setter を使う）
  const changeBgColor = async (color: string) => {
    try {
      await setBgColor(color);
    } catch {
      Alert.alert('エラー', '背景色の保存に失敗しました。');
    }
  };

  return (
    <AppSafeArea style={styles.container}>
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

        {/* 背景色設定 */}
        <View style={styles.card}>
          <Text style={styles.label}>背景色</Text>
          <View style={{ height: 12 }} />
          <View style={styles.colorRow}>
            <TouchableOpacity
              style={[styles.colorSwatch, { backgroundColor: '#f2f4f5' }, bgColor === '#f2f4f5' ? styles.colorSelected : null]}
              onPress={() => changeBgColor('#f2f4f5')}
            />

            <TouchableOpacity
              style={[styles.colorSwatch, { backgroundColor: '#fff8e7' }, bgColor === '#fff8e7' ? styles.colorSelected : null]}
              onPress={() => changeBgColor('#fff8e7')}
            />
            <TouchableOpacity
              style={[styles.colorSwatch, { backgroundColor: '#e8f7ff' }, bgColor === '#e8f7ff' ? styles.colorSelected : null]}
              onPress={() => changeBgColor('#e8f7ff')}
            />
            <TouchableOpacity
              style={[styles.colorSwatch, { backgroundColor: '#fdeef8' }, bgColor === '#fdeef8' ? styles.colorSelected : null]}
              onPress={() => changeBgColor('#fdeef8')}
            />
            <TouchableOpacity
              style={[styles.colorSwatch, { backgroundColor: '#e6fff1' }, bgColor === '#e6fff1' ? styles.colorSelected : null]}
              onPress={() => changeBgColor('#e6fff1')}
            />
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>ログアウト</Text>
        </TouchableOpacity>
      </View>
    </AppSafeArea>
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
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  colorSwatch: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    marginRight: 12,
  },
  colorSelected: {
    borderColor: '#0a7ea4',
    borderWidth: 2,
  },
});
