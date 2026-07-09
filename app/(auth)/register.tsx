// 新規登録画面
// メールアドレス・パスワード・ニックネームでアカウントを作る。
// 登録と同時に Firestore の users/{uid} にユーザー情報を保存する。

import { Link } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
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
import { auth, db } from '../../firebase';

export default function RegisterScreen() {
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // 登録ボタンを押したときの処理。
  const handleRegister = async () => {
    // 未入力チェック。
    if (!nickname || !email || !password) {
      Alert.alert('入力エラー', 'すべての項目を入力してください。');
      return;
    }
    // パスワードは6文字以上（Firebase の最低条件）。
    if (password.length < 6) {
      Alert.alert('入力エラー', 'パスワードは6文字以上で設定してください。');
      return;
    }

    setLoading(true);
    try {
      // 1) Firebase Authentication にアカウントを作る。
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);

      // 2) Firestore の users/{uid} に、このユーザーの情報を保存する。
      //    仕様のデータ構造に合わせて nickname / status / currentRoomId を持たせる。
      await setDoc(doc(db, 'users', credential.user.uid), {
        nickname: nickname.trim(),
        status: 'online', // online / matching / chatting のいずれか
        currentRoomId: '', // 現在いるチャット部屋のID（まだ無いので空）
        coinBalance: 0,
        pendingStake: 0,
        pendingStakeStatus: 'none',
        pendingStakeRoomId: '',
      });

      // 登録に成功するとログイン状態になり、_layout.tsx が自動でホームへ移動させる。
    } catch (e: any) {
      Alert.alert('登録に失敗しました', getErrorMessage(e.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>
        <Text style={styles.title}>Alチャット</Text>
        <Text style={styles.subtitle}>新規登録</Text>

        {/* ニックネーム入力欄（ラベル付き）。チャットで相手に表示される名前。 */}
        <Text style={styles.label}>ニックネーム</Text>
        <TextInput
          style={styles.input}
          placeholder="例：たろう"
          value={nickname}
          onChangeText={setNickname}
          maxLength={20}
        />

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
          placeholder="6文字以上で入力"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>登録する</Text>
          )}
        </TouchableOpacity>

        {/* ログイン画面へ戻るリンク */}
        <Link href="/login" style={styles.link}>
          <Text style={styles.linkText}>すでにアカウントをお持ちの方はこちら（ログイン）</Text>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

// Firebase のエラーコードを日本語に変換する。
function getErrorMessage(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'メールアドレスの形式が正しくありません。';
    case 'auth/email-already-in-use':
      return 'このメールアドレスは既に登録されています。';
    case 'auth/weak-password':
      return 'パスワードが簡単すぎます。6文字以上にしてください。';
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
