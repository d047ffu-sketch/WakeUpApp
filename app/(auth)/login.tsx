// ログイン画面
// メールアドレスとパスワードを入力してログインする。

import { Link } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth } from '../../firebase';
import { useBackgroundColor } from '../../lib/background-color-context';

export default function LoginScreen() {
  const { backgroundColor } = useBackgroundColor();
  // 入力欄の状態を保持する。
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false); // ログイン処理中かどうか

  // ログインボタンを押したときの処理。
  const handleLogin = async () => {
    // 未入力チェック。
    if (!email || !password) {
      Alert.alert('入力エラー', 'メールアドレスとパスワードを入力してください。');
      return;
    }

    setLoading(true);
    try {
      // Firebase にログインを依頼する。
      // 成功すると _layout.tsx の監視が反応して自動でホームへ移動する。
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e: any) {
      // 失敗したらエラー内容に応じてメッセージを出す。
      Alert.alert('ログインに失敗しました', getErrorMessage(e.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>
        <Text style={styles.title}>Alチャット</Text>
        <Text style={styles.subtitle}>ログイン</Text>

        {/* メールアドレス入力欄（ラベル付き） */}
        <Text style={styles.label}>メールアドレス</Text>
        <TextInput
          style={styles.input}
          placeholder="例：sample@email.com"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        {/* パスワード入力欄（ラベル付き） */}
        <Text style={styles.label}>パスワード</Text>
        <TextInput
          style={styles.input}
          placeholder="パスワードを入力"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>ログイン</Text>
          )}
        </TouchableOpacity>

        {/* 新規登録画面へのリンク */}
        <Link href="/register" style={styles.link}>
          <Text style={styles.linkText}>アカウントを持っていない方はこちら（新規登録）</Text>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

// Firebase のエラーコードを、日本語の分かりやすい文章に変換する。
function getErrorMessage(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'メールアドレスの形式が正しくありません。';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'メールアドレスまたはパスワードが間違っています。';
    default:
      return '時間をおいて、もう一度お試しください。';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#1D3D47',
  },
  subtitle: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 32,
    color: '#555',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#1D3D47',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  link: {
    marginTop: 24,
    alignSelf: 'center',
  },
  linkText: {
    color: '#1D3D47',
    fontSize: 14,
  },
});
